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
  beta: number | null; // covariance(asset, SPY) / variance(SPY); null if market benchmark data unavailable
  managementFee: number; // annual fee as % (default 0)
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
