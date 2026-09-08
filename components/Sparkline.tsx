"use client";

import { useMemo } from "react";
import { ChartSeries, Currency } from "@/lib/types";
import { SERIES_COLORS } from "@/components/PerformanceChart";

/**
 * The thumbnail a comparison shows while it sits collapsed in the gallery —
 * every symbol's growth curve, indexed to 100 at the window's start, with no
 * axes, labels or ticks.
 *
 * Indexed rather than priced because the tile is ~280px wide: a $600 symbol
 * plotted against a $40 one flattens the cheaper line into the baseline, and a
 * shape nobody can read is worse than no picture. Indexing puts every series on
 * the same footing, which is the one question a thumbnail can answer — who
 * pulled ahead — leaving levels to the full chart.
 */
export default function Sparkline({
  series,
  mixedCurrencies,
}: {
  series: ChartSeries[];
  mixedCurrencies: boolean;
}) {
  const paths = useMemo(() => {
    // Same default the full chart opens on, so the thumbnail and the expanded
    // chart never disagree about which currency is being drawn.
    const currency: Currency = mixedCurrencies ? "USD" : series[0]?.currency ?? "USD";

    const indexed = series.map((s) => {
      const values: number[] = [];
      let base: number | null = null;
      for (const p of s.points) {
        const raw = currency === "USD" ? p.priceUSD : p.priceTWD;
        if (raw === null || raw <= 0) continue;
        if (base === null) base = raw;
        values.push((raw / base) * 100);
      }
      return values;
    });

    const all = indexed.flat();
    if (all.length < 2) return [];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const span = hi - lo || 1;

    return indexed.flatMap((values, idx) => {
      if (values.length < 2) return [];
      const step = 100 / (values.length - 1);
      const d = values
        .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(2)} ${(38 - ((v - lo) / span) * 36).toFixed(2)}`)
        .join(" ");
      return [{ d, color: SERIES_COLORS[idx % SERIES_COLORS.length] }];
    });
  }, [series, mixedCurrencies]);

  if (paths.length === 0) return null;

  return (
    <svg
      aria-hidden
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      className="w-full"
      style={{ height: 64, display: "block" }}
    >
      {paths.map((p) => (
        <path
          key={p.color + p.d.slice(0, 16)}
          d={p.d}
          fill="none"
          stroke={p.color}
          strokeWidth={1.25}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
