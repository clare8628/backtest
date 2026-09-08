"use client";

import { useMemo, useRef, useState } from "react";
import { ChartSeries, Currency } from "@/lib/types";
import { Lang, t } from "@/lib/i18n";
import { displaySymbol, symbolLabel } from "@/lib/symbolCatalog";

// 高對比顏色組合
export const SERIES_COLORS = [
  "#2E7D32", // deep green
  "#D32F2F", // bright red
  "#1976D2", // bright blue
  "#F57C00", // orange
  "#7B1FA2", // purple
  "#0097A7", // cyan
  "#C2185B", // pink
  "#558B2F", // olive
];

/**
 * A series' label under the chart: ticker on top, fund name centred beneath,
 * matching how the metrics table labels its columns. The hover tooltip keeps
 * the one-line parenthesised form instead — a second line per series would
 * double the height of a box that already lists every symbol.
 */
function LegendLabel({ symbol, lang }: { symbol: string; lang: Lang }) {
  const { code, name } = symbolLabel(symbol, lang);
  if (!name) return <>{code}</>;
  return (
    <span className="inline-flex flex-col items-center leading-tight">
      <span>{code}</span>
      <span className="opacity-70">{name}</span>
    </span>
  );
}

/** Rough rendered width of an SVG text run: CJK glyphs are full-width, Latin
 *  roughly 0.55em. Only needs to be close, and only exists because a Taiwan
 *  symbol's label carries its fund name — a fixed box would clip it. */
function textWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.55;
  return w;
}

interface Props {
  series: ChartSeries[];
  mixedCurrencies: boolean;
  lang: Lang;
  height?: number;
}

interface CrisisEvent {
  date: string; // representative anchor date (ISO), used to place the marker
  zh: string;
  en: string;
}

/**
 * Major market crises, anchored to a single representative date each (the
 * widely-cited crash/collapse date, not the full multi-month drawdown).
 * Only ones falling inside a chart's actual visible date range are drawn —
 * pre-1993 entries (no ETF existed yet) simply never render for this app's
 * data, which is harmless to keep here.
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
  { date: "2022-01-03", zh: "2022年熊市（升息與通膨）", en: "2022 Bear Market (Rate Hikes & Inflation)" },
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

/** What the y-axis currently represents, spelled out so a real price is never
 *  mistaken for an index value (or vice versa) — e.g. a 2x leveraged ETF's
 *  actual price and its indexed performance can look like similar numbers. */
function yAxisLabel(mode: ChartMode, currency: Currency, lang: Lang): string {
  if (mode === "index") return lang === "zh" ? "指數（起點=100）" : "Index (start = 100)";
  const currencyName =
    currency === "USD" ? (lang === "zh" ? "美元" : "USD") : lang === "zh" ? "新台幣" : "TWD";
  return lang === "zh" ? `股價（${currencyName}）` : `Price (${currencyName})`;
}

/**
 * Lightweight dependency-free SVG line chart showing each symbol's actual
 * price over time, date-aligned on the x-axis, with a hover tooltip and an
 * optional USD/TWD currency toggle when the comparison mixes US and Taiwan
 * symbols.
 */
