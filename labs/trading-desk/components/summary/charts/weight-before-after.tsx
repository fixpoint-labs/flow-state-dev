/**
 * WeightBeforeAfter — the portfolio weight before/after bar for the Summary's
 * portfolio-fit block (Slice 6, spec 06 §9.5). Two CSS bars on a shared scale:
 * the position's CURRENT weight and the PM's TARGET weight, with the signed Δ.
 *
 * Real-money discipline: this component draws ONLY the three numbers it is
 * handed (`currentWeightPct`, `targetWeightPct`, `weightDeltaPct`) — all stored
 * fields the PM commit handler derived/emitted. It computes nothing from thin
 * air; the only math is normalizing the two weights to a shared bar scale so
 * they read comparably. The caller renders this only when the run actually had
 * a portfolio (`hasPortfolioContext`), so there is always a real current weight.
 *
 * Matches the existing inline CSS-bar idiom (charts/bar-group.tsx) — no chart
 * library, OKLCH design tokens, theme-aware.
 */
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

export type WeightBeforeAfterProps = {
  /** The position's current weight, % of NAV (stored echo field). */
  currentWeightPct: number;
  /** The PM's target weight, % of NAV (stored LLM field). */
  targetWeightPct: number;
  /** targetWeightPct − currentWeightPct (stored echo field). */
  weightDeltaPct: number;
};

/** Bar fill color by row: target uses the accent, current the muted surface. */
function deltaColor(delta: number): string {
  if (delta > 0) return "var(--c-live)";
  if (delta < 0) return "var(--c-warn)";
  return "var(--c-fg-muted)";
}

export function WeightBeforeAfter({
  currentWeightPct,
  targetWeightPct,
  weightDeltaPct,
}: WeightBeforeAfterProps): ReactElement {
  // Shared scale: the larger of the two weights (floored at a small positive so
  // a 0%→0% pair doesn't divide by zero). No fabricated ceiling — the scale is
  // derived purely from the two stored weights.
  const scaleMax = Math.max(currentWeightPct, targetWeightPct, 0.0001);
  const rows: Array<{ label: string; value: number; color: string }> = [
    { label: "current", value: currentWeightPct, color: "var(--c-surface-2)" },
    { label: "target", value: targetWeightPct, color: "var(--c-accent)" },
  ];
  const deltaText = `${weightDeltaPct >= 0 ? "+" : ""}${weightDeltaPct.toFixed(1)}%`;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      aria-label="Portfolio weight before/after"
    >
      {rows.map((row) => {
        const pct = Math.min(1, Math.max(0, row.value / scaleMax));
        return (
          <div key={row.label} className="flex items-center gap-2">
            <span className="w-16 shrink-0 font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
              {row.label}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--c-surface-2)]">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct * 100}%`, backgroundColor: row.color }}
              />
            </div>
            <span className="w-12 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-[color:var(--c-fg-muted)]">
              {row.value.toFixed(1)}%
            </span>
          </div>
        );
      })}
      <div className="flex items-center justify-end">
        <span
          className="font-mono text-[10px] uppercase tracking-wider"
          style={{ color: deltaColor(weightDeltaPct) }}
        >
          Δ {deltaText}
        </span>
      </div>
    </div>
  );
}
