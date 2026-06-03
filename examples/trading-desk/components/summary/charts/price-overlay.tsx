/**
 * PriceOverlay — inline-SVG close-price line with entry/stop/target/fair-value
 * horizontal overlays. No chart library, no interactivity, no ResizeObserver:
 * a static figure projected into a fixed viewBox.
 *
 * The series comes from the stored `priceHistory` resource slice (date + close
 * only). The overlay levels come from the trader memo (stop/target) and the
 * valuation spine (fair value); the latest close is drawn as a reference line.
 * Every level that falls outside the price domain widens the domain so it stays
 * visible. With fewer than two bars the caller renders the trade-levels fallback
 * instead — this component assumes a drawable series.
 *
 * Provenance honesty: the `source` tag is surfaced by the caller, not faked
 * here. This component only draws the numbers it is given.
 */
import type { ReactElement } from "react";

const VIEW_W = 600;
const VIEW_H = 160;

export type PriceOverlayLevel = {
  label: string;
  value: number;
  /** Token color, e.g. "var(--c-warn)". */
  color: string;
};

export type PriceOverlayProps = {
  bars: ReadonlyArray<{ date: string; close: number }>;
  levels: ReadonlyArray<PriceOverlayLevel>;
};

/** Project a value in [min, max] to a y pixel (inverted: high price = low y). */
function projectY(value: number, min: number, max: number): number {
  if (max === min) return VIEW_H / 2;
  return (1 - (value - min) / (max - min)) * VIEW_H;
}

export function PriceOverlay({ bars, levels }: PriceOverlayProps): ReactElement {
  const closes = bars.map((b) => b.close);
  // The domain spans the price series AND every overlay level, so out-of-range
  // levels (e.g. a stop below the lowest close) stay on-canvas.
  const domainValues = [...closes, ...levels.map((l) => l.value)];
  const min = Math.min(...domainValues);
  const max = Math.max(...domainValues);

  const points = bars
    .map((b, i) => {
      const x = bars.length === 1 ? 0 : (i / (bars.length - 1)) * VIEW_W;
      const y = projectY(b.close, min, max);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="h-40 w-full rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-surface)]"
        role="img"
        aria-label="Price history with trade levels"
      >
        {levels.map((level) => {
          const y = projectY(level.value, min, max);
          return (
            <line
              key={level.label}
              x1={0}
              x2={VIEW_W}
              y1={y}
              y2={y}
              stroke={level.color}
              strokeWidth={1}
              strokeDasharray="4 3"
              opacity={0.7}
            />
          );
        })}
        <polyline
          points={points}
          fill="none"
          stroke="var(--c-accent)"
          strokeWidth={1.5}
        />
      </svg>
      {/* Level legend below the chart — readable regardless of where the line
          lands inside the non-uniformly-scaled SVG. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {levels.map((level) => (
          <span
            key={level.label}
            className="flex items-center gap-1 font-mono text-[10px] text-[color:var(--c-fg-muted)]"
          >
            <span
              aria-hidden
              className="inline-block h-0.5 w-3"
              style={{ background: level.color }}
            />
            {level.label} {level.value}
          </span>
        ))}
      </div>
    </div>
  );
}
