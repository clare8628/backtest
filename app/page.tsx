"use client";

import { Fragment, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { t, Lang } from "@/lib/i18n";
import { searchCatalog } from "@/lib/symbolCatalog";
import { ComparisonGroup, BacktestMetrics, Recommendation, ChartSeries } from "@/lib/types";
import { loadGroups, upsertGroup, deleteGroup, newGroupId } from "@/lib/storage";
import PerformanceChart from "@/components/PerformanceChart";

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

const DASH = "—";
const pct = (v: number | null | undefined) => (v === undefined || v === null ? DASH : `${v}%`);
const num = (v: number | null | undefined) => (v === undefined || v === null ? DASH : String(v));

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
function metricSections(T: Dict): { title: string; rows: MetricRow[] }[] {
  return [
    {
      title: T.groupReturn,
      rows: [
        { label: T.totalReturn, value: (m) => pct(m.totalReturn) },
        { label: T.annualizedReturn, value: (m) => pct(m.annualizedReturn) },
        { label: T.finalValue, value: (m) => m.finalValue.toLocaleString() },
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
                  <span className="opacity-50"> ({T.betaVs} {m.benchmarkSymbol.replace(".TW", "")})</span>
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
        {
          label: T.swingUpAvgPct,
          value: (m) =>
            m.swingUpAvgPct === undefined || m.swingUpAvgPct === null ? DASH : `+${m.swingUpAvgPct}%`,
        },
        {
          label: T.swingDownAvgPct,
          value: (m) =>
            m.swingDownAvgPct === undefined || m.swingDownAvgPct === null ? DASH : `-${m.swingDownAvgPct}%`,
          color: () => "var(--negative)",
        },
      ],
    },
    {
      title: T.groupInfo,
      rows: [
        { label: T.maxBacktestYears, value: (m) => num(m.maxBacktestYears) },
        { label: T.fee, value: (m) => pct(m.managementFee) },
        { label: T.splitCount, value: (m) => num(m.splitCount) },
      ],
    },
  ];
}

function MetricsTable({ metrics, T }: { metrics: BacktestMetrics[]; T: Dict }) {
  const sections = metricSections(T);
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr style={{ color: "var(--foreground-muted)" }}>
          <th className="py-1 pr-4 text-left font-normal">{T.metric}</th>
          {metrics.map((m) => (
            <th key={m.symbol} className="py-1 px-2 text-right font-medium" style={{ color: "var(--foreground)" }}>
              {m.symbol}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sections.map((section) => (
          <Fragment key={section.title}>
            <tr>
              <td
                colSpan={metrics.length + 1}
                className="pt-3 pb-1 text-xs font-medium"
                style={{ color: "var(--shu)" }}
              >
                {section.title}
              </td>
            </tr>
            {section.rows.map((row) => (
              <tr key={row.label} className="border-t" style={{ borderColor: "var(--line)" }}>
                <th
                  scope="row"
                  className="py-1.5 pr-4 text-left text-xs font-normal"
                  style={{ color: "var(--foreground-muted)" }}
                >
                  {row.label}
                </th>
                {metrics.map((m) => (
                  <td
                    key={m.symbol}
                    className="py-1.5 px-2 text-right tabular-nums"
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
  const [rangeYears, setRangeYears] = useState(5);
  const [startValue, setStartValue] = useState(1000);
  const [swingThresholdPct, setSwingThresholdPct] = useState(10);

  const [results, setResults] = useState<Record<string, BacktestResult>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editQuery, setEditQuery] = useState("");

  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    loadGroups()
      .then((loaded) => {
        setGroups(loaded);
        // Auto-expand each saved group with its latest backtest result on load.
        loaded.forEach((g) => {
          if (g.symbols.length > 0) runBacktest(g);
        });
      })
      .catch(() => setGroups([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const suggestions = useMemo(() => searchCatalog(query), [query]);
  const editSuggestions = useMemo(() => searchCatalog(editQuery), [editQuery]);

  function addSymbol(sym: string) {
    const s = sym.trim().toUpperCase();
    if (!s || draftSymbols.includes(s)) return;
    setDraftSymbols([...draftSymbols, s]);
    setQuery("");
  }

  function removeDraftSymbol(sym: string) {
    setDraftSymbols(draftSymbols.filter((s) => s !== sym));
  }

  async function runBacktest(group: ComparisonGroup) {
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
          swingThresholdPct: group.swingThresholdPct ?? 10,
        }),
      });
      const data = await res.json();
      setResults((prev) => ({ ...prev, [group.id]: data }));
    } catch {
      setResults((prev) => ({
        ...prev,
        [group.id]: {
          metrics: [],
          recommendations: [],
          chartSeries: [],
          mixedCurrencies: false,
          errors: [{ symbol: "*", message: "network error" }],
        },
      }));
    } finally {
      setLoadingId(null);
    }
  }

  function scheduleRerun(group: ComparisonGroup) {
    if (debounceRef.current[group.id]) clearTimeout(debounceRef.current[group.id]);
    debounceRef.current[group.id] = setTimeout(() => runBacktest(group), DEBOUNCE_MS);
  }

  function saveDraftAsGroup() {
    if (draftSymbols.length === 0) return;
    const group: ComparisonGroup = {
      id: newGroupId(),
      title: draftTitle.trim() || draftSymbols.join(" / "),
      symbols: draftSymbols,
      createdAt: new Date().toISOString(),
      rangeYears,
      startValue,
      swingThresholdPct,
    };
    upsertGroup(group).then((updated) => {
      setGroups(updated);
      setDraftTitle("");
      setDraftSymbols([]);
      setStartValue(1000);
      setSwingThresholdPct(10);
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

  function addSymbolToGroup(group: ComparisonGroup, sym: string) {
    const s = sym.trim().toUpperCase();
    if (!s || group.symbols.includes(s)) return;
    const updated = { ...group, symbols: [...group.symbols, s] };
    updateGroup(updated, { rerun: true });
    setEditQuery("");
  }

  function removeSymbolFromGroup(group: ComparisonGroup, sym: string) {
    const nextSymbols = group.symbols.filter((s) => s !== sym);
    const updated = { ...group, symbols: nextSymbols };
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
    const updated = { ...group, rangeYears: years };
    updateGroup(updated, { rerun: true, debounce: true });
  }

  function changeGroupStartValue(group: ComparisonGroup, value: number) {
    const updated = { ...group, startValue: Math.max(1, value) };
    updateGroup(updated, { rerun: true, debounce: true });
  }

  function changeGroupSwingThreshold(group: ComparisonGroup, pct: number) {
    const updated = { ...group, swingThresholdPct: Math.max(0.1, pct) };
    updateGroup(updated, { rerun: true, debounce: true });
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--background)" }}>
      <header>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-lg font-semibold">=</span>
            <span className="font-display text-lg">{T.title}</span>
          </div>
          <button
            onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            className="btn-primary px-4 py-1.5 text-sm shrink-0"
          >
            {T.langToggle}
          </button>
        </div>
      </header>

      <div className="relative overflow-hidden hero-gradient">
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-16 sm:pb-24 text-center">
          <h1 className="font-display text-4xl sm:text-6xl leading-tight text-white">
            {T.title}
          </h1>
          <p className="text-base sm:text-lg mt-3 text-white/85 max-w-xl mx-auto">{T.subtitle}</p>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-8">
        {/* New comparison builder */}
        <section className="card p-4 sm:p-6 flex flex-col gap-4">
          <span className="eyebrow">1. {T.newComparison}</span>
          <h2 className="font-display text-2xl">{T.newComparison}</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder={T.groupTitlePlaceholder}
              className="border rounded-lg px-3 py-2 bg-white/70 sm:col-span-1"
              style={{ borderColor: "var(--line)" }}
            />
            <NumberField label={T.startValue} value={startValue} onCommit={setStartValue} min={1} step={100} />
            <NumberField
              label={T.swingThreshold}
              value={swingThresholdPct}
              onCommit={setSwingThresholdPct}
              min={0.1}
              step={1}
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={T.searchPlaceholder}
                className="w-full border rounded-lg px-3 py-2 bg-white/70"
                style={{ borderColor: "var(--line)" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && query.trim()) addSymbol(query);
                }}
              />
              {query && suggestions.length > 0 && (
                <ul
                  className="absolute z-10 mt-1 w-full card shadow-md max-h-64 overflow-auto"
                  style={{ background: "var(--washi)" }}
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
            <button onClick={() => addSymbol(query)} className="btn-primary px-4 py-2 text-sm">
              {T.addSymbol}
            </button>
          </div>

          {draftSymbols.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {draftSymbols.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm"
                  style={{ background: "var(--line)" }}
                >
                  {s}
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
            className="btn-accent px-4 py-2 text-sm self-start disabled:opacity-40"
          >
            {T.runBacktest}
          </button>
        </section>

        {/* Saved groups */}
        <section className="flex flex-col gap-4">
          <div>
            <span className="eyebrow">2. {T.savedGroups}</span>
            <h2 className="font-display text-2xl mt-1">{T.savedGroups}</h2>
          </div>
          {groups.length === 0 && <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>{T.noGroups}</p>}

          {groups.map((g) => {
            const result = results[g.id];
            const isLoading = loadingId === g.id;
            const isEditing = editingGroupId === g.id;
            return (
              <div key={g.id} className="card p-4 sm:p-6 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-xl">{g.title}</h3>
                    {!isEditing && (
                      <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
                        {T.symbols}: {g.symbols.join(", ") || "—"}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => setEditingGroupId(isEditing ? null : g.id)}
                      className="px-3 py-1.5 text-sm rounded-full border"
                      style={{ borderColor: "var(--line)" }}
                    >
                      {isEditing ? T.doneEditing : T.editSymbols}
                    </button>
                    <button
                      onClick={() => runBacktest(g)}
                      className="btn-primary px-3 py-1.5 text-sm"
                      disabled={isLoading || g.symbols.length === 0}
                    >
                      {isLoading ? T.running : T.runBacktest}
                    </button>
                    <button
                      onClick={() => handleDelete(g.id)}
                      className="px-3 py-1.5 text-sm rounded-full border"
                      style={{ borderColor: "var(--line)" }}
                    >
                      {T.delete}
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <div className="flex flex-col gap-3 rounded-lg p-3" style={{ background: "var(--background)" }}>
                    <div className="flex flex-wrap gap-2">
                      {g.symbols.map((s) => (
                        <span
                          key={s}
                          className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm"
                          style={{ background: "var(--line)" }}
                        >
                          {s}
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
                    <div className="relative">
                      <input
                        value={editQuery}
                        onChange={(e) => setEditQuery(e.target.value)}
                        placeholder={T.addSymbolToGroup}
                        className="w-full border rounded-lg px-3 py-2 bg-white/70 text-sm"
                        style={{ borderColor: "var(--line)" }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && editQuery.trim()) addSymbolToGroup(g, editQuery);
                        }}
                      />
                      {editQuery && editSuggestions.length > 0 && (
                        <ul
                          className="absolute z-10 mt-1 w-full card shadow-md max-h-64 overflow-auto"
                          style={{ background: "var(--washi)" }}
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
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <RangeSlider
                    label={T.rangeYears}
                    value={g.rangeYears}
                    onChange={(years) => changeGroupRange(g, years)}
                    unit={g.rangeYears === 1 ? T.year : T.years}
                  />
                  <NumberField
                    label={T.startValue}
                    value={g.startValue ?? 1000}
                    onCommit={(v) => changeGroupStartValue(g, v)}
                    min={1}
                    step={100}
                    className="w-full border rounded-lg px-3 py-2 bg-white/70 text-sm"
                  />
                  <NumberField
                    label={T.swingThreshold}
                    value={g.swingThresholdPct ?? 10}
                    onCommit={(v) => changeGroupSwingThreshold(g, v)}
                    min={0.1}
                    step={1}
                    className="w-full border rounded-lg px-3 py-2 bg-white/70 text-sm"
                  />
                </div>

                {result && (
                  <div className="flex flex-col gap-4">
                    {result.errors.length > 0 && (
                      <p className="text-xs" style={{ color: "var(--negative)" }}>
                        {T.errorFetch}: {result.errors.map((e) => e.symbol).join(", ")}
                      </p>
                    )}

                    {result.alignedWindow && (
                      <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                        {result.constrainedBy ? (
                          <>
                            {T.alignedNoticeBefore}
                            <strong>{result.constrainedBy}</strong>
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
                        />
                      </div>
                    )}

                    {result.metrics.length > 0 && (
                      <div className="flex flex-col gap-3">
                        <div className="overflow-x-auto">
                          <MetricsTable metrics={result.metrics} T={T} />
                        </div>
                        <Note title={T.sourceNote} body={T.sourceNoteText} />
                        <Note title={T.trendNote} body={T.trendNoteText} />
                        <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                          {T.resolutionNote}
                        </p>
                      </div>
                    )}

                    {result.recommendations.length > 0 && (
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
                        <div className="flex flex-col gap-2 mt-2">
                          {result.recommendations.map((r) => (
                            <div
                              key={r.symbol}
                              className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 rounded-lg px-3 py-2"
                              style={{ background: "var(--background)" }}
                            >
                              <div className="flex items-center gap-2 sm:w-32 shrink-0">
                                <span
                                  className="inline-flex items-center justify-center rounded-full text-xs font-semibold shrink-0"
                                  style={{
                                    background: "var(--matsu)",
                                    color: "#fff",
                                    width: "1.5rem",
                                    height: "1.5rem",
                                  }}
                                >
                                  {r.rank}
                                </span>
                                <span className="font-semibold whitespace-nowrap">{r.symbol}</span>
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
            );
          })}
        </section>
      </main>
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
  className = "w-full border rounded-lg px-3 py-2 bg-white/70",
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
  min = 1,
  max = 20,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit: string;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <label className="opacity-70">{label}</label>
        <span className="font-medium">
          {value} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-current"
        style={{ accentColor: "var(--matsu)" }}
      />
    </div>
  );
}
