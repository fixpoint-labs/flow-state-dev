/**
 * RiskPanel — the Summary's risk & dependencies block: critical risks from the
 * Phase 4 risk-assessment memo (severity glyph + who raised it) and the PM's
 * key dependencies.
 *
 * Reads only stored fields via the aggregate. Renders nothing when both lists
 * are empty (no empty chrome). The not-advice framing is carried by the
 * persistent StatusBar disclaimer.
 */
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

export type RiskPanelProps = {
  criticalRisks: ReadonlyArray<{
    description: string;
    severity: "high" | "medium" | "low";
    raisedBy: string;
  }>;
  keyDependencies: ReadonlyArray<string>;
};

const SEVERITY: Record<
  RiskPanelProps["criticalRisks"][number]["severity"],
  { glyph: string; label: string; cls: string }
> = {
  high: { glyph: "▲", label: "HIGH", cls: "text-[color:var(--c-warn)]" },
  medium: { glyph: "●", label: "MED", cls: "text-[color:var(--c-fg)]" },
  low: { glyph: "·", label: "LOW", cls: "text-[color:var(--c-fg-muted)]" },
};

export function RiskPanel({
  criticalRisks,
  keyDependencies,
}: RiskPanelProps): ReactElement | null {
  if (criticalRisks.length === 0 && keyDependencies.length === 0) return null;

  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-md border p-3",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      aria-label="Risks and dependencies"
    >
      {criticalRisks.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            Critical risks
          </h3>
          <ul className="flex flex-col gap-1.5">
            {criticalRisks.map((r, i) => {
              const sev = SEVERITY[r.severity];
              return (
                <li
                  key={i}
                  className="flex items-baseline gap-2 text-[12px] text-[color:var(--c-fg)]"
                >
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[10px] uppercase tracking-wider",
                      sev.cls,
                    )}
                  >
                    {sev.glyph} {sev.label}
                  </span>
                  <span>
                    {r.description}{" "}
                    <span className="text-[color:var(--c-fg-faint)]">
                      ({r.raisedBy})
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {keyDependencies.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            Key dependencies
          </h3>
          <ul className="ml-3 list-disc text-[12px] leading-relaxed text-[color:var(--c-fg)]">
            {keyDependencies.map((dep, i) => (
              <li key={i}>{dep}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
