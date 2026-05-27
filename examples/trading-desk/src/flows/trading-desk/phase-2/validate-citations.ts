/**
 * `validateCitations` — deterministic post-debate citation auditor (FIX-679).
 *
 * Runs as a `.tap()` after the bull/bear round-robin and before the
 * consolidation generators. Bull/Bear are required (by
 * `ROUND_ROBIN_INSTRUCTIONS`) to back every load-bearing claim with a
 * `[memo:<analyst> "verbatim quote"]` tag. This handler is the structural
 * floor that turns that contract from a vibe into a check: it substring-
 * matches every tag's quote against the named analyst memo's body and
 * records which tags are valid, which are not, and the quote each invalid
 * tag attempted.
 *
 * The result is written to session state (`citationIntegrity`) rather than
 * returned, so the research-manager generator's context formatter can render
 * it and the writer can project it onto the persisted InvestmentThesis. No
 * LLM is involved — substring matching only. It does NOT verify semantic
 * faithfulness (a debater could quote-stuff accurate-but-irrelevant lines);
 * that softer concern is left to the RM prompt.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { PHASE_1_MEMO_KEYS } from "../agents";
import { memoSectionTexts, normalizeWhitespace } from "../lib/format";
import { memosCollection, phase2Contributions } from "../resources";
import { sessionStateSchema } from "../state";
import type { RoundRobinContributionEntry } from "@flow-state-dev/patterns/round-robin";

/** Matches `[memo:<analyst> "<quote>"]` tags. The analyst alternation is
 *  derived from the Phase 1 memo registry, so a tag pointing at a
 *  non-existent analyst simply doesn't match (and adding a sixth analyst
 *  keeps this in sync automatically). */
const TAG_REGEX = new RegExp(
  `\\[memo:(${Object.keys(PHASE_1_MEMO_KEYS).join("|")})\\s+"([^"]+)"\\]`,
  "g",
);

export const validateCitations = handler({
  name: "p2-validate-citations",
  inputSchema: z.unknown(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: { memos: memosCollection, p2Contributions: phase2Contributions },
  execute: async (_input, ctx) => {
    // Each memo body is flattened and whitespace-normalized once so the
    // substring check below isn't defeated by formatting differences between
    // the stored body and a re-typed quote.
    const memos: Record<string, string> = {};
    for (const [shortName, info] of Object.entries(PHASE_1_MEMO_KEYS)) {
      const state = ctx.resources.memos.getOptional(info.collectionKey)?.state;
      memos[shortName] = normalizeWhitespace(memoSectionTexts(state).join(" "));
    }

    const entries: RoundRobinContributionEntry[] =
      ctx.resources.p2Contributions.state.entries ?? [];

    const invalidTags: Array<{
      contribution: string;
      tag: string;
      attemptedQuote: string;
    }> = [];
    let tagsChecked = 0;
    let tagsValid = 0;

    for (const entry of entries) {
      for (const match of entry.text.matchAll(TAG_REGEX)) {
        tagsChecked++;
        const [, analyst, quote] = match;
        if (memos[analyst]?.includes(normalizeWhitespace(quote))) {
          tagsValid++;
        } else {
          invalidTags.push({
            contribution: `${entry.agentName}:${entry.round}`,
            tag: analyst,
            attemptedQuote: quote,
          });
        }
      }
    }

    await ctx.session.patchState({
      citationIntegrity: { tagsChecked, tagsValid, invalidTags },
    });
  },
});
