import { Currency, DividendEvent, PricePoint, SplitEvent, SymbolSeries } from "./types";
import { findEntry } from "./symbolCatalog";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface SymbolLookupResult {
  found: boolean;
  symbol: string;
  canonicalSymbol: string;
  name: string;
  nameEn: string;
  currency: Currency;
  latestPrice?: number;
  previousClose?: number;
  category?: string;
  channelUsed?: string;
  channelsTried?: string[];
  error?: string;
}

interface YahooMeta {
  currency?: string;
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  instrumentType?: string;
}

/**
 * Fetches daily historical close prices for a symbol.
 * Multi-channel architecture:
 *  - Primary: Yahoo Finance Query 1 API
 *  - Backup A: Yahoo Finance Query 2 API
 *  - Backup B: Stooq CSV endpoint
 */
export async function fetchDailyPrices(
  symbol: string,
  rangeYears = 5,
  forceRefresh = false
): Promise<SymbolSeries> {
  const attempted: string[] = [];
  const candidates = symbolCandidates(symbol);
  const symbolsToTry = candidates.length > 0 ? candidates : [symbol];

  for (const sym of symbolsToTry) {
    // Channel 1: Yahoo Finance Query 1 (Primary)
    try {
      attempted.push(`Yahoo Q1 (${sym})`);
      return await fetchFromYahoo(sym, rangeYears, 0, forceRefresh);
    } catch {
      // Channel 2: Yahoo Finance Query 2 (Backup A)
      try {
        attempted.push(`Yahoo Q2 (${sym})`);
        return await fetchFromYahoo(sym, rangeYears, 1, forceRefresh);
      } catch {
        // Try next candidate or fallback
      }
    }
  }

  // Channel 3: Stooq (Backup B)
  try {
    attempted.push(`Stooq (${symbol})`);
    return await fetchFromStooq(symbol, rangeYears, forceRefresh);
  } catch {
    throw new Error(
      `No price data found for symbol: ${symbol} (tried channels: ${attempted.join(", ")})`
    );
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

/**
 * The ticker as Yahoo Finance's chart API wants it spelled.
 *
 * Class shares are written with a dot everywhere a human types them, and the
 * catalog stores them that way — `BRK.B`, `BF.B` — but Yahoo's chart endpoint
 * only answers to the hyphen form (`BRK-B`); the dot form comes back "No data
 * found, symbol may be delisted". A US class-share ticker is letters, a dot,
 * one letter; Taiwan symbols lead with digits and carry a `.TW`/`.TWO` suffix,
 * so they never match and pass through untouched.
 */
export function toYahooSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  return /^[A-Z]+\.[A-Z]$/.test(s) ? s.replace(".", "-") : s;
}

async function fetchFromYahoo(
  symbol: string,
  rangeYears: number,
  hostIndex = 0,
  forceRefresh = false
): Promise<SymbolSeries> {
  const host = hostIndex === 0 ? "query1.finance.yahoo.com" : "query2.finance.yahoo.com";
  const range = yearsToYahooRange(rangeYears);
  const url = `https://${host}/v8/finance/chart/${encodeURIComponent(
    toYahooSymbol(symbol)
  )}?range=${range}&interval=1d&events=div%2Csplit`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "application/json",
    },
    ...(forceRefresh ? { cache: "no-store" } : { next: { revalidate: 3600 } }),
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
    let close = closes[i];
    if (close === null || close === undefined) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    // Yahoo Finance bug workaround: 00631L.TW underwent a 1:22 split in March 2026.
    // Yahoo adjusted prices from 2015-01-05 onwards (~0.85), but left 2014-10-23 to 2014-12-31
    // unadjusted (~19~20), causing a 22x artificial spike and distorted 12-year backtest metrics.
    if (symbol.toUpperCase().startsWith("00631L") && date < "2015-01-01" && close > 5) {
      close = close / 22;
    }
    // Yahoo Finance FX bug workaround: TWD=X has an erroneous close of 3.67 on 2014-12-31
    // (normal range ~25-35 TWD/USD), which causes a massive false spike in USD price conversions.
    if (symbol.toUpperCase().includes("TWD=X") && (close < 15 || close > 50)) {
      continue;
    }
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

async function fetchFromStooq(symbol: string, rangeYears: number, forceRefresh = false): Promise<SymbolSeries> {
  const stooqSymbol = toStooqSymbol(symbol);
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`;

  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA },
    ...(forceRefresh ? { cache: "no-store" } : { next: { revalidate: 3600 } }),
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
  // A class share (`brk.b`) writes its class with a dot, but Stooq — like
  // Yahoo — wants a hyphen and still needs the `.us` market suffix appended.
  if (/^[a-z]+\.[a-z]$/.test(s)) return `${s.replace(".", "-")}.us`;
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
  rangeYears = 5,
  forceRefresh = false
): Promise<{ results: SymbolSeries[]; errors: { symbol: string; message: string }[] }> {
  const results: SymbolSeries[] = [];
  const errors: { symbol: string; message: string }[] = [];

  await Promise.all(
    symbols.map(async (sym) => {
      try {
        const series = await fetchDailyPrices(sym, rangeYears, forceRefresh);
        results.push(series);
      } catch (e) {
        errors.push({ symbol: sym, message: e instanceof Error ? e.message : String(e) });
      }
    })
  );

  return { results, errors };
}

async function fetchYahooMeta(symbol: string, hostIndex: number): Promise<YahooMeta | null> {
  const host = hostIndex === 0 ? "query1.finance.yahoo.com" : "query2.finance.yahoo.com";
  const url = `https://${host}/v8/finance/chart/${encodeURIComponent(toYahooSymbol(symbol))}?range=1d&interval=1d`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.chart?.result?.[0]?.meta || null;
  } catch {
    return null;
  }
}

