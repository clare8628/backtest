import { BacktestMetrics, IndexedPoint, PricePoint, Recommendation, SymbolSeries } from "./types";
import { getManagementFee } from "./symbolCatalog";

const TRADING_DAYS_PER_YEAR = 252;
const RISK_FREE_RATE = 0.02; // 2% annual, simplification for Sharpe ratio
const MS_PER_YEAR = 1000 * 60 * 60 * 24 * 365.25;

/**
 * How many bars per year this series actually carries, measured rather than
 * assumed.
 *
 * The data source silently switches from daily to monthly bars over long
 * ranges (see CEILING_FETCH_YEARS in the backtest route), so annualizing with
 * a hardcoded 252 blows up exactly where the range is longest: a 15-year
 * comparison was reporting 250% volatility and a Sharpe of 4.32 against the
 * same symbol's 67% / 0.81 at 10 years, purely from scaling monthly returns by
 * sqrt(252). Deriving the figure from the real bar count over the real
 * calendar span makes every annualized metric mean the same thing at any
 * range. Clamped to [1, 252] so a degenerate series can't produce a wild
 * multiplier.
 */
export function periodsPerYear(prices: PricePoint[]): number {
  if (prices.length < 2) return TRADING_DAYS_PER_YEAR;
  const years = (Date.parse(prices[prices.length - 1].date) - Date.parse(prices[0].date)) / MS_PER_YEAR;
  if (!(years > 0)) return TRADING_DAYS_PER_YEAR;
  return Math.min(TRADING_DAYS_PER_YEAR, Math.max(1, (prices.length - 1) / years));
}

/**
 * Up/down capture: how much of the benchmark's average move this symbol picks
 * up in the periods when the benchmark rose, and when it fell — each as a % of
 * the benchmark's own average move. A 3x leveraged fund lands near 300%/300%;
 * a defensive holding shows less down-capture than up-capture.
 *
 * This is the mechanism behind a leveraged fund out-earning its underlying
 * despite a rougher path: it takes ~3x of every move in both directions, and
 * the underlying simply had more up than down to give.
 *
 * Returns are date-aligned (inner join) the same way Beta is, since the two
 * series can have slightly different trading calendars. Null when too few
 * periods overlap to mean anything.
 */
export function captureRatios(
  assetReturns: { date: string; value: number }[],
  marketReturns: { date: string; value: number }[]
): { up: number | null; down: number | null } {
  const marketByDate = new Map(marketReturns.map((r) => [r.date, r.value]));
  let upAsset = 0;
  let upMarket = 0;
  let upCount = 0;
  let downAsset = 0;
  let downMarket = 0;
  let downCount = 0;
  for (const r of assetReturns) {
    const m = marketByDate.get(r.date);
    if (m === undefined) continue;
    if (m > 0) {
      upAsset += r.value;
      upMarket += m;
      upCount++;
    } else if (m < 0) {
      downAsset += r.value;
      downMarket += m;
      downCount++;
    }
  }
  // Same denominator count on both sides of each ratio, so summing is
  // equivalent to averaging and avoids a needless division.
  const MIN_PERIODS = 5;
  return {
    up: upCount >= MIN_PERIODS && upMarket !== 0 ? (upAsset / upMarket) * 100 : null,
    down: downCount >= MIN_PERIODS && downMarket !== 0 ? (downAsset / downMarket) * 100 : null,
  };
}

/** Daily simple returns from a price series. */
export function dailyReturns(prices: PricePoint[]): number[] {
  return dailyReturnsWithDates(prices).map((r) => r.value);
}

/** Daily simple returns paired with the date of the later of the two prices,
 *  so a return series can be date-aligned against another series (e.g. for Beta). */
