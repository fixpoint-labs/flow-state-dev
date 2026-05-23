/**
 * Phase 4 memo state-transition blocks — built via the shared
 * `defineMemoWriter` factory. Two notable differences from Phase 2 / 3:
 *
 *   1. `errorTextPlaceholder` is set so `markError` returns
 *      `{ status, text }`. The placeholder isn't consumed by downstream
 *      personas (they read prior critiques from the persona memos which
 *      `markError` flips to `error` with the captured `errorMessage`),
 *      but keeping a typed non-empty rescue output simplifies the
 *      test seam.
 *
 *   2. The three persona commits share a single output schema and a
 *      shared projection — only the short-name differs. The
 *      `commitPersonaMemo` factory captures that.
 *
 * The `riskAssessment` commit is distinct: its schema and extension
 * fields (`criticalRisks`, `recommendedAdjustments`,
 * `confidenceCalibration`, `calibrationRationale`) are unrelated to the
 * persona shape, so it doesn't fold into `commitPersonaMemo`.
 */
import { defineMemoWriter } from "../lib/memo-writer";
import { PHASE_4_MEMO_KEYS } from "../agents";
import { personaCritiqueOutputSchema, riskAssessmentOutputSchema } from "./schemas";

/** The three persona memos share a commit shape; `riskAssessment` does not. */
export type Phase4PersonaShortName = "aggressive" | "conservative" | "neutral";

const writer = defineMemoWriter({
  phaseId: "p4",
  agentTeam: "risk",
  keys: PHASE_4_MEMO_KEYS,
  errorMessageFallback: "Phase 4 generator failed.",
  errorTextPlaceholder: (agentName) => `(critique unavailable: ${agentName})`,
});

export const { markWriting: markWritingP4, markError: markErrorP4 } = writer;

/** Commit a persona's critique to its `memos/p4/{persona}-risk` memo.
 *  All three personas share `personaCritiqueOutputSchema` — aggressive and
 *  conservative prompts emit `dismissedRisks: []`, neutral populates it.
 *  This uniformity is what lets the factory be one straight-line projection
 *  instead of a schema-branching switch. */
export function commitPersonaMemo(shortName: Phase4PersonaShortName) {
  return writer.defineCommit({
    shortName,
    inputSchema: personaCritiqueOutputSchema,
    project: (critique) => ({
      label: critique.label,
      headline: critique.headline,
      rating: critique.rating,
      body: critique.body,
      metrics: critique.metrics,
      posture: critique.posture,
      raisedRisks: critique.raisedRisks,
      proposedAdjustments: critique.proposedAdjustments,
      dismissedRisks: critique.dismissedRisks,
    }),
  });
}

export const commitRiskAssessmentMemo = writer.defineCommit({
  shortName: "riskAssessment",
  inputSchema: riskAssessmentOutputSchema,
  project: (assessment) => ({
    label: assessment.label,
    headline: assessment.headline,
    rating: assessment.rating,
    body: assessment.body,
    metrics: assessment.metrics,
    criticalRisks: assessment.criticalRisks,
    dismissedRisks: assessment.dismissedRisks,
    recommendedAdjustments: assessment.recommendedAdjustments,
    confidenceCalibration: assessment.confidenceCalibration,
    calibrationRationale: assessment.calibrationRationale,
  }),
});