async function searchYahooQuotes(query: string): Promise<SymbolLookupResult | null> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=5`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const quotes = data?.quotes;
    if (!Array.isArray(quotes) || quotes.length === 0) return null;
    const qUpper = query.trim().toUpperCase();
    const match =
      quotes.find((q: { symbol?: string }) => q.symbol?.toUpperCase() === qUpper) ||
      quotes.find((q: { symbol?: string }) => q.symbol?.toUpperCase().startsWith(qUpper)) ||
      quotes[0];
    if (!match?.symbol) return null;
    const canonical = match.symbol.toUpperCase();
    const isTw = isTaiwanListed(canonical);
    return {
      found: true,
      symbol: qUpper,
      canonicalSymbol: canonical,
      name: match.shortname || match.longname || canonical,
      nameEn: match.longname || match.shortname || canonical,
      currency: isTw ? "TWD" : "USD",
      category: match.quoteType === "ETF" ? "ETF" : "Stock",
    };
  } catch {
    return null;
  }
}

async function resolveTaiwanChineseName(canonicalSymbol: string): Promise<string | null> {
  // 1. Check local catalog
  const catalogEntry = findEntry(canonicalSymbol);
  if (catalogEntry?.name) return catalogEntry.name;

  // 2. Query TWSE MIS API for instant official Chinese name
  try {
    const isTPEx = canonicalSymbol.endsWith(".TWO");
    const exCh = `${isTPEx ? "otc_" : "tse_"}${canonicalSymbol.toLowerCase()}`;
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exCh}&json=1&delay=0`;
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA },
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      const msg = data?.msgArray?.[0];
      if (msg?.n && msg.n !== "-") return msg.n;
    }
  } catch {
    // fallback
  }

  return null;
}

async function lookupTaiwanOpenApi(rawSymbol: string): Promise<SymbolLookupResult | null> {
  const cleanCode = rawSymbol.trim().toUpperCase().replace(/\.(TW|TWO)$/i, "");
  try {
    const res = await fetch("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", {
      headers: { "User-Agent": BROWSER_UA },
      cache: "no-store",
    });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        const item = list.find((it: { Code?: string }) => it.Code === cleanCode);
        if (item) {
          const canonical = `${item.Code}.TW`;
          const closePrice = parseFloat(item.ClosingPrice);
          return {
            found: true,
            symbol: rawSymbol.toUpperCase(),
            canonicalSymbol: canonical,
            name: item.Name || canonical,
            nameEn: item.Name || canonical,
            currency: "TWD",
            latestPrice: Number.isNaN(closePrice) ? undefined : closePrice,
            category: "Stock",
            channelUsed: "TWSE 官方證券資料庫 (Backup)",
          };
        }
      }
    }
  } catch {
    // try next
  }

  return null;
}

/**
 * Validates and looks up a symbol across multiple live channels.
 * Returns metadata including canonical symbol, name, currency, latest price, and channel used.
 */
