/**
 * Output schemas for the Phase 4 risk debate.
 *
 * One `personaCritiqueOutputSchema` for all three persona generators —
 * `posture` carries the persona identity at runtime, and `dismissedRisks`
 * is always required (aggressive and conservative emit `[]` per their
 * prompts; neutral populates it). A downstream `riskAssessmentGenerator`
 * synthesizes the three persona memos into a single `RiskAssessment` that
 * Phase 5 consumes.
 *
 * Why one schema, not three: the writer side reads each persona's output
 * the same way (commit posture + raisedRisks + proposedAdjustments +
 * dismissedRisks), so splitting the schema by persona just to lock down
 * `posture` for each one forces the writer to branch its input schema and
 * union its output type for no observable gain. The persona-specific
 * value of `posture` is enforced in the prompts where it's already
 * spelled out.
 *
 * BP-016: every field required, no `.optional()` / `.default()` /
 * `.record()` / `.nullable()` reachable from any output, every enum is a
 * literal-only union. The `metrics` shape is uniform across personas
 * with every key required — personas fill irrelevant keys with `"—"`,
 * explained in their prompts.
 */
import { z } from "zod";
import { memoCitation, thesisSection } from "../../resources";

const adjustmentShape = z.object({
  sizing: z.enum(["larger", "smaller", "unchanged"]),
  holdingPeriod: z.enum(["longer", "shorter", "unchanged"]),
  invalidation: z.enum(["tighter", "looser", "unchanged"]),
});

/** Shape shared by all three persona generators. `dismissedRisks` is
 *  always required; aggressive and conservative emit `[]`, neutral
 *  populates it. */
export const personaCritiqueOutputSchema = z.object({
  label: z.string(),
  headline: z.string(),
  rating: z.string(),
  metrics: z.object({
    stance: z.string(),
    structuralChange: z.string(),
    scopeChange: z.string(),
    exitDiscipline: z.string(),
    stopMechanics: z.string(),
    followOn: z.string(),
  }),
  body: z.array(thesisSection),
  posture: z.enum(["aggressive", "conservative", "neutral"]),
  raisedRisks: z.array(
    z.object({
      description: z.string(),
      severity: z.enum(["high", "medium", "low"]),
    }),
  ),
  proposedAdjustments: adjustmentShape,
  dismissedRisks: z.array(
    z.object({
      description: z.string(),
      reason: z.string(),
      dismissalCategory: z.enum([
        "already-addressed",
        "out-of-scope",
        "no-mechanism",
        "asymmetric-no-bound",
      ]),
    }),
  ),
  // FIX-676 — URLs the persona actually fetched while corroborating a claim via
  // the `corroborate` preset (all three personas opt in — all-or-none, so search
  // does not tilt the triad). Null when nothing was fetched and always null on
  // `fast`. Shared schema, so a persona that did not fetch emits `citations:
  // null`. Rendered as a "Sources" footer.
  citations: z.array(memoCitation).nullable(),
});

export type PersonaCritiqueOutput = z.infer<typeof personaCritiqueOutputSchema>;

/** Consolidated `RiskAssessment` — what Phase 5 (PM) reads. */
export const riskAssessmentOutputSchema = z.object({
  label: z.string(),
  headline: z.string(),
  rating: z.string(),
  metrics: z.object({
    calibration: z.string(),
    sizing: z.string(),
    invalidation: z.string(),
    holdingPeriod: z.string(),
  }),
  body: z.array(thesisSection),
  criticalRisks: z.array(
    z.object({
      description: z.string(),
      raisedBy: z.enum(["aggressive", "conservative"]),
      severity: z.enum(["high", "medium", "low"]),
    }),
  ),
  dismissedRisks: z.array(
    z.object({
      description: z.string(),
      reason: z.string(),
      dismissalCategory: z.enum([
        "already-addressed",
        "out-of-scope",
        "no-mechanism",
        "asymmetric-no-bound",
      ]),
    }),
  ),
  // `"unchanged"` is included in each direction enum so the consolidator can
  // attribute a no-op recommendation to a persona's reasoning rather than
  // dropping the field entirely. See spec §10 OQ3.
  recommendedAdjustments: z.object({
    sizing: z.object({
      direction: z.enum(["larger", "smaller", "unchanged"]),
      rationale: z.string(),
      attributedTo: z.enum(["aggressive", "conservative", "neutral"]),
    }),
    holdingPeriod: z.object({
      direction: z.enum(["longer", "shorter", "unchanged"]),
      rationale: z.string(),
      attributedTo: z.enum(["aggressive", "conservative", "neutral"]),
    }),
    invalidation: z.object({
      direction: z.enum(["tighter", "looser", "unchanged"]),
      rationale: z.string(),
      attributedTo: z.enum(["aggressive", "conservative", "neutral"]),
    }),
  }),
  confidenceCalibration: z.enum([
    "overconfident",
    "calibrated",
    "underconfident",
  ]),
  calibrationRationale: z.string(),
  // FIX-676 — URLs the consolidator actually fetched via the `reviewReferences`
  // preset (it can pull a link the desk already surfaced, but cannot run a fresh
  // search). Null when nothing was fetched and always null on `fast`. Rendered as
  // a "Sources" footer.
  citations: z.array(memoCitation).nullable(),
});

export type RiskAssessmentOutput = z.infer<typeof riskAssessmentOutputSchema>;
