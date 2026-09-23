"use client";

import { useMemo, useRef, useState } from "react";
import { ChartSeries, Currency } from "@/lib/types";
import { Lang, t } from "@/lib/i18n";
import { displaySymbol, symbolLabel } from "@/lib/symbolCatalog";
import { simulateWithdrawnSeries } from "@/lib/backtest";

// 現代金融精緻高對比調色盤（兼顧高辨識度、色盲友善與 Equals 品牌質感）
export const SERIES_COLORS = [
  "#059669", // 穩健翡翠綠 (Emerald)
  "#2563EB", // 核心皇家藍 (Royal Blue)
  "#8E4FAE", // 品牌典雅紫 (Orchid Brand)
  "#DC2626", // 鮮明珊瑚紅 (Crimson Coral)
  "#D97706", // 溫暖琥珀金 (Amber Gold)
  "#0891B2", // 科技澄澈青 (Deep Cyan)
  "#BE185D", // 飽和洋紅玫瑰 (Rose Pink)
  "#475569", // 沉穩板岩灰 (Slate Graphite)
];

/**
 * A series' label under the chart: ticker on top, fund name centred beneath,
 * matching how the metrics table labels its columns.
 */
function LegendLabel({ symbol, lang }: { symbol: string; lang: Lang }) {
  const { code, name } = symbolLabel(symbol, lang);
  if (!name) return <span className="font-semibold">{code}</span>;
  return (
    <span className="inline-flex flex-col items-start leading-tight">
      <span className="font-semibold">{code}</span>
      <span className="text-[10px] opacity-70 truncate max-w-[130px]">{name}</span>
    </span>
  );
}

/** Rough rendered width of an SVG text run */
function textWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.55;
  return w;
}

export interface SimSettings {
  enabled: boolean;
  withdrawalRate: number;
  inflationRate: number;
}

interface Props {
  series: ChartSeries[];
  mixedCurrencies: boolean;
  lang: Lang;
  height?: number;
  simSettings?: SimSettings;
  onSimSettingsChange?: (settings: SimSettings) => void;
}

interface CrisisEvent {
  date: string; // ISO date
  zh: string;
  en: string;
}

/**
 * Major market crises & milestones, updated to 2024.
 */
const CRISES: CrisisEvent[] = [
  { date: "1929-10-29", zh: "1929年華爾街股災（經濟大蕭條）", en: "1929 Wall Street Crash (Great Depression)" },
  { date: "1987-10-19", zh: "1987年黑色星期一", en: "1987 Black Monday" },
  { date: "1997-07-02", zh: "1997年亞洲金融風暴", en: "1997 Asian Financial Crisis" },
  { date: "1998-08-17", zh: "1998年俄羅斯債務危機／LTCM危機", en: "1998 Russian Crisis / LTCM Collapse" },
  { date: "2000-03-10", zh: "2000年網路泡沫破裂", en: "2000 Dot-com Bubble Burst" },
  { date: "2001-09-11", zh: "2001年911事件市場衝擊", en: "2001 9/11 Market Shock" },
  { date: "2008-09-15", zh: "2008年全球金融海嘯（雷曼兄弟倒閉）", en: "2008 Global Financial Crisis (Lehman Collapse)" },
  { date: "2011-08-05", zh: "2011年美債降評危機", en: "2011 US Credit Downgrade Crisis" },
  { date: "2015-08-24", zh: "2015年中國股災／全球黑色星期一", en: "2015 China Crash / Global Black Monday" },
  { date: "2018-12-24", zh: "2018年第四季股災（升息疑慮）", en: "2018 Q4 Selloff (Rate Hike Fears)" },
  { date: "2020-02-20", zh: "2020年新冠疫情股災", en: "2020 COVID-19 Crash" },
  { date: "2022-01-03", zh: "2022年熊市（升息與高通膨）", en: "2022 Bear Market (Rate Hikes & Inflation)" },
  { date: "2023-03-10", zh: "2023年矽谷銀行倒閉與歐美銀行風暴", en: "2023 SVB & Banking Crisis" },
  { date: "2023-10-19", zh: "2023年美債殖利率升破5%震盪", en: "2023 US 10Y Yield 5% Selloff" },
  { date: "2024-08-05", zh: "2024年全球黑色星期一（日圓套利平倉）", en: "2024 Global Black Monday (Yen Carry Unwind)" },
];

type ChartMode = "price" | "index";
type ChartScale = "linear" | "log";

interface PlottedPoint {
  date: string;
  t: number; // timestamp, ms
  value: number;
}

function priceOf(currency: Currency, p: { priceUSD: number | null; priceTWD: number | null }): number | null {
  return currency === "USD" ? p.priceUSD : p.priceTWD;
}

function formatPrice(value: number, currency: Currency): string {
  const prefix = currency === "USD" ? "$" : "NT$";
  return `${prefix}${value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 0 : 2 })}`;
}

function formatValue(value: number, mode: ChartMode, currency: Currency): string {
  if (mode === "index") return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return formatPrice(value, currency);
}