export function dailyReturnsWithDates(prices: PricePoint[]): { date: string; value: number }[] {
  const returns: { date: string; value: number }[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1].close;
    const curr = prices[i].close;
    if (prev > 0) returns.push({ date: prices[i].date, value: (curr - prev) / prev });
  }
  return returns;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Calculate Beta the standard way: covariance(asset daily returns, market daily
 * returns) / variance(market daily returns), against whichever market benchmark
 * the caller passes in (SPY for US-listed symbols, 0050.TW for Taiwan-listed
 * ones — see route.ts).
 *
 * The two return series are date-aligned first (inner join on date) since the
 * asset and benchmark may have slightly different trading calendars (holidays,
 * gaps from data-source retries, different listing exchanges, etc). Returns
 * null if there isn't enough overlapping data to compute a meaningful value —
 * we never fall back to a guessed number.
 */
export function calculateBeta(
  assetReturns: { date: string; value: number }[],
  marketReturns: { date: string; value: number }[]
): number | null {
  const marketByDate = new Map(marketReturns.map((r) => [r.date, r.value]));
  const paired: { asset: number; market: number }[] = [];
  for (const r of assetReturns) {
    const m = marketByDate.get(r.date);
    if (m !== undefined) paired.push({ asset: r.value, market: m });
  }

  // Guard against a near-empty overlap (e.g. two series that barely share any
  // trading dates), where covariance/variance would be a near-meaningless
  // estimate from a handful of points. Real comparisons run over months to
  // years of daily data (hundreds to thousands of points), so this only ever
  // bites genuinely degenerate overlaps.
  if (paired.length < 5) return null;

  const assetVals = paired.map((p) => p.asset);
  const marketVals = paired.map((p) => p.market);
  const assetMean = mean(assetVals);
  const marketMean = mean(marketVals);

  let covariance = 0;
  let marketVariance = 0;
  for (let i = 0; i < paired.length; i++) {
    const da = assetVals[i] - assetMean;
    const dm = marketVals[i] - marketMean;
    covariance += da * dm;
    marketVariance += dm * dm;
  }
  covariance /= paired.length - 1;
  marketVariance /= paired.length - 1;

  if (marketVariance === 0) return null;
  return covariance / marketVariance;
}