export default function PerformanceChart({ series, mixedCurrencies, lang, height = 280 }: Props) {
  const T = t(lang);
  const width = 640;
  const padding = { top: 24, right: 12, bottom: 28, left: 56 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [mode, setMode] = useState<ChartMode>("price");
  const [scale, setScale] = useState<ChartScale>("linear");
  const [displayCurrency, setDisplayCurrency] = useState<Currency>("USD");
  const activeCurrency: Currency = mixedCurrencies ? displayCurrency : series[0]?.currency ?? "USD";

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
    // Index mode: rebase each series to 100 at its own first point, so relative
    // performance is comparable regardless of each symbol's absolute price scale.
    return raw.map((s) => {
      const base = s.points[0].value || 1;
      return { symbol: s.symbol, points: s.points.map((p) => ({ ...p, value: (p.value / base) * 100 })) };
    });
  }, [series, activeCurrency, mode]);

  const [hoverT, setHoverT] = useState<number | null>(null);
  const [hoveredCrisis, setHoveredCrisis] = useState<string | null>(null);

  if (plotted.length === 0) return null;

  const allT = plotted.flatMap((s) => s.points.map((p) => p.t));
  const allV = plotted.flatMap((s) => s.points.map((p) => p.value));
  const tMin = Math.min(...allT);
  const tMax = Math.max(...allT);
  const minV = Math.min(...allV);
  const maxV = Math.max(...allV);

  let yMin: number;
  let yMax: number;
  if (scale === "log") {
    // Log scale can't reach 0, so floor the domain just above the smallest
    // plotted value instead of padding down toward zero like linear mode does.
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

  // Year tick marks (西元年) across the covered span.
  const startYear = new Date(tMin).getFullYear();
  const endYear = new Date(tMax).getFullYear();
  const yearTicks: { t: number; label: number }[] = [];
  for (let y = startYear; y <= endYear; y++) {
    const jan1 = new Date(Date.UTC(y, 0, 1)).getTime();
    if (jan1 >= tMin && jan1 <= tMax) yearTicks.push({ t: jan1, label: y });
  }
  if (yearTicks.length === 0) {
    yearTicks.push({ t: tMin, label: startYear }, { t: tMax, label: endYear });
  }

  const gridLines = 4;

  // Crisis markers falling inside the chart's actual visible date span.
  const visibleCrises = CRISES.map((c) => ({ ...c, t: new Date(c.date).getTime() })).filter(
    (c) => c.t >= tMin && c.t <= tMax
  );

  // Rough CJK/ASCII-safe label width so the crisis tooltip box fits its text.
  function labelWidth(text: string): number {
    return Math.max(60, text.length * 8 + 16);
  }

  // Nearest point per series to the hovered date, for the tooltip.
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
      ? plotted.map((s) => ({ symbol: s.symbol, point: nearestPoint(s.points, hoverT) }))
      : null;
  const hoverX = hoverT !== null ? xFor(hoverT) : null;
  const tooltipDate = hoverPoints?.find((h) => h.point)?.point?.date;

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scale = width / rect.width;
    const xPixel = (e.clientX - rect.left) * scale;
    setHoverT(tForX(xPixel));
  }

  // The tooltip lists one line per symbol, and a Taiwan symbol's line carries
  // its fund name, so the box is sized to its own longest line — clamped so a
  // long name can't grow it past a third of the chart.
  const tooltipLines = (hoverPoints ?? []).flatMap((h) =>
    h.point ? [`${displaySymbol(h.symbol, lang)}: ${formatValue(h.point.value, mode, activeCurrency)}`] : []
  );
  const tooltipW = Math.min(
    320,
    Math.max(150, ...tooltipLines.map((line) => textWidth(line, 9.5) + 16))
  );

  // While a crisis marker is hovered, its label and the price tooltip must
  // never overlap — both default to roughly the same x (the cursor sits
  // right on the marker). Default to crisis-left/price-right of the marker's
  // line; if the marker sits too close to either chart edge for that split to
  // fit, stack both boxes on whichever side does have room instead.
  const activeCrisis = hoveredCrisis ? visibleCrises.find((c) => c.date === hoveredCrisis) ?? null : null;
  const activeCrisisX = activeCrisis ? xFor(activeCrisis.t) : null;
  const activeCrisisLabelW = activeCrisis ? labelWidth(lang === "zh" ? activeCrisis.zh : activeCrisis.en) : 0;

  let splitCrisisBoxX = 0;
  let splitPriceBoxX = 0;
  if (activeCrisisX !== null) {
    splitCrisisBoxX = activeCrisisX - 10 - activeCrisisLabelW;
    splitPriceBoxX = activeCrisisX + 10;
    if (splitCrisisBoxX < padding.left) {
      // No room to the left — stack both to the right, crisis closer to the line.
      splitCrisisBoxX = activeCrisisX + 10;
      splitPriceBoxX = splitCrisisBoxX + activeCrisisLabelW + 10;
    }
    if (splitPriceBoxX + tooltipW > width - padding.right) {
      // No room to the right either — stack both to the left, price closer to the line.
      splitPriceBoxX = activeCrisisX - 10 - tooltipW;
      splitCrisisBoxX = splitPriceBoxX - activeCrisisLabelW - 10;
      if (splitCrisisBoxX < padding.left) splitCrisisBoxX = padding.left;
    }
  }

  // Tooltip box: flip to the left of the cursor if it would overflow the right
  // edge — unless a crisis marker is active, in which case it uses the split
  // position computed above instead.
  const tooltipX =
    hoverX !== null
      ? activeCrisisX !== null
        ? splitPriceBoxX
        : hoverX + tooltipW + 8 > width
          ? hoverX - tooltipW - 10
          : hoverX + 10
      : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap justify-between items-center gap-2 text-xs">
        <div className="flex gap-1">
          {(["price", "index"] as ChartMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="px-3 py-1 rounded-full"
              style={{
                border: "1px solid var(--line)",
                background: mode === m ? "var(--orchid-ink)" : "transparent",
                color: mode === m ? "white" : "inherit",
              }}
            >
              {m === "price" ? T.chartModePrice : T.chartModeIndex}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(["linear", "log"] as ChartScale[]).map((s) => (
            <button
              key={s}
              onClick={() => setScale(s)}
              className="px-3 py-1 rounded-full"
              style={{
                border: "1px solid var(--line)",
                background: scale === s ? "var(--orchid-ink)" : "transparent",
                color: scale === s ? "white" : "inherit",
              }}
            >
              {s === "linear" ? T.scaleLinear : T.scaleLog}
            </button>
          ))}
        </div>
        {mixedCurrencies && (
          <div className="flex gap-1">
            {(["USD", "TWD"] as Currency[]).map((c) => (
              <button
                key={c}
                onClick={() => setDisplayCurrency(c)}
                className="px-3 py-1 rounded-full"
                style={{
                  border: "1px solid var(--line)",
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

      <div className="overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full"
          style={{ minWidth: 320, maxWidth: 720 }}
          role="img"
          aria-label="performance chart"
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverT(null)}
        >
          {/* persistent y-axis title — always visible, not just on hover, so the
              unit (real price vs. index) is never ambiguous at a glance */}
          <text x={padding.left} y={12} fontSize={9.5} fontWeight={600} fill="currentColor" opacity={0.75}>
            {yAxisLabel(mode, activeCurrency, lang)}
          </text>

          {/* y grid + value labels */}
          {Array.from({ length: gridLines + 1 }).map((_, i) => {
            // Log-spaced grid values land at evenly spaced pixel rows under yFor's
            // log transform, the same way linear-spaced values do under linear.
            const v =
              scale === "log"
                ? yMin * Math.pow(yMax / yMin, i / gridLines)
                : yMin + ((yMax - yMin) * i) / gridLines;
            const y = yFor(v);
            return (
              <g key={i}>
                <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="var(--line)" strokeWidth={1} />
                <text x={4} y={y + 3} fontSize={9} fill="currentColor" opacity={0.6}>
                  {formatValue(v, mode, activeCurrency)}
                </text>
              </g>
            );
          })}

          {/* year ticks */}
          {yearTicks.map((tick) => {
            const x = xFor(tick.t);
            return (
              <g key={tick.t}>
                <line x1={x} x2={x} y1={padding.top} y2={height - padding.bottom} stroke="var(--line)" strokeWidth={1} strokeDasharray="2,3" />
                <text x={x} y={height - 8} fontSize={9} fill="currentColor" opacity={0.6} textAnchor="middle">
                  {tick.label}
                </text>
              </g>
            );
          })}

          {/* index baseline at 100 */}
          {mode === "index" && yMin <= 100 && yMax >= 100 && (
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yFor(100)}
              y2={yFor(100)}
              stroke="currentColor"
              strokeOpacity={0.3}
              strokeDasharray="3,3"
            />
          )}

          {/* series lines */}
          {plotted.map((s, idx) => {
            const color = SERIES_COLORS[idx % SERIES_COLORS.length];
            const d = s.points
              .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.t).toFixed(1)} ${yFor(p.value).toFixed(1)}`)
              .join(" ");
            return <path key={s.symbol} d={d} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />;
          })}

          {/* crisis markers — fixed (always visible) red dots on each series at
              well-known market crashes, with the event name on hover */}
          {visibleCrises.map((c) => {
            const x = xFor(c.t);
            const label = lang === "zh" ? c.zh : c.en;
            const w = labelWidth(label);
            // Uses the split position computed above (crisis-left/price-right
            // of the line by default, falling back to stacking near an edge)
            // so this box and the price tooltip never overlap.
            const boxX = hoveredCrisis === c.date ? splitCrisisBoxX : 0;
            return (
              <g key={c.date}>
                <line
                  x1={x}
                  x2={x}
                  y1={padding.top}
                  y2={height - padding.bottom}
                  stroke="#B71C1C"
                  strokeOpacity={0.3}
                  strokeWidth={1}
                  strokeDasharray="2,2"
                />
                {plotted.map((s) => {
                  const p = nearestPoint(s.points, c.t);
                  if (!p) return null;
                  return (
                    <circle
                      key={s.symbol}
                      cx={xFor(p.t)}
                      cy={yFor(p.value)}
                      r={3.5}
                      fill="#B71C1C"
                      stroke="var(--surface)"
                      strokeWidth={1.2}
                    />
                  );
                })}
                {/* wide, mostly-invisible hit area so the thin dashed line/small
                    dots are easy to hover across the chart's full height */}
                <rect
                  x={x - 8}
                  y={padding.top}
                  width={16}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHoveredCrisis(c.date)}
                  onMouseLeave={() => setHoveredCrisis((cur) => (cur === c.date ? null : cur))}
                  style={{ cursor: "pointer" }}
                />
                {hoveredCrisis === c.date && (
                  <g transform={`translate(${boxX}, ${padding.top + 2})`}>
                    <rect x={0} y={0} width={w} height={18} rx={4} fill="var(--surface)" stroke="#B71C1C" style={{ opacity: 0.97 }} />
                    <text x={8} y={13} fontSize={9} fontWeight={600} fill="#B71C1C">
                      {label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* hover guideline + dots */}
          {hoverX !== null && (
            <>
              <line x1={hoverX} x2={hoverX} y1={padding.top} y2={height - padding.bottom} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} />
              {hoverPoints?.map((h, idx) =>
                h.point ? (
                  <circle key={h.symbol} cx={xFor(h.point.t)} cy={yFor(h.point.value)} r={3.5} fill={SERIES_COLORS[idx % SERIES_COLORS.length]} stroke="var(--surface)" strokeWidth={1.5} />
                ) : null
              )}
            </>
          )}

          {/* hover tooltip */}
          {hoverX !== null && hoverPoints && tooltipDate && (
            <g transform={`translate(${tooltipX}, ${padding.top})`}>
              <rect
                x={0}
                y={0}
                width={tooltipW}
                height={30 + hoverPoints.length * 14}
                rx={6}
                fill="var(--surface)"
                stroke="var(--line)"
                style={{ opacity: 0.97 }}
              />
              <text x={8} y={14} fontSize={10} fontWeight={600} fill="currentColor">
                {formatYearMonth(tooltipDate, lang)}
              </text>
              {/* unit restated here too — the axis title above can scroll out of
                  view, and this is exactly where a real price vs. an index value
                  gets misread as the other */}
              <text x={8} y={25} fontSize={8} fill="currentColor" opacity={0.55}>
                {yAxisLabel(mode, activeCurrency, lang)}
              </text>
              {hoverPoints.map((h, idx) =>
                h.point ? (
                  <text key={h.symbol} x={8} y={41 + idx * 14} fontSize={9.5} fill={SERIES_COLORS[idx % SERIES_COLORS.length]}>
                    {displaySymbol(h.symbol, lang)}: {formatValue(h.point.value, mode, activeCurrency)}
                  </text>
                ) : null
              )}
            </g>
          )}
        </svg>

        <div className="flex flex-wrap gap-3 mt-2 text-xs">
          {plotted.map((s, idx) => (
            <span key={s.symbol} className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-1 rounded" style={{ background: SERIES_COLORS[idx % SERIES_COLORS.length] }} />
              <LegendLabel symbol={s.symbol} lang={lang} />
            </span>
          ))}
          <span className="opacity-50">
            {mode === "price" ? `(${activeCurrency})` : lang === "zh" ? "(指數＝100)" : "(Index=100)"}
          </span>
        </div>
        {mode === "price" && (
          <p className="text-xs opacity-50 mt-0.5">{T.splitAdjustedNote}</p>
        )}
      </div>
    </div>
  );
}
