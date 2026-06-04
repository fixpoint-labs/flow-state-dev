/**
 * BarGroup — a generic horizontal labeled-bar group, inline SVG-free (CSS bars
 * over the OKLCH design tokens). Used for the valuation factor scores.
 *
 * Each row is `{ label, value }` where `value` is on a fixed 0..`max` scale
 * (factor scores are ~0..100). A `null` value renders a muted "—" with no bar —
 * a missing score reads as missing, never as a fabricated 0 (BP-020 at the UI
 * layer). The component does no math beyond clamping to `[0, max]`.
 */
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

export type BarGroupRow = {
  label: string;
  value: number | null;
};

export type BarGroupProps = {
  rows: ReadonlyArray<BarGroupRow>;
  /** Scale ceiling; bar width = value / max. Defaults to 100 (score scale). */
  max?: number;
};

export function BarGroup({ rows, max = 100 }: BarGroupProps): ReactElement {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
    >
      {rows.map((row) => {
        const pct =
          row.value === null
            ? null
            : Math.min(1, Math.max(0, row.value / max));
        return (
          <div key={row.label} className="flex items-center gap-2">
            <span className="w-16 shrink-0 font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
              {row.label}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--c-surface-2)]">
              {pct !== null ? (
                <div
                  className="h-full rounded-full bg-[color:var(--c-accent)]"
                  style={{ width: `${pct * 100}%` }}
                />
              ) : null}
            </div>
            <span className="w-9 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-[color:var(--c-fg-muted)]">
              {row.value === null ? "—" : Math.round(row.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
