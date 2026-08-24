"use client";

import { SymbolIndexSeries } from "@/lib/types";

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
  series: SymbolIndexSeries[];
  height?: number;
  indexLabel: string;
}

/**
 * Lightweight dependency-free SVG line chart showing each symbol's
 * price performance indexed to 100 at the start of the range.
 */
export default function PerformanceChart({ series, height = 260, indexLabel }: Props) {
  const width = 640;
  const padding = { top: 12, right: 12, bottom: 24, left: 44 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const validSeries = series.filter((s) => s.points.length > 1);
  if (validSeries.length === 0) return null;

  const allValues = validSeries.flatMap((s) => s.points.map((p) => p.value));
  const minV = Math.min(...allValues, 100);
  const maxV = Math.max(...allValues, 100);
  const pad = (maxV - minV) * 0.08 || 5;
  const yMin = minV - pad;
  const yMax = maxV + pad;

  const maxLen = Math.max(...validSeries.map((s) => s.points.length));

  function xFor(i: number, len: number) {
    // Align by proportional index position so different-length series still compare left-to-right.
    const ratio = len > 1 ? i / (len - 1) : 0;
    return padding.left + ratio * innerW;
  }
  function yFor(v: number) {
    const ratio = (v - yMin) / (yMax - yMin || 1);
    return padding.top + innerH - ratio * innerH;
  }

  const baselineY = yFor(100);

  const gridLines = 4;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ minWidth: 320, maxWidth: 720 }}
        role="img"
        aria-label="performance chart"
      >
        {/* grid */}
        {Array.from({ length: gridLines + 1 }).map((_, i) => {
          const v = yMin + ((yMax - yMin) * i) / gridLines;
          const y = yFor(v);
          return (
            <g key={i}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="var(--line)"
                strokeWidth={1}
              />
              <text x={4} y={y + 3} fontSize={9} fill="currentColor" opacity={0.6}>
                {Math.round(v)}
              </text>
            </g>
          );
        })}

        {/* baseline at 100 */}
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={baselineY}
          y2={baselineY}
          stroke="currentColor"
          strokeOpacity={0.3}
          strokeDasharray="3,3"
        />

        {/* series lines */}
        {validSeries.map((s, idx) => {
          const color = COLORS[idx % COLORS.length];
          const d = s.points
            .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i, s.points.length).toFixed(1)} ${yFor(p.value).toFixed(1)}`)
            .join(" ");
          return <path key={s.symbol} d={d} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />;
        })}

        {/* x-axis start/end labels */}
        <text x={padding.left} y={height - 6} fontSize={9} fill="currentColor" opacity={0.6}>
          {validSeries[0]?.points[0]?.date}
        </text>
        <text
          x={width - padding.right}
          y={height - 6}
          fontSize={9}
          fill="currentColor"
          opacity={0.6}
          textAnchor="end"
        >
          {validSeries[0]?.points[validSeries[0].points.length - 1]?.date}
        </text>
      </svg>

      <div className="flex flex-wrap gap-3 mt-2 text-xs">
        {validSeries.map((s, idx) => (
          <span key={s.symbol} className="flex items-center gap-1.5">
            <span
              className="inline-block w-4 h-1 rounded"
              style={{ background: COLORS[idx % COLORS.length] }}
            />
            {s.symbol}
          </span>
        ))}
        <span className="opacity-50">({indexLabel})</span>
      </div>
    </div>
  );
}
