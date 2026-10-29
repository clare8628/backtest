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
 * "@alo" marks an adjustable allocation: a leveraged ETF held together with
 * cash, e.g. "TQQQ@alo(60:40)" = 60% TQQQ + 40% cash, rebalanced back to that
 * split every year on 11/1. A bare "@alo" (no ratio yet) means the default.
 * It can follow "@sim": "TQQQ@sim@alo(80:20)".
 */
export const ALO_SUFFIX = "@alo";
export const DEFAULT_ALO_RISK = 60;
/** Month-day (MM-DD) on which allocation-adjusted portfolios are rebalanced. */
export const ALO_REBALANCE_MD = "11-01";

export interface Allocation {
  /** % held in the leveraged ETF */
  risk: number;
  /** % held in cash */
  cash: number;
}

const ALO_RE = /@alo(?:\(\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*\))?$/i;

/** Splits off a trailing "@alo[(risk:cash)]". `valid` is false when the ratio
 *  is out of range or does not total 100%. */
function splitAlo(symbol: string): { rest: string; alloc: (Allocation & { valid: boolean }) | null } {
  const s = symbol.trim();
  const m = ALO_RE.exec(s);
  if (!m) return { rest: s, alloc: null };
  const rest = s.slice(0, m.index).trim();
  if (m[1] === undefined) {
    return { rest, alloc: { risk: DEFAULT_ALO_RISK, cash: 100 - DEFAULT_ALO_RISK, valid: true } };
  }
  const risk = Number(m[1]);
  const cash = Number(m[2]);
  const valid = risk > 0 && risk <= 100 && cash >= 0 && Math.abs(risk + cash - 100) < 1e-9;
  return { rest, alloc: { risk, cash, valid } };
}

export function isAllocationSymbol(symbol: string): boolean {
  return ALO_RE.test(symbol.trim());
}

/** The ETF/cash split carried by the symbol, or null when it has none. */
export function parseAllocation(symbol: string): (Allocation & { valid: boolean }) | null {
  return splitAlo(symbol).alloc;
}

export function allocationSuffix(a: Allocation): string {
  return `${ALO_SUFFIX}(${a.risk}:${a.cash})`;
}

/** Rewrites the ratio on a symbol that already carries (or is about to carry)
 *  an "@alo" suffix, keeping the base ticker and any "@sim" intact. Used to
 *  drive an adjustable ratio control from a plain risk% input. */
export function withAllocationRatio(symbol: string, risk: number): string {
  const idx = symbol.search(/@alo/i);
  const base = (idx >= 0 ? symbol.slice(0, idx) : symbol).trim();
  const clamped = Math.min(100, Math.max(1, risk));
  return `${base}${allocationSuffix({ risk: clamped, cash: 100 - clamped })}`;
}

function endsWithSim(s: string): boolean {
  return s.trim().toUpperCase().endsWith(SIM_SUFFIX.toUpperCase());
}

export function isSimulatedSymbol(symbol: string): boolean {
  return endsWithSim(splitAlo(symbol).rest);
}

/**
 * Users may type the displayed "@sim" / "@alo(60:40)" suffixes back into a
 * symbol search box (e.g. copying "TQQQ@sim" from the legend). They are
 * display-only labels, not part of any real ticker, so strip both before any
 * lookup.
 */
export function stripSimSuffix(symbol: string): string {
  const s = splitAlo(symbol).rest;
  if (endsWithSim(s)) return s.slice(0, s.length - SIM_SUFFIX.length).trim();
  return s;
}

/** Canonical key for a base ticker plus optional @sim / @alo(...) variants. */
export function variantSymbol(
  base: string,
  opts: { sim?: boolean; alloc?: Allocation | null } = {}
): string {
  const b = stripSimSuffix(base).trim().toUpperCase();
  return `${b}${opts.sim ? SIM_SUFFIX : ""}${opts.alloc ? allocationSuffix(opts.alloc) : ""}`;
}

/** Re-attaches the variants carried by `original` onto a canonical base ticker. */
export function withVariantOf(original: string, canonicalBase: string): string {
  const alloc = parseAllocation(original);
  return variantSymbol(canonicalBase, {
    sim: isSimulatedSymbol(original),
    alloc: alloc && { risk: alloc.risk, cash: alloc.cash },
  });
}

export function simVariantSymbol(symbol: string): string {
  const base = stripSimSuffix(symbol).trim().toUpperCase();
  return `${base}${SIM_SUFFIX}`;
}

export function parseSymbolVariant(symbol: string): { base: string; isSim: boolean } {
  const isSim = isSimulatedSymbol(symbol);
  const base = stripSimSuffix(symbol).trim().toUpperCase();
  return { base, isSim };
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
  const bare = stripSimSuffix(symbol).trim().toUpperCase();
  return (
    SIM_SPECS[bare] ??
    SIM_SPECS[`${bare}.TW`] ??
    SIM_SPECS[`${bare}.TWO`] ??
    null
  );
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

/**
 * Daily value of "risk% in the asset + cash% in cash", rebalanced back to that
 * split on the first trading day on or after each 11/1. Cash earns 0%. The
 * series starts at the asset's first close, so its scale stays comparable with
 * the plain symbol, and begins at the target split.
 */
export function simulateAllocation(prices: PricePoint[], alloc: Allocation): PricePoint[] {
  if (prices.length === 0) return [];
  const w = alloc.risk / 100;
  let value = prices[0].close;
  let shares = (value * w) / prices[0].close;
  let cash = value * (1 - w);
  const out: PricePoint[] = [{ date: prices[0].date, close: value }];
  for (let i = 1; i < prices.length; i++) {
    const { date, close } = prices[i];
    value = shares * close + cash;
    const rebalanceDay = `${date.slice(0, 4)}-${ALO_REBALANCE_MD}`;
    if (prices[i - 1].date < rebalanceDay && date >= rebalanceDay) {
      shares = (value * w) / close;
      cash = value * (1 - w);
    }
    out.push({ date, close: value });
  }
  return out;
}
