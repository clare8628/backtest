import { PricePoint } from "./types";

/**
 * Leveraged ETFs are young, so their history never reaches the big crashes
 * (2000, 2008). To backtest through them, the stretch before inception is
 * simulated from the underlying index ETF: each day earns `leverage` times the
 * underlying's daily return, minus financing on the borrowed part and the
 * fund's expense ratio. Simulated series are shown with an "@sim" suffix.
 */
export interface LeverageSpec {
  underlying: string;
  leverage: number;
  /** Annual expense ratio, % */
  expenseRatio: number;
  /** Assumed annual financing rate on the borrowed (leverage - 1) part, % */
  financingRate: number;
}

export const SIM_SUFFIX = "@sim";
/**
 * Explicit opt-out: appending "@real" to a symbol adds it as the real-data-only
 * counterpart of a leveraged ETF, never extended with simulated pre-inception
 * prices — even though the bare symbol auto-extends by default. This lets the
 * original (truncated) and simulated series for the same ticker sit side by
 * side in one comparison, e.g. "TQQQ" (auto, extends when the range needs it)
 * next to "TQQQ@real" (always real-only).
 */
export const REAL_SUFFIX = "@real";

/**
 * Users may type the displayed "@sim" suffix back into a symbol search box
 * (e.g. copying "TQQQ@sim" from the legend). The suffix is a display-only
 * label, not part of any real ticker, so strip it before any lookup.
 */
export function stripSimSuffix(symbol: string): string {
  const s = symbol.trim();
  if (s.toUpperCase().endsWith(SIM_SUFFIX.toUpperCase())) {
    return s.slice(0, s.length - SIM_SUFFIX.length).trim();
  }
  return s;
}

/** Strips a trailing "@real" suffix (case-insensitive), the counterpart of
 *  stripSimSuffix for the explicit real-only opt-out. */
export function stripRealSuffix(symbol: string): string {
  const s = symbol.trim();
  if (s.toUpperCase().endsWith(REAL_SUFFIX.toUpperCase())) {
    return s.slice(0, s.length - REAL_SUFFIX.length).trim();
  }
  return s;
}

export interface SymbolVariant {
  /** The ticker with any "@sim"/"@real" suffix removed — what's actually
   *  fetched and looked up. Case is preserved from the input. */
  base: string;
  /** True when the input explicitly asked to exclude simulated pre-inception
   *  data (a trailing "@real"), overriding the default auto-extend behavior. */
  forceReal: boolean;
}

/** Parses a symbol that may carry a trailing "@sim" or "@real" display/intent
 *  suffix into its real ticker and which variant was requested. */
export function parseSymbolVariant(symbol: string): SymbolVariant {
  const s = symbol.trim();
  if (s.toUpperCase().endsWith(REAL_SUFFIX.toUpperCase())) {
    return { base: stripRealSuffix(s), forceReal: true };
  }
  return { base: stripSimSuffix(s), forceReal: false };
}

/** Canonical storage/display key for the explicit real-only variant of a
 *  leveraged ETF, so it can coexist in a comparison group alongside the
 *  symbol's default (auto-simulated) entry. */
export function realVariantSymbol(base: string): string {
  return `${base.trim().toUpperCase()}${REAL_SUFFIX}`;
}

const SIM_SPECS: Record<string, LeverageSpec> = {
  TQQQ: { underlying: "QQQ", leverage: 3, expenseRatio: 0.86, financingRate: 3 },
  QLD: { underlying: "QQQ", leverage: 2, expenseRatio: 0.95, financingRate: 3 },
  SPXL: { underlying: "SPY", leverage: 3, expenseRatio: 0.91, financingRate: 3 },
  UPRO: { underlying: "SPY", leverage: 3, expenseRatio: 0.91, financingRate: 3 },
  SSO: { underlying: "SPY", leverage: 2, expenseRatio: 0.89, financingRate: 3 },
  SOXL: { underlying: "SOXX", leverage: 3, expenseRatio: 0.9, financingRate: 3 },
  "00631L.TW": { underlying: "0050.TW", leverage: 2, expenseRatio: 1.03, financingRate: 1.5 },
};

export function getLeverageSpec(symbol: string): LeverageSpec | null {
  return SIM_SPECS[symbol.trim().toUpperCase()] ?? null;
}

const TRADING_DAYS = 252;

/**
 * Simulated prices for every underlying date before the real series starts,
 * anchored so the simulated path joins the real first price with no jump.
 * Returns [] when the underlying has nothing earlier than the real series.
 */
export function simulatePrefix(
  realFirst: PricePoint,
  underlying: PricePoint[],
  spec: LeverageSpec
): PricePoint[] {
  const j = underlying.findIndex((p) => p.date >= realFirst.date);
  if (j <= 0) return [];
  const dailyCost =
    ((spec.leverage - 1) * spec.financingRate + spec.expenseRatio) / 100 / TRADING_DAYS;

  const out: PricePoint[] = new Array(j);
  let next = realFirst.close;
  for (let i = j - 1; i >= 0; i--) {
    const r = underlying[i + 1].close / underlying[i].close - 1;
    const growth = Math.max(1 + spec.leverage * r - dailyCost, 1e-4);
    next = next / growth;
    out[i] = { date: underlying[i].date, close: next };
  }
  return out;
}
