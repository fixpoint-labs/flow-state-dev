/**
 * Phase 2 commit handlers.
 *
 * The three commit handlers (`commitBullMemo`, `commitBearMemo`,
 * `commitResearchManagerMemo`) are plain handlers that project their LLM
 * output and hand the patch to `publishMemo`. They're not run through a
 * factory because each has a different output schema and a different
 * projection — the body IS what varies. The `writing` / `error` lifecycle
 * taps come from the shared key-driven `markWriting` / `markError` in
 * `_recipe/memo-writer` (placed via `defineMemoStep` in `orchestration/stages.ts`).
 */
import { PHASE_2_MEMO_KEYS } from "../../registry";
import { memoHandler, publishMemo } from "../_recipe/memo-writer";
import {
  bearThesisOutputSchema,
  bullThesisOutputSchema,
  investmentThesisOutputSchema,
} from "./generators";

export const commitBullMemo = memoHandler({
  name: "commit-memo-p2-bull",
  inputSchema: bullThesisOutputSchema,
  execute: async (thesis, ctx) => {
    await publishMemo(ctx, "bull", PHASE_2_MEMO_KEYS.bull.collectionKey, thesis);
  },
});

export const commitBearMemo = memoHandler({
  name: "commit-memo-p2-bear",
  inputSchema: bearThesisOutputSchema,
  execute: async (thesis, ctx) => {
    await publishMemo(ctx, "bear", PHASE_2_MEMO_KEYS.bear.collectionKey, thesis);
  },
});

/**
 * Research manager commit. Populates the five InvestmentThesis extension
 * fields (stance, conviction, keyRisks, keyOpportunities,
 * unresolvedDisagreements) in addition to the standard `Thesis` shape so
 * Phase 3+ can read the debate's outcome directly off the memo.
 *
 * `citationIntegrity` is projected from session state (where
 * `validateCitations` wrote it), NOT from the LLM output — the deterministic
 * audit is the source of truth, so the model can never inflate its own
 * citation score (FIX-679).
 */
export const commitResearchManagerMemo = memoHandler({
  name: "commit-memo-p2-research-manager",
  inputSchema: investmentThesisOutputSchema,
  execute: async (thesis, ctx) => {
    await publishMemo(ctx, "researchManager", PHASE_2_MEMO_KEYS.researchManager.collectionKey, {
      ...thesis,
      citationIntegrity: ctx.session.state.citationIntegrity,
    });
  },
});
