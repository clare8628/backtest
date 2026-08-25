"use client";

import { useMemo, useRef, useState } from "react";
import { ChartSeries, Currency } from "@/lib/types";
import { Lang, t } from "@/lib/i18n";

// 高對比顏色組合
const COLORS = [
  "#2E7D32", // deep green
  "#D32F2F", // bright red
  "#1976D2", // bright blue
  "#F57C00", // orange
  "#7B1FA2", // purple
  "#0097A7", // cyan
  "#C2185B", // pink
  "#558B2F", // olive
];

interface Props {
  series: ChartSeries[];
  mixedCurrencies: boolean;
  lang: Lang;
  height?: number;
}

type ChartMode = "price" | "index";

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

  if (plotted.length === 0) return null;

  const allT = plotted.flatMap((s) => s.points.map((p) => p.t));
  const allV = plotted.flatMap((s) => s.points.map((p) => p.value));
  const tMin = Math.min(...allT);
  const tMax = Math.max(...allT);
  const minV = Math.min(...allV);
  const maxV = Math.max(...allV);
  const vPad = (maxV - minV) * 0.08 || maxV * 0.1 || 1;
  const yMin = Math.max(0, minV - vPad);
  const yMax = maxV + vPad;

  function xFor(t: number) {
    const ratio = tMax > tMin ? (t - tMin) / (tMax - tMin) : 0;
    return padding.left + ratio * innerW;
  }
  function yFor(v: number) {
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

  // Tooltip box: flip to the left of the cursor if it would overflow the right edge.
  const tooltipW = 150;
  const tooltipX =
    hoverX !== null ? (hoverX + tooltipW + 8 > width ? hoverX - tooltipW - 10 : hoverX + 10) : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap justify-between items-center gap-2 text-xs">
        <div className="flex gap-1">
          {(["price", "index"] as ChartMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="px-2 py-1 rounded-md"
              style={{
                border: "1px solid var(--line)",
                background: mode === m ? "var(--matsu)" : "transparent",
                color: mode === m ? "white" : "inherit",
              }}
            >
              {m === "price" ? T.chartModePrice : T.chartModeIndex}
            </button>
          ))}
        </div>
        {mixedCurrencies && (
          <div className="flex gap-1">
            {(["USD", "TWD"] as Currency[]).map((c) => (
              <button
                key={c}
                onClick={() => setDisplayCurrency(c)}
                className="px-2 py-1 rounded-md"
                style={{
                  border: "1px solid var(--line)",
                  background: activeCurrency === c ? "var(--matsu)" : "transparent",
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
            const v = yMin + ((yMax - yMin) * i) / gridLines;
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
            const color = COLORS[idx % COLORS.length];
            const d = s.points
              .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.t).toFixed(1)} ${yFor(p.value).toFixed(1)}`)
              .join(" ");
            return <path key={s.symbol} d={d} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />;
          })}

          {/* hover guideline + dots */}
          {hoverX !== null && (
            <>
              <line x1={hoverX} x2={hoverX} y1={padding.top} y2={height - padding.bottom} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} />
              {hoverPoints?.map((h, idx) =>
                h.point ? (
                  <circle key={h.symbol} cx={xFor(h.point.t)} cy={yFor(h.point.value)} r={3.5} fill={COLORS[idx % COLORS.length]} stroke="var(--washi)" strokeWidth={1.5} />
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
                fill="var(--washi)"
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
                  <text key={h.symbol} x={8} y={41 + idx * 14} fontSize={9.5} fill={COLORS[idx % COLORS.length]}>
                    {h.symbol}: {formatValue(h.point.value, mode, activeCurrency)}
                  </text>
                ) : null
              )}
            </g>
          )}
        </svg>

        <div className="flex flex-wrap gap-3 mt-2 text-xs">
          {plotted.map((s, idx) => (
            <span key={s.symbol} className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-1 rounded" style={{ background: COLORS[idx % COLORS.length] }} />
              {s.symbol}
            </span>
          ))}
          <span className="opacity-50">
            {mode === "price" ? `(${activeCurrency})` : lang === "zh" ? "(指數＝100)" : "(Index=100)"}
          </span>
        </div>
      </div>
    </div>
  );
}
