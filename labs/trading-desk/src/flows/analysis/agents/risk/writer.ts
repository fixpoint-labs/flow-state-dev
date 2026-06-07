/**
 * Phase 4 memo-writing blocks.
 *
 * Two interesting cases:
 *
 *   - `commitPersonaMemo(shortName)` is a factory because all three
 *     personas (aggressive, conservative, neutral) share
 *     `personaCritiqueOutputSchema` and the same projection — only the
 *     short-name differs. Factory earns its keep here (no per-call body).
 *
 *   - `commitRiskAssessmentMemo` is a plain handler. Its output schema
 *     and extension fields are unrelated to the persona shape, so it
 *     doesn't fold into the persona factory.
 *
 * The `writing` / `error` memo transitions are placed by `defineMemoStep`
 * (`orchestration/stages.ts`) via the registry-keyed `markWriting` /
 * `markError`. The persona `error` rescue carries a non-empty `text`
 * placeholder (`(critique unavailable: <agent>)`) sourced from each persona's
 * `errorPlaceholder` registry entry — it isn't consumed at runtime by
 * downstream personas (they read prior critiques from the persona memos the
 * rescue flips to `error`), but the typed non-empty shape simplifies the test
 * seam.
 */
import { PHASE_4_MEMO_KEYS } from "../../registry";
import { memoHandler, publishMemo } from "../_recipe/memo-writer";
import { personaCritiqueOutputSchema, riskAssessmentOutputSchema } from "./schemas";

/** The three persona memos share a commit shape; `riskAssessment` does not. */
export type Phase4PersonaShortName = "aggressive" | "conservative" | "neutral";

/**
 * Commit a persona's critique to its `memos/p4/{persona}-risk` memo.
 * Factory pattern: aggressive, conservative, and neutral personas share
 * `personaCritiqueOutputSchema` (aggressive/conservative emit
 * `dismissedRisks: []`, neutral populates it) and an identical
 * projection. The factory captures the shared body; only the short-name
 * varies per call.
 */
export function commitPersonaMemo(shortName: Phase4PersonaShortName) {
  const { collectionKey } = PHASE_4_MEMO_KEYS[shortName];
  return memoHandler({
    name: `commit-memo-p4-${shortName}`,
    inputSchema: personaCritiqueOutputSchema,
    execute: async (critique, ctx) => {
      await publishMemo(ctx, shortName, collectionKey, critique);
    },
  });
}

export const commitRiskAssessmentMemo = memoHandler({
  name: "commit-memo-p4-risk-assessment",
  inputSchema: riskAssessmentOutputSchema,
  execute: async (assessment, ctx) => {
    await publishMemo(ctx, "riskAssessment", PHASE_4_MEMO_KEYS.riskAssessment.collectionKey, assessment);
  },
});