function formatYearMonth(dateStr: string, lang: Lang): string {
  const d = new Date(dateStr);
  if (lang === "zh") return `${d.getFullYear()}年${d.getMonth() + 1}月`;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

function yAxisLabel(mode: ChartMode, currency: Currency, lang: Lang): string {
  if (mode === "index") return lang === "zh" ? "指數基準（起點＝100）" : "Index Base (start = 100)";
  const currencyName =
    currency === "USD" ? (lang === "zh" ? "美元" : "USD") : lang === "zh" ? "新台幣" : "TWD";
  return lang === "zh" ? `股價淨值（${currencyName}）` : `Price (${currencyName})`;
}

/**
 * 重新設計呈現質感的高解析走勢圖：
 * 1. 放大畫布與曲線版面（縱向延伸，動態範圍大幅舒展）。
 * 2. 懸停聚焦（Hover Focus）與端點即時標籤（Endpoint Badges）。
 * 3. 重大事件時間軸鄰近磁吸感測（Proximity Detection，靠近時自動滑順展開）。
 * 4. Glassmorphism 浮雕磨砂資訊卡與現代金融調色盤。
 */
export default function PerformanceChart({
  series,
  mixedCurrencies,
  lang,
  height = 420,
  simSettings,
  onSimSettingsChange,
}: Props) {
  const T = t(lang);
  // 放大寬度與高度，預設 840 x 420，給予曲線充足的揮灑空間
  const width = 840;
  const padding = { top: 36, right: 88, bottom: 38, left: 62 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [mode, setMode] = useState<ChartMode>("index");
  const [scale, setScale] = useState<ChartScale>("linear");
  const [justToggledScale, setJustToggledScale] = useState<boolean>(false);
  const [displayCurrency, setDisplayCurrency] = useState<Currency>("USD");
  const activeCurrency: Currency = mixedCurrencies ? displayCurrency : series[0]?.currency ?? "USD";

  // 標的聚焦高亮狀態（Hover Focus）
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);

  // 退休提領模擬設定
  const [localSimEnabled, setLocalSimEnabled] = useState<boolean>(false);
  const [localWithdrawalRate, setLocalWithdrawalRate] = useState<number>(3);
  const [localInflationRate, setLocalInflationRate] = useState<number>(3);

  const simEnabled = simSettings !== undefined ? simSettings.enabled : localSimEnabled;
  const withdrawalRate = simSettings !== undefined ? simSettings.withdrawalRate : localWithdrawalRate;
  const inflationRate = simSettings !== undefined ? simSettings.inflationRate : localInflationRate;

  function updateSimSettings(updates: Partial<SimSettings>) {
    const next: SimSettings = {
      enabled: updates.enabled ?? simEnabled,
      withdrawalRate: updates.withdrawalRate ?? withdrawalRate,
      inflationRate: updates.inflationRate ?? inflationRate,
    };
    if (onSimSettingsChange) {
      onSimSettingsChange(next);
    } else {
      if (updates.enabled !== undefined) setLocalSimEnabled(updates.enabled);
      if (updates.withdrawalRate !== undefined) setLocalWithdrawalRate(updates.withdrawalRate);
      if (updates.inflationRate !== undefined) setLocalInflationRate(updates.inflationRate);
    }
  }

  const plotted = useMemo(() => {
    const raw = series
      .map((s) => ({
        symbol: s.symbol,
        points: s.points
          .map((p) => {
            const value = priceOf(activeCurrency, p);
            return value === null ? null : { date: p.date, t: new Date(p.date).getTime(), value };
          })
          .filter((p): p is PlottedPoint => p !== null),
      }))
      .filter((s) => s.points.length > 1);

    if (mode === "price") return raw;
    return raw.map((s) => {
      const base = s.points[0].value || 1;
      return { symbol: s.symbol, points: s.points.map((p) => ({ ...p, value: (p.value / base) * 100 })) };
    });
  }, [series, activeCurrency, mode]);

  // 模擬每年提領後曲線
  const plottedWithdrawn = useMemo(() => {
    if (!simEnabled) return [];

    return plotted.map((s) => {
      const sim = simulateWithdrawnSeries(
        s.points,
        s.points[0]?.value ?? 0,
        withdrawalRate,
        inflationRate
      );
      return {
        symbol: s.symbol,
        points: sim.points,
        depletedDate: sim.depletedDate,
      };
    });
  }, [plotted, simEnabled, withdrawalRate, inflationRate]);

  const [hoverT, setHoverT] = useState<number | null>(null);
  const [hoveredCrisisDate, setHoveredCrisisDate] = useState<string | null>(null);

  if (plotted.length === 0) return null;

  const allT = plotted.flatMap((s) => s.points.map((p) => p.t));
  const allV = [
    ...plotted.flatMap((s) => s.points.map((p) => p.value)),
    ...(simEnabled ? plottedWithdrawn.flatMap((s) => s.points.map((p) => p.value)) : []),
  ];
  const tMin = Math.min(...allT);
  const tMax = Math.max(...allT);
  const minV = Math.min(...allV);
  const maxV = Math.max(...allV);

  let yMin: number;
  let yMax: number;
  if (scale === "log") {
    const logMin = Math.log10(Math.max(minV, 1e-6));
    const logMax = Math.log10(Math.max(maxV, minV * 1.0001, 1e-6));
    const logPad = (logMax - logMin) * 0.08 || 0.05;
    yMin = Math.pow(10, logMin - logPad);
    yMax = Math.pow(10, logMax + logPad);
  } else {
    const vPad = (maxV - minV) * 0.08 || maxV * 0.1 || 1;
    yMin = Math.max(0, minV - vPad);
    yMax = maxV + vPad;
  }

  function xFor(t: number) {
    const ratio = tMax > tMin ? (t - tMin) / (tMax - tMin) : 0;
    return padding.left + ratio * innerW;
  }
  function yFor(v: number) {
    if (scale === "log") {
      const ratio =
        (Math.log10(Math.max(v, 1e-9)) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin) || 1);
      return padding.top + innerH - ratio * innerH;
    }
    const ratio = (v - yMin) / (yMax - yMin || 1);
    return padding.top + innerH - ratio * innerH;
  }
  function tForX(xPixel: number) {
    const ratio = (xPixel - padding.left) / innerW;
    return tMin + Math.max(0, Math.min(1, ratio)) * (tMax - tMin);
  }

  // 年份刻度（西元年）
  const startYear = new Date(tMin).getFullYear();
  const endYear = new Date(tMax).getFullYear();
  const yearTicks: { t: number; label: number }[] = [];
  const yearSpan = endYear - startYear;
  // 若跨度較長，適度間隔年份標籤以保畫面乾淨
  const yearStep = yearSpan > 20 ? 3 : yearSpan > 10 ? 2 : 1;

  for (let y = startYear; y <= endYear; y += yearStep) {
    const jan1 = new Date(Date.UTC(y, 0, 1)).getTime();
    if (jan1 >= tMin && jan1 <= tMax) yearTicks.push({ t: jan1, label: y });
  }
  if (yearTicks.length === 0) {
    yearTicks.push({ t: tMin, label: startYear }, { t: tMax, label: endYear });
  }

  // 網格線數量
  const gridLines = 5;

  // 範圍內可見之重大事件
  const visibleCrises = CRISES.map((c) => ({ ...c, t: new Date(c.date).getTime() })).filter(
    (c) => c.t >= tMin && c.t <= tMax
  );

  function labelWidth(text: string): number {
    return Math.max(70, text.length * 8.5 + 24);
  }

  function nearestPoint(points: PlottedPoint[], t: number): PlottedPoint | null {
    if (points.length === 0) return null;
    let best = points[0];
    let bestDist = Math.abs(points[0].t - t);
    for (const p of points) {
      const dist = Math.abs(p.t - t);
      if (dist < bestDist) {
        best = p;
        bestDist = dist;
      }
    }
    return best;
  }

  const hoverPoints =
    hoverT !== null
      ? plotted.map((s, idx) => {
          const pt = nearestPoint(s.points, hoverT);
          const wPt = simEnabled && plottedWithdrawn[idx] ? nearestPoint(plottedWithdrawn[idx].points, hoverT) : null;
          return {
            symbol: s.symbol,
            point: pt,
            withdrawnPoint: wPt,
          };
        })
      : null;

  const hoverX = hoverT !== null ? xFor(hoverT) : null;
  const tooltipDate = hoverPoints?.find((h) => h.point)?.point?.date;

  // ========== 重大事件鄰近磁吸感測 (Proximity Detection) ==========
  // 當滑鼠水平位置與重大事件的距離小於 28px 時，自動吸附並亮起該事件
  const PROXIMITY_THRESHOLD = 28;
  const nearestCrisis = useMemo(() => {
    if (hoverX === null) return null;
    let closest: { crisis: (typeof visibleCrises)[number]; dist: number } | null = null;
    for (const c of visibleCrises) {
      const cX = xFor(c.t);
      const dist = Math.abs(hoverX - cX);
      if (dist <= PROXIMITY_THRESHOLD) {
        if (!closest || dist < closest.dist) {
          closest = { crisis: c, dist };
        }
      }
    }
    return closest ? closest.crisis : null;
  }, [hoverX, visibleCrises]);

  // 作用中的重大事件（優先使用直接 hover 的，次為鄰近磁吸感測到的）
  const activeCrisis = hoveredCrisisDate
    ? visibleCrises.find((c) => c.date === hoveredCrisisDate) ?? null
    : nearestCrisis;

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scaleFactor = width / rect.width;
    const xPixel = (e.clientX - rect.left) * scaleFactor;
    setHoverT(tForX(xPixel));
  }

  // 懸浮資訊文字列
  const tooltipDataRows = (hoverPoints ?? []).map((h, sIdx) => {
    const color = SERIES_COLORS[sIdx % SERIES_COLORS.length];
    const { code, name } = symbolLabel(h.symbol, lang);
    const firstVal = plotted[sIdx]?.points[0]?.value || 1;
    const currentVal = h.point?.value ?? 0;
    const returnPct = ((currentVal - firstVal) / firstVal) * 100;
    const pctStr = `${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}%`;

    return {
      symbol: h.symbol,
      code,
      name,
      color,
      valueStr: h.point ? formatValue(h.point.value, mode, activeCurrency) : "—",
      pctStr,
      returnPct,
      withdrawnStr: h.withdrawnPoint ? formatValue(h.withdrawnPoint.value, mode, activeCurrency) : null,
      isFocused: hoveredSymbol === h.symbol,
    };
  });

  const tooltipW = Math.min(
    380,
    Math.max(
      220,
      activeCrisis ? labelWidth(lang === "zh" ? activeCrisis.zh : activeCrisis.en) + 24 : 0,
      ...tooltipDataRows.map((r) => textWidth(`${r.code} ${r.valueStr} (${r.pctStr})`, 9.5) + 36)
    )
  );

  const tooltipH =
    42 +
    (activeCrisis ? 28 : 0) +
    tooltipDataRows.length * (simEnabled ? 32 : 22);

  // Tooltip 座標防溢出
  const tooltipX =
    hoverX !== null
      ? hoverX + tooltipW + 16 > width - padding.right
        ? hoverX - tooltipW - 14
        : hoverX + 14
      : 0;

  const tooltipY = Math.min(padding.top + 8, height - tooltipH - padding.bottom);

  return (
    <div className="flex flex-col gap-3">
      {/* 頂部控制面板 */}
      <div className="flex flex-wrap justify-between items-center gap-2.5 text-xs bg-[var(--surface)] p-2.5 rounded-xl border border-[var(--line)] shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* 模式切換：股價 / 指數 */}
          <div className="flex p-0.5 bg-[var(--background)] rounded-full border border-[var(--line)]">
            {(["price", "index"] as ChartMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="px-3.5 py-1 rounded-full text-xs font-medium transition-all"
                style={{
                  background: mode === m ? "var(--orchid-ink)" : "transparent",
                  color: mode === m ? "white" : "inherit",
                  boxShadow: mode === m ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
                }}
              >
                {m === "price" ? T.chartModePrice : T.chartModeIndex}
              </button>
            ))}
          </div>

          {/* 退休提領模擬開關 */}
          <div
            className="flex items-center gap-2 px-3 py-1 rounded-full border transition-all"
            style={{
              borderColor: simEnabled ? "var(--orchid-ink)" : "var(--line)",
              background: simEnabled ? "rgba(142, 79, 174, 0.08)" : "transparent",
            }}
          >
            <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium select-none">
              <input
                type="checkbox"
                checked={simEnabled}
                onChange={(e) => updateSimSettings({ enabled: e.target.checked })}
                className="w-3.5 h-3.5 accent-[var(--orchid-ink)] rounded cursor-pointer"
              />
              <span className={simEnabled ? "text-[var(--orchid-ink)] font-semibold" : ""}>
                {T.retirementSim}
              </span>
            </label>

            {simEnabled && (
              <div className="flex items-center gap-2.5 pl-2 border-l border-[var(--line)]">
                <div className="flex items-center gap-1">
                  <span className="opacity-70 text-[11px]">{T.withdrawalRate}:</span>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="30"
                    value={withdrawalRate}
                    onChange={(e) => updateSimSettings({ withdrawalRate: Number(e.target.value) || 0 })}
                    className="w-12 px-1.5 py-0.5 rounded text-center border bg-[var(--surface)] text-inherit text-xs"
                    style={{ borderColor: "var(--line)" }}
                  />
                  <span className="text-[11px]">%</span>
                </div>

                <div className="flex items-center gap-1">
                  <span className="opacity-70 text-[11px]">{T.inflationRate}:</span>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="20"
                    value={inflationRate}
                    onChange={(e) => updateSimSettings({ inflationRate: Number(e.target.value) || 0 })}
                    className="w-12 px-1.5 py-0.5 rounded text-center border bg-[var(--surface)] text-inherit text-xs"
                    style={{ borderColor: "var(--line)" }}
                  />
                  <span className="text-[11px]">%</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 右側刻度與幣別切換 */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="flex p-0.5 bg-[var(--background)] rounded-full border border-[var(--line)]">
              {(["linear", "log"] as ChartScale[]).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setScale(s);
                    setJustToggledScale(true);
                    setTimeout(() => setJustToggledScale(false), 800);
                  }}
                  className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                  style={{
                    background: scale === s ? "var(--orchid-ink)" : "transparent",
                    color: scale === s ? "white" : "inherit",
                    boxShadow: scale === s ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
                  }}
                >
                  {s === "linear" ? T.scaleLinear : T.scaleLog}
                </button>
              ))}
            </div>
            <span
              className="hidden sm:inline text-[11px] tracking-tight transition-opacity duration-300"
              style={{
                color: scale === "log" ? "var(--orchid-ink)" : "currentColor",
                opacity: scale === "log" ? 0.95 : 0.6,
                fontWeight: scale === "log" ? 600 : 400,
              }}
            >
              {scale === "linear" ? `← ${T.scaleGuideLinear}` : `${T.scaleGuideLog} →`}
            </span>
          </div>

          {mixedCurrencies && (
            <div className="flex p-0.5 bg-[var(--background)] rounded-full border border-[var(--line)]">
              {(["USD", "TWD"] as Currency[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setDisplayCurrency(c)}
                  className="px-2.5 py-0.5 rounded-full text-xs font-medium transition-all"
                  style={{
                    background: activeCurrency === c ? "var(--orchid-ink)" : "transparent",
                    color: activeCurrency === c ? "white" : "inherit",
                  }}
                >
                  {c === "USD" ? T.currencyUSD : T.currencyTWD}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 走勢圖本體容器 */}
      <div className="relative w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-xs overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full select-none"
          style={{ minWidth: 320, maxWidth: "100%", height: "auto", display: "block" }}
          role="img"
          aria-label="performance chart"
          onMouseMove={handleMove}
          onMouseLeave={() => {
            setHoverT(null);
            setHoveredCrisisDate(null);
          }}
        >
          {/* 精緻濾鏡與陰影定義 */}
          <defs>
            <filter id="subtle-line-shadow" x="-5%" y="-10%" width="110%" height="130%">
              <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#000" floodOpacity="0.08" />
            </filter>
            <filter id="active-line-glow" x="-10%" y="-15%" width="120%" height="140%">
              <feDropShadow dx="0" dy="3" stdDeviation="3.5" floodColor="#000" floodOpacity="0.18" />
            </filter>
            <filter id="card-shadow" x="-10%" y="-10%" width="120%" height="125%">
              <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.12" />
            </filter>
            <filter id="crisis-pulse" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#DC2626" floodOpacity="0.5" />
            </filter>
          </defs>

          {/* 背景微妙裝飾淡漸層 */}
          <rect
            x={padding.left}
            y={padding.top}
            width={innerW}
            height={innerH}
            fill="transparent"
          />

          {/* 左 Y 軸標題（絕對值/指數） */}
          <text
            x={padding.left}
            y={16}
            fontSize={10.5}
            fontWeight={scale === "linear" ? 700 : 500}
            fill={scale === "linear" ? "var(--orchid-ink)" : "currentColor"}
            opacity={scale === "linear" ? 0.95 : 0.45}
            className={`transition-all duration-300 ${justToggledScale && scale === "linear" ? "animate-pulse" : ""}`}
          >
            {yAxisLabel(mode, activeCurrency, lang)}
          </text>

          {/* 右 Y 軸標題（變動比例） */}
          <text
            x={width - padding.right + 12}
            y={16}
            fontSize={10.5}
            fontWeight={scale === "log" ? 700 : 500}
            textAnchor="end"
            fill={scale === "log" ? "var(--orchid-ink)" : "currentColor"}
            opacity={scale === "log" ? 0.95 : 0.4}
            className={`transition-all duration-300 ${justToggledScale && scale === "log" ? "animate-pulse" : ""}`}
          >
            {T.logScaleRightAxis}
          </text>

          {/* Y 軸水平網格線與數值標記 */}
          {Array.from({ length: gridLines + 1 }).map((_, i) => {
            const v =
              scale === "log"
                ? yMin * Math.pow(yMax / yMin, i / gridLines)
                : yMin + ((yMax - yMin) * i) / gridLines;
            const y = yFor(v);

            const baseForPct = mode === "index" ? 100 : (plotted[0]?.points[0]?.value || 1);
            const pct = ((v - baseForPct) / (baseForPct || 1)) * 100;
            const pctText = (pct > 0 ? "+" : "") + pct.toFixed(Math.abs(pct) >= 100 ? 0 : 1) + "%";

            return (
              <g key={i}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  stroke="var(--line)"
                  strokeWidth={0.8}
                  strokeDasharray="4,4"
                  opacity={0.7}
                />
                {/* 左刻度 */}
                <text
                  x={padding.left - 8}
                  y={y + 3.5}
                  fontSize={9.5}
                  textAnchor="end"
                  fontWeight={scale === "linear" ? 600 : 400}
                  fill="currentColor"
                  opacity={scale === "linear" ? 0.8 : 0.4}
                >
                  {formatValue(v, mode, activeCurrency)}
                </text>
                {/* 右刻度 */}
                <text
                  x={width - padding.right + 8}
                  y={y + 3.5}
                  fontSize={9.5}
                  textAnchor="start"
                  fontWeight={scale === "log" ? 600 : 400}
                  fill={scale === "log" ? "var(--orchid-ink)" : "currentColor"}
                  opacity={scale === "log" ? 0.9 : 0.4}
                >
                  {pctText}
                </text>
              </g>
            );
          })}

          {/* X 軸年份虛線與標記 */}
          {yearTicks.map((tick) => {
            const x = xFor(tick.t);
            return (
              <g key={tick.t}>
                <line
                  x1={x}
                  x2={x}
                  y1={padding.top}
                  y2={height - padding.bottom}
                  stroke="var(--line)"
                  strokeWidth={0.7}
                  strokeDasharray="2,3"
                  opacity={0.65}
                />
                <text
                  x={x}
                  y={height - padding.bottom + 18}
                  fontSize={10}
                  fill="currentColor"
                  opacity={0.65}
                  textAnchor="middle"
                  fontWeight={500}
                >
                  {tick.label}
                </text>
              </g>
            );
          })}

          {/* 指數基準線 (100) */}
          {mode === "index" && yMin <= 100 && yMax >= 100 && (
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yFor(100)}
              y2={yFor(100)}
              stroke="var(--foreground-muted)"
              strokeOpacity={0.4}
              strokeWidth={1.2}
              strokeDasharray="4,4"
            />
          )}

          {/* 歷史重大事件垂直引導線與標記點 */}
          {visibleCrises.map((c) => {
            const x = xFor(c.t);
            const isNear = activeCrisis?.date === c.date;

            return (
              <g key={c.date}>
                {/* 垂直引導軸線 */}
                <line
                  x1={x}
                  x2={x}
                  y1={padding.top}
                  y2={height - padding.bottom}
                  stroke={isNear ? "#DC2626" : "#E11D48"}
                  strokeOpacity={isNear ? 0.85 : 0.25}
                  strokeWidth={isNear ? 1.8 : 1}
                  strokeDasharray={isNear ? undefined : "3,3"}
                  className="transition-all duration-200"
                />

                {/* 各曲線上在重大事件時的點位 */}
                {plotted.map((s) => {
                  const p = nearestPoint(s.points, c.t);
                  if (!p) return null;
                  const cy = yFor(p.value);

                  return (
                    <g key={s.symbol}>
                      {isNear && (
                        <circle
                          cx={x}
                          cy={cy}
                          r={8}
                          fill="none"
                          stroke="#DC2626"
                          strokeWidth={1.5}
                          strokeOpacity={0.4}
                          filter="url(#crisis-pulse)"
                        />
                      )}
                      <circle
                        cx={x}
                        cy={cy}
                        r={isNear ? 4.8 : 3.2}
                        fill={isNear ? "#DC2626" : "#E11D48"}
                        stroke="var(--surface)"
                        strokeWidth={1.5}
                        className="transition-all duration-200"
                      />
                    </g>
                  );
                })}

                {/* 頂部事件簡明警示標誌 (若被吸附或接近時更突出) */}
                <circle
                  cx={x}
                  cy={padding.top - 8}
                  r={isNear ? 6 : 4}
                  fill={isNear ? "#DC2626" : "#F43F5E"}
                  stroke="var(--surface)"
                  strokeWidth={1.2}
                  className="transition-all duration-200"
                />

                {/* 擴大的隱形觸控/感測熱區 */}
                <rect
                  x={x - 14}
                  y={padding.top}
                  width={28}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHoveredCrisisDate(c.date)}
                  onMouseLeave={() => setHoveredCrisisDate((cur) => (cur === c.date ? null : cur))}
                  style={{ cursor: "pointer" }}
                />
              </g>
            );
          })}

          {/* 走勢主要曲線 (Series Lines) */}
          {plotted.map((s, idx) => {
            const color = SERIES_COLORS[idx % SERIES_COLORS.length];
            const isHovered = hoveredSymbol === s.symbol;
            const isDimmed = hoveredSymbol !== null && !isHovered;
            const d = s.points
              .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.t).toFixed(1)} ${yFor(p.value).toFixed(1)}`)
              .join(" ");

            return (
              <path
                key={s.symbol}
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={isHovered ? 3.8 : 2.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-all duration-200"
                style={{
                  opacity: isDimmed ? 0.22 : 1,
                  filter: isHovered ? "url(#active-line-glow)" : "url(#subtle-line-shadow)",
                  cursor: "pointer",
                }}
                onMouseEnter={() => setHoveredSymbol(s.symbol)}
                onMouseLeave={() => setHoveredSymbol(null)}
              />
            );
          })}

          {/* 提領後曲線 (含通膨疊加) */}
          {simEnabled &&
            plottedWithdrawn.map((s, idx) => {
              const color = SERIES_COLORS[idx % SERIES_COLORS.length];
              const isHovered = hoveredSymbol === s.symbol;
              const isDimmed = hoveredSymbol !== null && !isHovered;
              const d = s.points
                .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.t).toFixed(1)} ${yFor(p.value).toFixed(1)}`)
                .join(" ");

              return (
                <g key={`withdrawn-${s.symbol}`}>
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={isHovered ? 2.6 : 1.8}
                    strokeDasharray="5,4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-all duration-200"
                    style={{ opacity: isDimmed ? 0.2 : 0.85 }}
                  />
                  {s.depletedDate && (
                    <circle
                      cx={xFor(new Date(s.depletedDate).getTime())}
                      cy={yFor(0)}
                      r={5}
                      fill="#DC2626"
                      stroke="var(--surface)"
                      strokeWidth={1.8}
                    />
                  )}
                </g>
              );
            })}

          {/* 曲線最右側端點即時標籤 (Endpoint Badges) - 降低辨識難度 */}
          {plotted.map((s, idx) => {
            const lastPt = s.points[s.points.length - 1];
            if (!lastPt) return null;
            const color = SERIES_COLORS[idx % SERIES_COLORS.length];
            const isHovered = hoveredSymbol === s.symbol;
            const isDimmed = hoveredSymbol !== null && !isHovered;
            const labelX = xFor(lastPt.t) + 6;
            const labelY = yFor(lastPt.value);
            const { code } = symbolLabel(s.symbol, lang);

            const firstVal = s.points[0]?.value || 1;
            const retPct = ((lastPt.value - firstVal) / firstVal) * 100;
            const retStr = `${retPct >= 0 ? "+" : ""}${retPct.toFixed(0)}%`;
            const badgeText = `${code} ${retStr}`;
            const badgeW = textWidth(badgeText, 8.5) + 12;

            return (
              <g
                key={`badge-${s.symbol}`}
                className="transition-all duration-200"
                style={{
                  opacity: isDimmed ? 0.25 : 1,
                  cursor: "pointer",
                }}
                onMouseEnter={() => setHoveredSymbol(s.symbol)}
                onMouseLeave={() => setHoveredSymbol(null)}
              >
                <rect
                  x={labelX}
                  y={labelY - 9}
                  width={badgeW}
                  height={18}
                  rx={4}
                  fill="var(--surface)"
                  stroke={color}
                  strokeWidth={isHovered ? 1.8 : 1}
                  filter="drop-shadow(0px 1px 2px rgba(0,0,0,0.08))"
                />
                <text
                  x={labelX + 6}
                  y={labelY + 3.5}
                  fontSize={8.5}
                  fontWeight={isHovered ? 700 : 600}
                  fill={color}
                >
                  {badgeText}
                </text>
              </g>
            );
          })}

          {/* 滑鼠垂直時間引導線與節點 (Crosshair) */}
          {hoverX !== null && (
            <>
              <line
                x1={hoverX}
                x2={hoverX}
                y1={padding.top}
                y2={height - padding.bottom}
                stroke="var(--foreground)"
                strokeOpacity={0.25}
                strokeWidth={1}
                strokeDasharray="2,2"
              />
              {hoverPoints?.map((h, idx) => {
                const color = SERIES_COLORS[idx % SERIES_COLORS.length];
                const isHovered = hoveredSymbol === h.symbol;
                return (
                  <g key={h.symbol}>
                    {h.point && (
                      <circle
                        cx={xFor(h.point.t)}
                        cy={yFor(h.point.value)}
                        r={isHovered ? 5.5 : 4}
                        fill={color}
                        stroke="var(--surface)"
                        strokeWidth={1.8}
                        className="transition-all duration-150"
                      />
                    )}
                    {h.withdrawnPoint && (
                      <circle
                        cx={xFor(h.withdrawnPoint.t)}
                        cy={yFor(h.withdrawnPoint.value)}
                        r={3.2}
                        fill={color}
                        stroke="var(--surface)"
                        strokeWidth={1.2}
                        opacity={0.8}
                      />
                    )}
                  </g>
                );
              })}
            </>
          )}

          {/* 懸浮智慧資訊卡 (Elevated Rich Tooltip) */}
          {hoverX !== null && hoverPoints && tooltipDate && (
            <g
              transform={`translate(${tooltipX}, ${tooltipY})`}
              className="transition-transform duration-100 ease-out"
              pointerEvents="none"
            >
              {/* 卡片本體玻璃質感底框 */}
              <rect
                x={0}
                y={0}
                width={tooltipW}
                height={tooltipH}
                rx={8}
                fill="var(--surface)"
                stroke="var(--line)"
                strokeWidth={1}
                filter="url(#card-shadow)"
                style={{ opacity: 0.98 }}
              />

              {/* 頂部日期 */}
              <text x={12} y={19} fontSize={11} fontWeight={700} fill="var(--foreground)">
                {formatYearMonth(tooltipDate, lang)}
              </text>
              <text x={tooltipW - 12} y={18} fontSize={8.5} fill="var(--foreground-muted)" textAnchor="end">
                {mode === "index" ? "起點＝100" : activeCurrency}
              </text>

              {/* 重大事件突出橫幅 (若靠近重大事件時間點) */}
              {activeCrisis && (
                <g transform="translate(10, 26)">
                  <rect
                    x={0}
                    y={0}
                    width={tooltipW - 20}
                    height={22}
                    rx={4}
                    fill="#FEF2F2"
                    stroke="#EF4444"
                    strokeWidth={1}
                  />
                  <text
                    x={8}
                    y={15}
                    fontSize={9.5}
                    fontWeight={700}
                    fill="#B91C1C"
                  >
                    🚨 {lang === "zh" ? activeCrisis.zh : activeCrisis.en}
                  </text>
                </g>
              )}

              {/* 分隔細線 */}
              <line
                x1={10}
                x2={tooltipW - 10}
                y1={activeCrisis ? 54 : 26}
                y2={activeCrisis ? 54 : 26}
                stroke="var(--line)"
                strokeWidth={0.8}
              />

              {/* 各標的數據列 */}
              {tooltipDataRows.map((row, rIdx) => {
                const startY = (activeCrisis ? 68 : 40) + rIdx * (simEnabled ? 30 : 20);

                return (
                  <g key={row.symbol}>
                    {/* 聚焦時的背景高亮淡條 */}
                    {row.isFocused && (
                      <rect
                        x={6}
                        y={startY - 10}
                        width={tooltipW - 12}
                        height={simEnabled ? 28 : 18}
                        rx={3}
                        fill={row.color}
                        fillOpacity={0.1}
                      />
                    )}

                    {/* 顏色小圖示圓點 */}
                    <circle cx={16} cy={startY - 3} r={3.5} fill={row.color} />

                    {/* 代號與名稱 */}
                    <text
                      x={25}
                      y={startY}
                      fontSize={9.5}
                      fontWeight={row.isFocused ? 700 : 600}
                      fill="var(--foreground)"
                    >
                      {row.code}
                    </text>

                    {/* 數值 */}
                    <text
                      x={tooltipW - 68}
                      y={startY}
                      fontSize={9.5}
                      fontWeight={row.isFocused ? 700 : 500}
                      fill="var(--foreground)"
                      textAnchor="end"
                    >
                      {row.valueStr}
                    </text>

                    {/* 累積報酬百分比 */}
                    <text
                      x={tooltipW - 10}
                      y={startY}
                      fontSize={9}
                      fontWeight={600}
                      fill={row.returnPct >= 0 ? "var(--positive)" : "var(--negative)"}
                      textAnchor="end"
                    >
                      {row.pctStr}
                    </text>

                    {/* 提領模擬數據列 (若啟用) */}
                    {row.withdrawnStr && (
                      <text
                        x={25}
                        y={startY + 12}
                        fontSize={8.5}
                        fill={row.color}
                        opacity={0.85}
                      >
                        ↳ {T.withdrawnCurveLabel}: {row.withdrawnStr}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          )}
        </svg>
      </div>

      {/* 下方互動圖例 (Legend) - 支援懸停聚焦高亮 */}
      <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
        {plotted.map((s, idx) => {
          const color = SERIES_COLORS[idx % SERIES_COLORS.length];
          const isHovered = hoveredSymbol === s.symbol;
          const isDimmed = hoveredSymbol !== null && !isHovered;

          return (
            <button
              key={s.symbol}
              type="button"
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all select-none"
              style={{
                borderColor: isHovered ? color : "var(--line)",
                background: isHovered ? "var(--surface)" : "transparent",
                opacity: isDimmed ? 0.35 : 1,
                boxShadow: isHovered ? "0 2px 6px rgba(0,0,0,0.08)" : "none",
                transform: isHovered ? "translateY(-1px)" : "none",
              }}
              onMouseEnter={() => setHoveredSymbol(s.symbol)}
              onMouseLeave={() => setHoveredSymbol(null)}
            >
              <span
                className="w-3.5 h-1.5 rounded-full transition-all"
                style={{
                  background: color,
                  transform: isHovered ? "scale(1.2)" : "scale(1)",
                }}
              />
              <LegendLabel symbol={s.symbol} lang={lang} />
            </button>
          );
        })}

        {simEnabled && (
          <span className="flex items-center gap-1.5 px-2 py-1 text-xs opacity-75">
            <span
              className="inline-block w-4 h-0.5 border-t-2 border-dashed"
              style={{ borderColor: "currentColor" }}
            />
            <span>
              {T.withdrawnCurveLabel}（{withdrawalRate}%提領, {inflationRate}%通膨）
            </span>
          </span>
        )}

        <span className="ml-auto text-[11px] text-[var(--foreground-muted)]">
          {mode === "price" ? `(${activeCurrency})` : lang === "zh" ? "(指數化＝100)" : "(Index=100)"}
        </span>
      </div>

      {/* 底部互動說明與提示 */}
      <div className="flex flex-col gap-1 text-[11px] text-[var(--foreground-muted)] px-1">
        <p className="flex items-center gap-1.5">
          <span>{T.chartInteractionTip}</span>
        </p>

        {simEnabled && (
          <p className="opacity-80">
            💡 {T.simExplanation}
          </p>
        )}

        {mode === "price" && (
          <p className="opacity-75">{T.splitAdjustedNote}</p>
        )}
      </div>
    </div>
  );
}
