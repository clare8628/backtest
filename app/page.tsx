"use client";

import { Fragment, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { t, Lang } from "@/lib/i18n";
import { displaySymbol, findEntry, registerDynamicSymbol, searchCatalog, symbolLabel } from "@/lib/symbolCatalog";
import { getLeverageSpec, isSimulatedSymbol, SIM_SUFFIX, stripSimSuffix } from "@/lib/leverageSim";
import { ComparisonGroup, BacktestMetrics, Recommendation, ChartSeries, Currency } from "@/lib/types";
import { loadGroups, upsertGroup, reorderGroups, deleteGroup, newGroupId } from "@/lib/storage";
import PerformanceChart, { SimSettings } from "@/components/PerformanceChart";
import Sparkline from "@/components/Sparkline";
import { simulateWithdrawnSeries } from "@/lib/backtest";
import { APP_VERSION, BUILD_TIME_ISO, DISPLAY_VERSION, formatBuildStamp, formatBuildTime } from "@/lib/version";

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

/** The alert shown when an add-symbol input resolves to a symbol already in
 *  the group — e.g. typing "TQQQ@sim" when "TQQQ" is already there, since
 *  the "@sim" suffix is only ever a display label, never a distinct entry. */
function duplicateSymbolMessage(T: Record<string, string>, resolvedKey: string): string {
  return T.symbolAlreadyInGroup.replace("{symbol}", resolvedKey);
}

/** Blue above `neutral`, red below — used for the signed trend measures, where
 *  the sign (not the magnitude) is what says "uptrend" vs "downtrend". */
function trendColor(value: number | null | undefined, neutral = 0): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value > neutral) return "var(--positive)";
  if (value < neutral) return "var(--negative)";
  return undefined;
}

export function reorderArray<T>(list: T[], sourceIndex: number, targetIndex: number, placeAfter: boolean): T[] {
  if (sourceIndex === targetIndex) return list;
  const item = list[sourceIndex];
  const without = list.filter((_, i) => i !== sourceIndex);
  const targetItem = list[targetIndex];
  const newTargetIndex = without.indexOf(targetItem);
  const insertIndex = placeAfter ? newTargetIndex + 1 : newTargetIndex;
  const result = [...without];
  result.splice(insertIndex, 0, item);
  return result;
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
function SymbolLabel({ symbol, lang, simulated }: { symbol: string; lang: Lang; simulated?: boolean }) {
  const { code, name } = symbolLabel(symbol, lang, simulated);
  if (!name) return <>{code}</>;
  return (
    <span className="inline-flex flex-col items-center leading-tight">
      <span className="text-xs font-semibold">{code}</span>
      <span className="text-xs font-normal opacity-75 whitespace-nowrap">{name}</span>
    </span>
  );
}

const DASH = "—";
const pct = (v: number | null | undefined) => (v === undefined || v === null ? DASH : `${v}%`);
const num = (v: number | null | undefined) => (v === undefined || v === null ? DASH : String(v));

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

/** A dash alone doesn't say whether "no fund size" means "not a fund" (a
 *  stock — expected, no explanation needed) or "this fund has no figure for
 *  a specific, known reason" (delisted, no data from the source) — so when
 *  the catalog knows the reason, it renders right next to the dash. */
function fundSizeReasonLabel(
  reason: "delisting" | "noData" | undefined,
  T: Dict
): string | null {
  if (reason === "delisting") return T.fundSizeReasonDelisting;
  if (reason === "noData") return T.fundSizeReasonNoData;
  return null;
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
                  <span className="text-xs opacity-75 font-normal">
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
              <span className="inline-flex items-baseline justify-end gap-1 flex-wrap">
                <span>{m.beta}</span>
                {m.benchmarkSymbol && (
                  <span className="text-xs opacity-65 font-normal">
                    ({T.betaVs} {displaySymbol(m.benchmarkSymbol, lang)})
                  </span>
                )}
              </span>
            ),
        },
      ],
    },
    {
      title: T.groupSource,
      rows: [
        {
          label: T.volatilityDrag,
          value: (m) => (m.volatilityDrag === undefined ? DASH : `-${m.volatilityDrag}%`),
          color: () => "var(--negative)",
        },
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
        {
          label: T.fundSize,
          value: (m) => {
            const formatted = formatFundSize(m.fundSize, m.fundSizeCurrency);
            const reason = fundSizeReasonLabel(m.fundSizeUnavailableReason, T);
            if (!reason) return formatted;
            return (
              <span className="inline-flex flex-col items-end leading-tight">
                <span>{formatted}</span>
                <span className="text-[11px] opacity-70 font-normal">({reason})</span>
              </span>
            );
          },
        },
        {
          label: T.estimatedYield,
          value: (m) => pct(m.estimatedYieldPct),
          color: (m) => (m.estimatedYieldPct ? "var(--positive)" : undefined),
        },
        { label: T.distributionFreq, value: (m) => distributionLabel(m.distributionsPerYear, T) },
        { label: T.latestExDate, value: (m) => m.latestExDate ?? DASH },
        {
          label: T.latestDistribution,
          value: (m) => (m.latestDistribution == null ? DASH : String(m.latestDistribution)),
        },
        {
          label: T.latestAnnualizedYield,
          value: (m) => pct(m.latestAnnualizedYieldPct),
          color: (m) => (m.latestAnnualizedYieldPct ? "var(--positive)" : undefined),
        },
        {
          label: T.avgAnnualizedYield,
          value: (m) => pct(m.avgAnnualizedYieldPct),
          color: (m) => (m.avgAnnualizedYieldPct ? "var(--positive)" : undefined),
        },
      ],
    },
    {
      title: T.groupInfo,
      rows: [
        {
          label: T.fee,
          value: (m) => (m.managementFeeKnown === false ? DASH : pct(m.managementFee)),
        },
      ],
    },
  ];
}

