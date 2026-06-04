/**
 * Phase 6 memo-writing blocks.
 *
 *   - `markWritingP6` / `markErrorP6` — built via `defineMemoStateBlocks`.
 *   - `commitThesisAlignmentMemo` — plain handler that enforces the
 *     anti-yes-man rule, then publishes the validator's audit.
 *
 * The anti-yes-man rule lives here rather than in the output schema because a
 * Zod refinement would wrap the schema in `ZodEffects` and break OpenAI strict
 * structured output (BP-016). Throwing in the commit triggers the
 * `markErrorP6` rescue, so a yes-man verdict flips the memo to `error`
 * instead of publishing — same shape as Phase 5's lineage-violation throw.
 */
import { PHASE_6_MEMO_KEYS } from "../agents";
import {
  defineMemoStateBlocks,
  memoHandler,
  publishMemo,
} from "../agents/_recipe/memo-writer";
import { thesisAlignmentOutputSchema } from "./thesis-validator";

export const {
  markWriting: markWritingP6,
  markError: markErrorP6,
} = defineMemoStateBlocks({
  phaseId: "p6",
  agentTeam: "pm",
  keys: PHASE_6_MEMO_KEYS,
  errorMessageFallback: "Phase 6 generator failed.",
});

export const commitThesisAlignmentMemo = memoHandler({
  name: "commit-memo-p6-thesis-alignment",
  inputSchema: thesisAlignmentOutputSchema,
  execute: async (audit, ctx) => {
    // Anti-yes-man enforcement: `aligned` is the highest bar and the
    // failure mode this phase exists to prevent. It requires ≥ 2 supporting
    // citations AND zero contradicting evidence — anything weaker must be
    // "partially-aligned" or lower. The prompt asks for this; only the
    // writer can guarantee it.
    if (audit.alignment === "aligned") {
      if (audit.supportingEvidence.length < 2) {
        throw new Error(
          "alignment-violation: `aligned` requires at least 2 supportingEvidence entries.",
        );
      }
      if (audit.contradictingEvidence.length > 0) {
        throw new Error(
          "alignment-violation: `aligned` requires contradictingEvidence to be empty.",
        );
      }
    } else if (audit.proposedRevision === null) {
      // A non-aligned verdict must propose a revision — the user's value-add
      // is "what would the evidence actually support".
      throw new Error(
        "alignment-violation: proposedRevision is required when alignment is not `aligned`.",
      );
    }

    await publishMemo(
      ctx,
      "thesisAlignment",
      PHASE_6_MEMO_KEYS.thesisAlignment.collectionKey,
      {
        label: audit.label,
        headline: audit.headline,
        rating: audit.rating,
        body: audit.body,
        metrics: audit.metrics,
        alignment: audit.alignment,
        alignmentConfidence: audit.alignmentConfidence,
        supportingEvidence: audit.supportingEvidence,
        contradictingEvidence: audit.contradictingEvidence,
        blindSpots: audit.blindSpots,
        proposedRevision: audit.proposedRevision,
        citations: audit.citations,
      },
    );
  },
});
