/**
 * PortfolioFitBlock — the Summary's portfolio weight before/after block
 * (Slice 6, spec 06 §9.5). Renders the PM's sized verdict against the live
 * portfolio: an action chip, the current→target weight bar (with Δ), the
 * suggested account, the sizing/concentration/conviction rationale, and the
 * snapshot-as-of provenance line.
 *
 * The caller (`report-summary.tsx`) gates this on `portfolioFit !== null AND
 * fit.hasPortfolioContext === true`, so this component always has a real
 * current weight to chart. It mirrors the PmHero `PortfolioFitPanel` idiom
 * (components/theses/pm-hero.tsx) for visual + semantic consistency between the
 * report view and the Summary.
 *
 * Real-money discipline (spec 06 §9.1/§9.5, RISK-P3):
 *   - EVERY figure traces to a named stored `portfolioFit` field — nothing is
 *     computed from thin air (the before/after bar only normalizes for display).
 *   - the snapshot-as-of provenance reads as "frozen, not live" so a stale
 *     snapshot is never mistaken for a live position.
 *   - a suggested account is shown only when the PM commit handler VALIDATED it
 *     to a real account label (empty string → omitted; never a fake account).
 *   - the not-advice line stays; it does not replace the persistent StatusBar
 *     disclaimer, it reinforces the methodology framing at the block.
 */
import type { ReactElement } from "react";
import type { PortfolioFit } from "./aggregate";
import { WeightBeforeAfter } from "./charts/weight-before-after";
import { cn } from "@/lib/utils";

export type PortfolioFitBlockProps = {
  fit: PortfolioFit;
};

/** Action-chip color by verb. `initiate`/`add` build a position (live);
 *  `trim`/`exit` reduce it (warn); `hold` is neutral (muted). Mirrors the
 *  PmHero `actionColor`. */
function actionColor(action: PortfolioFit["action"]): string {
  if (action === "initiate" || action === "add") return "var(--c-live)";
  if (action === "trim" || action === "exit") return "var(--c-warn)";
  return "var(--c-fg-muted)";
}

export function PortfolioFitBlock({
  fit,
}: PortfolioFitBlockProps): ReactElement {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-md border p-3",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      aria-label="Portfolio fit"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
          portfolio fit
        </span>
        <span
          className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
          style={{
            color: actionColor(fit.action),
            border: `1px solid ${actionColor(fit.action)}`,
          }}
        >
          {fit.action}
        </span>
      </div>

      <WeightBeforeAfter
        currentWeightPct={fit.currentWeightPct}
        targetWeightPct={fit.targetWeightPct}
        weightDeltaPct={fit.weightDeltaPct}
      />

      {fit.suggestedAccount !== "" ? (
        <p className="text-[12px] text-[color:var(--c-fg-muted)]">
          <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            suggested account
          </span>{" "}
          <span className="text-[color:var(--c-fg)]">{fit.suggestedAccount}</span>
        </p>
      ) : null}

      {fit.concentrationRisk !== "" ? (
        <p className="text-[12px] text-[color:var(--c-fg-muted)]">
          <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            concentration
          </span>{" "}
          {fit.concentrationRisk}
        </p>
      ) : null}

      {fit.sizingRationale !== "" ? (
        <p className="text-[12px] text-[color:var(--c-fg)]">
          <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            sizing
          </span>{" "}
          {fit.sizingRationale}
        </p>
      ) : null}

      {fit.convictionBasis !== "" ? (
        <p className="text-[12px] text-[color:var(--c-fg)]">
          <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            conviction
          </span>{" "}
          {fit.convictionBasis}
        </p>
      ) : null}

      <p className="text-[10px] leading-snug text-[color:var(--c-fg-faint)]">
        {fit.snapshotAsOf !== null && fit.snapshotAsOf !== ""
          ? `Portfolio snapshot as of ${fit.snapshotAsOf} — frozen at run start, not live. `
          : ""}
        Documented portfolio-management methodology — not financial advice.
      </p>
    </section>
  );
}
