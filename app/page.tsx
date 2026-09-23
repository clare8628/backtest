"use client";

import { Fragment, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { t, Lang } from "@/lib/i18n";
import { displaySymbol, findEntry, registerDynamicSymbol, searchCatalog, symbolLabel } from "@/lib/symbolCatalog";
import { ComparisonGroup, BacktestMetrics, Recommendation, ChartSeries, Currency } from "@/lib/types";
import { loadGroups, upsertGroup, deleteGroup, newGroupId } from "@/lib/storage";
import PerformanceChart, { SimSettings } from "@/components/PerformanceChart";
import Sparkline from "@/components/Sparkline";
import { simulateWithdrawnSeries } from "@/lib/backtest";

interface BacktestResult {
  metrics: BacktestMetrics[];
  recommendations: Recommendation[];
  chartSeries: ChartSeries[];
  mixedCurrencies: boolean;
  errors: { symbol: string; message: string }[];
  alignedWindow?: { start: string; end: string; years: number } | null;
  constrainedBy?: string | null;
}

const DEBOUNCE_MS = 500;

/** Range-slider bounds, and the value a brand-new group starts at before its
 *  first backtest fits it to the data. */
const RANGE_MIN = 1;
const RANGE_MAX = 20;
const DEFAULT_RANGE_YEARS = 5;
const MAX_SYMBOLS_PER_GROUP = 15;

/** Blue above `neutral`, red below — used for the signed trend measures, where
 *  the sign (not the magnitude) is what says "uptrend" vs "downtrend". */
function trendColor(value: number | null | undefined, neutral = 0): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value > neutral) return "var(--positive)";
  if (value < neutral) return "var(--negative)";
  return undefined;
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs"
      style={{ background: "var(--background)", border: "1px solid var(--line)", color: "var(--foreground-muted)" }}
    >
      <p className="font-medium mb-1" style={{ color: "var(--foreground)" }}>{title}</p>
      <p>{body}</p>
    </div>
  );
}

/**
 * A symbol wherever it labels something rather than sits in a sentence: the
 * ticker on top, its fund name on a second line centred underneath.
 *
 * Stacked rather than run together in parentheses because a Taiwan fund's name
 * is longer than its code — inline, one column header became a wrapping run of
 * text that pushed the table wide; stacked, the label is only as wide as its
 * longer line and the code stays the first thing read. US tickers have no
 * name and render as the single line they already were.
 */
function SymbolLabel({ symbol, lang }: { symbol: string; lang: Lang }) {
  const { code, name } = symbolLabel(symbol, lang);
  if (!name) return <>{code}</>;
  return (
    <span className="inline-flex flex-col items-center leading-tight">
      <span>{code}</span>
      <span className="text-xs font-normal opacity-70">{name}</span>
    </span>
  );
}

const DASH = "—";
const pct = (v: number | null | undefined) => (v === undefined || v === null ? DASH : `${v}%`);
const num = (v: number | null | undefined) => (v === undefined || v === null ? DASH : String(v));
const text = (v: string | null | undefined) => (v ? v : DASH);

/** Net assets in the fund's own currency, scaled to the unit that market
 *  actually quotes: 億 for TWD (a NT$167,000,000,000 fund is "1,674 億"), and
 *  B/M for USD. Showing raw digits for either makes them unreadable. */
