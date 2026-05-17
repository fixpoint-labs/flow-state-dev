/**
 * Output schemas for the Phase 4 risk debate.
 *
 * Three persona generators (aggressive, conservative, neutral) emit a typed
 * critique in a single LLM call. The neutral persona extends the persona
 * shape with `dismissedRisks`. A downstream `riskAssessmentGenerator`
 * synthesizes the three persona memos into a single `RiskAssessment` that
 * Phase 5 consumes.
 *
 * BP-016: every field is required, no `.optional()` / `.default()` /
 * `.record()` / `.nullable()` reachable from any output, every enum is a
 * literal-only union. The `metrics` shape is uniform across personas with
 * every key required — personas fill irrelevant keys with `"—"`, explained
 * in their prompts. This stays strict-mode-compatible without forking
 * into three near-identical schemas.
 */
import { z } from "zod";
import { thesisSection } from "../resources";

const adjustmentShape = z.object({
  sizing: z.enum(["larger", "smaller", "unchanged"]),
  holdingPeriod: z.enum(["longer", "shorter", "unchanged"]),
  invalidation: z.enum(["tighter", "looser", "unchanged"]),
});

/** Shape shared by the aggressive and conservative persona generators. */
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
  posture: z.enum(["aggressive", "conservative"]),
  raisedRisks: z.array(
    z.object({
      description: z.string(),
      severity: z.enum(["high", "medium", "low"]),
    }),
  ),
  proposedAdjustments: adjustmentShape,
});

export type PersonaCritiqueOutput = z.infer<typeof personaCritiqueOutputSchema>;

/** Neutral persona shape — adds `dismissedRisks` and locks `posture`. */
export const neutralCritiqueOutputSchema = personaCritiqueOutputSchema
  .omit({ posture: true })
  .extend({
    posture: z.literal("neutral"),
    dismissedRisks: z.array(
      z.object({
        description: z.string(),
        reason: z.string(),
      }),
    ),
  });

export type NeutralCritiqueOutput = z.infer<typeof neutralCritiqueOutputSchema>;

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
});

export type RiskAssessmentOutput = z.infer<typeof riskAssessmentOutputSchema>;
