export interface CatalogEntry {
  symbol: string;
  name: string;
  nameEn: string;
  category: string;
  /** Annual expense ratio (%), only meaningful for ETF/Fund category. */
  expenseRatio?: number;
}

/** Curated list of popular global ETFs and stocks for quick search/add.
 *  expenseRatio values reflect each fund's actual published annual expense ratio. */
export const SYMBOL_CATALOG: CatalogEntry[] = [
  { symbol: "VOO", name: "Vanguard 標普500 ETF", nameEn: "Vanguard S&P 500 ETF", category: "ETF", expenseRatio: 0.03 },
  { symbol: "VT", name: "Vanguard 全世界股票 ETF", nameEn: "Vanguard Total World Stock ETF", category: "ETF", expenseRatio: 0.07 },
  { symbol: "SPY", name: "SPDR 標普500 ETF", nameEn: "SPDR S&P 500 ETF Trust", category: "ETF", expenseRatio: 0.0945 },
  { symbol: "QQQ", name: "Invesco 那斯達克100 ETF", nameEn: "Invesco QQQ Trust", category: "ETF", expenseRatio: 0.20 },
  { symbol: "VTI", name: "Vanguard 全美股市 ETF", nameEn: "Vanguard Total Stock Market ETF", category: "ETF", expenseRatio: 0.03 },
  { symbol: "VXUS", name: "Vanguard 全球（美國除外）ETF", nameEn: "Vanguard Total Intl Stock ETF", category: "ETF", expenseRatio: 0.05 },
  { symbol: "VEA", name: "Vanguard 已開發市場 ETF", nameEn: "Vanguard FTSE Developed Markets ETF", category: "ETF", expenseRatio: 0.03 },
  { symbol: "VWO", name: "Vanguard 新興市場 ETF", nameEn: "Vanguard FTSE Emerging Markets ETF", category: "ETF", expenseRatio: 0.07 },
  { symbol: "ARKK", name: "ARK 創新 ETF", nameEn: "ARK Innovation ETF", category: "ETF", expenseRatio: 0.75 },
  { symbol: "GLD", name: "SPDR 黃金 ETF", nameEn: "SPDR Gold Shares", category: "ETF", expenseRatio: 0.40 },
  { symbol: "BND", name: "Vanguard 總體債券 ETF", nameEn: "Vanguard Total Bond Market ETF", category: "ETF", expenseRatio: 0.03 },
  // Taiwan-listed ETFs (Yahoo Finance requires the .TW suffix for TWSE tickers).
  // Several issuers (notably 0050 and 006208) moved to asset-size-tiered management
  // fees in 2025, so these totals are current best-effort snapshots rather than
  // fixed published rates — expect them to drift as fund size changes.
  { symbol: "0050.TW", name: "元大台灣50 ETF", nameEn: "Yuanta Taiwan Top 50 ETF", category: "ETF", expenseRatio: 0.20 },
  { symbol: "006208.TW", name: "富邦台50 ETF", nameEn: "Fubon Taiwan 50 ETF", category: "ETF", expenseRatio: 0.23 },
  { symbol: "0056.TW", name: "元大高股息 ETF", nameEn: "Yuanta Taiwan Dividend Plus ETF", category: "ETF", expenseRatio: 0.66 },
  { symbol: "00878.TW", name: "國泰永續高股息 ETF", nameEn: "Cathay Taiwan ESG High Dividend ETF", category: "ETF", expenseRatio: 0.59 },
  { symbol: "00919.TW", name: "群益台灣精選高息 ETF", nameEn: "Capital Taiwan Top Dividend Select ETF", category: "ETF", expenseRatio: 0.55 },
  { symbol: "00929.TW", name: "復華台灣科技優息 ETF", nameEn: "FSITC Taiwan Technology Optimized Yield ETF", category: "ETF", expenseRatio: 0.60 },
  { symbol: "00631L.TW", name: "元大台灣50正2 ETF（2倍槓桿）", nameEn: "Yuanta Taiwan 50 Leveraged 2X ETF", category: "ETF", expenseRatio: 1.05 },
  { symbol: "00632R.TW", name: "元大台灣50反1 ETF（反向1倍）", nameEn: "Yuanta Taiwan 50 Inverse 1X ETF", category: "ETF", expenseRatio: 1.00 },
  { symbol: "AAPL", name: "蘋果公司", nameEn: "Apple Inc.", category: "Stock", expenseRatio: 0 },
  { symbol: "MSFT", name: "微軟", nameEn: "Microsoft Corp.", category: "Stock", expenseRatio: 0 },
  { symbol: "GOOGL", name: "Alphabet (Google)", nameEn: "Alphabet Inc.", category: "Stock", expenseRatio: 0 },
  { symbol: "AMZN", name: "亞馬遜", nameEn: "Amazon.com Inc.", category: "Stock", expenseRatio: 0 },
  { symbol: "NVDA", name: "輝達", nameEn: "NVIDIA Corp.", category: "Stock", expenseRatio: 0 },
  { symbol: "TSLA", name: "特斯拉", nameEn: "Tesla Inc.", category: "Stock", expenseRatio: 0 },
  { symbol: "META", name: "Meta Platforms", nameEn: "Meta Platforms Inc.", category: "Stock", expenseRatio: 0 },
  { symbol: "BRK.B", name: "波克夏海瑟威", nameEn: "Berkshire Hathaway Inc.", category: "Stock", expenseRatio: 0 },
  { symbol: "TSM", name: "台積電（ADR）", nameEn: "Taiwan Semiconductor (ADR)", category: "Stock", expenseRatio: 0 },
  { symbol: "JPM", name: "摩根大通", nameEn: "JPMorgan Chase & Co.", category: "Stock", expenseRatio: 0 },
];

/**
 * Look up the annual management (expense) fee for a given symbol.
 * Falls back to 0% for unrecognized tickers — we never guess a nonzero
 * fee for a symbol we don't have verified data for.
 */
export function getManagementFee(symbol: string): number {
  const entry = SYMBOL_CATALOG.find((e) => e.symbol.toUpperCase() === symbol.trim().toUpperCase());
  return entry?.expenseRatio ?? 0;
}

export function searchCatalog(query: string): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return SYMBOL_CATALOG.slice(0, 8);
  return SYMBOL_CATALOG.filter(
    (e) =>
      e.symbol.toLowerCase().includes(q) ||
      e.name.toLowerCase().includes(q) ||
      e.nameEn.toLowerCase().includes(q)
  ).slice(0, 8);
}
