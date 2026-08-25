import { NextRequest, NextResponse } from "next/server";
import {
  computeMetrics,
  recommend,
  dailyReturnsWithDates,
  seriesYears,
  commonWindow,
  trimToWindow,
  downsamplePrices,
  fxLookup,
} from "@/lib/backtest";
import { fetchMultiple, fetchDailyPrices } from "@/lib/marketData";
import { Currency, ChartSeries } from "@/lib/types";

// A Taiwan-listed fund's daily correlation to the US market isn't a meaningful
// "Beta" for it, so each symbol is measured against its own market's benchmark:
// SPY for everything else, 0050.TW (Taiwan's broad market-cap-weighted ETF) for
// tickers listed on the TWSE.
const US_MARKET_BENCHMARK_SYMBOL = "SPY";
const TW_MARKET_BENCHMARK_SYMBOL = "0050.TW";
// Yahoo Finance FX ticker for USD/TWD (TWD per 1 USD), used to let the chart
// show a mixed US+TW comparison in one common currency.
const USD_TWD_FX_SYMBOL = "TWD=X";
// A second, separate fetch (beyond the user's requested range) so we can
// report each ETF's true backtestable ceiling — e.g. a fund listed 2 years
// ago tops out at ~2 years no matter how far the range slider is pushed.
// The UI's slider never exceeds 20 years, so this comfortably covers it;
// funds older than this (e.g. SPY, ~33y) just get capped here, which doesn't
// matter since the slider can't reach that far anyway.
//
// This MUST stay a separate fetch from the main one used for metrics/chart
// data: Yahoo silently coarsens very long ranges to monthly bars — even with
// interval=1d explicitly requested — so reusing it for the actual analysis
// window would badly degrade every metric (volatility, Sharpe, drawdown,
// beta, the chart itself) down to monthly resolution, not just the ceiling
// calculation that can tolerate it.
const CEILING_FETCH_YEARS = 30;

function isTaiwanListed(symbol: string): boolean {
  return symbol.toUpperCase().endsWith(".TW");
}

function benchmarkFor(symbol: string): string {
  return isTaiwanListed(symbol) ? TW_MARKET_BENCHMARK_SYMBOL : US_MARKET_BENCHMARK_SYMBOL;
}

