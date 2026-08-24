import { NextRequest, NextResponse } from "next/server";
import { computeMetrics, recommend, normalizeToIndex, dailyReturnsWithDates } from "@/lib/backtest";
import { fetchMultiple, fetchDailyPrices } from "@/lib/marketData";

const MARKET_BENCHMARK_SYMBOL = "SPY";

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

    // Fetch SPY as the market benchmark for Beta, reusing the already-fetched
    // series if the user's own comparison includes SPY, so we don't fetch it twice.
    const existingBenchmark = results.find(
      (s) => s.symbol.toUpperCase() === MARKET_BENCHMARK_SYMBOL
    );
    let marketReturns: { date: string; value: number }[] = [];
    if (existingBenchmark) {
      marketReturns = dailyReturnsWithDates(existingBenchmark.prices);
    } else {
      try {
        const benchmark = await fetchDailyPrices(MARKET_BENCHMARK_SYMBOL, rangeYears);
        marketReturns = dailyReturnsWithDates(benchmark.prices);
      } catch {
        // Benchmark unavailable — Beta will be reported as null (not guessed).
        marketReturns = [];
      }
    }

    const metrics = results.map((s) => computeMetrics(s, startValue, marketReturns));
    const recommendations = recommend(metrics);

    // Normalized series (indexed to 100 at the first data point) for charting.
    const series = results.map((s) => ({
      symbol: s.symbol,
      points: normalizeToIndex(s.prices),
    }));

    return NextResponse.json({
      metrics,
      recommendations,
      series,
      errors,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
