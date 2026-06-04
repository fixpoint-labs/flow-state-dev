/**
 * Phase 1 memo-writing blocks.
 *
 *   - `markWriting` / `markError` — built via the shared
 *     `defineMemoStateBlocks` factory (identity-only parameterization).
 *   - `commitMemo(shortName)` — returns a plain handler whose body calls
 *     `publishMemo` with the analyst's thesis projected onto the memo's
 *     extension fields. Phase 1 keeps the factory shape for the commit
 *     because all five analysts share the same projection (the only
 *     difference is the memo key the patch goes to). When commits diverge
 *     per phase (Phase 2's bull/bear/RM, Phase 3's trader, Phase 5's PM),
 *     they're written as plain handlers — see those files.
 */
import { PHASE_1_MEMO_KEYS, type Phase1MemoShortName } from "../agents";
import {
  defineMemoStateBlocks,
  memoHandler,
  publishMemo,
} from "../agents/_recipe/memo-writer";
import { thesisOutputSchema } from "./thesis-schema";

export const { markWriting, markError } = defineMemoStateBlocks({
  phaseId: "p1",
  agentTeam: "analyst",
  keys: PHASE_1_MEMO_KEYS,
  errorMessageFallback: "Analyst run failed.",
});

/**
 * Commit an analyst's `Thesis` to its memo. The `metrics` array-of-pairs
 * is flattened back into a `Record<string,string>` — the LLM emits the
 * pair shape (OpenAI strict-mode requirement) and the stored shape is
 * the dict.
 */
export function commitMemo(shortName: Phase1MemoShortName) {
  const { collectionKey } = PHASE_1_MEMO_KEYS[shortName];
  return memoHandler({
    name: `commit-memo-p1-${shortName}`,
    inputSchema: thesisOutputSchema,
    execute: async (thesis, ctx) => {
      await publishMemo(ctx, shortName, collectionKey, {
        label: thesis.label,
        headline: thesis.headline,
        rating: thesis.rating,
        body: thesis.body,
        metrics: Object.fromEntries(thesis.metrics.map((m) => [m.key, m.value])),
        citations: thesis.citations,
        dataQuality: thesis.dataQuality,
      });
    },
  });
}