function nativeCurrency(symbol: string): Currency {
  return isTaiwanListed(symbol) ? "TWD" : "USD";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const symbols: string[] = Array.isArray(body?.symbols) ? body.symbols : [];
    const rangeYears: number = typeof body?.rangeYears === "number" ? body.rangeYears : 5;
    const startValue: number =
      typeof body?.startValue === "number" && body.startValue > 0 ? body.startValue : 1000;

    if (symbols.length === 0) {
      return NextResponse.json({ error: "symbols is required" }, { status: 400 });
    }
    if (symbols.length > 10) {
      return NextResponse.json({ error: "max 10 symbols per comparison" }, { status: 400 });
    }

    // Main fetch at the user's requested (daily-resolution) range, plus a
    // parallel low-cost fetch purely to learn each symbol's true native date
    // span for the "max backtestable years" ceiling (see CEILING_FETCH_YEARS).
    const [{ results, errors }, { results: ceilingResults }] = await Promise.all([
      fetchMultiple(symbols, rangeYears),
      fetchMultiple(symbols, CEILING_FETCH_YEARS),
    ]);

    // Each symbol's own maximum backtestable history, independent of the
    // currently selected range — a fund listed 2 years ago tops out at ~2
    // years no matter how far the range slider is pushed.
    const maxBacktestYears: Record<string, number> = {};
    for (const s of ceilingResults) maxBacktestYears[s.symbol] = seriesYears(s.prices);

    // Each symbol's actual data span within the requested range — a fund
    // listed more recently than `rangeYears` ago falls short of it.
    const windowedYears: Record<string, number> = {};
    for (const s of results) windowedYears[s.symbol] = seriesYears(s.prices);

    // Auto-align the whole group to the overlapping window shared by every
    // symbol, pegged to whichever one has the shortest available history, so
    // headline metrics never silently span different eras across symbols.
    const window = commonWindow(results);
    const alignedResults = window
      ? results.map((s) => ({ ...s, prices: trimToWindow(s.prices, window) }))
      : results;

    const yearsValues = results.map((s) => windowedYears[s.symbol]);
    const minYears = yearsValues.length > 0 ? Math.min(...yearsValues) : 0;
    const maxYears = yearsValues.length > 0 ? Math.max(...yearsValues) : 0;
    // Only call out a "constraint" when history lengths actually differ —
    // if every symbol already covers the full requested range there's nothing
    // to explain.
    const constrainedBy =
      results.length > 1 && maxYears - minYears > 0.05
        ? results.find((s) => windowedYears[s.symbol] === minYears)?.symbol ?? null
        : null;

    // Fetch whichever benchmark(s) the group's symbols need, reusing an
    // already-fetched series (e.g. the user compared SPY or 0050.TW directly)
    // instead of double-fetching.
    const neededBenchmarks = Array.from(new Set(alignedResults.map((s) => benchmarkFor(s.symbol))));
    const benchmarkReturns = new Map<string, { date: string; value: number }[]>();
    await Promise.all(
      neededBenchmarks.map(async (benchmarkSymbol) => {
        const existing = results.find(
          (s) => s.symbol.toUpperCase() === benchmarkSymbol.toUpperCase()
        );
        try {
          const prices = existing
            ? existing.prices
            : (await fetchDailyPrices(benchmarkSymbol, rangeYears)).prices;
          benchmarkReturns.set(benchmarkSymbol, dailyReturnsWithDates(prices));
        } catch {
          // Benchmark unavailable — Beta will be reported as null (not guessed).
          benchmarkReturns.set(benchmarkSymbol, []);
        }
      })
    );

    const metrics = alignedResults.map((s) => {
      const benchmarkSymbol = benchmarkFor(s.symbol);
      const m = computeMetrics(s, startValue, benchmarkReturns.get(benchmarkSymbol) ?? []);
      return {
        ...m,
        benchmarkSymbol,
        maxBacktestYears: round2(maxBacktestYears[s.symbol] ?? 0),
      };
    });
    const recommendations = recommend(metrics);

    // Chart series in actual price (not indexed), built from the same aligned
    // window as the metrics above so the chart's x-axis and the table's
    // numbers describe the same period. When the group mixes US and Taiwan
    // symbols, fetch the USD/TWD rate once so the chart can show either
    // currency without a data round-trip on toggle.
    const currenciesPresent = new Set(alignedResults.map((s) => nativeCurrency(s.symbol)));
    const mixedCurrencies = currenciesPresent.has("USD") && currenciesPresent.has("TWD");

    let rateAt: ((date: string) => number | null) | null = null;
    if (mixedCurrencies) {
      try {
        const fx = await fetchDailyPrices(USD_TWD_FX_SYMBOL, rangeYears);
        rateAt = fxLookup(fx.prices);
      } catch {
        rateAt = null; // FX unavailable — chart falls back to native-currency-only per symbol.
      }
    }

    const chartSeries: ChartSeries[] = alignedResults.map((s) => {
      const currency = nativeCurrency(s.symbol);
      const sampled = downsamplePrices(s.prices, 120);
      const points = sampled.map((p) => {
        const rate = rateAt ? rateAt(p.date) : null; // TWD per 1 USD
        const priceUSD = currency === "USD" ? p.close : rate !== null ? round2(p.close / rate) : null;
        const priceTWD = currency === "TWD" ? p.close : rate !== null ? round2(p.close * rate) : null;
        return { date: p.date, priceUSD, priceTWD };
      });
      return { symbol: s.symbol, currency, points };
    });

    return NextResponse.json({
      metrics,
      recommendations,
      chartSeries,
      mixedCurrencies,
      errors,
      alignedWindow: window
        ? {
            start: window.start,
            end: window.end,
            years: round2(
              (new Date(window.end).getTime() - new Date(window.start).getTime()) /
                (1000 * 60 * 60 * 24 * 365.25)
            ),
          }
        : null,
      constrainedBy,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
