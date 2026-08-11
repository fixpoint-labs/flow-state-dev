/**
 * RiskPanel — the Summary's risk & dependencies block: critical risks from the
 * Phase 4 risk-assessment memo (severity glyph + who raised it), that memo's
 * confidence-calibration verdict and the adjustments it recommended, and the
 * PM's key dependencies.
 *
 * Reads only stored fields via the aggregate. Renders nothing when every section
 * is empty (no empty chrome). A null calibration renders no calibration line —
 * it is never defaulted to "calibrated", which would assert a review nobody
 * performed. The not-advice framing is carried by the persistent StatusBar
 * disclaimer.
 */
import type { ReactElement } from "react";
import type { RiskVerdict } from "./aggregate";
import { cn } from "@/lib/utils";

export type RiskPanelProps = {
  criticalRisks: ReadonlyArray<{
    description: string;
    severity: "high" | "medium" | "low";
    raisedBy: string;
  }>;
  /** Calibration verdict + recommended adjustments from the same risk memo. */
  verdict: RiskVerdict;
  keyDependencies: ReadonlyArray<string>;
};

/** The three adjustment axes the risk consolidator can recommend, in the order
 *  the risk memo declares them. */
const ADJUSTMENT_AXES = [
  { key: "sizing", label: "sizing" },
  { key: "holdingPeriod", label: "holding period" },
  { key: "invalidation", label: "invalidation" },
] as const;

const CALIBRATION_CLASS: Record<
  NonNullable<RiskVerdict["confidenceCalibration"]>,
  string
> = {
  overconfident: "text-[color:var(--c-warn)]",
  calibrated: "text-[color:var(--c-live)]",
  underconfident: "text-[color:var(--c-warn)]",
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
  verdict,
  keyDependencies,
}: RiskPanelProps): ReactElement | null {
  const adjustments = ADJUSTMENT_AXES.flatMap(({ key, label }) => {
    const entry = verdict.recommendedAdjustments?.[key] ?? null;
    return entry === null ? [] : [{ label, ...entry }];
  });
  const hasCalibration =
    verdict.confidenceCalibration !== null ||
    verdict.calibrationRationale !== null;

  if (
    criticalRisks.length === 0 &&
    keyDependencies.length === 0 &&
    adjustments.length === 0 &&
    !hasCalibration
  ) {
    return null;
  }

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

      {hasCalibration ? (
        <div className="flex flex-col gap-1">
          <h3 className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            Confidence calibration
          </h3>
          {verdict.confidenceCalibration !== null ? (
            <span
              className={cn(
                "font-mono text-[12px] uppercase tracking-wider",
                CALIBRATION_CLASS[verdict.confidenceCalibration],
              )}
            >
              {verdict.confidenceCalibration}
            </span>
          ) : null}
          {verdict.calibrationRationale !== null &&
          verdict.calibrationRationale !== "" ? (
            <p className="text-[12px] leading-relaxed text-[color:var(--c-fg)]">
              {verdict.calibrationRationale}
            </p>
          ) : null}
        </div>
      ) : null}

      {adjustments.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            Recommended adjustments
          </h3>
          <ul className="flex flex-col gap-1.5">
            {adjustments.map((adj) => (
              <li
                key={adj.label}
                className="flex items-baseline gap-2 text-[12px] text-[color:var(--c-fg)]"
              >
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-[color:var(--c-fg-muted)]">
                  {adj.label} {adj.direction}
                </span>
                <span>
                  {adj.rationale}{" "}
                  <span className="text-[color:var(--c-fg-faint)]">
                    ({adj.attributedTo})
                  </span>
                </span>
              </li>
            ))}
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
