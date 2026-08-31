import { DividendEvent, PricePoint, SplitEvent, SymbolSeries } from "./types";

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
  for (const candidate of symbolCandidates(symbol)) {
    try {
      return await fetchFromYahoo(candidate, rangeYears);
    } catch {
      // Try the next suffix before falling through to the Stooq fallback.
    }
  }
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

/**
 * Market suffixes worth trying for a bare Taiwanese ticker before giving up.
 *
 * Taiwanese tickers are numeric, sometimes with a class letter (0050, 00679B,
 * 00631L), and nobody in Taiwan writes the exchange suffix — but the data
 * source demands one, and *which* one depends on where the symbol listed:
 * `.TW` for the TWSE, `.TWO` for TPEx, where every Taiwanese bond ETF lives.
 * A bare numeric ticker is never a US symbol, so resolving it against both is
 * unambiguous. Anything already carrying a suffix, or shaped like a US ticker,
 * yields nothing here and is fetched as typed.
 */
export function symbolCandidates(symbol: string): string[] {
  const s = symbol.trim().toUpperCase();
  if (s.includes(".") || !/^\d{4,6}[A-Z]?$/.test(s)) return [];
  return [`${s}.TW`, `${s}.TWO`];
}

async function fetchFromYahoo(symbol: string, rangeYears: number): Promise<SymbolSeries> {
  const range = yearsToYahooRange(rangeYears);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${range}&interval=1d&events=div%2Csplit`;

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
  const usedCutoff = trimmed.length >= 2 ? cutoff : null;

  // Historical prices from this endpoint are already split-adjusted (no
  // artificial jump around a split date), so a low share price never means a
  // low return — but that also makes splits invisible in the price series
  // itself. Surface them explicitly from the requested split events instead.
  const rawSplits = result?.events?.splits as
    | Record<string, { date: number; numerator?: number; denominator?: number; splitRatio?: string }>
    | undefined;
  const splits: SplitEvent[] | undefined = rawSplits
    ? Object.values(rawSplits)
        .map((s) => ({
          date: new Date(s.date * 1000).toISOString().slice(0, 10),
          ratio: s.splitRatio ?? `${s.numerator ?? "?"}:${s.denominator ?? "?"}`,
        }))
        .filter((s) => usedCutoff === null || new Date(s.date) >= usedCutoff)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
    : splitsUnreported(symbol);

  // Cash distributions, for the income metrics. Unlike splits these need no
  // market-specific caveat: the source reports them for US and Taiwan funds
  // alike (a Taiwan bond ETF paying monthly returns twelve events a year).
  const rawDividends = result?.events?.dividends as
    | Record<string, { date: number; amount?: number }>
    | undefined;
  const dividends: DividendEvent[] | undefined = rawDividends
    ? Object.values(rawDividends)
        .filter((d) => typeof d.amount === "number")
        .map((d) => ({
          date: new Date(d.date * 1000).toISOString().slice(0, 10),
          amount: d.amount as number,
        }))
        .sort((a, b) => (a.date < b.date ? -1 : 1))
    : undefined;

  return { symbol: symbol.toUpperCase(), prices: finalPrices, splits, dividends };
}

/**
 * Whether a symbol trades in Taiwan.
 *
 * Two suffixes, not one: TWSE-listed symbols end in `.TW`, but Taiwan's bond
 * ETFs are all listed on TPEx and end in `.TWO` instead — a `.TW` lookup for
 * any of them returns nothing at all. Note that `.TWO` does *not* end with
 * `.TW`, so a naive endsWith(".TW") check silently classifies every Taiwanese
 * bond ETF as US-listed and prices it in the wrong currency against the wrong
 * benchmark.
 */
export function isTaiwanListed(symbol: string): boolean {
  const s = symbol.trim().toUpperCase();
  return s.endsWith(".TW") || s.endsWith(".TWO");
}

/**
 * What an *absent* split-events block means for this symbol: a genuine zero,
 * or simply unknown.
 *
 * Yahoo omits the block both for a symbol that has truly never split and for
 * one whose split history it doesn't carry, so the response alone can't tell
 * the two apart — the market has to decide it. For US-listed symbols the
 * coverage is reliable (AAPL's 2020 4:1, TSLA's 5:1 and 3:1, NVDA's 4:1 and
 * 10:1, TQQQ's eight splits all come through), so an empty block is a real
 * zero. For Taiwan-listed ETFs it is not: 0050.TW's 1-into-4 split of June
 * 2025 is missing entirely even though the prices around it *are* adjusted for
 * it (~NT$47 where it had traded ~NT$190). Taiwan-listed *stocks* do report
 * theirs (2330.TW returns ten events), but we can't enumerate which symbols
 * are covered, so every Taiwan-listed symbol with an empty block is reported
 * as unknown rather than as a confident zero.
 *
 * Returns are unaffected either way — the price series is split-adjusted at
 * source, so this only governs whether the UI can show a count or a dash.
 */
export function splitsUnreported(symbol: string): SplitEvent[] | undefined {
  return isTaiwanListed(symbol) ? undefined : [];
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
