export interface PricePoint {
  date: string; // YYYY-MM-DD
  close: number;
}

export interface DividendEvent {
  date: string; // YYYY-MM-DD (ex-dividend date)
  amount: number; // per share, in the symbol's native currency
}

export interface SplitEvent {
  date: string; // YYYY-MM-DD
  ratio: string; // e.g. "2:1" for a 2-for-1 forward split
}

export interface SymbolSeries {
  symbol: string;
  name?: string;
  prices: PricePoint[];
  /** Stock/ETF splits within the fetched range, from Yahoo's split events —
   *  undefined (not []) when the source (e.g. the Stooq fallback) doesn't
   *  report split history, so "no splits" can be told apart from "unknown". */
  splits?: SplitEvent[];
  /** Cash distributions within the fetched range, from the source's dividend
   *  events — undefined when the source doesn't report them at all. */
  dividends?: DividendEvent[];
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
  /** Direction-of-trend measures. All threshold-free — nothing here has a knob
   *  to tune. See trendStrength() in backtest.ts for the full definitions.
   *  - trendR2: R² (0–100) of ln(price) regressed on time, signed by slope —
   *    how tightly the price tracks one steady exponential path, and which way.
   *  - newHighMonthPct: % of months closing at a new high for the window.
   *  - positiveYearPct: % of rolling 12-month holding periods that ended up.
   *  - gainPainRatio: sum of up-month returns / sum of down-month returns;
   *    >1 means up months outweigh down months in size, not just count. */
  trendR2?: number | null;
  newHighMonthPct?: number | null;
  positiveYearPct?: number | null;
  gainPainRatio?: number | null;
  /** Where the compounded return actually came from — these reconcile a fund
   *  with worse trend quality still finishing far ahead on cumulative return.
   *  By construction annualizedReturn = arithmeticAnnualReturn - volatilityDrag.
   *  - arithmeticAnnualReturn: the plain average period return, annualized —
   *    raw upward drift before compounding takes its cut.
   *  - volatilityDrag: what the bumpy path costs per year (roughly variance/2).
   *    A 3x fund pays several times the drag of its underlying but starts from
   *    3x the drift, so it can still win on the compounded figure.
   *  - calmarRatio: annualized return per unit of max drawdown — whether the
   *    extra return was bought at a discount or paid for in full.
   *  - upCapture / downCapture: % of the benchmark's average up / down move
   *    this symbol picks up. A 3x fund sits near 300%/300%. */
  arithmeticAnnualReturn?: number;
  volatilityDrag?: number;
  calmarRatio?: number | null;
  upCapture?: number | null;
  downCapture?: number | null;
  /** Number of stock/ETF splits within the backtest window — undefined when
   *  the data source doesn't report split history (see SymbolSeries.splits).
   *  A low share price alone doesn't mean low returns: frequent forward
   *  splits (common for popular leveraged ETFs) keep the nominal price low
   *  even after a huge cumulative return, since Yahoo's close price is
   *  already split-adjusted and unaffected either way. */
  splitCount?: number;
  /** Income profile, for judging a holding as retirement cash flow rather than
   *  capital gain. assetClass/creditRating are curated (see symbolCatalog);
   *  fundSize is a dated snapshot (see FUND_SIZE_AS_OF) quoted in
   *  fundSizeCurrency — the fund's own trading currency, or USD for every
   *  symbol once a comparison spans both markets and the figures have to be
   *  comparable; the yield and distribution count are computed from the
   *  distributions actually paid over the trailing year.
   *  Every one is optional/null rather than defaulted, so "we have no figure"
   *  never renders as a confident zero. */
  assetClass?: string;
  creditRating?: string;
  fundSize?: number | null;
  fundSizeCurrency?: Currency;
  estimatedYieldPct?: number | null;
  distributionsPerYear?: number | null;
  /** False when managementFee is the 0% fallback rather than a published
   *  figure — the UI shows a dash instead of claiming the fund is free. */
  managementFeeKnown?: boolean;
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
  /**
   * Whether `rangeYears` is a settled choice rather than the untouched default.
   * A group's first backtest snaps `rangeYears` up to the shared backtestable
   * ceiling (the youngest symbol's history) and sets this; moving the slider by
   * hand also sets it. Once set, the auto-fit never runs for that group again.
   */
  rangeFitted?: boolean;
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
