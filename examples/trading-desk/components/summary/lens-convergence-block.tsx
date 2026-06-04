/**
 * LensConvergenceBlock — the Summary's investor-lens convergence card
 * (Slice 6, spec 06 §9). One cell per lens (stance-colored bar + label +
 * conviction), dissenters outlined so "this is philosophy-dependent" is visible,
 * a classification pill, and the three honesty lines.
 *
 * Dedicated card, NOT extra nodes in the conviction strip: the lens read
 * carries richer honesty data (per-lens dataGap, dissenters, classification,
 * the robustness framing) that a single dot on a -1..+1 axis cannot express,
 * and dropping that framing would breach the real-money gate (§1.6 / RISK-F6:
 * convergence is ROBUSTNESS across philosophies, NOT a probability of being
 * right). The card mirrors the PmHero `LensConvergenceStrip`
 * (components/theses/pm-hero.tsx) so the report view and the Summary read the
 * same signal identically.
 *
 * Every value is a stored field on the deterministic convergence mirror — the
 * convergence math is arithmetic over independent verdicts (FIX-655), never an
 * LLM narrative. This component computes nothing.
 *
 * The three required honesty lines (carried verbatim from the report-view
 * idiom):
 *   1. independent verdicts — not a debate (header label).
 *   2. applying each investor's documented methodology to the same evidence.
 *   3. robustness across philosophies, NOT "likely correct" / not advice.
 */
import type { ReactElement } from "react";
import type { LensConvergence } from "./aggregate";
import { cn } from "@/lib/utils";

export type LensConvergenceBlockProps = {
  convergence: LensConvergence;
};

/** Stance → bar color for the per-lens convergence cell. Mirrors PmHero. */
function stanceColor(stance: "bullish" | "neutral" | "bearish"): string {
  if (stance === "bullish") return "var(--c-live)";
  if (stance === "bearish") return "var(--c-warn)";
  return "var(--c-surface-2)";
}

/** Convergence classification → header pill color. Mirrors PmHero. */
function classificationColor(c: LensConvergence["classification"]): string {
  if (c === "convergent") return "var(--c-live)";
  if (c === "divergent") return "var(--c-warn)";
  return "var(--c-fg-muted)";
}

export function LensConvergenceBlock({
  convergence,
}: LensConvergenceBlockProps): ReactElement {
  const dissenters = new Set(convergence.dissenters);
  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      aria-label="Lens convergence"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
          lens pack · independent verdicts (not a debate)
        </span>
        <span
          className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
          style={{
            color: classificationColor(convergence.classification),
            border: `1px solid ${classificationColor(convergence.classification)}`,
          }}
        >
          {convergence.classification} · {convergence.majorityStance} · netLean{" "}
          {convergence.netLean >= 0 ? "+" : ""}
          {convergence.netLean.toFixed(2)}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {convergence.verdicts.map((v) => (
          <div
            key={v.lensId}
            className={cn(
              "flex min-w-[110px] flex-1 flex-col gap-1 rounded-sm p-1.5",
              dissenters.has(v.lensId)
                ? "border border-dashed border-[color:var(--c-fg-faint)]"
                : "border border-transparent",
            )}
            title={`${v.attribution} — ${v.verdict}`}
          >
            <div
              className="h-1.5 w-full rounded-sm"
              style={{ backgroundColor: stanceColor(v.stance) }}
            />
            <span className="truncate text-[11px] text-[color:var(--c-fg)]">
              {v.label}
            </span>
            <span className="font-mono text-[9.5px] text-[color:var(--c-fg-faint)]">
              {v.stance} · {v.conviction.toFixed(2)}
            </span>
            {v.dataGap !== "" ? (
              <span className="text-[9px] leading-tight text-[color:var(--c-warn)]">
                gap: {v.dataGap}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <p className="text-[10px] leading-snug text-[color:var(--c-fg-faint)]">
        Applying each investor's documented methodology to the same evidence.
        Convergence means the call is robust across philosophies — not that it is
        likely correct. Divergence is information, not failure.
      </p>
    </section>
  );
}
