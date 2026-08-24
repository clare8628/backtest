import { PricePoint, SymbolSeries } from "./types";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Fetches daily historical close prices for a symbol.
 * Primary source: Yahoo Finance chart API (no key required).
 * Fallback: Stooq CSV endpoint, in case Yahoo is unreachable for a symbol.
 */
export async function fetchDailyPrices(
  symbol: string,
  rangeYears = 5
): Promise<SymbolSeries> {
  try {
    return await fetchFromYahoo(symbol, rangeYears);
  } catch (yahooError) {
    try {
      return await fetchFromStooq(symbol, rangeYears);
    } catch (stooqError) {
      const yMsg = yahooError instanceof Error ? yahooError.message : String(yahooError);
      const sMsg = stooqError instanceof Error ? stooqError.message : String(stooqError);
      throw new Error(`No price data found for symbol: ${symbol} (yahoo: ${yMsg}; stooq: ${sMsg})`);
    }
  }
}

async function fetchFromYahoo(symbol: string, rangeYears: number): Promise<SymbolSeries> {
  const range = yearsToYahooRange(rangeYears);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${range}&interval=1d`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "application/json",
    },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const timestamps: number[] | undefined = result?.timestamp;
  const closes: (number | null)[] | undefined = result?.indicators?.quote?.[0]?.close;

  if (!timestamps || !closes || timestamps.length === 0) {
    throw new Error("empty response");
  }

  const prices: PricePoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close === null || close === undefined) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    prices.push({ date, close });
  }

  if (prices.length === 0) {
    throw new Error("no valid close prices");
  }

  // yearsToYahooRange() rounds up to Yahoo's fixed range buckets (1y/2y/5y/10y/max),
  // so the raw response can contain more history than the user actually asked for
  // (e.g. a 3-year request returns Yahoo's "5y" bucket). Trim to the requested
  // window so downstream annualization uses the correct number of years.
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - rangeYears);
  const trimmed = prices.filter((p) => new Date(p.date) >= cutoff);
  const finalPrices = trimmed.length >= 2 ? trimmed : prices;

  return { symbol: symbol.toUpperCase(), prices: finalPrices };
}

function yearsToYahooRange(years: number): string {
  if (years <= 1) return "1y";
  if (years <= 2) return "2y";
  if (years <= 5) return "5y";
  if (years <= 10) return "10y";
  return "max";
}

async function fetchFromStooq(symbol: string, rangeYears: number): Promise<SymbolSeries> {
  const stooqSymbol = toStooqSymbol(symbol);
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`;

  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const csv = await res.text();
  const prices = parseStooqCsv(csv);

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - rangeYears);
  const filtered = prices.filter((p) => new Date(p.date) >= cutoff);

  if (filtered.length === 0) {
    throw new Error("no rows in range");
  }

  return { symbol: symbol.toUpperCase(), prices: filtered };
}

export function toStooqSymbol(symbol: string): string {
  const s = symbol.trim().toLowerCase();
  // If it already contains a market suffix (e.g. .us, .tw), leave as-is.
  if (s.includes(".")) return s;
  return `${s}.us`;
}

export function parseStooqCsv(csv: string): PricePoint[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const points: PricePoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 5) continue;
    const [date, , , , close] = cols;
    const closeNum = parseFloat(close);
    if (!date || Number.isNaN(closeNum)) continue;
    points.push({ date, close: closeNum });
  }
  return points;
}

export async function fetchMultiple(
  symbols: string[],
  rangeYears = 5
): Promise<{ results: SymbolSeries[]; errors: { symbol: string; message: string }[] }> {
  const results: SymbolSeries[] = [];
  const errors: { symbol: string; message: string }[] = [];

  await Promise.all(
    symbols.map(async (sym) => {
      try {
        const series = await fetchDailyPrices(sym, rangeYears);
        results.push(series);
      } catch (e) {
        errors.push({ symbol: sym, message: e instanceof Error ? e.message : String(e) });
      }
    })
  );

  return { results, errors };
}
