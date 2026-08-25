import { NextRequest, NextResponse } from "next/server";
import {
  computeMetrics,
  recommend,
  normalizeToIndex,
  dailyReturnsWithDates,
  seriesYears,
  commonWindow,
  trimToWindow,
} from "@/lib/backtest";
import { fetchMultiple, fetchDailyPrices } from "@/lib/marketData";

// A Taiwan-listed fund's daily correlation to the US market isn't a meaningful
// "Beta" for it, so each symbol is measured against its own market's benchmark:
// SPY for everything else, 0050.TW (Taiwan's broad market-cap-weighted ETF) for
// tickers listed on the TWSE.
const US_MARKET_BENCHMARK_SYMBOL = "SPY";
const TW_MARKET_BENCHMARK_SYMBOL = "0050.TW";

function isTaiwanListed(symbol: string): boolean {
  return symbol.toUpperCase().endsWith(".TW");
}

function benchmarkFor(symbol: string): string {
  return isTaiwanListed(symbol) ? TW_MARKET_BENCHMARK_SYMBOL : US_MARKET_BENCHMARK_SYMBOL;
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

    const { results, errors } = await fetchMultiple(symbols, rangeYears);

    // Each symbol's own actual data span within the requested range — a fund
    // listed more recently than `rangeYears` ago falls short of it.
    const availableYears: Record<string, number> = {};
    for (const s of results) availableYears[s.symbol] = seriesYears(s.prices);

    // Auto-align the whole group to the overlapping window shared by every
    // symbol, pegged to whichever one has the shortest available history, so
    // headline metrics never silently span different eras across symbols.
    const window = commonWindow(results);
    const alignedResults = window
      ? results.map((s) => ({ ...s, prices: trimToWindow(s.prices, window) }))
      : results;

    const yearsValues = results.map((s) => availableYears[s.symbol]);
    const minYears = yearsValues.length > 0 ? Math.min(...yearsValues) : 0;
    const maxYears = yearsValues.length > 0 ? Math.max(...yearsValues) : 0;
    // Only call out a "constraint" when history lengths actually differ —
    // if every symbol already covers the full requested range there's nothing
    // to explain.
    const constrainedBy =
      results.length > 1 && maxYears - minYears > 0.05
        ? results.find((s) => availableYears[s.symbol] === minYears)?.symbol ?? null
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
        availableYears: round2(availableYears[s.symbol] ?? 0),
      };
    });
    const recommendations = recommend(metrics);

    // Normalized series (indexed to 100 at the first data point) for charting,
    // built from the same aligned window as the metrics above so the chart's
    // x-axis and the table's numbers describe the same period.
    const series = alignedResults.map((s) => ({
      symbol: s.symbol,
      points: normalizeToIndex(s.prices),
    }));

    return NextResponse.json({
      metrics,
      recommendations,
      series,
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
