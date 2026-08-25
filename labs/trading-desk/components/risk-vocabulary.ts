/**
 * The risk debate's shared display vocabulary: how a severity is drawn, how a
 * calibration verdict is coloured, and what the three adjustment axes are
 * called and in what order.
 *
 * Two surfaces draw the same risk memo — the Summary's `RiskPanel` and the
 * Theses tab's `RiskCritiqueCard` — and every constant here is one a second
 * copy of would let them drift. Import them; do not re-spell them.
 *
 * Presentation only. Nothing here decides anything: the severities, verdicts,
 * and axis directions are stored fields the risk memos committed, and nothing
 * here infers, defaults, or re-orders one.
 *
 * A leaf beside `agent-badge.tsx` rather than under `summary/` or `theses/`,
 * because it belongs to neither one.
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

/** The consolidated assessment's confidence-calibration verdict, as the risk
 *  schema spells it. */
export type RiskCalibration = "overconfident" | "calibrated" | "underconfident";

/**
 * Colour class per calibration verdict: both miscalibrations read as a warning,
 * a calibrated desk reads as live.
 *
 * The colour IS the signal here — "overconfident" has to look like a warning
 * wherever it appears — so the Summary's `RiskPanel` and the Theses tab's
 * `RiskCritiqueCard` index this one map rather than each choosing a treatment.
 */
export const CALIBRATION_CLASS: Record<RiskCalibration, string> = {
  overconfident: "text-[color:var(--c-warn)]",
  calibrated: "text-[color:var(--c-live)]",
  underconfident: "text-[color:var(--c-warn)]",
};
