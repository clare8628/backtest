import { describe, it, expect } from "vitest";
import { computeMetrics, recommend, maxDrawdown, dailyReturns, dailyReturnsWithDates, normalizeToIndex, RECOMMENDATION_WEIGHTS, calculateBeta, monthEndCloses, trendStrength, periodsPerYear, captureRatios, stdDev, incomeProfile, simulateWithdrawnSeries } from "@/lib/backtest";
import { parseStooqCsv, toStooqSymbol, toYahooSymbol, splitsUnreported, isTaiwanListed, symbolCandidates, lookupSymbol } from "@/lib/marketData";
import { displaySymbol, findEntry, fundSizeIn, getAssetClass, getCreditRating, getFundSize, getManagementFee, nativeCurrencyOf, registerDynamicSymbol, searchCatalog } from "@/lib/symbolCatalog";
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

  it("hyphenates a class share and still appends .us", () => {
    expect(toStooqSymbol("BRK.B")).toBe("brk-b.us");
    expect(toStooqSymbol("BF.B")).toBe("bf-b.us");
  });
});

describe("toYahooSymbol", () => {
  it("hyphenates a class share Yahoo only answers to in hyphen form", () => {
    expect(toYahooSymbol("BRK.B")).toBe("BRK-B");
    expect(toYahooSymbol("bf.b")).toBe("BF-B");
  });

  it("leaves plain tickers and Taiwan symbols untouched", () => {
    expect(toYahooSymbol("VOO")).toBe("VOO");
    expect(toYahooSymbol("0050.TW")).toBe("0050.TW");
    expect(toYahooSymbol("00687B.TWO")).toBe("00687B.TWO");
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

describe("periodsPerYear", () => {
  it("measures daily bars as ~252 and monthly bars as ~12", () => {
    const daily: PricePoint[] = [];
    const start = Date.parse("2015-01-01T00:00:00Z");
    for (let d = 0; d < 1000; d++) {
      daily.push({ date: new Date(start + d * 86_400_000).toISOString().slice(0, 10), close: 100 });
    }
    // Calendar-consecutive days top out at the 252 clamp (real series skip weekends).
    expect(periodsPerYear(daily)).toBe(252);
    expect(periodsPerYear(monthlySeries(Array.from({ length: 120 }, () => 100)))).toBeCloseTo(12, 0);
  });

  it("falls back to the daily assumption for a series too short to measure", () => {
    expect(periodsPerYear([])).toBe(252);
    expect(periodsPerYear([{ date: "2024-01-01", close: 100 }])).toBe(252);
  });
});

describe("computeMetrics annualization", () => {
  // The regression this guards: monthly bars were being scaled by sqrt(252),
  // reporting 250% volatility and a Sharpe of 4.32 for a symbol that measured
  // 67% / 0.81 over a shorter, daily-resolution range.
  it("annualizes monthly bars by sqrt(12), not sqrt(252)", () => {
    const closes = [100];
    for (let i = 0; i < 120; i++) closes.push(closes[closes.length - 1] * (i % 2 === 0 ? 1.05 : 0.97));
    const prices = monthlySeries(closes);
    const m = computeMetrics({ symbol: "X", prices });

    const monthlyStd = stdDev(dailyReturns(prices));
    expect(m.annualizedVolatility).toBeCloseTo(monthlyStd * Math.sqrt(12) * 100, 1);
  });

  it("decomposes the compounded return into drift minus drag exactly", () => {
    const closes = [100];
    for (let i = 0; i < 120; i++) closes.push(closes[closes.length - 1] * (i % 2 === 0 ? 1.05 : 0.97));
    const m = computeMetrics({ symbol: "X", prices: monthlySeries(closes) });
    expect(m.arithmeticAnnualReturn! - m.volatilityDrag!).toBeCloseTo(m.annualizedReturn, 1);
  });

  it("charges a bumpy path more drag than a smooth one of the same drift", () => {
    const smooth = monthlySeries(Array.from({ length: 121 }, (_, i) => 100 * 1.01 ** i));
    // Same 1% average monthly drift, but delivered in violent swings.
    const bumpy = monthlySeries(
      Array.from({ length: 121 }, (_, i) => 100 * 1.01 ** i * (i % 2 === 0 ? 1.25 : 0.8))
    );
    expect(computeMetrics({ symbol: "S", prices: smooth }).volatilityDrag!).toBeLessThan(
      computeMetrics({ symbol: "B", prices: bumpy }).volatilityDrag!
    );
  });
});

describe("captureRatios", () => {
  // Needs at least 5 up and 5 down periods to clear captureRatios' minimum.
  const market = [0.02, -0.01, 0.03, -0.02, 0.01, -0.03, 0.04, -0.015, 0.025, -0.005, 0.012, -0.022].map(
    (value, i) => ({ date: `2024-02-${String(i + 1).padStart(2, "0")}`, value })
  );

  it("reports ~300%/300% for a fund that takes 3x of every move", () => {
    const asset = market.map((r) => ({ date: r.date, value: r.value * 3 }));
    const { up, down } = captureRatios(asset, market);
    expect(up).toBeCloseTo(300, 6);
    expect(down).toBeCloseTo(300, 6);
  });

  it("shows less down-capture than up-capture for a defensive holding", () => {
    const asset = market.map((r) => ({ date: r.date, value: r.value > 0 ? r.value : r.value * 0.4 }));
    const { up, down } = captureRatios(asset, market);
    expect(up).toBeCloseTo(100, 6);
    expect(down).toBeCloseTo(40, 6);
  });

  it("returns null when too few periods overlap to be meaningful", () => {
    expect(captureRatios([{ date: "2024-01-02", value: 0.02 }], market)).toEqual({
      up: null,
      down: null,
    });
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
    // Six +20% months alternating with six -10% months — equal counts each way,
    // so only magnitude separates them. Gain/pain = (6 x 0.20) / (6 x 0.10) = 2.
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

describe("splitsUnreported", () => {
  // Yahoo omits the split-events block both for a symbol that never split and
  // for one it doesn't track, so the market has to decide which it means.
  it("treats a missing block as a real zero for US-listed symbols", () => {
    expect(splitsUnreported("SPY")).toEqual([]);
    expect(splitsUnreported("GLD")).toEqual([]);
  });

  it("treats a missing block as unknown for Taiwan-listed symbols", () => {
    // 0050.TW's June 2025 1-into-4 split is absent from Yahoo's events even
    // though its prices are adjusted for it, so a "0" here would be a lie.
    expect(splitsUnreported("0050.TW")).toBeUndefined();
    expect(splitsUnreported("006208.tw")).toBeUndefined();
  });
});

describe("isTaiwanListed", () => {
  it("recognises both TWSE (.TW) and TPEx (.TWO) listings", () => {
    expect(isTaiwanListed("0050.TW")).toBe(true);
    expect(isTaiwanListed("2330.tw")).toBe(true);
    // Every Taiwanese bond ETF lists on TPEx. ".TWO" does not end with ".TW",
    // so a naive endsWith(".TW") check calls these US-listed and prices them
    // in the wrong currency against the wrong benchmark.
    expect(isTaiwanListed("00679B.TWO")).toBe(true);
    expect(isTaiwanListed("00937b.two")).toBe(true);
  });

  it("does not claim US symbols are Taiwan-listed", () => {
    expect(isTaiwanListed("TLT")).toBe(false);
    expect(isTaiwanListed("SPY")).toBe(false);
  });

  it("treats a TPEx symbol's missing split block as unknown too", () => {
    expect(splitsUnreported("00679B.TWO")).toBeUndefined();
  });
});

describe("incomeProfile", () => {
  const prices: PricePoint[] = [
    { date: "2025-09-01", close: 100 },
    { date: "2026-08-31", close: 100 },
  ];

  it("yields trailing-12-month distributions over the latest close, and counts them", () => {
    // Sept 2025 through Aug 2026 — twelve payments inside the trailing year.
    const divs = Array.from({ length: 12 }, (_, i) => {
      const month = ((8 + i) % 12) + 1;
      const year = 8 + i < 12 ? 2025 : 2026;
      return { date: `${year}-${String(month).padStart(2, "0")}-15`, amount: 0.5 };
    });
    // Twelve payments of 0.5 on a 100 close = 6% and monthly.
    const { estimatedYieldPct, distributionsPerYear } = incomeProfile(prices, divs);
    expect(estimatedYieldPct).toBeCloseTo(6, 6);
    expect(distributionsPerYear).toBe(12);
  });

  it("ignores distributions older than the trailing year", () => {
    const { estimatedYieldPct, distributionsPerYear } = incomeProfile(prices, [
      { date: "2020-01-15", amount: 99 }, // long before the window
      { date: "2026-03-15", amount: 2 },
      { date: "2026-06-15", amount: 2 },
    ]);
    expect(estimatedYieldPct).toBeCloseTo(4, 6);
    expect(distributionsPerYear).toBe(2);
  });

  it("reports null rather than 0% when the source gives no distributions", () => {
    expect(incomeProfile(prices, undefined)).toEqual({
      estimatedYieldPct: null,
      distributionsPerYear: null,
    });
    expect(incomeProfile(prices, [])).toEqual({
      estimatedYieldPct: null,
      distributionsPerYear: null,
    });
    // A fund whose only payouts predate the window is "no data for this year",
    // not "pays nothing" — still null, never a confident zero.
    expect(incomeProfile(prices, [{ date: "2019-01-15", amount: 3 }]).estimatedYieldPct).toBeNull();
  });
});

describe("symbolCandidates", () => {
  it("resolves a bare Taiwanese ticker against both exchanges", () => {
    // Nobody in Taiwan types the suffix, and which one is right depends on
    // where the symbol listed — bond ETFs are all on TPEx (.TWO).
    expect(symbolCandidates("0050")).toEqual(["0050.TW", "0050.TWO"]);
    expect(symbolCandidates("00679B")).toEqual(["00679B.TW", "00679B.TWO"]);
    expect(symbolCandidates("00631l")).toEqual(["00631L.TW", "00631L.TWO"]);
  });

  it("leaves already-suffixed and US-shaped symbols to be fetched as typed", () => {
    expect(symbolCandidates("0050.TW")).toEqual([]);
    expect(symbolCandidates("00679B.TWO")).toEqual([]);
    expect(symbolCandidates("TLT")).toEqual([]);
    expect(symbolCandidates("BRK.B")).toEqual([]);
  });
});

describe("displaySymbol", () => {
  it("names a Taiwan-listed fund beside its code and drops the exchange suffix", () => {
    expect(displaySymbol("00687B.TWO")).toBe("00687B(國泰20年美債)");
    expect(displaySymbol("0050.TW")).toBe("0050(元大台灣50 ETF)");
  });

  it("uses the English name in English", () => {
    expect(displaySymbol("00720B.TWO", "en")).toBe("00720B(Yuanta US 20+ Year BBB Corporate Bond ETF)");
  });

  it("leaves US tickers exactly as typed", () => {
    expect(displaySymbol("TLT")).toBe("TLT");
    expect(displaySymbol("BRK.B")).toBe("BRK.B");
  });

  it("keeps the full ticker for a Taiwan symbol it has no name for, suffix included", () => {
    // Shortening it to "2454" would make it indistinguishable from a US ticker.
    expect(displaySymbol("2454.TW")).toBe("2454.TW");
  });
});

describe("fundSizeIn", () => {
  const RATE = 30; // TWD per USD

  it("converts a Taiwan fund's net assets to USD for a mixed-market comparison", () => {
    const twd = getFundSize("00679B.TWO");
    const converted = fundSizeIn("00679B.TWO", "USD", RATE);
    expect(converted.currency).toBe("USD");
    expect(converted.value).toBe(Math.round((twd as number) / RATE));
  });

  it("leaves a fund already quoted in the target currency untouched", () => {
    expect(fundSizeIn("TLT", "USD", RATE)).toEqual({ value: getFundSize("TLT"), currency: "USD" });
  });

  it("keeps the native figure labelled in its own currency when no rate is available", () => {
    const unconverted = fundSizeIn("00679B.TWO", "USD", null);
    expect(unconverted).toEqual({ value: getFundSize("00679B.TWO"), currency: "TWD" });
  });

  it("reports no size, rather than a converted zero, for a symbol with no snapshot", () => {
    expect(fundSizeIn("AAPL", "USD", RATE)).toEqual({ value: null, currency: "USD" });
    // 00687B is absent from the source's net-assets data, and mislabelling
    // its dash "TWD" in a USD column would suggest the column mixes
    // currencies.
    expect(fundSizeIn("00687B.TWO", "USD", RATE)).toEqual({ value: null, currency: "USD" });
  });
});

describe("nativeCurrencyOf", () => {
  it("reads the market off the ticker suffix", () => {
    expect(nativeCurrencyOf("0050.TW")).toBe("TWD");
    expect(nativeCurrencyOf("00687B.TWO")).toBe("TWD");
    expect(nativeCurrencyOf("TLT")).toBe("USD");
    expect(nativeCurrencyOf("VGLT")).toBe("USD");
  });
});

describe("catalog entry for VGLT", () => {
  it("resolves expense ratio, asset class, and credit rating correctly", () => {
    expect(getManagementFee("VGLT")).toBe(0.03);
    expect(getAssetClass("VGLT")).toBe("美國公債");
    expect(getCreditRating("VGLT")).toBe("AA+（美國主權）");
    expect(displaySymbol("VGLT")).toBe("VGLT");
    const results = searchCatalog("vglt");
    expect(results[0]?.symbol).toBe("VGLT");
  });
});

describe("simulateWithdrawnSeries", () => {
  it("calculates initial withdrawal and annual inflation-adjusted withdrawals", () => {
    // 兩年資料：2023年與2024年，股價持平為 100
    const points = [
      { date: "2023-01-01", value: 100 },
      { date: "2023-06-01", value: 100 },
      { date: "2024-01-01", value: 100 },
    ];
    // 起點金額 10,000，提領率 3% (第一年初提領 300，剩餘 9,700)
    // 2024年初提領通膨調整款：300 * (1 + 0.03) = 309，剩餘 9,700 - 309 = 9,391
    const result = simulateWithdrawnSeries(points, 10000, 3, 3);
    expect(result.points[0].value).toBe(9700);
    expect(result.points[1].value).toBe(9700);
    expect(result.points[2].value).toBe(9391);
    expect(result.finalValue).toBe(9391);
    expect(result.depletedDate).toBeNull();
  });

  it("handles depletion gracefully when withdrawals exceed portfolio value", () => {
    const points = [
      { date: "2023-01-01", value: 100 },
      { date: "2024-01-01", value: 10 }, // 股價大跌
    ];
    // 起點 1,000，提領率 50% -> 2023初提領 500，剩 500 (換算 5 股)
    // 2024年初：5 股現值 50，預計提領 500 * 1.05 = 525，資產不足耗盡
    const result = simulateWithdrawnSeries(points, 1000, 50, 5);
    expect(result.finalValue).toBe(0);
    expect(result.depletedDate).toBe("2024-01-01");
  });
});

describe("registerDynamicSymbol", () => {
  it("allows registering and searching dynamic symbols at runtime", () => {
    registerDynamicSymbol({
      symbol: "TEST_DYNAMIC",
      name: "動態測試標的",
      nameEn: "Dynamic Test Stock",
      category: "Stock",
    });
    const found = findEntry("TEST_DYNAMIC");
    expect(found?.name).toBe("動態測試標的");
    const results = searchCatalog("動態測試");
    expect(results.some((r) => r.symbol === "TEST_DYNAMIC")).toBe(true);
  });
});

describe("lookupSymbol", () => {
  it("resolves catalog symbols immediately", async () => {
    const res = await lookupSymbol("VOO");
    expect(res.found).toBe(true);
    expect(res.canonicalSymbol).toBe("VOO");
    expect(res.currency).toBe("USD");
  });

  it("looks up real online stock/ETF symbols not in static catalog", async () => {
    const res = await lookupSymbol("SMH");
    expect(res.found).toBe(true);
    expect(res.canonicalSymbol).toBe("SMH");
    expect(res.currency).toBe("USD");
    expect(res.name).toBeTruthy();
  }, 10000);

  it("handles empty symbols gracefully", async () => {
    const res = await lookupSymbol("   ");
    expect(res.found).toBe(false);
    expect(res.error).toBe("標的代號不能為空");
  });

  it("reports channelsTried and error when symbol does not exist", async () => {
    const res = await lookupSymbol("NON_EXISTENT_XYZ_9999");
    expect(res.found).toBe(false);
    expect(res.error).toContain("NON_EXISTENT_XYZ_9999");
    expect(res.channelsTried?.length).toBeGreaterThan(0);
  });
});


