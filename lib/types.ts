export interface PricePoint {
  date: string; // YYYY-MM-DD
  close: number;
}

export interface SymbolSeries {
  symbol: string;
  name?: string;
  prices: PricePoint[];
}

export interface BacktestMetrics {
  symbol: string;
  totalReturn: number; // %
  annualizedReturn: number; // %
  annualizedVolatility: number; // %
  maxDrawdown: number; // %
  sharpeRatio: number;
  finalValue: number; // per 10000 invested
  beta: number | null; // covariance(asset, benchmark) / variance(benchmark); null if benchmark data unavailable
  managementFee: number; // annual fee as % (default 0)
  /** Which symbol Beta was measured against — SPY for US-listed symbols, 0050.TW
   *  for Taiwan-listed ones. Optional since older/local test fixtures predate it. */
  benchmarkSymbol?: string;
  /** This symbol's true maximum backtestable history in years (from its
   *  listing date to today), independent of the currently selected range —
   *  a fund listed 2 years ago tops out at ~2 years regardless of the slider. */
  maxBacktestYears?: number;
  /** Number of completed up/down price swings of at least swingThresholdPct
   *  within the backtest window (zigzag-style reversal count) — how many
   *  times the symbol swung a meaningful amount in each direction. These two
   *  counts alone are a weak signal of trend strength: completed legs
   *  strictly alternate direction, so up/down counts can never differ by
   *  more than 1 regardless of the overall trend — see swingUpAvgPct /
   *  swingDownAvgPct for what actually distinguishes a long-term uptrend. */
  swingUpCount?: number;
  swingDownCount?: number;
  /** Average size (%) of each direction's completed legs — null when that
   *  direction had zero completed legs. Asymmetry here (e.g. up legs
   *  averaging bigger than down legs) is what drives compounding despite a
   *  roughly even swing count. */
  swingUpAvgPct?: number | null;
  swingDownAvgPct?: number | null;
}

export interface Recommendation {
  symbol: string;
  score: number; // 0-100
  rank: number;
  reasons: string[];
  reasonsEn: string[];
}

export interface ComparisonGroup {
  id: string;
  title: string;
  symbols: string[];
  createdAt: string;
  rangeYears: number;
  startValue?: number; // 起點金額，預設 1000
  swingThresholdPct?: number; // 波段反轉門檻(%)，預設 10
}

export interface IndexedPoint {
  date: string;
  value: number; // indexed to 100 at first data point
}

export interface SymbolIndexSeries {
  symbol: string;
  points: IndexedPoint[];
}

export type Currency = "USD" | "TWD";

export interface ChartPoint {
  date: string; // YYYY-MM-DD
  /** Price in USD; null only if this symbol is TWD-native and no USD/TWD
   *  rate was fetched (single-currency comparison, or the FX fetch failed). */
  priceUSD: number | null;
  /** Price in TWD; null only if this symbol is USD-native and no USD/TWD
   *  rate was fetched (single-currency comparison, or the FX fetch failed). */
  priceTWD: number | null;
}

export interface ChartSeries {
  symbol: string;
  currency: Currency; // the symbol's native trading currency
  points: ChartPoint[];
}
