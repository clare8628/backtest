import { describe, it, expect } from "vitest";
import { computeMetrics, recommend, maxDrawdown, dailyReturns, dailyReturnsWithDates, normalizeToIndex, RECOMMENDATION_WEIGHTS, calculateBeta, countSwings, monthEndCloses, trendStrength } from "@/lib/backtest";
import { parseStooqCsv, toStooqSymbol } from "@/lib/marketData";
import { PricePoint, BacktestMetrics } from "@/lib/types";

function series(closes: number[]): PricePoint[] {
  return closes.map((close, i) => ({ date: `2024-01-${String(i + 1).padStart(2, "0")}`, close }));
}

/** Consecutive real calendar dates, so month boundaries land where they really do. */
function dailySeries(closes: number[]): PricePoint[] {
  const start = Date.parse("2015-01-01T00:00:00Z");
  return closes.map((close, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    close,
  }));
}

/** One point per calendar month, so each becomes its own month-end close. */
function monthlySeries(closes: number[]): PricePoint[] {
  return closes.map((close, i) => ({
    date: `${2015 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-15`,
    close,
  }));
}

describe("dailyReturns", () => {
  it("computes simple returns between consecutive days", () => {
    const rets = dailyReturns(series([100, 110, 99]));
    expect(rets[0]).toBeCloseTo(0.1, 5);
    expect(rets[1]).toBeCloseTo(-0.1, 5);
  });

  it("returns empty array for single point", () => {
    expect(dailyReturns(series([100]))).toEqual([]);
  });
});

describe("maxDrawdown", () => {
  it("returns 0 for a monotonically increasing series", () => {
    expect(maxDrawdown(series([100, 110, 120]))).toBe(0);
  });

  it("computes negative drawdown correctly", () => {
    const dd = maxDrawdown(series([100, 200, 100]));
    expect(dd).toBeCloseTo(-50, 5);
  });

  it("picks the deepest of several distinct drawdowns, not the first or last", () => {
    // peak 100 -> trough 80 (-20%), recover to 150 -> trough 90 (-40% from 150)
    const dd = maxDrawdown(series([100, 80, 150, 90]));
    expect(dd).toBeCloseTo(-40, 5);
  });

  it("measures drawdown from the running peak-so-far, not the eventual global max", () => {
    // 100 -> 50 is -50% from the peak at that point; later 200 -> 150 is only -25%.
    // The -50% dip must win even though 200 is a higher absolute price than 100.
    const dd = maxDrawdown(series([100, 50, 200, 150]));
    expect(dd).toBeCloseTo(-50, 5);
  });

  it("uses the final trough when the series never recovers", () => {
    const dd = maxDrawdown(series([100, 70, 40, 30]));
    expect(dd).toBeCloseTo(-70, 5);
  });

  it("is unaffected by the start value used for the hypothetical investment", () => {
    // Drawdown is a pure percentage of the price path — it must not change
    // when computeMetrics is called with a different startValue.
    const prices = series([100, 200, 100]);
    const m1000 = computeMetrics({ symbol: "TEST", prices }, 1000);
    const m50000 = computeMetrics({ symbol: "TEST", prices }, 50000);
    expect(m1000.maxDrawdown).toBe(m50000.maxDrawdown);
    expect(m1000.maxDrawdown).toBeCloseTo(-50, 5);
  });
});

