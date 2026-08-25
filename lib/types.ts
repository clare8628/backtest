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
  /** Years of price history this symbol actually contributed within the
   *  requested range (may fall short of it for a recently-listed fund). */
  availableYears?: number;
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