export async function lookupSymbol(rawSymbol: string): Promise<SymbolLookupResult> {
  const s = rawSymbol.trim().toUpperCase();
  const channelsTried: string[] = [];

  if (!s) {
    return {
      found: false,
      symbol: "",
      canonicalSymbol: "",
      name: "",
      nameEn: "",
      currency: "USD",
      error: "標的代號不能為空",
      channelsTried,
    };
  }

  // 0. Check internal catalog
  const catalogEntry = findEntry(s);
  if (catalogEntry) {
    const canonical = catalogEntry.symbol.toUpperCase();
    const currency = isTaiwanListed(canonical) ? "TWD" : "USD";
    return {
      found: true,
      symbol: s,
      canonicalSymbol: canonical,
      name: catalogEntry.name,
      nameEn: catalogEntry.nameEn,
      currency,
      category: catalogEntry.category,
      channelUsed: "內建標的庫 (Catalog)",
      channelsTried: ["內建標的庫"],
    };
  }

  // Candidates for bare Taiwanese tickers (e.g. 2330 -> 2330.TW, 2330.TWO)
  const candidates = symbolCandidates(s);
  const symbolsToTry = candidates.length > 0 ? candidates : [s];

  // 1. Try Yahoo Finance Query 1 (Primary)
  for (const cand of symbolsToTry) {
    try {
      channelsTried.push(`Yahoo Finance Q1 (${cand})`);
      const meta = await fetchYahooMeta(cand, 0);
      if (meta && (meta.regularMarketPrice !== undefined || meta.chartPreviousClose !== undefined)) {
        return await buildLookupResult(meta, cand, "Yahoo Finance (Primary)", channelsTried);
      }
    } catch {
      // try next
    }
  }

  // 2. Try Yahoo Finance Query 2 (Backup A)
  for (const cand of symbolsToTry) {
    try {
      channelsTried.push(`Yahoo Finance Q2 (${cand})`);
      const meta = await fetchYahooMeta(cand, 1);
      if (meta && (meta.regularMarketPrice !== undefined || meta.chartPreviousClose !== undefined)) {
        return await buildLookupResult(meta, cand, "Yahoo Finance (Backup Q2)", channelsTried);
      }
    } catch {
      // try next
    }
  }

  // 3. Try Yahoo Search API (Backup B)
  try {
    channelsTried.push(`Yahoo Finance Search (${s})`);
    const searchRes = await searchYahooQuotes(s);
    if (searchRes && searchRes.found) {
      if (searchRes.currency === "TWD") {
        const twName = await resolveTaiwanChineseName(searchRes.canonicalSymbol);
        if (twName) searchRes.name = twName;
      }
      return {
        ...searchRes,
        channelUsed: "Yahoo Finance (Search API)",
        channelsTried,
      };
    }
  } catch {
    // try next
  }

  // 4. Try Taiwan Official OpenAPI (Backup C - Taiwan)
  const isTaiwanCandidate = candidates.length > 0 || isTaiwanListed(s);
  if (isTaiwanCandidate) {
    try {
      channelsTried.push(`TWSE/TPEx OpenAPI (${s})`);
      const twRes = await lookupTaiwanOpenApi(s);
      if (twRes && twRes.found) {
        return {
          ...twRes,
          channelsTried,
        };
      }
    } catch {
      // try next
    }
  }

  // 5. Try Stooq CSV (Backup D - US)
  try {
    channelsTried.push(`Stooq (${s})`);
    const stooqRes = await fetchFromStooq(s, 1);
    if (stooqRes && stooqRes.prices.length > 0) {
      const latest = stooqRes.prices[stooqRes.prices.length - 1];
      return {
        found: true,
        symbol: s,
        canonicalSymbol: s,
        name: s,
        nameEn: s,
        currency: "USD",
        latestPrice: latest.close,
        category: "Stock",
        channelUsed: "Stooq (Backup)",
        channelsTried,
      };
    }
  } catch {
    // all failed
  }

  return {
    found: false,
    symbol: s,
    canonicalSymbol: s,
    name: s,
    nameEn: s,
    currency: isTaiwanListed(s) ? "TWD" : "USD",
    error: `找不到標的「${s}」的行情數據。已嘗試多個管道（${channelsTried.join("、")}）均無此代號，請確認代號是否正確。`,
    channelsTried,
  };
}

async function buildLookupResult(
  meta: YahooMeta,
  cand: string,
  channel: string,
  channelsTried: string[]
): Promise<SymbolLookupResult> {
  const canonicalSymbol = meta.symbol?.toUpperCase() || cand.toUpperCase();
  const currency: Currency = meta.currency === "TWD" || isTaiwanListed(canonicalSymbol) ? "TWD" : "USD";
  let name = meta.shortName || meta.longName || canonicalSymbol;
  const nameEn = meta.longName || meta.shortName || canonicalSymbol;

  if (currency === "TWD") {
    const twName = await resolveTaiwanChineseName(canonicalSymbol);
    if (twName) {
      name = twName;
    }
  }

  return {
    found: true,
    symbol: cand.toUpperCase(),
    canonicalSymbol,
    name,
    nameEn,
    currency,
    latestPrice: meta.regularMarketPrice ?? meta.chartPreviousClose,
    previousClose: meta.chartPreviousClose,
    category: meta.instrumentType === "ETF" ? "ETF" : "Stock",
    channelUsed: channel,
    channelsTried,
  };
}