describe("computeMetrics", () => {
  it("computes total return correctly for a simple doubling, defaulting to a 1000 start value", () => {
    const m = computeMetrics({ symbol: "TEST", prices: series([100, 150, 200]) });
    expect(m.totalReturn).toBe(100);
    expect(m.finalValue).toBe(2000);
  });

  it("handles degenerate single-point series without throwing", () => {
    const m = computeMetrics({ symbol: "TEST", prices: series([100]) });
    expect(m.totalReturn).toBe(0);
    expect(m.finalValue).toBe(1000);
  });

  it("scales the final value with a custom start value", () => {
    const m = computeMetrics({ symbol: "TEST", prices: series([100, 150, 200]) }, 5000);
    expect(m.finalValue).toBe(10000);
  });

  it("annualizes using the actual calendar span, not raw trading-day count", () => {
    // Exactly 2 calendar years apart, price doubles -> CAGR should be ~41.4%
    // (sqrt(2) - 1), independent of how many trading-day rows are in between.
    const prices: PricePoint[] = [
      { date: "2022-01-01", close: 100 },
      { date: "2022-06-01", close: 120 },
      { date: "2023-01-01", close: 130 },
      { date: "2024-01-01", close: 200 },
    ];
    const m = computeMetrics({ symbol: "TEST", prices });
    const expectedCagr = (Math.pow(200 / 100, 1 / 2) - 1) * 100;
    expect(m.annualizedReturn).toBeCloseTo(expectedCagr, 1);
    expect(m.totalReturn).toBe(100); // cumulative return stays 100%, unaffected by span
  });

  it("does not conflate a short window with a longer one that has more rows", () => {
    // Same start/end value and same short 6-month span, but with many more
    // rows in between (simulating extra data Yahoo's range bucket rounding
    // could include). Annualized return should stay high (short-window CAGR),
    // not be diluted toward the cumulative return as if it spanned years.
    const denseRows: PricePoint[] = [];
    const start = new Date("2024-01-01").getTime();
    for (let i = 0; i <= 180; i++) {
      const date = new Date(start + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const close = 100 + (i / 180) * 20; // linear 100 -> 120 over ~6 months
      denseRows.push({ date, close });
    }
    const m = computeMetrics({ symbol: "TEST", prices: denseRows });
    // ~6 months at +20% should annualize to well above 20% (short window compounding)
    expect(m.annualizedReturn).toBeGreaterThan(30);
  });

  it("looks up the real expense ratio for known ETFs instead of guessing from the symbol name", () => {
    const voo = computeMetrics({ symbol: "VOO", prices: series([100, 110, 120]) });
    const qqq = computeMetrics({ symbol: "QQQ", prices: series([100, 110, 120]) });
    const vt = computeMetrics({ symbol: "VT", prices: series([100, 110, 120]) });
    expect(voo.managementFee).toBe(0.03);
    expect(qqq.managementFee).toBe(0.2);
    expect(vt.managementFee).toBe(0.07);
  });

  it("defaults management fee to 0 for individual stocks", () => {
    const aapl = computeMetrics({ symbol: "AAPL", prices: series([100, 110, 120]) });
    expect(aapl.managementFee).toBe(0);
  });

  it("defaults management fee to 0 for symbols not in the catalog, rather than guessing", () => {
    const unknown = computeMetrics({ symbol: "UNKNOWNTICKER", prices: series([100, 110, 120]) });
    expect(unknown.managementFee).toBe(0);
  });

  it("reports beta as null when no market benchmark data is supplied, instead of a guessed number", () => {
    const m = computeMetrics({ symbol: "AAPL", prices: series([100, 110, 120, 105, 130]) });
    expect(m.beta).toBeNull();
  });

  it("computes beta of ~1.0 for the benchmark against itself", () => {
    const prices = series([100, 102, 101, 105, 103, 108, 110, 107, 112, 115]);
    const marketReturns = dailyReturnsWithDates(prices);
    const m = computeMetrics({ symbol: "SPY", prices }, 1000, marketReturns);
    expect(m.beta).not.toBeNull();
    expect(m.beta!).toBeCloseTo(1, 2);
  });
});

describe("calculateBeta", () => {
  it("returns exactly 1 for a series compared against itself (self-covariance / self-variance)", () => {
    const returns = [
      { date: "2024-01-02", value: 0.01 },
      { date: "2024-01-03", value: -0.02 },
      { date: "2024-01-04", value: 0.015 },
      { date: "2024-01-05", value: 0.005 },
      { date: "2024-01-08", value: -0.008 },
      { date: "2024-01-09", value: 0.012 },
      { date: "2024-01-10", value: -0.003 },
      { date: "2024-01-11", value: 0.007 },
      { date: "2024-01-12", value: -0.011 },
      { date: "2024-01-15", value: 0.009 },
      { date: "2024-01-16", value: 0.002 },
      { date: "2024-01-17", value: -0.006 },
      { date: "2024-01-18", value: 0.014 },
      { date: "2024-01-19", value: -0.004 },
      { date: "2024-01-22", value: 0.008 },
      { date: "2024-01-23", value: -0.009 },
      { date: "2024-01-24", value: 0.011 },
      { date: "2024-01-25", value: 0.003 },
      { date: "2024-01-26", value: -0.002 },
      { date: "2024-01-29", value: 0.006 },
      { date: "2024-01-30", value: -0.001 },
    ];
    expect(calculateBeta(returns, returns)).toBeCloseTo(1, 5);
  });

  it("doubles to beta ~2 when the asset moves exactly 2x the market on every date", () => {
    const marketReturns = Array.from({ length: 25 }, (_, i) => ({
      date: `2024-02-${String(i + 1).padStart(2, "0")}`,
      value: Math.sin(i) * 0.01,
    }));
    const assetReturns = marketReturns.map((r) => ({ date: r.date, value: r.value * 2 }));
    expect(calculateBeta(assetReturns, marketReturns)).toBeCloseTo(2, 5);
  });

  it("returns null when there isn't enough date overlap to compute a meaningful beta", () => {
    const marketReturns = [
      { date: "2024-01-01", value: 0.01 },
      { date: "2024-01-02", value: 0.02 },
    ];
    const assetReturns = [
      { date: "2099-01-01", value: 0.05 },
      { date: "2099-01-02", value: -0.03 },
    ];
    expect(calculateBeta(assetReturns, marketReturns)).toBeNull();
  });
});

describe("recommend", () => {
  const metrics: BacktestMetrics[] = [
    { symbol: "A", totalReturn: 50, annualizedReturn: 20, annualizedVolatility: 10, maxDrawdown: -5, sharpeRatio: 1.5, finalValue: 15000, beta: 0.6, managementFee: 0.05 },
    { symbol: "B", totalReturn: 10, annualizedReturn: 5, annualizedVolatility: 25, maxDrawdown: -30, sharpeRatio: 0.2, finalValue: 11000, beta: 1.5, managementFee: 0.03 },
  ];

  it("ranks the stronger performer first", () => {
    const recs = recommend(metrics);
    expect(recs[0].symbol).toBe("A");
    expect(recs[0].rank).toBe(1);
    expect(recs[1].rank).toBe(2);
  });

  it("returns empty list for empty input", () => {
    expect(recommend([])).toEqual([]);
  });

  it("provides both zh and en reasons", () => {
    const recs = recommend(metrics);
    expect(recs[0].reasons.length).toBeGreaterThan(0);
    expect(recs[0].reasonsEn.length).toBeGreaterThan(0);
  });

  it("weights sum to 1 so the displayed formula matches the actual scoring", () => {
    const total = Object.values(RECOMMENDATION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("lower beta and lower management fee improve the score when other metrics are tied", () => {
    const tied: BacktestMetrics[] = [
      { symbol: "LOW_RISK", totalReturn: 20, annualizedReturn: 10, annualizedVolatility: 15, maxDrawdown: -10, sharpeRatio: 0.8, finalValue: 1200, beta: 0.5, managementFee: 0.03 },
      { symbol: "HIGH_RISK", totalReturn: 20, annualizedReturn: 10, annualizedVolatility: 15, maxDrawdown: -10, sharpeRatio: 0.8, finalValue: 1200, beta: 1.8, managementFee: 0.75 },
    ];
    const recs = recommend(tied);
    expect(recs[0].symbol).toBe("LOW_RISK");
  });
});

describe("parseStooqCsv", () => {
  it("parses valid CSV with header", () => {
    const csv = "Date,Open,High,Low,Close,Volume\n2024-01-01,10,11,9,10.5,1000\n2024-01-02,10.5,12,10,11.5,1200";
    const points = parseStooqCsv(csv);
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ date: "2024-01-01", close: 10.5 });
  });

  it("skips malformed rows", () => {
    const csv = "Date,Open,High,Low,Close,Volume\nbad-row\n2024-01-02,10.5,12,10,11.5,1200";
    const points = parseStooqCsv(csv);
    expect(points).toHaveLength(1);
  });

  it("returns empty array for header-only CSV", () => {
    const csv = "Date,Open,High,Low,Close,Volume";
    expect(parseStooqCsv(csv)).toEqual([]);
  });
});

describe("toStooqSymbol", () => {
  it("appends .us suffix for bare tickers", () => {
    expect(toStooqSymbol("VOO")).toBe("voo.us");
  });

  it("preserves explicit market suffix", () => {
    expect(toStooqSymbol("2330.tw")).toBe("2330.tw");
  });
});

describe("normalizeToIndex", () => {
  it("indexes the first point to 100", () => {
    const points = normalizeToIndex(series([50, 55, 60]));
    expect(points[0].value).toBe(100);
  });

  it("reflects proportional change at the last point", () => {
    const points = normalizeToIndex(series([100, 150]));
    expect(points[points.length - 1].value).toBe(150);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeToIndex([])).toEqual([]);
  });

  it("always includes the last data point even when downsampled", () => {
    const longSeries = series(Array.from({ length: 500 }, (_, i) => 100 + i));
    const points = normalizeToIndex(longSeries, 50);
    expect(points[points.length - 1].date).toBe(longSeries[longSeries.length - 1].date);
  });
});

describe("countSwings", () => {
  it("counts one completed up-swing once price reverses down past the threshold, sized from its start pivot to its peak", () => {
    const { up, down, avgUpPct, avgDownPct } = countSwings(series([100, 105, 110, 120, 130, 100, 90]), 10);
    expect(up).toBe(1);
    expect(down).toBe(0);
    expect(avgUpPct).toBeCloseTo(30, 5); // 100 -> 130
    expect(avgDownPct).toBeNull();
  });

  it("counts one completed down-swing once price reverses up past the threshold, sized from its start pivot to its trough", () => {
    const { up, down, avgUpPct, avgDownPct } = countSwings(series([100, 90, 80, 70, 85, 100, 115]), 10);
    expect(down).toBe(1);
    expect(up).toBe(0);
    expect(avgDownPct).toBeCloseTo(30, 5); // 100 -> 70
    expect(avgUpPct).toBeNull();
  });

  it("does not count an in-progress leg that hasn't reversed by the threshold yet", () => {
    // Ends mid-uptrend from the down-swing's extreme (115 is only +64% off the
    // 70 low but never reverses back down), so that leg stays uncounted.
    const { up, down } = countSwings(series([100, 90, 80, 70, 85, 100, 115]), 10);
    expect(up + down).toBe(1);
  });

  it("ignores moves smaller than the threshold as noise", () => {
    const { up, down } = countSwings(series([100, 105, 102, 108, 103, 109]), 10);
    expect(up).toBe(0);
    expect(down).toBe(0);
  });

  it("averages leg size across multiple completed swings in the same direction", () => {
    // Up legs: 100->120 (+20%), then (after a down leg) 100->140 (+40%). Average 30%.
    const { up, avgUpPct } = countSwings(series([100, 120, 100, 140, 110]), 10);
    expect(up).toBe(2);
    expect(avgUpPct).toBeCloseTo(30, 5);
  });

  it("returns zero swings and null averages for a non-positive threshold or too few points", () => {
    expect(countSwings(series([100, 200]), 0)).toEqual({ up: 0, down: 0, avgUpPct: null, avgDownPct: null });
    expect(countSwings(series([100]), 10)).toEqual({ up: 0, down: 0, avgUpPct: null, avgDownPct: null });
  });

  it("can never separate an uptrend from a downtrend by leg count alone", () => {
    // The premise behind reporting only the averages: legs strictly alternate,
    // so a relentless riser and a relentless faller both come out ~even.
    const riser = countSwings(series([100, 80, 130, 105, 170, 140, 220]), 10);
    const faller = countSwings(series([100, 130, 80, 105, 60, 80, 45]), 10);
    expect(Math.abs(riser.up - riser.down)).toBeLessThanOrEqual(1);
    expect(Math.abs(faller.up - faller.down)).toBeLessThanOrEqual(1);
  });
});

describe("monthEndCloses", () => {
  it("takes the last close of each calendar month", () => {
    const prices: PricePoint[] = [
      { date: "2024-01-30", close: 10 },
      { date: "2024-01-31", close: 11 },
      { date: "2024-02-01", close: 12 },
      { date: "2024-02-29", close: 13 },
      { date: "2024-03-01", close: 14 },
    ];
    expect(monthEndCloses(prices)).toEqual([11, 13, 14]);
  });

  it("returns an empty list for an empty series", () => {
    expect(monthEndCloses([])).toEqual([]);
  });
});

describe("trendStrength", () => {
  it("scores a steady exponential riser near +100 and a steady faller near -100", () => {
    const up = dailySeries(Array.from({ length: 300 }, (_, i) => 100 * 1.002 ** i));
    const down = dailySeries(Array.from({ length: 300 }, (_, i) => 100 * 0.998 ** i));
    expect(trendStrength(up).trendR2).toBeCloseTo(100, 6);
    expect(trendStrength(down).trendR2).toBeCloseTo(-100, 6);
  });

  it("scores a sideways oscillation near zero, unlike either trend", () => {
    const flat = dailySeries(
      Array.from({ length: 300 }, (_, i) => 100 + 10 * Math.sin((i / 300) * 8 * Math.PI))
    );
    expect(Math.abs(trendStrength(flat).trendR2!)).toBeLessThan(20);
  });

  it("counts a new high in every month of a monotonic rise, and just one after an early peak", () => {
    const rising = monthlySeries(Array.from({ length: 36 }, (_, i) => 100 + i));
    expect(trendStrength(rising).newHighMonthPct).toBeCloseTo(100, 6);

    // Peaks in month 2 and never exceeds it again — 1 new high out of 35 months.
    const peaked = monthlySeries([100, 150, ...Array.from({ length: 34 }, () => 120)]);
    expect(trendStrength(peaked).newHighMonthPct).toBeCloseTo((1 / 35) * 100, 6);
  });

  it("reports the share of rolling 12-month holds that ended in profit", () => {
    // Rises for the first half, then gives it all back: early entries are up a
    // year later, late ones aren't.
    const closes = [
      ...Array.from({ length: 30 }, (_, i) => 100 + i),
      ...Array.from({ length: 30 }, (_, i) => 130 - i),
    ];
    const pct = trendStrength(monthlySeries(closes)).positiveYearPct!;
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThan(100);

    const alwaysUp = monthlySeries(Array.from({ length: 60 }, (_, i) => 100 + i));
    expect(trendStrength(alwaysUp).positiveYearPct).toBeCloseTo(100, 6);
  });

  it("leaves the 1-year win rate null when there are too few rolling windows to mean anything", () => {
    // 20 months = only 8 overlapping 12-month windows, under the minimum.
    expect(trendStrength(monthlySeries(Array.from({ length: 20 }, (_, i) => 100 + i))).positiveYearPct)
      .toBeNull();
  });

  it("gives the same monthly-basis answers whether the source bars are daily or monthly", () => {
    // The data source silently switches daily -> monthly bars over long ranges,
    // so the same underlying path must not score differently just because it
    // arrived at a coarser resolution. Build 36 months of daily bars, then the
    // month-end closes of that very series, and compare.
    const daily: PricePoint[] = [];
    const start = Date.parse("2015-01-01T00:00:00Z");
    for (let d = 0; d < 36 * 30; d++) {
      daily.push({
        date: new Date(start + d * 86_400_000).toISOString().slice(0, 10),
        close: 100 * 1.0005 ** d,
      });
    }
    const monthly = monthEndCloses(daily).map((close, i) => ({
      date: `${2015 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-28`,
      close,
    }));

    const fromDaily = trendStrength(daily);
    const fromMonthly = trendStrength(monthly);
    expect(fromDaily.newHighMonthPct).toBeCloseTo(fromMonthly.newHighMonthPct!, 6);
    expect(fromDaily.positiveYearPct).toBeCloseTo(fromMonthly.positiveYearPct!, 6);
    expect(fromDaily.gainPainRatio).toBe(fromMonthly.gainPainRatio); // both null: no down months
  });

  it("separates up from down by magnitude even when up and down months are equal in number", () => {
    // Six +20% months alternating with six -10% months — the case swing counts
    // call a tie. Gain/pain = (6 x 0.20) / (6 x 0.10) = 2.
    const closes = [100];
    for (let i = 0; i < 12; i++) {
      closes.push(closes[closes.length - 1] * (i % 2 === 0 ? 1.2 : 0.9));
    }
    expect(trendStrength(monthlySeries(closes)).gainPainRatio).toBeCloseTo(2, 6);
  });

  it("leaves gain/pain null when there are no down months to divide by", () => {
    expect(trendStrength(monthlySeries([100, 110, 120, 130])).gainPainRatio).toBeNull();
  });

  it("returns all-null for a series too short to measure", () => {
    expect(trendStrength([])).toEqual({
      trendR2: null,
      newHighMonthPct: null,
      positiveYearPct: null,
      gainPainRatio: null,
    });
  });
});