function MetricsTable({
  metrics,
  T,
  lang,
  chartSeries,
  startValue = 100,
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
          <th className="py-2 pr-4 text-left font-normal text-xs whitespace-nowrap">{T.metric}</th>
          {sortedMetrics.map((m) => (
            <th key={m.symbol} className="py-2 px-2 text-right font-medium" style={{ color: "var(--foreground)" }}>
              <SymbolLabel symbol={m.symbol} lang={lang} simulated={m.simulated} />
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
                className="table-group pt-4 pb-1.5"
              >
                {section.title}
              </td>
            </tr>
            {section.rows.map((row) => (
              <tr key={row.label} className="metrics-row border-t cursor-default" style={{ borderColor: "var(--line)" }}>
                <th
                  scope="row"
                  className="py-2 pl-2 pr-4 text-left text-xs font-normal rounded-l whitespace-nowrap"
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

  // Ensure version badge and hover title match the client's local timezone (default Asia/Taipei)
  const [displayVersion, setDisplayVersion] = useState(DISPLAY_VERSION);
  const [buildTimeTitle, setBuildTimeTitle] = useState(() => formatBuildTime(BUILD_TIME_ISO));

  useEffect(() => {
    if (BUILD_TIME_ISO) {
      try {
        const clientTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const stamp = formatBuildStamp(BUILD_TIME_ISO, clientTimeZone);
        if (stamp) {
          setDisplayVersion(`${APP_VERSION}+${stamp}`);
        }
        const timeStr = formatBuildTime(BUILD_TIME_ISO, clientTimeZone);
        if (timeStr) {
          setBuildTimeTitle(timeStr);
        }
      } catch {
        // Fallback already covered by default Asia/Taipei timezone
      }
    }
  }, []);

  const [groups, setGroups] = useState<ComparisonGroup[]>([]);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSymbols, setDraftSymbols] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const curYear = new Date().getFullYear();
  const [draftStartYear, setDraftStartYear] = useState(curYear - DEFAULT_RANGE_YEARS);
  const [draftEndYear, setDraftEndYear] = useState(curYear);
  const [rangeYears, setRangeYears] = useState(DEFAULT_RANGE_YEARS);
  const [startValue, setStartValue] = useState(100);

  const [results, setResults] = useState<Record<string, BacktestResult>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [simSettingsMap, setSimSettingsMap] = useState<Record<string, SimSettings>>({});
  /** Which tile is open. One at a time: an open tile spans the whole grid row,
   *  so two of them would leave no gallery to come back to. */
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: "before" | "after" } | null>(null);
  const draggedRef = useRef(false);
  const draggedGroupIdRef = useRef<string | null>(null);

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
    const isSim = isSimulatedSymbol(sym);
    const s = stripSimSuffix(sym).trim().toUpperCase();
    if (!s) return;

    if (isSim && !getLeverageSpec(s)) {
      alert(T.symbolSimNotSupported.replace("{symbol}", s));
      return;
    }

    const key = isSim ? `${s}${SIM_SUFFIX}` : s;
    if (draftSymbols.includes(key)) {
      alert(duplicateSymbolMessage(T, key));
      return;
    }
    if (draftSymbols.length >= MAX_SYMBOLS_PER_GROUP) {
      alert(T.maxSymbolsReached);
      return;
    }

    setLookupError(null);

    // If known in catalog, add immediately
    const known = findEntry(s);
    if (known) {
      const canonicalBase = known.symbol.toUpperCase();
      if (isSim && !getLeverageSpec(canonicalBase)) {
        alert(T.symbolSimNotSupported.replace("{symbol}", canonicalBase));
        return;
      }
      const canonicalKey = isSim ? `${canonicalBase}${SIM_SUFFIX}` : canonicalBase;
      if (!draftSymbols.includes(canonicalKey)) {
        setDraftSymbols([...draftSymbols, canonicalKey]);
      } else {
        alert(duplicateSymbolMessage(T, canonicalKey));
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
        const canonicalBase = data.canonicalSymbol.toUpperCase();
        if (isSim && !getLeverageSpec(canonicalBase)) {
          alert(T.symbolSimNotSupported.replace("{symbol}", canonicalBase));
          return;
        }
        const canonicalKey = isSim ? `${canonicalBase}${SIM_SUFFIX}` : canonicalBase;
        if (!draftSymbols.includes(canonicalKey)) {
          setDraftSymbols([...draftSymbols, canonicalKey]);
        } else {
          alert(duplicateSymbolMessage(T, canonicalKey));
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
    const thisYear = new Date().getFullYear();
    const reqBody: Record<string, unknown> = {
      symbols: group.symbols,
      rangeYears: group.rangeYears,
      startValue: group.startValue ?? 100,
      forceRefresh: options?.forceRefresh ?? false,
    };
    if (typeof group.startYear === "number") {
      reqBody.startYear = group.startYear;
      reqBody.startDate = `${group.startYear}-01-01`;
    }
    if (typeof group.endYear === "number" && group.endYear < thisYear) {
      reqBody.endYear = group.endYear;
      reqBody.endDate = `${group.endYear}-12-31`;
    }
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
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
    const simVariantBases = new Set(
      (data.metrics ?? [])
        .filter((m) => isSimulatedSymbol(m.symbol))
        .map((m) => stripSimSuffix(m.symbol).toUpperCase())
    );
    const unsimulatedCounterparts = new Set(
      (data.metrics ?? [])
        .filter((m) => !isSimulatedSymbol(m.symbol) && simVariantBases.has(m.symbol.toUpperCase()))
        .map((m) => m.symbol)
    );
    const candidateMetrics = (data.metrics ?? []).filter(
      (m) => !unsimulatedCounterparts.has(m.symbol)
    );
    const pool = candidateMetrics.length > 0 ? candidateMetrics : data.metrics ?? [];
    const ceilings = pool
      .map((m) => m.maxBacktestYears)
      .filter((y): y is number => typeof y === "number" && y > 0);
    if (ceilings.length === 0) return; // every symbol errored — try again next run
    const maxAvailable = Math.min(RANGE_MAX, Math.max(RANGE_MIN, Math.ceil(Math.min(...ceilings))));
    const thisYear = new Date().getFullYear();

    if (!group.rangeFitted) {
      const fit = maxAvailable;
      const fitStart = thisYear - fit;
      const fitEnd = thisYear;
      const fitted = {
        ...group,
        rangeYears: fit,
        startYear: fitStart,
        endYear: fitEnd,
        rangeFitted: true,
      };
      if (
        fit === group.rangeYears &&
        group.startYear === fitStart &&
        group.endYear === fitEnd
      ) {
        updateGroup(fitted);
        return;
      }
      updateGroup(fitted, { rerun: true });
      return;
    }

    // Even if rangeFitted (user adjusted or previous fit), if current range exceeds the shortest symbol ceiling,
    // clamp it down automatically to the shortest symbol's max ceiling.
    if (group.rangeYears > maxAvailable) {
      const fitStart = Math.max(group.startYear ?? (thisYear - group.rangeYears), thisYear - maxAvailable);
      const fitted = {
        ...group,
        rangeYears: maxAvailable,
        startYear: fitStart,
        endYear: group.endYear ?? thisYear,
      };
      updateGroup(fitted, { rerun: true });
    }
  }

  function saveDraftAsGroup() {
    if (draftSymbols.length === 0) return;
    const thisYear = new Date().getFullYear();
    const sy = typeof draftStartYear === "number" ? draftStartYear : (thisYear - rangeYears);
    const ey = typeof draftEndYear === "number" ? draftEndYear : thisYear;
    const span = Math.max(1, ey - sy);
    const group: ComparisonGroup = {
      id: newGroupId(),
      // An unnamed group is titled by its symbols, so those carry their fund
      // names too — "00679B.TWO / 00687B.TWO" names two funds that differ by
      // one digit and says nothing about either.
      title: draftTitle.trim() || draftSymbols.map((s) => displaySymbol(s, lang)).join(" / "),
      symbols: draftSymbols,
      createdAt: new Date().toISOString(),
      rangeYears: span,
      startYear: sy,
      endYear: ey,
      // Left the draft slider at its default → let the first backtest fit the
      // range to the data. Moved it → that's the choice, keep it.
      rangeFitted: span !== DEFAULT_RANGE_YEARS || ey !== thisYear,
      startValue,
    };
    upsertGroup(group).then((updated) => {
      setGroups(updated);
      setDraftTitle("");
      setDraftSymbols([]);
      setDraftStartYear(thisYear - DEFAULT_RANGE_YEARS);
      setDraftEndYear(thisYear);
      setRangeYears(DEFAULT_RANGE_YEARS);
      setStartValue(100);
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

  /** Saves an edited title; a blank one falls back to the symbol list, like an unnamed new group. */
  function commitGroupTitle(group: ComparisonGroup, value: string) {
    const title = value.trim() || group.symbols.map((s) => displaySymbol(s, lang)).join(" / ");
    if (title === group.title) return;
    updateGroup({ ...group, title });
  }

  async function addSymbolToGroup(group: ComparisonGroup, sym: string) {
    const isSim = isSimulatedSymbol(sym);
    const s = stripSimSuffix(sym).trim().toUpperCase();
    if (!s) return;

    if (isSim && !getLeverageSpec(s)) {
      alert(T.symbolSimNotSupported.replace("{symbol}", s));
      return;
    }

    const key = isSim ? `${s}${SIM_SUFFIX}` : s;
    if (group.symbols.includes(key)) {
      alert(duplicateSymbolMessage(T, key));
      return;
    }
    if (group.symbols.length >= MAX_SYMBOLS_PER_GROUP) {
      alert(T.maxSymbolsReached);
      return;
    }

    setGroupLookupErrors((prev) => ({ ...prev, [group.id]: null }));

    const known = findEntry(s);
    if (known) {
      const canonicalBase = known.symbol.toUpperCase();
      if (isSim && !getLeverageSpec(canonicalBase)) {
        alert(T.symbolSimNotSupported.replace("{symbol}", canonicalBase));
        return;
      }
      const canonicalKey = isSim ? `${canonicalBase}${SIM_SUFFIX}` : canonicalBase;
      if (!group.symbols.includes(canonicalKey)) {
        const updated = { ...group, symbols: [...group.symbols, canonicalKey], rangeFitted: false };
        updateGroup(updated, { rerun: true });
      } else {
        alert(duplicateSymbolMessage(T, canonicalKey));
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
        const canonicalBase = data.canonicalSymbol.toUpperCase();
        if (isSim && !getLeverageSpec(canonicalBase)) {
          alert(T.symbolSimNotSupported.replace("{symbol}", canonicalBase));
          return;
        }
        const canonicalKey = isSim ? `${canonicalBase}${SIM_SUFFIX}` : canonicalBase;
        if (!group.symbols.includes(canonicalKey)) {
          const updated = { ...group, symbols: [...group.symbols, canonicalKey], rangeFitted: false };
          updateGroup(updated, { rerun: true });
        } else {
          alert(duplicateSymbolMessage(T, canonicalKey));
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

  function changeGroupRange(group: ComparisonGroup, startYear: number, endYear: number) {
    // A hand-picked range is a settled choice: opt this group out of auto-fit.
    const years = Math.max(1, endYear - startYear);
    const updated: ComparisonGroup = {
      ...group,
      startYear,
      endYear,
      rangeYears: years,
      rangeFitted: true,
    };
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
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="font-display text-2xl leading-none">=</span>
            <span className="font-display text-lg">{T.title}</span>
            <span
              suppressHydrationWarning
              className="text-[11px] font-mono px-2 py-0.5 rounded-full font-medium"
              style={{
                background: "var(--orchid-band)",
                color: "var(--orchid-ink)",
                border: "1px solid rgba(142, 79, 174, 0.2)",
              }}
              title={`Version ${APP_VERSION}${buildTimeTitle ? ` · built ${buildTimeTitle}` : ""}`}
            >
              v{displayVersion}
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
        <div className="relative max-w-[1600px] mx-auto px-4 sm:px-6 pt-20 sm:pt-28 pb-16 sm:pb-24 text-center">
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

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 flex flex-col gap-8">
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

          <DualRangeSlider
            label={T.rangeYears}
            min={curYear - RANGE_MAX}
            max={curYear}
            startValue={draftStartYear}
            endValue={draftEndYear}
            onChange={(start, end) => {
              setDraftStartYear(start);
              setDraftEndYear(end);
              setRangeYears(end - start);
            }}
            unit={T.years}
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
            const isDragging = draggedGroupId === g.id;
            const isDropTarget = dropTarget?.id === g.id;
            const topMetric = result?.metrics && result.metrics.length > 0
              ? [...result.metrics].sort((a, b) => b.annualizedReturn - a.annualizedReturn)[0]
              : null;
            return (
              <div
                key={g.id}
                draggable={renamingId !== g.id}
                onDragStart={(e) => {
                  draggedRef.current = false;
                  draggedGroupIdRef.current = g.id;
                  setDraggedGroupId(g.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", g.id);
                }}
                onDrag={() => {
                  draggedRef.current = true;
                }}
                onDragEnd={() => {
                  setDraggedGroupId(null);
                  setDropTarget(null);
                  setTimeout(() => {
                    draggedRef.current = false;
                    draggedGroupIdRef.current = null;
                  }, 100);
                }}
                onDragOver={(e) => {
                  if (!draggedGroupIdRef.current || draggedGroupIdRef.current === g.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const rect = e.currentTarget.getBoundingClientRect();
                  const isAfter = (e.clientX - rect.left) > rect.width / 2;
                  const position = isAfter ? "after" : "before";
                  setDropTarget((prev) => {
                    if (prev?.id === g.id && prev?.position === position) return prev;
                    return { id: g.id, position };
                  });
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDropTarget((prev) => (prev?.id === g.id ? null : prev));
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const sourceId = draggedGroupIdRef.current || e.dataTransfer.getData("text/plain");
                  if (!sourceId || sourceId === g.id) {
                    setDraggedGroupId(null);
                    setDropTarget(null);
                    return;
                  }
                  const sourceIndex = groups.findIndex((item) => item.id === sourceId);
                  const targetIndex = groups.findIndex((item) => item.id === g.id);
                  if (sourceIndex === -1 || targetIndex === -1) {
                    setDraggedGroupId(null);
                    setDropTarget(null);
                    return;
                  }
                  const rect = e.currentTarget.getBoundingClientRect();
                  const placeAfter = (e.clientX - rect.left) > rect.width / 2;
                  const reordered = reorderArray(groups, sourceIndex, targetIndex, placeAfter);
                  const withOrder = reordered.map((item, idx) => ({ ...item, sortOrder: idx }));
                  setGroups(withOrder);
                  reorderGroups(withOrder);
                  setDraggedGroupId(null);
                  setDropTarget(null);
                }}
                className={`card gallery-tile p-4 sm:p-5 flex flex-col gap-3 relative${isSelected ? " is-active" : ""}${isDragging ? " is-dragging" : ""}${isDropTarget ? " is-drop-target" : ""}`}
              >
                {/* Visual drop indicator edge */}
                {isDropTarget && dropTarget?.position === "before" && (
                  <div
                    className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-[calc(var(--radius-card)-1px)] z-20 pointer-events-none"
                    style={{ background: "var(--orchid-ink)", boxShadow: "2px 0 8px rgba(142, 79, 174, 0.4)" }}
                  />
                )}
                {isDropTarget && dropTarget?.position === "after" && (
                  <div
                    className="absolute right-0 top-0 bottom-0 w-1.5 rounded-r-[calc(var(--radius-card)-1px)] z-20 pointer-events-none"
                    style={{ background: "var(--orchid-ink)", boxShadow: "-2px 0 8px rgba(142, 79, 174, 0.4)" }}
                  />
                )}
                <div
                  className="flex flex-col gap-3 cursor-pointer flex-1"
                  onClick={() => {
                    if (draggedRef.current) return;
                    setExpandedWithUrl(isSelected ? null : g.id);
                  }}
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
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <div
                        className="drag-handle mt-0.5 p-1 -ml-1 rounded cursor-grab active:cursor-grabbing text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0 flex items-center justify-center"
                        title={T.dragToReorder}
                        aria-label={T.dragToReorder}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                          <circle cx="5" cy="3" r="1.5" />
                          <circle cx="11" cy="3" r="1.5" />
                          <circle cx="5" cy="8" r="1.5" />
                          <circle cx="11" cy="8" r="1.5" />
                          <circle cx="5" cy="13" r="1.5" />
                          <circle cx="11" cy="13" r="1.5" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {renamingId === g.id ? (
                            <input
                              autoFocus
                              defaultValue={g.title}
                              aria-label={T.groupTitleLabel}
                              maxLength={80}
                              className="font-display text-xl w-full min-w-0 bg-transparent border-b outline-none py-0.5"
                              style={{ borderColor: "var(--line)" }}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") e.currentTarget.blur();
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              onBlur={(e) => {
                                commitGroupTitle(g, e.currentTarget.value);
                                setRenamingId(null);
                              }}
                            />
                          ) : (
                            <h3 className="font-display text-xl truncate">{g.title}</h3>
                          )}
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
                        {displaySymbol(topMetric.symbol, lang, topMetric.simulated)}
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

                <div
                  className="flex flex-wrap gap-2 mt-auto pt-2 border-t"
                  style={{ borderColor: "var(--line)" }}
                  draggable={false}
                  onDragStart={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                >
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
                    onClick={() => setRenamingId(g.id)}
                    className="btn-ghost px-3 py-1.5 text-sm"
                  >
                    {T.rename}
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
          const thisYear = new Date().getFullYear();
          const groupMinYear = thisYear - maxGroupYears;
          const groupMaxYear = thisYear;
          const currentStartYear =
            typeof g.startYear === "number"
              ? g.startYear
              : Math.max(groupMinYear, thisYear - (g.rangeYears || 5));
          const currentEndYear = typeof g.endYear === "number" ? g.endYear : thisYear;

          const sortedByInception = [...(result?.metrics ?? [])].sort((a, b) => {
            const ya = typeof a.maxBacktestYears === "number" ? a.maxBacktestYears : 0;
            const yb = typeof b.maxBacktestYears === "number" ? b.maxBacktestYears : 0;
            if (ya !== yb) return ya - yb;
            return a.symbol.localeCompare(b.symbol);
          });

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
                  <div className="min-w-0 flex-1">
                    <input
                      key={`${g.id}:${g.title}`}
                      defaultValue={g.title}
                      aria-label={T.groupTitleLabel}
                      placeholder={T.groupTitleLabel}
                      maxLength={80}
                      className="font-display text-2xl sm:text-3xl w-full bg-transparent border-b outline-none py-0.5 transition-colors focus:border-[var(--orchid-ink)]"
                      style={{ borderColor: "var(--line)" }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = "var(--orchid-ink)";
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = "var(--line)";
                        commitGroupTitle(g, e.currentTarget.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
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
                  <DualRangeSlider
                    label={T.rangeYears}
                    min={groupMinYear}
                    max={groupMaxYear}
                    startValue={currentStartYear}
                    endValue={currentEndYear}
                    onChange={(start, end) => changeGroupRange(g, start, end)}
                    unit={T.years}
                  />
                  <NumberField
                    label={T.startValue}
                    value={g.startValue ?? 100}
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

                    {/* Explanation text below adjustment bar: comparison period & itemized symbols by inception age */}
                    <div className="flex flex-col gap-2 text-xs" style={{ color: "var(--foreground-muted)" }}>
                      {result.alignedWindow && (
                        <p className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold" style={{ color: "var(--foreground)" }}>{T.currentComparisonPeriod}：</span>
                          <span className="font-mono font-bold" style={{ color: "var(--orchid-ink)" }}>
                            {result.alignedWindow.years} {T.years}
                          </span>
                          <span className="opacity-80">（{result.alignedWindow.start} ~ {result.alignedWindow.end}）</span>
                        </p>
                      )}

                      {sortedByInception.length > 0 && (
                        <div className="flex flex-col gap-1.5 pt-1.5 border-t" style={{ borderColor: "var(--line)" }}>
                          <p className="font-medium" style={{ color: "var(--foreground)" }}>
                            {T.symbolInceptionHistoryTitle}：
                          </p>
                          <ul className="flex flex-col gap-1.5 pl-1">
                            {sortedByInception.map((m) => (
                              <li key={m.symbol} className="flex items-center gap-2 flex-wrap">
                                <span
                                  className="w-1.5 h-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: "var(--orchid-ink)" }}
                                />
                                <span className="font-semibold" style={{ color: "var(--foreground)" }}>
                                  {displaySymbol(m.symbol, lang, m.simulated)}
                                </span>
                                <span>：</span>
                                <span className="font-mono font-medium" style={{ color: "var(--foreground)" }}>
                                  {m.maxBacktestYears !== undefined ? `${m.maxBacktestYears} ${T.years}` : "--"}
                                </span>
                                {m.firstDate && (
                                  <span className="opacity-70 font-mono text-[11px]">
                                    （{m.firstDate} {T.toDate}）
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

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
                            startValue={g.startValue ?? 100}
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
                                  <SymbolLabel symbol={r.symbol} lang={lang} simulated={result?.metrics.find((m) => m.symbol === r.symbol)?.simulated} />
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
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-16 sm:py-20">
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

function DualRangeSlider({
  label,
  min,
  max,
  startValue,
  endValue,
  onChange,
  unit,
  minGap = 1,
}: {
  label: string;
  min: number;
  max: number;
  startValue: number;
  endValue: number;
  onChange: (start: number, end: number) => void;
  unit: string;
  minGap?: number;
}) {
  const safeMax = Math.max(min + minGap, max);
  const clampedStart = Math.min(safeMax - minGap, Math.max(min, startValue));
  const clampedEnd = Math.max(clampedStart + minGap, Math.min(safeMax, endValue));

  const totalRange = safeMax - min;
  const leftPercent = totalRange > 0 ? ((clampedStart - min) / totalRange) * 100 : 0;
  const rightPercent = totalRange > 0 ? ((clampedEnd - min) / totalRange) * 100 : 100;
  const duration = clampedEnd - clampedStart;

  const [activeThumb, setActiveThumb] = useState<"left" | "right" | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm flex-wrap gap-2">
        <label className="opacity-70 font-medium">{label}</label>
        <div className="flex items-center gap-1.5 font-mono">
          <span className="font-semibold text-foreground">
            {clampedStart} ~ {clampedEnd}
          </span>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: "var(--orchid-band)", color: "var(--orchid-ink)" }}
          >
            {duration} {unit}
          </span>
        </div>
      </div>

      <div
        className="dual-range-container select-none cursor-pointer"
        onClick={(e) => {
          // If clicked directly on the track (not the thumbs), move nearest thumb
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const ratio = Math.max(0, Math.min(1, clickX / rect.width));
          const clickedVal = Math.round(min + ratio * totalRange);
          const distStart = Math.abs(clickedVal - clampedStart);
          const distEnd = Math.abs(clickedVal - clampedEnd);
          if (distStart < distEnd) {
            onChange(Math.min(clickedVal, clampedEnd - minGap), clampedEnd);
          } else {
            onChange(clampedStart, Math.max(clickedVal, clampedStart + minGap));
          }
        }}
      >
        {/* Full background rail */}
        <div
          className="absolute w-full h-2 rounded-full pointer-events-none"
          style={{ background: "var(--line)" }}
        />
        {/* Selected interval highlight bar */}
        <div
          className="absolute h-2 rounded-full pointer-events-none transition-all duration-75"
          style={{
            left: `${leftPercent}%`,
            width: `${Math.max(0, rightPercent - leftPercent)}%`,
            backgroundColor: "var(--orchid-ink)",
          }}
        />
        {/* Start (Left) Range Input */}
        <input
          type="range"
          min={min}
          max={safeMax}
          step={1}
          value={clampedStart}
          onFocus={() => setActiveThumb("left")}
          onMouseDown={() => setActiveThumb("left")}
          onTouchStart={() => setActiveThumb("left")}
          onChange={(e) => {
            const val = Number(e.target.value);
            const clamped = Math.min(val, clampedEnd - minGap);
            onChange(clamped, clampedEnd);
          }}
          className="dual-range-input"
          style={{ zIndex: activeThumb === "left" || clampedStart > safeMax - 2 ? 6 : 4 }}
          aria-label={`${label} Start Year`}
        />
        {/* End (Right) Range Input */}
        <input
          type="range"
          min={min}
          max={safeMax}
          step={1}
          value={clampedEnd}
          onFocus={() => setActiveThumb("right")}
          onMouseDown={() => setActiveThumb("right")}
          onTouchStart={() => setActiveThumb("right")}
          onChange={(e) => {
            const val = Number(e.target.value);
            const clamped = Math.max(val, clampedStart + minGap);
            onChange(clampedStart, clamped);
          }}
          className="dual-range-input"
          style={{ zIndex: activeThumb === "right" ? 6 : 5 }}
          aria-label={`${label} End Year`}
        />
      </div>

      {/* Axis marks below the slider */}
      <div className="flex justify-between items-center text-[11px] font-mono opacity-60 px-0.5">
        <span>{min}</span>
        <span>{safeMax}</span>
      </div>
    </div>
  );
}
