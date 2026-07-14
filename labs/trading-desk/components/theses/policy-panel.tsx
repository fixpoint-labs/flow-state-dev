/**
 * Portfolio-mandate policy-fit panel (FIX-761) — how the household's durable
 * mandate (IPS) shaped the position size.
 *
 * Reads the PM memo's stored `policyDecision` mirror — the verdict + clamp flags
 * were derived deterministically at PM-commit (never from the LLM); the two
 * narrative reads are the PM's `policyFit`. This component computes nothing; the
 * caller gates it on `decision !== null`, so a mandate-blind run omits the panel
 * cleanly (BP-010).
 *
 * Real-money discipline: the panel states which constraints are HARD (the
 * max-position cap and the exclusion no-add, enforced at commit) versus ADVISORY;
 * the copy frames the mandate as a documented, user-set policy, not advice.
 */
import type { ReactElement } from "react";
import type { PolicyDecision } from "@/src/flows/analysis/resources";
import { cn } from "@/lib/utils";

export type PolicyPanelProps = {
  decision: PolicyDecision;
};

const VERDICT_LABEL: Record<PolicyDecision["policyVerdict"], string> = {
  "within-policy": "within policy",
  capped: "capped to policy",
  excluded: "excluded (no-add)",
  unenforced: "cap not enforced",
  "no-mandate": "no mandate",
};

function verdictColor(verdict: PolicyDecision["policyVerdict"]): string {
  if (verdict === "excluded") return "var(--c-warn)";
  if (verdict === "capped") return "var(--c-warn)";
  // "unenforced" is not a compliance claim — read it as cautionary, not green.
  if (verdict === "unenforced") return "var(--c-warn)";
  return "var(--c-live)";
}

export function PolicyPanel({ decision }: PolicyPanelProps): ReactElement {
  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      aria-label="Portfolio mandate policy fit"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
          portfolio mandate
        </span>
        <span
          className="rounded-sm px-1.5 py-0.5 text-[10.5px] font-medium text-white"
          style={{ backgroundColor: verdictColor(decision.policyVerdict) }}
        >
          {VERDICT_LABEL[decision.policyVerdict]}
        </span>
      </div>

      {/* Clamp badges — a HARD constraint that actually fired (an enforced
          no-add/cap requires a known household weight). When the weight is
          unknown (held-but-unpriced) the clamp was SKIPPED, so we show a
          skipped-enforcement note below rather than an "enforced" badge. */}
      {decision.householdWeightKnown && (decision.positionCapClamped || decision.excluded) ? (
        <div className="flex flex-wrap items-center gap-2 text-[10.5px]">
          {decision.excluded ? (
            <span className="rounded-sm border border-[color:var(--c-warn)]/40 bg-[color:var(--c-warn)]/10 px-1.5 py-0.5 text-[color:var(--c-warn)]">
              excluded — not added
            </span>
          ) : null}
          {decision.positionCapClamped ? (
            <span className="rounded-sm border border-[color:var(--c-warn)]/40 bg-[color:var(--c-warn)]/10 px-1.5 py-0.5 text-[color:var(--c-warn)]">
              size capped from {decision.preGatePolicyTargetPct.toFixed(1)}% to the position cap
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Held-but-unpriced honesty: the clamp was skipped, NOT satisfied — never
          present it as an enforced no-add. The action verb is still forced away
          from add for an excluded name (writer), so this is only a size caveat. */}
      {!decision.householdWeightKnown ? (
        <p className="text-[10.5px] text-[color:var(--c-fg-faint)]">
          {decision.excluded
            ? "This name is on the exclusion list, but the held position could not be priced, so the no-add size floor could not be computed for this run — the size is not mandate-constrained here (the decision is still not an add)."
            : "The held position could not be priced, so the cap could not be enforced without a market price — treat the size as unconstrained by the mandate for this run."}
        </p>
      ) : null}

      {decision.constraintRead.trim().length > 0 ? (
        <p className="text-[11px] text-[color:var(--c-fg)]">{decision.constraintRead}</p>
      ) : null}
      {decision.allocationRead.trim().length > 0 ? (
        <p className="text-[11px] text-[color:var(--c-fg-muted)]">{decision.allocationRead}</p>
      ) : null}

      <p className="text-[9.5px] text-[color:var(--c-fg-faint)]">
        A documented, user-set policy — not financial advice. The cap and exclusions
        are enforced deterministically; target allocation and minimum cash are
        advisory context.
      </p>
    </section>
  );
}
