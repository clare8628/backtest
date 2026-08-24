import { BacktestMetrics, IndexedPoint, PricePoint, Recommendation, SymbolSeries } from "./types";
import { getManagementFee } from "./symbolCatalog";

const TRADING_DAYS_PER_YEAR = 252;
const RISK_FREE_RATE = 0.02; // 2% annual, simplification for Sharpe ratio

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
 * returns) / variance(market daily returns), using SPY as the market benchmark.
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

  // Need a reasonable amount of overlap for the estimate to mean anything.
  if (paired.length < 20) return null;

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
  const calendarYears = msSpan / (1000 * 60 * 60 * 24 * 365.25);
  const years = calendarYears > 0 ? calendarYears : prices.length / TRADING_DAYS_PER_YEAR;
  const annualizedReturn =
    years > 0 ? ((Math.pow(last / first, 1 / years) - 1) * 100) : totalReturn;

  const retsWithDates = dailyReturnsWithDates(prices);
  const rets = retsWithDates.map((r) => r.value);
  const dailyStd = stdDev(rets);
  const annualizedVolatility = dailyStd * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;

  const dd = maxDrawdown(prices);

  const excessDailyReturn = mean(rets) - RISK_FREE_RATE / TRADING_DAYS_PER_YEAR;
  const sharpeRatio =
    dailyStd > 0
      ? (excessDailyReturn / dailyStd) * Math.sqrt(TRADING_DAYS_PER_YEAR)
      : 0;

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
