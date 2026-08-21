/**
 * RiskPanel — the Summary's risk & dependencies block: critical risks from the
 * Phase 4 risk-assessment memo (severity glyph + who raised it), that memo's
 * confidence-calibration verdict and the adjustments it recommended, and the
 * PM's key dependencies.
 *
 * Reads only stored fields via the aggregate. Renders nothing when every section
 * is empty (no empty chrome), and never defaults an unpublished calibration to
 * "calibrated" — that would assert a review nobody performed. The not-advice
 * framing is carried by the persistent StatusBar disclaimer.
 *
 * The severity glyphs, the calibration colours, and the three adjustment axes
 * live in `components/risk-vocabulary.ts`, shared with the Theses tab's
 * per-persona risk card. Import them; do not re-spell them here.
 */
import type { ReactElement } from "react";
import type { RiskVerdict } from "./aggregate";
import {
  ADJUSTMENT_AXES,
  CALIBRATION_CLASS,
  SEVERITY,
} from "@/components/risk-vocabulary";
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

/**
 * The calibration rationale the panel will actually show, or null.
 *
 * One helper rather than two conditions, because the section header and the
 * paragraph must agree: gating the header on `!== null` while the paragraph also
 * rejected `""` put a "Confidence calibration" heading over an empty section
 * whenever the risk memo emitted a blank rationale and no verdict.
 */
export function shownRationale(verdict: RiskVerdict): string | null {
  const r = verdict.calibrationRationale;
  return r === null || r === "" ? null : r;
}

export function RiskPanel({
  criticalRisks,
  verdict,
  keyDependencies,
}: RiskPanelProps): ReactElement | null {
  const adjustments = ADJUSTMENT_AXES.flatMap(({ key, label }) => {
    const entry = verdict.recommendedAdjustments?.[key] ?? null;
    return entry === null ? [] : [{ label, ...entry }];
  });
  const rationale = shownRationale(verdict);
  const hasCalibration =
    verdict.confidenceCalibration !== null || rationale !== null;

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
          {rationale !== null ? (
            <p className="text-[12px] leading-relaxed text-[color:var(--c-fg)]">
              {rationale}
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
