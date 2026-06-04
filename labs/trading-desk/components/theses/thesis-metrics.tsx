/**
 * thesis-metrics — auto-fit grid of label/value pairs.
 *
 * Used by ThesisHeader (analysts, researchers, etc.). PMHero ships its own
 * featured-metrics layout.
 */
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

export type ThesisMetricsProps = {
  metrics: Record<string, string>;
};

export function ThesisMetrics({ metrics }: ThesisMetricsProps): ReactElement | null {
  const entries = Object.entries(metrics);
  if (entries.length === 0) return null;
  return (
    <div
      className={cn(
        "grid gap-2 rounded-md border p-3",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))" }}
    >
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-col gap-0.5">
          <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            {key}
          </span>
          <span className="font-mono text-[12px] text-[color:var(--c-fg)]">{value}</span>
        </div>
      ))}
    </div>
  );
}
