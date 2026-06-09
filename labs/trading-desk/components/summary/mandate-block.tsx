/**
 * MandateBlock — the Summary's risk-appetite mandate verdict (FIX-752). The
 * third decision axis (appetite) beside the portfolio-fit weight block
 * (mechanics) and the lens-convergence card (philosophy).
 *
 * Reads straight off the PM memo's stored `mandateDecision` mirror — the verdict
 * + gate flags were derived deterministically at PM-commit (never from the LLM),
 * and the compact reward-to-risk figure comes from the resource. This component
 * computes nothing. It mirrors the PmHero `MandatePanel`
 * (components/theses/pm-hero.tsx) so the report view and the Summary read the
 * same signal identically.
 *
 * The caller (`report-summary.tsx`) gates this on `mandateDecision !== null`, so
 * a mandate-blind run omits the block cleanly — never a stubbed verdict.
 *
 * Real-money discipline: every figure traces to a stored field; a missing GLR /
 * EV / worst case renders `—`, never fabricated. The copy frames this as a
 * documented, user-settable methodology — not financial advice.
 */
import type { ReactElement } from "react";
import type { MandateDecision } from "./aggregate";
import { cn } from "@/lib/utils";

export type MandateBlockProps = {
  decision: MandateDecision;
};

/** Verdict → classification-pill color. `clears` reads positive (live); `fails`
 *  reads cautionary (warn). Mirrors the PmHero `verdictColor`. */
function verdictColor(verdict: MandateDecision["verdict"]): string {
  return verdict === "clears" ? "var(--c-live)" : "var(--c-warn)";
}

/** Format a signed percentage figure, or `—` when absent. Mirrors PmHero. */
function pctOrDash(value: number | null, signed = false): string {
  if (value === null) return "—";
  const sign = signed && value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function MandateBlock({ decision }: MandateBlockProps): ReactElement {
  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      aria-label="Risk-appetite mandate"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            risk-appetite mandate
          </span>
          <span className="rounded-sm border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-1.5 py-0.5 text-[10.5px] text-[color:var(--c-fg)]">
            {decision.mandateLabel}
          </span>
        </div>
        <span
          className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
          style={{
            color: verdictColor(decision.verdict),
            border: `1px solid ${verdictColor(decision.verdict)}`,
          }}
        >
          {decision.verdict}
        </span>
      </div>

      <dl
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        aria-label="Reward-to-risk figure"
      >
        <div className="flex flex-col gap-0.5">
          <dt className="font-mono text-[9px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            loss-adj GLR
          </dt>
          <dd className="font-mono text-[12px] text-[color:var(--c-fg)]">
            {decision.noDownside
              ? "no downside"
              : decision.lossAdjustedGlr !== null
                ? decision.lossAdjustedGlr.toFixed(2)
                : "—"}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="font-mono text-[9px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            exp value
          </dt>
          <dd className="font-mono text-[12px] text-[color:var(--c-fg)]">
            {pctOrDash(decision.expectedValuePct, true)}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="font-mono text-[9px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            worst case
          </dt>
          <dd className="font-mono text-[12px] text-[color:var(--c-fg)]">
            {pctOrDash(decision.worstCaseReturnPct, true)}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="font-mono text-[9px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            evidence
          </dt>
          <dd className="font-mono text-[12px] text-[color:var(--c-fg)]">
            {decision.evidenceBasis}
          </dd>
        </div>
      </dl>

      {decision.sizeClamped || decision.capacityVetoed ? (
        <div className="flex flex-wrap gap-2">
          {decision.capacityVetoed ? (
            <span
              className="rounded-sm px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--c-warn)", border: "1px solid var(--c-warn)" }}
            >
              capacity veto
            </span>
          ) : null}
          {decision.sizeClamped ? (
            <span
              className="rounded-sm px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--c-warn)", border: "1px solid var(--c-warn)" }}
            >
              size clamped
            </span>
          ) : null}
        </div>
      ) : null}

      {decision.rewardToRiskRead !== "" ? (
        <p className="text-[12px] text-[color:var(--c-fg)]">
          <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            reward-to-risk
          </span>{" "}
          {decision.rewardToRiskRead}
        </p>
      ) : null}

      {decision.sizeStance !== "" ? (
        <p className="text-[12px] text-[color:var(--c-fg)]">
          <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            size stance
          </span>{" "}
          {decision.sizeStance}
        </p>
      ) : null}

      {decision.overrideReason !== "" ? (
        <p className="text-[12px] text-[color:var(--c-fg-muted)]">
          <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            override
          </span>{" "}
          {decision.overrideReason}
        </p>
      ) : null}

      <p className="text-[10px] leading-snug text-[color:var(--c-fg-faint)]">
        Size gated against the mandate's documented risk dials — a documented,
        user-settable methodology, not financial advice.
      </p>
    </section>
  );
}
