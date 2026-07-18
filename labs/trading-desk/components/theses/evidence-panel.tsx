/**
 * Evidence-sufficiency gate panel (FIX-781) — why (or whether) the run was
 * allowed to add new exposure.
 *
 * Reads the PM memo's stored `evidenceDecision` mirror — the verdict + clamp
 * flags were derived deterministically at PM-commit from the valuation-spine and
 * reward-to-risk evidence bases plus the `criticalDataThin` tool signal (never
 * the LLM). This component computes nothing; the caller gates it on
 * `decision !== null`, so a legacy run (pre-feature) omits the panel cleanly
 * (BP-010).
 *
 * Real-money discipline: on insufficient evidence the panel states plainly that
 * NEW exposure was withheld — thin/absent evidence is non-evidence in both
 * directions, never a bearish signal — and names which layer was thin. The gate
 * is always-on and non-overridable; the copy frames it as a hard capital gate,
 * not advice.
 */
import type { ReactElement } from "react";
import type { EvidenceDecision } from "@/flows/analysis/resources";
import { cn } from "@/lib/utils";

export type EvidencePanelProps = {
  decision: EvidenceDecision;
};

/** The thin/absent evidence layers, in the order the gate evaluates them. Each is
 *  named only when it actually contributed to an insufficient verdict. */
function thinLayers(decision: EvidenceDecision): string[] {
  const layers: string[] = [];
  if (decision.spineEvidenceBasis !== "sufficient" || decision.spineLowConfidence) {
    layers.push(
      decision.spineEvidenceBasis == null ? "valuation spine absent" : "valuation spine thin",
    );
  }
  if (decision.rewardToRiskEvidenceBasis !== "sufficient") {
    layers.push(
      decision.rewardToRiskEvidenceBasis == null
        ? "reward-to-risk absent"
        : "reward-to-risk thin",
    );
  }
  if (decision.criticalDataThin) layers.push("a primary financial input unavailable");
  return layers;
}

export function EvidencePanel({ decision }: EvidencePanelProps): ReactElement {
  const insufficient = decision.verdict === "insufficient-evidence";
  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      aria-label="Evidence-sufficiency gate"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
          evidence
        </span>
        <span
          className="rounded-sm px-1.5 py-0.5 text-[10.5px] font-medium text-white"
          style={{ backgroundColor: insufficient ? "var(--c-warn)" : "var(--c-live)" }}
        >
          {insufficient ? "insufficient — no-add" : "sufficient"}
        </span>
      </div>

      {insufficient ? (
        <>
          {thinLayers(decision).length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-[10.5px]">
              {thinLayers(decision).map((layer) => (
                <span
                  key={layer}
                  className="rounded-sm border border-[color:var(--c-warn)]/40 bg-[color:var(--c-warn)]/10 px-1.5 py-0.5 text-[color:var(--c-warn)]"
                >
                  {layer}
                </span>
              ))}
            </div>
          ) : null}

          {decision.actionDowngraded || decision.sizeClamped ? (
            <div className="flex flex-wrap items-center gap-2 text-[10.5px]">
              {decision.actionDowngraded ? (
                <span className="rounded-sm border border-[color:var(--c-border)] px-1.5 py-0.5 text-[color:var(--c-fg-muted)]">
                  {decision.preGateEvidenceAction} → hold
                </span>
              ) : null}
              {decision.sizeClamped ? (
                <span className="rounded-sm border border-[color:var(--c-border)] px-1.5 py-0.5 text-[color:var(--c-fg-muted)]">
                  size capped from {decision.preGateEvidenceTargetPct.toFixed(1)}% to the current position
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Held-but-unpriced honesty: the numeric clamp was skipped (no NAV-basis
              weight to cap against), so only the action enforces the no-add here —
              never present the pass-through size as mandate-satisfied. */}
          {!decision.currentWeightKnown ? (
            <p className="text-[10.5px] text-[color:var(--c-fg-faint)]">
              The current position could not be priced, so the size was not capped
              numerically — the no-add is enforced by holding rather than adding.
            </p>
          ) : null}

          <p className="text-[11px] text-[color:var(--c-fg)]">
            The evidence behind this call was too thin to authorize new exposure.
            Missing or thin inputs are non-evidence in both directions — this is a
            no-add, not a bearish signal, and it does not change the rating.
          </p>
        </>
      ) : (
        <p className="text-[11px] text-[color:var(--c-fg-muted)]">
          The valuation spine, reward-to-risk figure, and primary financial inputs
          were all present and sufficient to size the position.
        </p>
      )}

      <p className="text-[9.5px] text-[color:var(--c-fg-faint)]">
        An always-on, non-overridable capital gate — not financial advice. It caps
        new exposure on thin evidence and never touches the rating.
      </p>
    </section>
  );
}