export function maxDrawdown(prices: PricePoint[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const p of prices) {
    if (p.close > peak) peak = p.close;
    const dd = peak > 0 ? (p.close - peak) / peak : 0;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd * 100; // negative %
}

/** Core backtest computation for a single symbol's price series.
 *  `startValue` is the hypothetical initial investment amount (defaults to 1000).
 *  `marketReturns` is the date-aligned daily return series for the market
 *  benchmark (SPY); pass undefined/empty if unavailable — Beta will be null. */
export function computeMetrics(
  series: SymbolSeries,
  startValue = 1000,
  marketReturns: { date: string; value: number }[] = []
): BacktestMetrics {
  const { prices } = series;
  if (prices.length < 2) {
    return {
      symbol: series.symbol,
      totalReturn: 0,
      annualizedReturn: 0,
      annualizedVolatility: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      finalValue: startValue,
      beta: null,
      managementFee: getManagementFee(series.symbol),
    };
  }

  const first = prices[0].close;
  const last = prices[prices.length - 1].close;
  const totalReturn = ((last - first) / first) * 100;

  // Prefer actual calendar span (first/last date) over trading-day count —
  // more robust to gaps from holidays or fetch retries, and avoids the
  // annualization window silently drifting from what the user requested.
  const msSpan = new Date(prices[prices.length - 1].date).getTime() - new Date(prices[0].date).getTime();
  const calendarYears = msSpan / MS_PER_YEAR;
  const years = calendarYears > 0 ? calendarYears : prices.length / TRADING_DAYS_PER_YEAR;
  const annualizedReturn =
    years > 0 ? ((Math.pow(last / first, 1 / years) - 1) * 100) : totalReturn;

  // Measured from the series rather than assumed to be daily — see
  // periodsPerYear() for why a hardcoded 252 silently breaks long ranges.
  const ppy = periodsPerYear(prices);
  const retsWithDates = dailyReturnsWithDates(prices);
  const rets = retsWithDates.map((r) => r.value);
  const periodStd = stdDev(rets);
  const annualizedVolatility = periodStd * Math.sqrt(ppy) * 100;

  const dd = maxDrawdown(prices);

  const excessPeriodReturn = mean(rets) - RISK_FREE_RATE / ppy;
  const sharpeRatio = periodStd > 0 ? (excessPeriodReturn / periodStd) * Math.sqrt(ppy) : 0;

  // The simple average of each period's return, annualized — the raw upward
  // drift *before* compounding takes its cut. Always >= the compounded (CAGR)
  // figure, and the gap between them is the volatility drag below.
  const arithmeticAnnualReturn = mean(rets) * ppy * 100;
  // What a bumpy path costs per year: a series that gains and loses the same
  // percentage ends below where it started, and the deeper the swings the
  // bigger the shortfall (roughly variance/2). This is the number that
  // reconciles "worse trend quality" with "far higher cumulative return" —
  // a 3x fund pays several times this drag but starts from 3x the drift, so
  // it can still finish far ahead. By construction:
  //   annualizedReturn = arithmeticAnnualReturn - volatilityDrag
  const volatilityDrag = arithmeticAnnualReturn - annualizedReturn;
  // Return per unit of worst-case pain (Calmar/MAR). Leverage tends to raise
  // return and drawdown together, so this shows whether the extra return was
  // actually bought at a discount or just paid for in full.
  const calmarRatio = dd < 0 ? annualizedReturn / Math.abs(dd) : null;

  const capture = marketReturns.length > 0
    ? captureRatios(retsWithDates, marketReturns)
    : { up: null, down: null };

  // Beta: real covariance(asset, SPY) / variance(SPY), date-aligned.
  // null when no market benchmark data was supplied or overlap is too thin —
  // never a guessed/approximated number.
  const rawBeta = marketReturns.length > 0 ? calculateBeta(retsWithDates, marketReturns) : null;
  const beta = rawBeta === null ? null : round2(rawBeta);

  // Management fee: looked up from the verified expense-ratio table.
  // Unknown symbols (not in our catalog) default to 0% rather than a guess.
  const managementFee = getManagementFee(series.symbol);

  const finalValue = startValue * (last / first);

  return {
    symbol: series.symbol,
    totalReturn: round2(totalReturn),
    annualizedReturn: round2(annualizedReturn),
    annualizedVolatility: round2(annualizedVolatility),
    maxDrawdown: round2(dd),
    sharpeRatio: round2(sharpeRatio),
    finalValue: round2(finalValue),
    beta,
    managementFee: round4(managementFee),
    arithmeticAnnualReturn: round2(arithmeticAnnualReturn),
    volatilityDrag: round2(volatilityDrag),
    calmarRatio: calmarRatio === null ? null : round2(calmarRatio),
    upCapture: capture.up === null ? null : round2(capture.up),
    downCapture: capture.down === null ? null : round2(capture.down),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Weights used by `recommend()`, exported so the UI can render the exact
 * formula alongside the results (kept in sync with the scoring logic below).
 */
export const RECOMMENDATION_WEIGHTS = {
  return: 0.25,
  vol: 0.15,
  dd: 0.15,
  sharpe: 0.25,
  beta: 0.1,
  fee: 0.1,
} as const;

/**
 * Rule-based multi-factor "AI" recommendation.
 * Scores each symbol 0-100 by normalizing every metric shown in the results
 * table within the current comparison group, then combining them with the
 * weights in RECOMMENDATION_WEIGHTS:
 *   - annualizedReturn (higher is better)
 *   - annualizedVolatility (lower is better)
 *   - maxDrawdown (smaller/shallower is better)
 *   - sharpeRatio (higher is better)
 *   - beta (closer to/below market, i.e. lower is better)
 *   - managementFee (lower is better)
 */
export function recommend(metricsList: BacktestMetrics[]): Recommendation[] {
  if (metricsList.length === 0) return [];

  const returns = metricsList.map((m) => m.annualizedReturn);
  const vols = metricsList.map((m) => m.annualizedVolatility);
  const drawdowns = metricsList.map((m) => Math.abs(m.maxDrawdown));
  const sharpes = metricsList.map((m) => m.sharpeRatio);
  const fees = metricsList.map((m) => m.managementFee);

  const normalize = (values: number[], invert = false) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    return values.map((v) => {
      if (range === 0) return 50;
      const score = ((v - min) / range) * 100;
      return invert ? 100 - score : score;
    });
  };

  const returnScores = normalize(returns);
  const volScores = normalize(vols, true); // lower volatility is better
  const ddScores = normalize(drawdowns, true); // smaller drawdown is better
  const sharpeScores = normalize(sharpes);
  const feeScores = normalize(fees, true); // lower management fee is better

  // Beta may be null when the market benchmark couldn't be fetched. Only
  // normalize across symbols that actually have a value; symbols without one
  // get a neutral 50 so a missing benchmark never rewards or penalizes them.
  const knownBetas = metricsList
    .map((m) => m.beta)
    .filter((b): b is number => b !== null)
    .map((b) => Math.abs(b));
  const normalizedKnownBetaScores = normalize(knownBetas, true);
  let knownBetaCursor = 0;
  const betaScores = metricsList.map((m) =>
    m.beta === null ? 50 : normalizedKnownBetaScores[knownBetaCursor++]
  );

  const w = RECOMMENDATION_WEIGHTS;

  const scored = metricsList.map((m, i) => {
    const score =
      returnScores[i] * w.return +
      volScores[i] * w.vol +
      ddScores[i] * w.dd +
      sharpeScores[i] * w.sharpe +
      betaScores[i] * w.beta +
      feeScores[i] * w.fee;

    const reasons: string[] = [];
    const reasonsEn: string[] = [];

    if (returnScores[i] >= 70) {
      reasons.push("年化報酬率表現優異");
      reasonsEn.push("Strong annualized return");
    }
    if (volScores[i] >= 70) {
      reasons.push("波動度相對較低，風險較穩定");
      reasonsEn.push("Relatively low volatility, more stable risk profile");
    }
    if (ddScores[i] >= 70) {
      reasons.push("最大回撤控制良好");
      reasonsEn.push("Well-controlled maximum drawdown");
    }
    if (sharpeScores[i] >= 70) {
      reasons.push("風險調整後報酬（夏普比率）具吸引力");
      reasonsEn.push("Attractive risk-adjusted return (Sharpe ratio)");
    }
    if (betaScores[i] >= 70) {
      reasons.push("Beta 係數偏低，對大盤波動較不敏感");
      reasonsEn.push("Lower beta, less sensitive to market swings");
    }
    if (feeScores[i] >= 70) {
      reasons.push("管理費偏低，長期持有成本較小");
      reasonsEn.push("Lower management fee, cheaper to hold long-term");
    }
    if (reasons.length === 0) {
      reasons.push("表現中庸，可作為分散配置參考");
      reasonsEn.push("Moderate performance, may serve as diversification");
    }

    return {
      symbol: m.symbol,
      score: round2(score),
      rank: 0,
      reasons,
      reasonsEn,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  scored.forEach((s, i) => (s.rank = i + 1));
  return scored;
}

/** Downsample and index a price series to 100 at its first point, for lightweight charting. */
export function normalizeToIndex(prices: PricePoint[], maxPoints = 120): IndexedPoint[] {
  if (prices.length === 0) return [];
  const base = prices[0].close || 1;
  const step = Math.max(1, Math.floor(prices.length / maxPoints));
  const sampled: IndexedPoint[] = [];
  for (let i = 0; i < prices.length; i += step) {
    sampled.push({ date: prices[i].date, value: round2((prices[i].close / base) * 100) });
  }
  const last = prices[prices.length - 1];
  const lastSampled = sampled[sampled.length - 1];
  if (lastSampled.date !== last.date) {
    sampled.push({ date: last.date, value: round2((last.close / base) * 100) });
  }
  return sampled;
}

/** Downsamples a price series for lightweight charting, keeping raw close
 *  values (unlike normalizeToIndex, which re-bases everything to 100). */
export function downsamplePrices(prices: PricePoint[], maxPoints = 120): PricePoint[] {
  if (prices.length === 0) return [];
  const step = Math.max(1, Math.floor(prices.length / maxPoints));
  const sampled: PricePoint[] = [];
  for (let i = 0; i < prices.length; i += step) sampled.push(prices[i]);
  const last = prices[prices.length - 1];
  if (sampled[sampled.length - 1].date !== last.date) sampled.push(last);
  return sampled;
}

/**
 * Builds a date -> FX rate lookup from a (possibly sparse) rate series, using
 * the latest available rate on or before the requested date — forex trades on
 * a wider calendar than either equity market, so gaps are rare, but a market
 * holiday specific to one exchange shouldn't leave a price point unconvertible.
 */
export function fxLookup(rates: PricePoint[]): (date: string) => number | null {
  const sorted = [...rates].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return (date: string) => {
    if (sorted.length === 0) return null;
    let lo = 0;
    let hi = sorted.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].date <= date) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans === -1 ? sorted[0].close : sorted[ans].close;
  };
}

/** Calendar-year span covered by a price series' own first-to-last date. */
export function seriesYears(prices: PricePoint[]): number {
  if (prices.length < 2) return 0;
  const ms =
    new Date(prices[prices.length - 1].date).getTime() - new Date(prices[0].date).getTime();
  return ms / (1000 * 60 * 60 * 24 * 365.25);
}

/**
 * The date window shared by every series in a comparison group — the latest of
 * their start dates through the earliest of their end dates. ETFs list on
 * different dates (a fund launched 18 months ago has far less history than one
 * that's been trading for 5 years), so comparing raw totalReturn/annualizedReturn
 * across a group silently mixes different market eras unless every series is
 * trimmed to this common window first. Returns null only when the group is
 * empty (nothing to align).
 */
export function commonWindow(
  seriesList: SymbolSeries[]
): { start: string; end: string } | null {
  const withData = seriesList.filter((s) => s.prices.length > 0);
  if (withData.length === 0) return null;
  let start = withData[0].prices[0].date;
  let end = withData[0].prices[withData[0].prices.length - 1].date;
  for (const s of withData) {
    const first = s.prices[0].date;
    const last = s.prices[s.prices.length - 1].date;
    if (first > start) start = first;
    if (last < end) end = last;
  }
  return start <= end ? { start, end } : null;
}

/** Keeps only the price points falling within an inclusive [start, end] date window. */
export function trimToWindow(
  prices: PricePoint[],
  window: { start: string; end: string }
): PricePoint[] {
  return prices.filter((p) => p.date >= window.start && p.date <= window.end);
}

/** Closing price on the last trading day of each calendar month, in order. */
export function monthEndCloses(prices: PricePoint[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    const month = prices[i].date.slice(0, 7);
    const next = i + 1 < prices.length ? prices[i + 1].date.slice(0, 7) : null;
    if (next !== month) out.push(prices[i].close);
  }
  return out;
}

export interface TrendStrength {
  trendR2: number | null;
  newHighMonthPct: number | null;
  positiveYearPct: number | null;
  gainPainRatio: number | null;
}

/** Rolling window, in months, for the "held it a year" statistic. */
const MONTHS_PER_YEAR = 12;
/** Don't report a rolling-year win rate off a handful of overlapping windows —
 *  under ~2 years of history the sample is too small to mean anything. */
const MIN_ROLLING_YEAR_WINDOWS = 12;

/**
 * Measures of *directional* trend strength. All four are threshold-free —
 * nothing here has a knob to tune, so the same window always scores the same
 * way. (These replaced a zigzag swing-count/size feature, which needed a
 * reversal threshold and still couldn't show direction: completed legs
 * strictly alternate, so up and down counts never differ by more than 1 no
 * matter how strongly the asset trends.)
 *
 * - `trendR2`: R² (0–100) of an ordinary least-squares fit of ln(price) against
 *   time, signed by the fitted slope. |R²| says how tightly the price hugs a
 *   single steady exponential path; the sign says which way that path runs.
 *   +90 is a relentless compounder, +20 a choppy asset that happens to have
 *   drifted up, -90 a relentless decliner. Log space (not raw price) is what
 *   makes a constant *percentage* growth rate score as a straight line.
 * - `newHighMonthPct`: share of months closing at a new high for the window. An
 *   asset in a strong uptrend rewrites its high constantly; a sideways one
 *   almost never does again after its first peak.
 * - `positiveYearPct`: share of all rolling 12-month holding periods inside the
 *   window that ended in profit — "if I'd bought on a random day and held a
 *   year, how often would I be up?".
 * - `gainPainRatio`: sum of positive monthly returns over the absolute sum of
 *   negative ones. The magnitude-weighted view of direction: >1 means up
 *   months outweigh down months in aggregate size even when there are just as
 *   many of each.
 *
 * The last three all run off month-end closes rather than the raw series on
 * purpose. Yahoo silently coarsens long ranges from daily to monthly bars (see
 * CEILING_FETCH_YEARS in the backtest route), so anything counted per *bar*
 * would quietly change meaning at longer ranges — a 15-year comparison would
 * report a "% of days at a new high" several times higher than a 10-year one
 * purely from the bar size, and a 252-trading-day rolling window would find
 * fewer than 252 bars in 15 years and give up entirely. Resampling to months
 * first makes all three mean the same thing at every range. Daily returns would
 * also squeeze gain/pain to within a hair of 1.00 for every asset, so monthly
 * is the more legible unit for it regardless.
 *
 * Each is null when the window is too short to compute it honestly (rather than
 * being filled with a degenerate value from a handful of points).
 */
export function trendStrength(prices: PricePoint[]): TrendStrength {
  const n = prices.length;
  if (n < 2) {
    return { trendR2: null, newHighMonthPct: null, positiveYearPct: null, gainPainRatio: null };
  }
  const months = monthEndCloses(prices);

  // --- Trend R², signed by slope: OLS of ln(close) on the day index ---
  let trendR2: number | null = null;
  const logs: number[] = [];
  for (const p of prices) if (p.close > 0) logs.push(Math.log(p.close));
  if (logs.length >= 3) {
    const m = logs.length;
    const xMean = (m - 1) / 2; // mean of 0..m-1
    const yMean = mean(logs);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < m; i++) {
      const dx = i - xMean;
      const dy = logs[i] - yMean;
      sxy += dx * dy;
      sxx += dx * dx;
      syy += dy * dy;
    }
    // syy === 0 means a perfectly flat price — no trend to fit, not a perfect one.
    if (sxx > 0 && syy > 0) {
      const r2 = (sxy * sxy) / (sxx * syy);
      trendR2 = Math.sign(sxy) * r2 * 100;
    }
  }

  // --- Share of months closing at a new high for the window ---
  // The first month is trivially its own high, so it's excluded from both
  // numerator and denominator; a new high must beat every close before it.
  let newHighMonthPct: number | null = null;
  if (months.length >= 2) {
    let peak = months[0];
    let highs = 0;
    for (let i = 1; i < months.length; i++) {
      if (months[i] > peak) {
        highs++;
        peak = months[i];
      }
    }
    newHighMonthPct = (highs / (months.length - 1)) * 100;
  }

  // --- Share of rolling 1-year holding periods that ended in profit ---
  let positiveYearPct: number | null = null;
  {
    const windows = months.length - MONTHS_PER_YEAR;
    if (windows >= MIN_ROLLING_YEAR_WINDOWS) {
      let wins = 0;
      for (let i = 0; i < windows; i++) {
        if (months[i + MONTHS_PER_YEAR] > months[i]) wins++;
      }
      positiveYearPct = (wins / windows) * 100;
    }
  }

  // --- Gain-to-pain on monthly returns ---
  let gainPainRatio: number | null = null;
  {
    let gain = 0;
    let pain = 0;
    for (let i = 1; i < months.length; i++) {
      if (months[i - 1] <= 0) continue;
      const r = (months[i] - months[i - 1]) / months[i - 1];
      if (r > 0) gain += r;
      else pain += -r;
    }
    // A window with no down months at all has no "pain" to divide by — leave it
    // null rather than reporting an infinite ratio.
    if (pain > 0) gainPainRatio = gain / pain;
  }

  return { trendR2, newHighMonthPct, positiveYearPct, gainPainRatio };
}
