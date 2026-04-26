/**
 * Tier 2 of intentSelector — local skill-keyword scan.
 *
 * Reads each enabled skill's `keywords` frontmatter from the collection and
 * matches their lowercased tokens as plain substrings of the user message.
 * Every skill whose keywords match activates with `source: "keyword"`.
 *
 * Resolution rule: any match → resolved (tier 3 skipped). No matches → not
 * resolved (tier 3 fires). The tier doesn't try to pre-empt the LLM call
 * when no skill declares keywords; that's a cold-path optimization with
 * negligible win versus the simpler invariant.
 *
 * The skill scan is O(n) over the collection per turn. For collections under
 * ~100 entries this is sub-millisecond.
 */

import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import type { ScopeType } from "@flow-state-dev/core/types";
import type { SkillState } from "@flow-state-dev/core";
import { getCollection } from "./internal/get-collection";
import { intentSequencerStateSchema } from "./intent-types";

const inputSchema = z.object({ message: z.string() }).passthrough();
const outputSchema = z.object({ skillsMatched: z.number() });

export interface KeywordMatchOptions {
  collectionKey: string;
  scope: ScopeType;
}

/**
 * Build the tier-2 keyword-match handler. Skipped when the sequencer is
 * already `resolved`.
 */
export function createIntentKeywordMatch(opts: KeywordMatchOptions) {
  return handler({
    name: "intent-keyword-match",
    inputSchema,
    outputSchema,
    sequencerStateSchema: intentSequencerStateSchema,
    execute: async (input, ctx) => {
      // Defensive — outer .tapIf gates this, but a direct invocation might
      // arrive after tier 1 already resolved.
      if (ctx.sequencer?.state.resolved) {
        return { skillsMatched: 0 };
      }

      const message = (input as { message: string }).message ?? "";
      const lowered = message.toLowerCase();

      const matchedSkills: Array<{ name: string }> = [];
      const collection = getCollection(ctx, opts.scope, opts.collectionKey);
      if (collection) {
        const seen = new Set<string>();
        for (const ref of collection.list()) {
          if (!ref.name.endsWith("/SKILL.md")) continue;
          const segments = ref.name.split("/");
          if (segments.length < 2) continue;
          const skillName = segments[segments.length - 2]!;
          if (seen.has(skillName)) continue;
          seen.add(skillName);
          const state = ref.state as unknown as SkillState;
          if (state.disableModelInvocation) continue;
          if (!state.keywords || state.keywords.length === 0) continue;
          if (state.keywords.some((kw) => lowered.includes(kw))) {
            matchedSkills.push({ name: skillName });
          }
        }
      }

      if (matchedSkills.length > 0) {
        const existing = ctx.sequencer?.state.skills ?? [];
        await ctx.sequencer!.patchState({
          resolved: true,
          skills: [
            ...existing,
            ...matchedSkills.map((s) => ({
              name: s.name,
              input: "",
              source: "keyword" as const,
            })),
          ],
        });
      }
      return { skillsMatched: matchedSkills.length };
    },
  });
}
