/**
 * The risk debate's shared display vocabulary: how a severity is drawn, and
 * what the three adjustment axes are called and in what order.
 *
 * Extracted from `components/summary/risk-panel.tsx` (FIX-1061), where both
 * were module-private, at the point a SECOND surface needed them — the Theses
 * tab's per-persona risk card. Two glyph maps diverge the first time anyone
 * restyles a severity, and two axis lists diverge the first time anyone renames
 * an axis, so both live here and both surfaces import them.
 *
 * Presentation only. Neither constant decides anything: the severities and the
 * axis directions are stored fields the risk memos committed, and nothing here
 * infers, defaults, or re-orders a verdict.
 *
 * A leaf beside `agent-badge.tsx` rather than under `summary/` or `theses/`,
 * because it now belongs to neither one.
 */

/** The severity a risk was raised at, as the risk schemas spell it. */
export type RiskSeverity = "high" | "medium" | "low";

/** Glyph + short label + colour class for one severity. `cls` is the accent the
 *  glyph and label share; the description beside them stays body-coloured. */
export type RiskSeverityStyle = {
  glyph: string;
  label: string;
  cls: string;
};

export const SEVERITY: Record<RiskSeverity, RiskSeverityStyle> = {
  high: { glyph: "▲", label: "HIGH", cls: "text-[color:var(--c-warn)]" },
  medium: { glyph: "●", label: "MED", cls: "text-[color:var(--c-fg)]" },
  low: { glyph: "·", label: "LOW", cls: "text-[color:var(--c-fg-muted)]" },
};

/** The three adjustment axes a risk memo can move, in the order the risk
 *  schemas declare them. The `key` indexes both `proposedAdjustments` (a
 *  persona's bare direction) and `recommendedAdjustments` (the consolidated
 *  assessment's direction + rationale + attribution); the `label` is what every
 *  surface calls the axis, so `holdingPeriod` reads as "holding period" in one
 *  place rather than two. */
export const ADJUSTMENT_AXES = [
  { key: "sizing", label: "sizing" },
  { key: "holdingPeriod", label: "holding period" },
  { key: "invalidation", label: "invalidation" },
] as const;

/** One adjustment axis key — `"sizing" | "holdingPeriod" | "invalidation"`. */
export type AdjustmentAxisKey = (typeof ADJUSTMENT_AXES)[number]["key"];