function formatFundSize(value: number | null | undefined, currency: Currency | undefined): string {
  if (value === undefined || value === null) return DASH;
  if (currency === "TWD") {
    return `${(value / 1e8).toLocaleString(undefined, { maximumFractionDigits: 0 })} 億 TWD`;
  }
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toLocaleString()}`;
}

/** Turn a raw count of payments per year into the label an investor thinks in.
 *  Kept slightly loose because a fund's first or last year in the window can
 *  land 11 or 13 payments on a genuinely monthly schedule. */
function distributionLabel(count: number | null | undefined, T: Dict): string {
  if (count === undefined || count === null) return DASH;
  const name =
    count >= 11 ? T.freqMonthly
    : count >= 3 && count <= 5 ? T.freqQuarterly
    : count === 2 ? T.freqSemiannual
    : count === 1 ? T.freqAnnual
    : T.freqOther;
  return `${name}（${count} ${T.perYear}）`;
}

type Dict = ReturnType<typeof t>;
interface MetricRow {
  label: string;
  value: (m: BacktestMetrics) => ReactNode;
  color?: (m: BacktestMetrics) => string | undefined;
}

/** The table is transposed — metrics down the side, symbols across the top —
 *  because there are ~20 metrics and rarely more than a handful of symbols.
 *  Laid out the other way every metric became a column and the right-hand half
 *  fell off the screen; this way the width scales with the symbol count the
 *  user chose, so a normal comparison fits without scrolling at all. Grouping
 *  the rows into sections also lets related numbers (the return decomposition
 *  especially, which reads as an equation) sit next to each other. */
function metricSections(
  T: Dict,
  lang: Lang,
  withdrawnValues?: Record<string, { value: number; depletedDate: string | null }>
): { title: string; rows: MetricRow[] }[] {
  return [
    {
      title: T.groupReturn,
      rows: [
        { label: T.totalReturn, value: (m) => pct(m.totalReturn) },
        { label: T.annualizedReturn, value: (m) => pct(m.annualizedReturn) },
        { label: T.finalValue, value: (m) => m.finalValue.toLocaleString() },
        {
          label: T.withdrawnFinalValue,
          value: (m) => {
            const data = withdrawnValues?.[m.symbol];
            if (!data) return DASH;
            if (data.depletedDate) {
              const year = new Date(data.depletedDate).getFullYear();
              return (
                <span className="inline-flex items-center gap-1" style={{ color: "var(--negative)" }}>
                  <span>0</span>
                  <span className="text-[10px] opacity-75 font-normal">
                    ({T.depletedAt} {year})
                  </span>
                </span>
              );
            }
            return data.value.toLocaleString();
          },
          color: (m) => {
            const data = withdrawnValues?.[m.symbol];
            if (data && data.depletedDate) return "var(--negative)";
            return undefined;
          },
        },
      ],
    },
    {
      title: T.groupRisk,
      rows: [
        { label: T.volatility, value: (m) => pct(m.annualizedVolatility) },
        {
          label: T.maxDrawdown,
          value: (m) => pct(m.maxDrawdown),
          color: (m) => (m.maxDrawdown < 0 ? "var(--negative)" : undefined),
        },
        { label: T.sharpe, value: (m) => num(m.sharpeRatio) },
        { label: T.calmarRatio, value: (m) => num(m.calmarRatio) },
        {
          label: T.beta,
          value: (m) =>
            m.beta === null ? (
              "N/A"
            ) : (
              <>
                {m.beta}
                {m.benchmarkSymbol && (
                  <span className="opacity-50"> ({T.betaVs} {displaySymbol(m.benchmarkSymbol, lang)})</span>
                )}
              </>
            ),
        },
      ],
    },
    {
      title: T.groupSource,
      rows: [
        { label: T.arithmeticAnnualReturn, value: (m) => pct(m.arithmeticAnnualReturn) },
        {
          label: T.volatilityDrag,
          value: (m) => (m.volatilityDrag === undefined ? DASH : `-${m.volatilityDrag}%`),
          color: () => "var(--negative)",
        },
        { label: T.upCapture, value: (m) => pct(m.upCapture) },
        { label: T.downCapture, value: (m) => pct(m.downCapture) },
      ],
    },
    {
      title: T.groupTrend,
      rows: [
        { label: T.trendR2, value: (m) => num(m.trendR2), color: (m) => trendColor(m.trendR2) },
        { label: T.newHighMonthPct, value: (m) => pct(m.newHighMonthPct) },
        { label: T.positiveYearPct, value: (m) => pct(m.positiveYearPct) },
        {
          label: T.gainPainRatio,
          value: (m) => num(m.gainPainRatio),
          color: (m) => trendColor(m.gainPainRatio, 1),
        },
      ],
    },
    {
      title: T.groupIncome,
      rows: [
        { label: T.assetClass, value: (m) => text(m.assetClass) },
        { label: T.creditRating, value: (m) => text(m.creditRating) },
        { label: T.fundSize, value: (m) => formatFundSize(m.fundSize, m.fundSizeCurrency) },
        {
          label: T.estimatedYield,
          value: (m) => pct(m.estimatedYieldPct),
          color: (m) => (m.estimatedYieldPct ? "var(--positive)" : undefined),
        },
        { label: T.distributionFreq, value: (m) => distributionLabel(m.distributionsPerYear, T) },
      ],
    },
    {
      title: T.groupInfo,
      rows: [
        { label: T.maxBacktestYears, value: (m) => num(m.maxBacktestYears) },
        {
          label: T.fee,
          value: (m) => (m.managementFeeKnown === false ? DASH : pct(m.managementFee)),
        },
        { label: T.splitCount, value: (m) => num(m.splitCount) },
      ],
    },
  ];
}

function MetricsTable({
  metrics,
  T,
  lang,
  chartSeries,
  startValue = 1000,
  simSettings,
}: {
  metrics: BacktestMetrics[];
  T: Dict;
  lang: Lang;
  chartSeries?: ChartSeries[];
  startValue?: number;
  simSettings?: SimSettings;
}) {
  const effectiveSim = simSettings ?? { enabled: true, withdrawalRate: 3, inflationRate: 3 };

  const withdrawnValues = useMemo(() => {
    if (!chartSeries || chartSeries.length === 0) return {};
    const res: Record<string, { value: number; depletedDate: string | null }> = {};
    for (const s of chartSeries) {
      if (s.points.length === 0) continue;
      // 取各標的自身的基準價格（有 close 價格對應的序列）
      const points = s.points
        .map((p) => {
          const val = p.priceUSD ?? p.priceTWD ?? 0;
          return { date: p.date, value: val };
        })
        .filter((p) => p.value > 0);

      if (points.length === 0) continue;
      const sim = simulateWithdrawnSeries(
        points,
        startValue,
        effectiveSim.withdrawalRate,
        effectiveSim.inflationRate
      );
      res[s.symbol] = {
        value: sim.finalValue,
        depletedDate: sim.depletedDate,
      };
    }
    return res;
  }, [chartSeries, startValue, effectiveSim.withdrawalRate, effectiveSim.inflationRate]);

  const sections = metricSections(T, lang, withdrawnValues);
  const sortedMetrics = useMemo(() => {
    return [...metrics].sort((a, b) => (b.totalReturn ?? 0) - (a.totalReturn ?? 0));
  }, [metrics]);

  return (
    <table className="w-full border-collapse metrics-table">
      <thead>
        <tr style={{ color: "var(--foreground-muted)" }}>
          <th className="py-1 pr-4 text-left font-normal">{T.metric}</th>
          {sortedMetrics.map((m) => (
            <th key={m.symbol} className="py-1 px-2 text-right font-medium" style={{ color: "var(--foreground)" }}>
              <SymbolLabel symbol={m.symbol} lang={lang} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sections.map((section) => (
          <Fragment key={section.title}>
            <tr>
              <td
                colSpan={sortedMetrics.length + 1}
                className="table-group pt-4 pb-1"
              >
                {section.title}
              </td>
            </tr>
            {section.rows.map((row) => (
              <tr key={row.label} className="metrics-row border-t cursor-default" style={{ borderColor: "var(--line)" }}>
                <th
                  scope="row"
                  className="py-2 pl-2 pr-4 text-left text-xs font-normal rounded-l"
                  style={{ color: "var(--foreground-muted)" }}
                >
                  {row.label}
                </th>
                {sortedMetrics.map((m, idx) => (
                  <td
                    key={m.symbol}
                    className={`py-2 px-2 text-right tabular-nums${idx === sortedMetrics.length - 1 ? " pr-2 rounded-r" : ""}`}
                    style={{ color: row.color?.(m) }}
                  >
                    {row.value(m)}
                  </td>
                ))}
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

export default function Home() {
  const [lang, setLang] = useState<Lang>("zh");
  const T = useMemo(() => t(lang), [lang]);

  const [groups, setGroups] = useState<ComparisonGroup[]>([]);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSymbols, setDraftSymbols] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [rangeYears, setRangeYears] = useState(DEFAULT_RANGE_YEARS);
  const [startValue, setStartValue] = useState(1000);

  const [results, setResults] = useState<Record<string, BacktestResult>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [simSettingsMap, setSimSettingsMap] = useState<Record<string, SimSettings>>({});
  /** Which tile is open. One at a time: an open tile spans the whole grid row,
   *  so two of them would leave no gallery to come back to. */
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  function setExpandedWithUrl(id: string | null) {
    setExpandedGroupId(id);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (id) {
        url.searchParams.set("group", id);
      } else {
        url.searchParams.delete("group");
      }
      window.history.replaceState(null, "", url.toString());
    }
  }
  const [editQuery, setEditQuery] = useState("");

  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const suggestions = useMemo(() => searchCatalog(query), [query]);
  const editSuggestions = useMemo(() => searchCatalog(editQuery), [editQuery]);

  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupStatus, setLookupStatus] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [groupLookupLoadingId, setGroupLookupLoadingId] = useState<string | null>(null);
  const [groupLookupStatus, setGroupLookupStatus] = useState<string | null>(null);
  const [groupLookupErrors, setGroupLookupErrors] = useState<Record<string, string | null>>({});

  const [refreshingGroupId, setRefreshingGroupId] = useState<string | null>(null);
  const [refreshSuccessGroupId, setRefreshSuccessGroupId] = useState<string | null>(null);

  async function addSymbol(sym: string) {
    const s = sym.trim().toUpperCase();
    if (!s || draftSymbols.includes(s)) return;
    if (draftSymbols.length >= MAX_SYMBOLS_PER_GROUP) {
      alert(T.maxSymbolsReached);
      return;
    }

    setLookupError(null);

    // If known in catalog, add immediately
    const known = findEntry(s);
    if (known) {
      const canonical = known.symbol.toUpperCase();
      if (!draftSymbols.includes(canonical)) {
        setDraftSymbols([...draftSymbols, canonical]);
      }
      setQuery("");
      return;
    }

    // Try multi-channel lookup online
    setLookupLoading(true);
    setLookupStatus(`${T.symbolLookupProgress} (${s})`);
    try {
      const res = await fetch("/api/symbol/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: s }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        registerDynamicSymbol({
          symbol: data.canonicalSymbol,
          name: data.name,
          nameEn: data.nameEn,
          category: data.category || "Stock",
        });
        const canonical = data.canonicalSymbol.toUpperCase();
        if (!draftSymbols.includes(canonical)) {
          setDraftSymbols([...draftSymbols, canonical]);
        }
        setQuery("");
      } else {
        setLookupError(data.error || T.symbolNotFoundTips);
      }
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : "網路連線失敗，請稍後重試");
    } finally {
      setLookupLoading(false);
      setLookupStatus(null);
    }
  }

  function removeDraftSymbol(sym: string) {
    setDraftSymbols(draftSymbols.filter((s) => s !== sym));
  }

  async function runBacktest(group: ComparisonGroup, options?: { forceRefresh?: boolean }) {
    if (group.symbols.length === 0) return;
    setLoadingId(group.id);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: group.symbols,
          rangeYears: group.rangeYears,
          startValue: group.startValue ?? 1000,
          forceRefresh: options?.forceRefresh ?? false,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        const errorMsg = data.error || `HTTP ${res.status}`;
        setResults((prev) => ({
          ...prev,
          [group.id]: {
            metrics: [],
            recommendations: [],
            chartSeries: [],
            mixedCurrencies: false,
            errors:
              Array.isArray(data.errors) && data.errors.length > 0
                ? data.errors
                : [{ symbol: "*", message: errorMsg }],
          },
        }));
        return;
      }
      setResults((prev) => ({ ...prev, [group.id]: data }));
      maybeAutoFitRange(group, data);
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [group.id]: {
          metrics: [],
          recommendations: [],
          chartSeries: [],
          mixedCurrencies: false,
          errors: [{ symbol: "*", message: err instanceof Error ? err.message : "network error" }],
        },
      }));
    } finally {
      setLoadingId(null);
    }
  }

  async function refreshGroupData(group: ComparisonGroup) {
    if (refreshingGroupId || loadingId) return;
    setRefreshingGroupId(group.id);
    try {
      await runBacktest(group, { forceRefresh: true });
      setRefreshSuccessGroupId(group.id);
      setTimeout(() => {
        setRefreshSuccessGroupId((prev) => (prev === group.id ? null : prev));
      }, 4000);
    } finally {
      setRefreshingGroupId(null);
    }
  }

  function scheduleRerun(group: ComparisonGroup) {
    if (debounceRef.current[group.id]) clearTimeout(debounceRef.current[group.id]);
    debounceRef.current[group.id] = setTimeout(() => runBacktest(group), DEBOUNCE_MS);
  }

  /**
   * A group's first backtest snaps its range to the shared backtestable
   * ceiling — the shortest symbol's history, e.g. 18.43y for a group held back
   * by Visa's 2008 listing — so a saved comparison spans all the history it can
   * instead of sitting at the 5-year default. Rounds UP (18.43 → 19) so no
   * available history is left on the table; the backend caps the request to
   * what actually exists. Runs once: `rangeFitted` is set here and by any
   * manual slider move, and gates re-entry.
   */
  /**
   * Snaps the group's range to the shared backtestable ceiling — the shortest
   * symbol's history (e.g. QQQI ~1.5y, SPMO ~8.8y, or 00940 ~1y) — so the backtest
   * never exceeds the shortest available history within the group.
   * If a group's current rangeYears exceeds this ceiling, it is automatically capped
   * down to match the shortest symbol's available years (minimum RANGE_MIN = 1).
   * For a brand-new group (!rangeFitted), it snaps directly to this ceiling.
   */
  function maybeAutoFitRange(group: ComparisonGroup, data: BacktestResult) {
    const ceilings = (data.metrics ?? [])
      .map((m) => m.maxBacktestYears)
      .filter((y): y is number => typeof y === "number" && y > 0);
    if (ceilings.length === 0) return; // every symbol errored — try again next run
    const maxAvailable = Math.min(RANGE_MAX, Math.max(RANGE_MIN, Math.ceil(Math.min(...ceilings))));

    if (!group.rangeFitted) {
      const fit = maxAvailable;
      const fitted = { ...group, rangeYears: fit, rangeFitted: true };
      if (fit === group.rangeYears) {
        updateGroup(fitted);
        return;
      }
      updateGroup(fitted, { rerun: true });
      return;
    }

    // Even if rangeFitted (user adjusted or previous fit), if current range exceeds the shortest symbol ceiling,
    // clamp it down automatically to the shortest symbol's max ceiling.
    if (group.rangeYears > maxAvailable) {
      const fitted = { ...group, rangeYears: maxAvailable };
      updateGroup(fitted, { rerun: true });
    }
  }

  function saveDraftAsGroup() {
    if (draftSymbols.length === 0) return;
    const group: ComparisonGroup = {
      id: newGroupId(),
      // An unnamed group is titled by its symbols, so those carry their fund
      // names too — "00679B.TWO / 00687B.TWO" names two funds that differ by
      // one digit and says nothing about either.
      title: draftTitle.trim() || draftSymbols.map((s) => displaySymbol(s, lang)).join(" / "),
      symbols: draftSymbols,
      createdAt: new Date().toISOString(),
      rangeYears,
      // Left the draft slider at its default → let the first backtest fit the
      // range to the data. Moved it → that's the choice, keep it.
      rangeFitted: rangeYears !== DEFAULT_RANGE_YEARS,
      startValue,
    };
    upsertGroup(group).then((updated) => {
      setGroups(updated);
      setDraftTitle("");
      setDraftSymbols([]);
      setStartValue(1000);
      setExpandedWithUrl(group.id);
      runBacktest(group);
    });
  }

  function handleDelete(id: string) {
    deleteGroup(id).then((updated) => {
      setGroups(updated);
      setResults((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (editingGroupId === id) setEditingGroupId(null);
      if (expandedGroupId === id) setExpandedWithUrl(null);
    });
  }

  function updateGroup(updated: ComparisonGroup, options?: { rerun?: boolean; debounce?: boolean }) {
    upsertGroup(updated).then((list) => {
      setGroups(list);
      if (options?.rerun) {
        if (options.debounce) scheduleRerun(updated);
        else runBacktest(updated);
      }
    });
  }

  async function addSymbolToGroup(group: ComparisonGroup, sym: string) {
    const s = sym.trim().toUpperCase();
    if (!s || group.symbols.includes(s)) return;
    if (group.symbols.length >= MAX_SYMBOLS_PER_GROUP) {
      alert(T.maxSymbolsReached);
      return;
    }

    setGroupLookupErrors((prev) => ({ ...prev, [group.id]: null }));

    const known = findEntry(s);
    if (known) {
      const canonical = known.symbol.toUpperCase();
      if (!group.symbols.includes(canonical)) {
        const updated = { ...group, symbols: [...group.symbols, canonical], rangeFitted: false };
        updateGroup(updated, { rerun: true });
      }
      setEditQuery("");
      return;
    }

    setGroupLookupLoadingId(group.id);
    setGroupLookupStatus(`${T.symbolLookupProgress} (${s})`);
    try {
      const res = await fetch("/api/symbol/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: s }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        registerDynamicSymbol({
          symbol: data.canonicalSymbol,
          name: data.name,
          nameEn: data.nameEn,
          category: data.category || "Stock",
        });
        const canonical = data.canonicalSymbol.toUpperCase();
        if (!group.symbols.includes(canonical)) {
          const updated = { ...group, symbols: [...group.symbols, canonical], rangeFitted: false };
          updateGroup(updated, { rerun: true });
        }
        setEditQuery("");
      } else {
        setGroupLookupErrors((prev) => ({
          ...prev,
          [group.id]: data.error || T.symbolNotFoundTips,
        }));
      }
    } catch (e) {
      setGroupLookupErrors((prev) => ({
        ...prev,
        [group.id]: e instanceof Error ? e.message : "網路連線失敗，請稍後重試",
      }));
    } finally {
      setGroupLookupLoadingId(null);
      setGroupLookupStatus(null);
    }
  }

  function removeSymbolFromGroup(group: ComparisonGroup, sym: string) {
    const nextSymbols = group.symbols.filter((s) => s !== sym);
    // Reset rangeFitted so maybeAutoFitRange will re-snap and calibrate
    // the slider and backtest range to the remaining shortest symbol ceiling.
    const updated = { ...group, symbols: nextSymbols, rangeFitted: false };
    updateGroup(updated, { rerun: nextSymbols.length > 0 });
    if (nextSymbols.length === 0) {
      setResults((prev) => {
        const next = { ...prev };
        delete next[group.id];
        return next;
      });
    }
  }

  function changeGroupRange(group: ComparisonGroup, years: number) {
    // A hand-picked range is a settled choice: opt this group out of auto-fit.
    const updated = { ...group, rangeYears: years, rangeFitted: true };
    updateGroup(updated, { rerun: true, debounce: true });
  }

  function changeGroupStartValue(group: ComparisonGroup, value: number) {
    const updated = { ...group, startValue: Math.max(1, value) };
    updateGroup(updated, { rerun: true, debounce: true });
  }

  // Load saved groups once on mount and kick off a backtest for each. Declared
  // after the functions it calls so those references aren't forward ones.
  useEffect(() => {
    loadGroups()
      .then((loaded) => {
        setGroups(loaded);
        if (typeof window !== "undefined") {
          const params = new URLSearchParams(window.location.search);
          const initialGroupId = params.get("group");
          if (initialGroupId && loaded.some((g) => g.id === initialGroupId)) {
            setExpandedGroupId(initialGroupId);
          }
        }
        loaded.forEach((g) => {
          if (g.symbols.length > 0) runBacktest(g);
        });
      })
      .catch(() => setGroups([]));

    function handlePopState() {
      const params = new URLSearchParams(window.location.search);
      setExpandedGroupId(params.get("group"));
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen" style={{ background: "var(--background)" }}>
      {/* Flat nav on the base canvas — no border, no shadow, and exactly one
          filled pill, per the single-CTA pattern the system uses. */}
      <header>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="font-display text-2xl leading-none">=</span>
            <span className="font-display text-lg">{T.title}</span>
            <span
              className="text-[11px] font-mono px-2 py-0.5 rounded-full font-medium"
              style={{
                background: "var(--orchid-band)",
                color: "var(--orchid-ink)",
                border: "1px solid rgba(142, 79, 174, 0.2)",
              }}
              title="Version 0.2.0"
            >
              v0.2.0
            </span>
          </div>
          <button
            onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            className="btn-primary px-4 py-1.5 text-sm shrink-0"
          >
            {T.langToggle}
          </button>
        </div>
      </header>

      {/* Hero sits on the same warm canvas as everything else — the section is
          set apart by whitespace and type size alone, not by a coloured band.
          The gradient blocks are peripheral ornament: they echo a bar chart at
          the margins and never sit behind text. */}
      <div className="relative">
        <PixelStack side="left" />
        <PixelStack side="right" />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-20 sm:pt-28 pb-16 sm:pb-24 text-center">
          <h1 className="hero-title">
            {T.heroClaim}
            <br />
            <span className="headline-sub">{T.heroSub}</span>
          </h1>
          <p className="mt-6 max-w-xl mx-auto" style={{ color: "var(--foreground-muted)" }}>
            {T.subtitle}
          </p>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-8">
        {/* New comparison builder */}
        <section className="card p-4 sm:p-6 flex flex-col gap-4">
          <span className="eyebrow">1. {T.eyebrowBuild}</span>
          <h2 className="font-display text-3xl sm:text-4xl">{T.newComparison}</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder={T.groupTitlePlaceholder}
              className="field px-3 py-2 sm:col-span-1"
            />
            <NumberField label={T.startValue} value={startValue} onCommit={setStartValue} min={1} step={100} />
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (lookupError) setLookupError(null);
                }}
                disabled={lookupLoading}
                placeholder={T.searchPlaceholder}
                className="field w-full px-3 py-2 disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && query.trim() && !lookupLoading) addSymbol(query);
                }}
              />
              {query && suggestions.length > 0 && !lookupLoading && (
                <ul
                  className="absolute z-10 mt-1 w-full card shadow-md max-h-64 overflow-auto"
                  style={{ background: "var(--surface)" }}
                >
                  {suggestions.map((s) => (
                    <li key={s.symbol}>
                      <button
                        onClick={() => addSymbol(s.symbol)}
                        className="w-full text-left px-3 py-2 hover:opacity-80 text-sm flex justify-between"
                      >
                        <span className="font-medium">{s.symbol}</span>
                        <span className="opacity-70">{lang === "zh" ? s.name : s.nameEn}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              onClick={() => query.trim() && addSymbol(query)}
              disabled={lookupLoading || !query.trim()}
              className="btn-ghost px-4 py-2 text-sm shrink-0 flex items-center gap-1.5 disabled:opacity-40"
            >
              {lookupLoading && (
                <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
              )}
              <span>{lookupLoading ? T.running : T.addSymbol}</span>
            </button>
          </div>

          {lookupLoading && (
            <div className="flex items-center gap-2 text-xs py-2 px-3 rounded-md animate-pulse" style={{ background: "var(--background)", border: "1px solid var(--line)", color: "var(--foreground)" }}>
              <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin shrink-0" />
              <span>{lookupStatus || T.symbolLookupProgress}</span>
            </div>
          )}

          {lookupError && (
            <div className="flex items-start justify-between gap-3 text-xs py-2.5 px-3.5 rounded-lg" style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid var(--negative)", color: "var(--negative)" }}>
              <div className="flex flex-col gap-1">
                <p className="font-semibold flex items-center gap-1">
                  <span>⚠️</span>
                  <span>{T.symbolNotFoundTitle}</span>
                </p>
                <p>{lookupError}</p>
                <p className="opacity-80 mt-0.5">{T.symbolNotFoundTips}</p>
              </div>
              <button
                onClick={() => setLookupError(null)}
                className="font-bold hover:opacity-100 opacity-60 text-sm p-0.5"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          {draftSymbols.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {draftSymbols.map((s) => (
                <span
                  key={s}
                  className="pill-badge px-3 py-1 text-sm"
                >
                  <SymbolLabel symbol={s} lang={lang} />
                  <button onClick={() => removeDraftSymbol(s)} className="opacity-60 hover:opacity-100">
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <RangeSlider
            label={T.rangeYears}
            value={rangeYears}
            onChange={setRangeYears}
            unit={rangeYears === 1 ? T.year : T.years}
          />

          <button
            onClick={saveDraftAsGroup}
            disabled={draftSymbols.length === 0}
            className="btn-primary px-4 py-2 text-sm self-start disabled:opacity-40"
          >
            {T.runBacktest}
          </button>
        </section>

        {/* Saved groups */}
        <section className="flex flex-col gap-4">
          <div>
            <span className="eyebrow">2. {T.eyebrowCompare}</span>
            <h2 className="font-display text-3xl sm:text-4xl mt-2">{T.savedGroups}</h2>
          </div>
          {groups.length === 0 && <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>{T.noGroups}</p>}

          <div className="gallery-grid">
          {groups.map((g) => {
            const result = results[g.id];
            const isLoading = loadingId === g.id;
            const isSelected = expandedGroupId === g.id;
            const topMetric = result?.metrics && result.metrics.length > 0
              ? [...result.metrics].sort((a, b) => b.annualizedReturn - a.annualizedReturn)[0]
              : null;
            return (
              <div
                key={g.id}
                className={`card gallery-tile p-4 sm:p-5 flex flex-col gap-3${isSelected ? " is-active" : ""}`}
              >
                <div
                  className="flex flex-col gap-3 cursor-pointer flex-1"
                  onClick={() => setExpandedWithUrl(isSelected ? null : g.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedWithUrl(isSelected ? null : g.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isSelected}
                  aria-label={`${g.title} - ${isSelected ? T.collapse : T.expand}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-display text-xl truncate">{g.title}</h3>
                        {isSelected && (
                          <span
                            className="px-2 py-0.5 text-[11px] font-medium rounded-full shrink-0"
                            style={{ background: "var(--orchid-band)", color: "var(--orchid-ink)" }}
                          >
                            {lang === "zh" ? "檢視中" : "Inspecting"}
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5 truncate" style={{ color: "var(--foreground-muted)" }}>
                        {g.symbols.map((s) => displaySymbol(s, lang)).join(", ") || "—"}
                      </p>
                    </div>
                    <span
                      aria-hidden
                      className="text-xs shrink-0 mt-1 px-2 py-1 rounded"
                      style={{
                        background: isSelected ? "var(--orchid-band)" : "transparent",
                        color: isSelected ? "var(--orchid-ink)" : "var(--foreground-muted)",
                      }}
                    >
                      {isSelected ? T.collapse : T.expand}
                    </span>
                  </div>

                  {result?.chartSeries && result.chartSeries.length > 0 ? (
                    <Sparkline series={result.chartSeries} mixedCurrencies={result.mixedCurrencies} />
                  ) : (
                    <div
                      className="tile-placeholder"
                      aria-hidden
                      style={{ height: 64 }}
                    />
                  )}
                  {topMetric ? (
                    <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                      {T.leads}
                      <span className="font-semibold" style={{ color: "var(--foreground)" }}>
                        {displaySymbol(topMetric.symbol, lang)}
                      </span>
                      {" · "}
                      <span
                        className="tabular-nums"
                        style={{ color: topMetric.annualizedReturn >= 0 ? "var(--positive)" : "var(--negative)" }}
                      >
                        {topMetric.annualizedReturn}%
                      </span>
                      {" "}
                      {T.annualizedShort}
                    </p>
                  ) : (
                    <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                      {T.notRunYet}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 mt-auto pt-2 border-t" style={{ borderColor: "var(--line)" }}>
                  <button
                    onClick={() => {
                      setExpandedWithUrl(g.id);
                      runBacktest(g);
                    }}
                    className="btn-primary px-3 py-1.5 text-sm disabled:opacity-40"
                    disabled={isLoading || g.symbols.length === 0}
                  >
                    {isLoading ? T.running : T.runBacktest}
                  </button>
                  <button
                    onClick={() => handleDelete(g.id)}
                    className="btn-ghost px-3 py-1.5 text-sm"
                  >
                    {T.delete}
                  </button>
                </div>
              </div>
            );
          })}
          </div>
        </section>

        {/* Section 3: In-Depth Comparison Analysis (Workbench) */}
        {expandedGroupId && (() => {
          const g = groups.find((item) => item.id === expandedGroupId);
          if (!g) return null;
          const result = results[g.id];
          const isLoading = loadingId === g.id;
          const isEditing = editingGroupId === g.id;

          const ceilings = (result?.metrics ?? [])
            .map((m) => m.maxBacktestYears)
            .filter((y): y is number => typeof y === "number" && y > 0);
          const maxGroupYears = ceilings.length > 0
            ? Math.min(RANGE_MAX, Math.max(RANGE_MIN, Math.ceil(Math.min(...ceilings))))
            : RANGE_MAX;

          return (
            <section className="flex flex-col gap-4 mt-2">
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                  <span className="eyebrow">3. {T.eyebrowInspect}</span>
                  <h2 className="font-display text-3xl sm:text-4xl mt-2">{T.detailedAnalysis}</h2>
                </div>
                <button
                  onClick={() => setExpandedWithUrl(null)}
                  className="btn-ghost px-4 py-2 text-sm flex items-center gap-1.5 self-start sm:self-auto"
                >
                  <span>✕</span>
                  <span>{T.closeInspection}</span>
                </button>
              </div>

              <div className="workbench-panel p-5 sm:p-7 flex flex-col gap-6">
                {/* Header info & action bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b" style={{ borderColor: "var(--line)" }}>
                  <div className="min-w-0">
                    <h3 className="font-display text-2xl sm:text-3xl">{g.title}</h3>
                    <p className="text-sm mt-1" style={{ color: "var(--foreground-muted)" }}>
                      {g.symbols.map((s) => displaySymbol(s, lang)).join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                      onClick={() => refreshGroupData(g)}
                      disabled={isLoading || refreshingGroupId === g.id || g.symbols.length === 0}
                      className="btn-ghost px-3.5 py-1.5 text-sm flex items-center gap-1.5 disabled:opacity-40"
                      title={T.refreshLatestData}
                    >
                      <span className={refreshingGroupId === g.id ? "animate-spin inline-block" : ""}>🔄</span>
                      <span>{refreshingGroupId === g.id ? T.refreshing : T.refreshLatestData}</span>
                    </button>
                    <button
                      onClick={() => setEditingGroupId(isEditing ? null : g.id)}
                      className="btn-ghost px-3.5 py-1.5 text-sm"
                    >
                      {isEditing ? T.doneEditing : T.editSymbols}
                    </button>
                    <button
                      onClick={() => runBacktest(g)}
                      className="btn-primary px-4 py-1.5 text-sm disabled:opacity-40"
                      disabled={isLoading || g.symbols.length === 0}
                    >
                      {isLoading ? T.running : T.runBacktest}
                    </button>
                  </div>
                </div>

                {refreshSuccessGroupId === g.id && (
                  <div className="text-xs px-3.5 py-2 rounded-lg self-start flex items-center gap-2" style={{ background: "rgba(34, 197, 94, 0.1)", color: "#16a34a", border: "1px solid rgba(34, 197, 94, 0.25)" }}>
                    <span>✓</span>
                    <span>{T.refreshSuccess}</span>
                  </div>
                )}

                {/* Edit symbols bar */}
                {isEditing && (
                  <div className="flex flex-col gap-3 rounded-lg p-4" style={{ background: "var(--background)", border: "1px solid var(--line)" }}>
                    <div className="flex flex-wrap gap-2">
                      {g.symbols.map((s) => (
                        <span
                          key={s}
                          className="pill-badge px-3 py-1 text-sm"
                        >
                          <SymbolLabel symbol={s} lang={lang} />
                          <button
                            onClick={() => removeSymbolFromGroup(g, s)}
                            className="opacity-60 hover:opacity-100"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {g.symbols.length === 0 && <span className="text-xs opacity-50">—</span>}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <input
                          value={editQuery}
                          onChange={(e) => {
                            setEditQuery(e.target.value);
                            if (groupLookupErrors[g.id]) {
                              setGroupLookupErrors((prev) => ({ ...prev, [g.id]: null }));
                            }
                          }}
                          disabled={groupLookupLoadingId === g.id}
                          placeholder={T.addSymbolToGroup}
                          className="field w-full px-3 py-2 text-sm disabled:opacity-50"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && editQuery.trim() && groupLookupLoadingId !== g.id) {
                              addSymbolToGroup(g, editQuery);
                            }
                          }}
                        />
                        {editQuery && editSuggestions.length > 0 && groupLookupLoadingId !== g.id && (
                          <ul
                            className="absolute z-10 mt-1 w-full card shadow-md max-h-64 overflow-auto"
                            style={{ background: "var(--surface)" }}
                          >
                            {editSuggestions.map((s) => (
                              <li key={s.symbol}>
                                <button
                                  onClick={() => addSymbolToGroup(g, s.symbol)}
                                  className="w-full text-left px-3 py-2 hover:opacity-80 text-sm flex justify-between"
                                >
                                  <span className="font-medium">{s.symbol}</span>
                                  <span className="opacity-70">{lang === "zh" ? s.name : s.nameEn}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <button
                        onClick={() => editQuery.trim() && addSymbolToGroup(g, editQuery)}
                        disabled={groupLookupLoadingId === g.id || !editQuery.trim()}
                        className="btn-ghost px-4 py-2 text-sm shrink-0 flex items-center gap-1.5 disabled:opacity-40"
                      >
                        {groupLookupLoadingId === g.id && (
                          <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                        )}
                        <span>{groupLookupLoadingId === g.id ? T.running : T.addSymbol}</span>
                      </button>
                    </div>

                    {groupLookupLoadingId === g.id && (
                      <div className="flex items-center gap-2 text-xs py-2 px-3 rounded-md animate-pulse" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
                        <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin shrink-0" />
                        <span>{groupLookupStatus || T.symbolLookupProgress}</span>
                      </div>
                    )}

                    {groupLookupErrors[g.id] && (
                      <div className="flex items-start justify-between gap-3 text-xs py-2.5 px-3.5 rounded-lg" style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid var(--negative)", color: "var(--negative)" }}>
                        <div className="flex flex-col gap-1">
                          <p className="font-semibold flex items-center gap-1">
                            <span>⚠️</span>
                            <span>{T.symbolNotFoundTitle}</span>
                          </p>
                          <p>{groupLookupErrors[g.id]}</p>
                          <p className="opacity-80 mt-0.5">{T.symbolNotFoundTips}</p>
                        </div>
                        <button
                          onClick={() => setGroupLookupErrors((prev) => ({ ...prev, [g.id]: null }))}
                          className="font-bold hover:opacity-100 opacity-60 text-sm p-0.5"
                          title="Dismiss"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Range and initial capital controllers */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end p-4 rounded-lg" style={{ background: "var(--background)", border: "1px solid var(--line)" }}>
                  <RangeSlider
                    label={T.rangeYears}
                    value={g.rangeYears}
                    onChange={(years) => changeGroupRange(g, years)}
                    unit={g.rangeYears === 1 ? T.year : T.years}
                    max={maxGroupYears}
                  />
                  <NumberField
                    label={T.startValue}
                    value={g.startValue ?? 1000}
                    onCommit={(v) => changeGroupStartValue(g, v)}
                    min={1}
                    step={100}
                    className="field w-full px-3 py-2 text-sm"
                  />
                </div>

                {isLoading && (
                  <div className="flex items-center gap-2.5 text-xs py-2.5 px-4 rounded-lg animate-pulse" style={{ background: "var(--background)", border: "1px solid var(--line)", color: "var(--foreground-muted)" }}>
                    <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin shrink-0" />
                    <span>{refreshingGroupId === g.id ? T.refreshing : T.running}（{T.symbolLookupTrying}）</span>
                  </div>
                )}

                {/* Analysis results */}
                {result && (
                  <div className="flex flex-col gap-6">
                    {(result.errors ?? []).length > 0 && (
                      <div className="rounded-lg p-3.5 text-xs flex flex-col gap-1.5" style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid var(--negative)", color: "var(--negative)" }}>
                        <p className="font-semibold flex items-center gap-1.5">
                          <span>⚠️</span>
                          <span>{T.errorFetch}: {(result.errors ?? []).map((e) => displaySymbol(e.symbol, lang)).join("、")}</span>
                        </p>
                        {(result.errors ?? []).map((e, idx) => (
                          <p key={idx} className="opacity-90 font-mono text-[11px]">{e.symbol}: {e.message}</p>
                        ))}
                        <p className="opacity-80 mt-0.5">{T.symbolNotFoundTips}</p>
                      </div>
                    )}

                    {result.alignedWindow && (
                      <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                        {result.constrainedBy ? (
                          <>
                            {T.alignedNoticeBefore}
                            <strong>{displaySymbol(result.constrainedBy, lang)}</strong>
                            {T.alignedNoticeAfter}
                          </>
                        ) : (
                          T.alignedFullBefore
                        )}
                        {result.alignedWindow.years} {T.years}（{result.alignedWindow.start} ~{" "}
                        {result.alignedWindow.end}）
                      </p>
                    )}

                    {result.chartSeries && result.chartSeries.length > 0 && (
                      <div>
                        <span className="eyebrow">{T.performanceChart}</span>
                        <PerformanceChart
                          series={result.chartSeries}
                          mixedCurrencies={result.mixedCurrencies}
                          lang={lang}
                          simSettings={simSettingsMap[g.id] ?? { enabled: false, withdrawalRate: 3, inflationRate: 3 }}
                          onSimSettingsChange={(settings) =>
                            setSimSettingsMap((prev) => ({ ...prev, [g.id]: settings }))
                          }
                        />
                      </div>
                    )}

                    {(result.metrics ?? []).length > 0 && (
                      <div className="flex flex-col gap-3">
                        <div className="overflow-x-auto">
                          <MetricsTable
                            metrics={result.metrics}
                            T={T}
                            lang={lang}
                            chartSeries={result.chartSeries}
                            startValue={g.startValue ?? 1000}
                            simSettings={simSettingsMap[g.id] ?? { enabled: false, withdrawalRate: 3, inflationRate: 3 }}
                          />
                        </div>
                        <Note title={T.sourceNote} body={T.sourceNoteText} />
                        <Note title={T.trendNote} body={T.trendNoteText} />
                        <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                          {T.resolutionNote}
                        </p>
                        <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                          {T.splitNote}
                        </p>
                        <Note title={T.incomeNote} body={T.incomeNoteText} />
                        <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                          {T.twoSuffixNote}
                        </p>
                      </div>
                    )}

                    {(result.recommendations ?? []).length > 0 && (
                      <div>
                        <div
                          className="rounded-lg px-3 py-2 mb-3 text-xs"
                          style={{ background: "var(--background)", border: "1px solid var(--line)", color: "var(--foreground-muted)" }}
                        >
                          <p className="font-medium mb-1" style={{ color: "var(--foreground)" }}>{T.scoreFormula}</p>
                          <p className="font-mono">{T.scoreFormulaText}</p>
                          <p className="mt-1">{T.scoreFormulaNote}</p>
                        </div>
                        <span className="eyebrow">{T.aiRecommendation}</span>
                        <div className="mt-2">
                          {result.recommendations.map((r) => (
                            <div
                              key={r.symbol}
                              className="hairline-row flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 py-3"
                            >
                              <div className="flex items-center gap-2 sm:w-56 shrink-0">
                                <span
                                  className="inline-flex items-center justify-center rounded-full text-xs font-semibold shrink-0"
                                  style={{
                                    background: "var(--orchid-ink)",
                                    color: "#fff",
                                    width: "1.5rem",
                                    height: "1.5rem",
                                  }}
                                >
                                  {r.rank}
                                </span>
                                <span className="font-semibold">
                                  <SymbolLabel symbol={r.symbol} lang={lang} />
                                </span>
                              </div>
                              <span className="text-xs opacity-60 sm:w-24 shrink-0">
                                {T.score}: {r.score}
                              </span>
                              <span className="text-xs opacity-80">
                                {(lang === "zh" ? r.reasons : r.reasonsEn).join("；")}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          );
        })()}
      </main>

      {/* Closing band and footer share one full-bleed orchid background with no
          hard break between them. */}
      <footer className="band-orchid mt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <p className="font-display text-3xl sm:text-4xl max-w-2xl">
            {T.heroClaim}
            <br />
            <span className="headline-sub">{T.heroSub}</span>
          </p>
          <p
            className="mt-8 max-w-2xl text-sm leading-relaxed"
            style={{ color: "var(--foreground-muted)" }}
          >
            {T.footerDisclaimer}
          </p>
          <p className="mt-8 text-sm flex items-center gap-2">
            <span aria-hidden className="font-display text-lg leading-none">=</span>
            <span className="font-display">{T.title}</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

/**
 * Peripheral ornament for the hero margins: gradient bars stacked like a bar
 * chart, alternating lavender and aqua with irregular widths so the column
 * reads as data rather than as a pattern. Decorative only — hidden from
 * assistive tech, and hidden outright below 1024px where there is no margin.
 */
function PixelStack({ side }: { side: "left" | "right" }) {
  const widths = side === "left" ? [64, 40, 78, 30, 56] : [38, 70, 46, 80, 34];
  return (
    <div aria-hidden className="pixel-stack" style={{ [side]: "1.5rem" }}>
      {widths.map((w, i) => (
        <span
          key={i}
          className={`pixel-block ${i % 2 === 0 ? "pixel-block--lavender" : "pixel-block--aqua"}`}
          style={{ width: w, alignSelf: side === "left" ? "flex-end" : "flex-start" }}
        />
      ))}
    </div>
  );
}

/**
 * Number input that lets you freely clear/retype while editing, instead of a
 * plain controlled `<input type="number">` whose value snaps back to a
 * clamped default (e.g. min) on every keystroke — including the empty string
 * mid-edit — fighting whatever you're trying to type. Local text state holds
 * the in-progress characters verbatim; parsing/clamping/commit only happens
 * on blur (or Enter).
 */
function NumberField({
  label,
  value,
  onCommit,
  min,
  step = 1,
  className = "field w-full px-3 py-2",
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min: number;
  step?: number;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  function commit() {
    const n = Number(text);
    if (text.trim() === "" || Number.isNaN(n)) {
      setText(String(value));
      return;
    }
    const clamped = Math.max(min, n);
    setText(String(clamped));
    onCommit(clamped);
  }

  return (
    <div>
      <label className="text-xs opacity-70 block mb-1">{label}</label>
      <input
        type="number"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        min={min}
        step={step}
        className={className}
        style={{ borderColor: "var(--line)" }}
      />
    </div>
  );
}

function RangeSlider({
  label,
  value,
  onChange,
  unit,
  min = RANGE_MIN,
  max = RANGE_MAX,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit: string;
  min?: number;
  max?: number;
}) {
  const safeMax = Math.max(min, max);
  const clampedValue = Math.min(safeMax, Math.max(min, value));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <label className="opacity-70">{label}</label>
        <span className="font-medium">
          {clampedValue} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={safeMax}
        step={1}
        value={clampedValue}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-current"
        style={{ accentColor: "var(--orchid-ink)" }}
      />
    </div>
  );
}
