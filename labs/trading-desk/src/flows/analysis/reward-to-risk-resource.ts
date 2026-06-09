/**
 * Session-scoped resource holding the scenario-derived reward-to-risk figure
 * (FIX-752).
 *
 * Populated by the `computeAndStoreRewardToRisk` tap after the scenario
 * forecaster commits (Phase 5a) and before the PM (Phase 5b). Read by the
 * `rewardToRisk` capability preset to inject `<rewardToRisk>` into the PM, and
 * re-read by the PM commit to gate size against the active mandate. State is
 * nullable — null means the forecaster produced no usable buckets (the PM then
 * decides mandate-blind). `client.exclude: []` ships the full state so the
 * Summary surface can read it like the valuation spine.
 *
 * Kept in its own file (pulling `@flow-state-dev/core`'s root barrel) so the
 * resource import never bleeds into client bundles.
 */
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

/** Durable shape of the derived reward-to-risk figure plus the provenance of the
 *  λ it was computed with (the active mandate, or 1 when mandate-blind). */
export const rewardToRiskStateSchema = z.object({
  expectedValuePct: z.number().nullable(),
  expectedGainPct: z.number().nullable(),
  expectedLossPct: z.number().nullable(),
  glr: z.number().nullable(),
  lossAdjustedGlr: z.number().nullable(),
  worstCaseReturnPct: z.number().nullable(),
  probGain: z.number().nullable(),
  noDownside: z.boolean(),
  evidenceBasis: z.enum(["sufficient", "thin"]),
  // Provenance: the loss-aversion λ used, and which mandate supplied it (null
  // when the figure was computed mandate-blind at λ=1).
  lossAversion: z.number(),
  mandateId: z.string().nullable(),
});

export type RewardToRiskState = z.infer<typeof rewardToRiskStateSchema>;

export const rewardToRiskResource = defineResource({
  scope: "session",
  ref: "rewardToRisk",
  stateSchema: rewardToRiskStateSchema.nullable(),
  default: null,
  writable: true,
  // A single nullable resource only reaches the client when it declares a client
  // projection; `exclude: []` identity-exposes the full state (the valuation-spine
  // precedent) so the Summary can read the figure without a debug endpoint.
  client: { exclude: [] },
});
