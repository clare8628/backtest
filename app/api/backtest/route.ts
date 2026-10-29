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
  trendStrength,
  incomeProfile,
} from "@/lib/backtest";
import { fetchMultiple, fetchDailyPrices, isTaiwanListed } from "@/lib/marketData";
import { ChartSeries } from "@/lib/types";
import {
  FUND_SIZE_AS_OF,
  fundSizeIn,
  getAssetClass,
  getCreditRating,
  hasKnownManagementFee,
  nativeCurrencyOf,
} from "@/lib/symbolCatalog";
import { isSimulatedSymbol, stripSimSuffix } from "@/lib/leverageSim";

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
const CEILING_FETCH_YEARS = 50;

function benchmarkFor(symbol: string): string {
  return isTaiwanListed(symbol) ? TW_MARKET_BENCHMARK_SYMBOL : US_MARKET_BENCHMARK_SYMBOL;
}

// Simulated prices only count if the compared window actually reaches them —
// aligning to a shorter peer can trim the simulated stretch away entirely.
function usesSimulation(s: { prices: { date: string }[]; simulatedUntil?: string }): boolean {
  return !!s.simulatedUntil && s.prices.length > 0 && s.prices[0].date < s.simulatedUntil;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const symbols: string[] = Array.isArray(body?.symbols) ? body.symbols : [];
    const rangeYears: number = typeof body?.rangeYears === "number" ? body.rangeYears : 5;
    const startDate: string | undefined =
      typeof body?.startDate === "string" && body.startDate ? body.startDate : undefined;
    const endDate: string | undefined =
      typeof body?.endDate === "string" && body.endDate ? body.endDate : undefined;
    const startValue: number =
      typeof body?.startValue === "number" && body.startValue > 0 ? body.startValue : 100;

    const forceRefresh: boolean = Boolean(body?.forceRefresh);

    if (symbols.length === 0) {
      return NextResponse.json(
        { error: "symbols is required", metrics: [], recommendations: [], chartSeries: [], errors: [] },
        { status: 400 }
      );
    }
    if (symbols.length > 15) {
      return NextResponse.json(
        {
          error: "max 15 symbols per comparison",
          metrics: [],
          recommendations: [],
          chartSeries: [],
          errors: [{ symbol: "*", message: "max 15 symbols per comparison" }],
        },
        { status: 400 }
      );
    }

    // Determine how many years of daily data we need to fetch.
    // If a custom startDate is specified, ensure the fetch window reaches back far enough.
    const MS_PER_YEAR = 1000 * 60 * 60 * 24 * 365.25;
    const yearsFromStart = startDate
      ? Math.ceil((Date.now() - new Date(startDate).getTime()) / MS_PER_YEAR) + 1
      : rangeYears;
    const fetchRangeYears = Math.min(30, Math.max(rangeYears, yearsFromStart));

    // Main fetch at the user's requested (daily-resolution) range, plus a
    // parallel low-cost fetch purely to learn each symbol's true native date
    // span for the "max backtestable years" ceiling (see CEILING_FETCH_YEARS).
    const [{ results, errors }, { results: ceilingResults }] = await Promise.all([
      fetchMultiple(symbols, fetchRangeYears, forceRefresh),
      fetchMultiple(symbols, CEILING_FETCH_YEARS, forceRefresh),
    ]);

    // Each symbol's own maximum backtestable history, independent of the
    // currently selected range — a fund listed 2 years ago tops out at ~2
    // years no matter how far the range slider is pushed.
    const maxBacktestYears: Record<string, number> = {};
    const firstTradeDates: Record<string, string | undefined> = {};
    for (const s of ceilingResults) {
      maxBacktestYears[s.symbol] = seriesYears(s.prices);
      firstTradeDates[s.symbol] = s.prices[0]?.date;
    }

    // Each symbol's actual data span within the requested range — a fund
    // listed more recently than `rangeYears` ago falls short of it.
    const windowedYears: Record<string, number> = {};
    for (const s of results) windowedYears[s.symbol] = seriesYears(s.prices);

    // When a group contains both a simulated series (e.g. TQQQ@sim) and its
    // un-simulated counterpart (e.g. TQQQ), the un-simulated series is present
    // specifically to compare real vs simulated side by side. It has less history
    // by design and must not drag the whole group's shared start forward to its
    // own later real inception, otherwise the simulated stretch of TQQQ@sim
    // would be aligned away.
    const simVariantBases = new Set(
      results
        .filter((s) => isSimulatedSymbol(s.symbol))
        .map((s) => stripSimSuffix(s.symbol).toUpperCase())
    );
    const unsimulatedCounterparts = new Set(
      results
        .filter((s) => !isSimulatedSymbol(s.symbol) && simVariantBases.has(s.symbol.toUpperCase()))
        .map((s) => s.symbol)
    );

    // Auto-align the whole group to the overlapping window shared by every
    // symbol, pegged to whichever one has the shortest available history, so
    // headline metrics never silently span different eras across symbols.
    const baseWindow = commonWindow(results, unsimulatedCounterparts);
    let window = baseWindow;
    if (window && (startDate || endDate)) {
      const effStart = startDate && startDate > window.start ? startDate : window.start;
      const effEnd = endDate && endDate < window.end ? endDate : window.end;
      if (effStart <= effEnd) {
        window = { start: effStart, end: effEnd };
      }
    }
    const alignedResults = window
      ? results.map((s) => ({ ...s, prices: trimToWindow(s.prices, window) }))
      : results;

    const constraintCandidates = results.filter((s) => !unsimulatedCounterparts.has(s.symbol));
    const yearsValues = constraintCandidates.map((s) => windowedYears[s.symbol]);
    const minYears = yearsValues.length > 0 ? Math.min(...yearsValues) : 0;
    const maxYears = yearsValues.length > 0 ? Math.max(...yearsValues) : 0;
    // Only call out a "constraint" when history lengths actually differ —
    // if every symbol already covers the full requested range there's nothing
    // to explain.
    const constrainedBy =
      constraintCandidates.length > 1 && maxYears - minYears > 0.05
        ? constraintCandidates.find((s) => windowedYears[s.symbol] === minYears)?.symbol ?? null
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
            : (await fetchDailyPrices(benchmarkSymbol, rangeYears, forceRefresh)).prices;
          benchmarkReturns.set(benchmarkSymbol, dailyReturnsWithDates(prices));
        } catch {
          // Benchmark unavailable — Beta will be reported as null (not guessed).
          benchmarkReturns.set(benchmarkSymbol, []);
        }
      })
    );

    // A group that mixes US and Taiwan symbols has to be read in one currency
    // to be read at all, so fetch the USD/TWD rate once, before anything that
    // needs it: the chart converts every point with it, and the fund-size
    // column converts each fund's net assets with the rate on the day those
    // figures were measured.
    const currenciesPresent = new Set(alignedResults.map((s) => nativeCurrencyOf(s.symbol)));
    const mixedCurrencies = currenciesPresent.has("USD") && currenciesPresent.has("TWD");

    let rateAt: ((date: string) => number | null) | null = null;
    if (mixedCurrencies) {
      try {
        const fx = await fetchDailyPrices(USD_TWD_FX_SYMBOL, rangeYears, forceRefresh);
        rateAt = fxLookup(fx.prices);
      } catch {
        rateAt = null; // FX unavailable — chart falls back to native-currency-only per symbol.
      }
    }
    // Fund sizes are all quoted in USD once the group spans both markets;
    // a single-market group keeps the currency that market quotes.
    const fundSizeSnapshotRate = rateAt ? rateAt(FUND_SIZE_AS_OF) : null;

    const metrics = alignedResults.map((s) => {
      const benchmarkSymbol = benchmarkFor(s.symbol);
      const m = computeMetrics(s, startValue, benchmarkReturns.get(benchmarkSymbol) ?? []);
      const trend = trendStrength(s.prices);
      const income = incomeProfile(s.prices, s.dividends);
      const fundSize = fundSizeIn(
        s.symbol,
        mixedCurrencies ? "USD" : nativeCurrencyOf(s.symbol),
        fundSizeSnapshotRate
      );
      // Splits within the aligned backtest window specifically — s.splits
      // itself still spans the full requested rangeYears fetch, untrimmed.
      const windowSplits = s.splits
        ? s.splits.filter((sp) => (!window || (sp.date >= window.start && sp.date <= window.end)))
        : undefined;
      const splitCount = windowSplits ? windowSplits.length : undefined;
      return {
        ...m,
        benchmarkSymbol,
        simulated: isSimulatedSymbol(s.symbol) && usesSimulation(s),
        maxBacktestYears: round2(maxBacktestYears[s.symbol] ?? 0),
        firstDate: firstTradeDates[s.symbol],
        trendR2: trend.trendR2 === null ? null : round2(trend.trendR2),
        newHighMonthPct: trend.newHighMonthPct === null ? null : round2(trend.newHighMonthPct),
        positiveYearPct: trend.positiveYearPct === null ? null : round2(trend.positiveYearPct),
        gainPainRatio: trend.gainPainRatio === null ? null : round2(trend.gainPainRatio),
        splitCount,
        splits: windowSplits,
        assetClass: getAssetClass(s.symbol),
        creditRating: getCreditRating(s.symbol),
        fundSize: fundSize.value,
        fundSizeCurrency: fundSize.currency,
        fundSizeUnavailableReason: fundSize.unavailableReason,
        estimatedYieldPct:
          income.estimatedYieldPct === null ? null : round2(income.estimatedYieldPct),
        distributionsPerYear: income.distributionsPerYear,
        latestDistribution: income.latestDistribution === null ? null : Math.round(income.latestDistribution * 10000) / 10000,
        latestExDate: income.latestExDate,
        latestAnnualizedYieldPct:
          income.latestAnnualizedYieldPct === null ? null : round2(income.latestAnnualizedYieldPct),
        avgAnnualizedYieldPct:
          income.avgAnnualizedYieldPct === null ? null : round2(income.avgAnnualizedYieldPct),
        managementFeeKnown: hasKnownManagementFee(s.symbol),
      };
    });
    const recommendations = recommend(metrics);

    // Chart series in actual price (not indexed), built from the same aligned
    // window as the metrics above so the chart's x-axis and the table's
    // numbers describe the same period. Both currencies are sent for every
    // point so the toggle costs no data round-trip.
    const chartSeries: ChartSeries[] = alignedResults.map((s) => {
      const currency = nativeCurrencyOf(s.symbol);
      const windowSplits = s.splits
        ? s.splits.filter((sp) => (!window || (sp.date >= window.start && sp.date <= window.end)))
        : undefined;
      const splitDates = windowSplits ? windowSplits.map((sp) => sp.date) : [];
      const sampled = downsamplePrices(s.prices, 120, splitDates);
      const points = sampled.map((p) => {
        const rate = rateAt ? rateAt(p.date) : null; // TWD per 1 USD
        const priceUSD = currency === "USD" ? p.close : rate !== null ? round2(p.close / rate) : null;
        const priceTWD = currency === "TWD" ? p.close : rate !== null ? round2(p.close * rate) : null;
        return { date: p.date, priceUSD, priceTWD };
      });
      return { symbol: s.symbol, currency, points, simulated: isSimulatedSymbol(s.symbol) && usesSimulation(s), splits: windowSplits };
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
