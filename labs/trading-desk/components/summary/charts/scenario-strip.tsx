/**
 * ScenarioStrip — the Summary's scenario probability strip. A restyle of the
 * PmHero scenario strip (pm-hero.tsx L122-168): one proportionally-flexed bar
 * per scenario, the primary scenario highlighted in the accent token.
 *
 * Reads only already-stored scenario buckets (name + probability + isPrimary)
 * from the aggregate — it computes nothing. Probabilities are stored 0..1 and
 * rendered as whole percents.
 */
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

export type ScenarioStripItem = {
  name: string;
  probability: number;
  isPrimary: boolean;
};

export type ScenarioStripProps = {
  scenarios: ReadonlyArray<ScenarioStripItem>;
  distribution: string | null;
};

export function ScenarioStrip({
  scenarios,
  distribution,
}: ScenarioStripProps): ReactElement {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      aria-label="Scenario distribution"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
          scenarios
        </span>
        {distribution !== null ? (
          <span className="text-[10.5px] text-[color:var(--c-fg-muted)]">
            {distribution}
          </span>
        ) : null}
      </div>
      <div className="flex gap-0.5">
        {scenarios.map((sc) => (
          <div
            key={sc.name}
            className="flex min-w-0 flex-col items-center gap-1"
            style={{ flex: Math.max(sc.probability, 0.01) }}
            title={sc.name}
          >
            <div
              className={cn(
                "h-1.5 w-full rounded-sm",
                sc.isPrimary
                  ? "bg-[color:var(--c-accent)]"
                  : "bg-[color:var(--c-surface-2)]",
              )}
            />
            <span
              className={cn(
                "max-w-full truncate text-center font-mono text-[8.5px] leading-tight",
                sc.isPrimary
                  ? "text-[color:var(--c-fg)]"
                  : "text-[color:var(--c-fg-faint)]",
              )}
            >
              {(sc.probability * 100).toFixed(0)}%
            </span>
            <span className="max-w-full truncate text-center text-[8.5px] leading-tight text-[color:var(--c-fg-faint)]">
              {sc.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
