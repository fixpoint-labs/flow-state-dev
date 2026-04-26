/**
 * Tier 2 of intentSelector — local skill-keyword scan.
 *
 * Reads each enabled skill's `keywords` frontmatter from the collection and
 * matches their lowercased tokens as plain substrings of the user message.
 * Every skill whose keywords match activates with `source: "keyword"`.
 *
 * Resolution rule (gates tier 3):
 *   - Skill matched: resolved.
 *   - No matches but no skill in the catalog declares any `keywords`: also
 *     resolved (tier 3 has nothing to add for the skill dimension).
 *   - Otherwise: not resolved — tier 3 fires on the LLM classifier path.
 *
 * The skill scan is O(n) over the collection per turn. For collections under
 * ~100 entries this is sub-millisecond. Larger catalogs should consider
 * keyword indexing at hydrate time.
 */

import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import type {
  BlockContext,
  ResourceCollectionRef,
  ScopeType,
} from "@flow-state-dev/core/types";
import type { SkillState } from "@flow-state-dev/core";
import { intentSequencerStateSchema } from "./intent-types";

const inputSchema = z.object({ message: z.string() }).passthrough();
const outputSchema = z.object({ skillsMatched: z.number() });

export interface KeywordMatchOptions {
  collectionKey: string;
  scope: ScopeType;
}

/** Resolve the skills collection ref from the appropriate scope registry. */
function getCollection(
  ctx: BlockContext,
  scope: ScopeType,
  key: string,
): ResourceCollectionRef | undefined {
  const registry =
    scope === "session"
      ? ctx.session?.resources
      : scope === "user"
        ? ctx.user?.resources
        : ctx.project?.resources;
  if (!registry) return undefined;
  const get = (registry as { get?: (k: string) => unknown }).get;
  if (typeof get === "function") {
    const ref = get.call(registry, key);
    if (ref && typeof ref === "object" && "pattern" in ref) {
      return ref as ResourceCollectionRef;
    }
  }
  const list = (registry as { list?: () => unknown[] }).list;
  if (typeof list === "function") {
    for (const entry of list.call(registry)) {
      if (
        entry &&
        typeof entry === "object" &&
        "pattern" in (entry as object) &&
        "create" in (entry as object)
      ) {
        const ref = entry as ResourceCollectionRef;
        if (ref.pattern.startsWith(`${key}/`)) return ref;
      }
    }
  }
  return undefined;
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
      let candidatesWithKeywords = 0;
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
          candidatesWithKeywords++;
          if (state.keywords.some((kw) => lowered.includes(kw))) {
            matchedSkills.push({ name: skillName });
          }
        }
      }

      const patch: Record<string, unknown> = {};
      if (matchedSkills.length > 0) {
        const existing = ctx.sequencer?.state.skills ?? [];
        patch.skills = [
          ...existing,
          ...matchedSkills.map((s) => ({
            name: s.name,
            input: "",
            source: "keyword" as const,
          })),
        ];
        patch.resolved = true;
        patch.source = "keyword" as const;
      } else if (candidatesWithKeywords === 0) {
        // Nothing in the catalog declares keywords — tier 3 can't help, mark
        // resolved so we don't pay for an LLM call that has nothing to match.
        patch.resolved = true;
        // Leave `source` null so apply-intent falls through to "classifier"
        // semantics (no match) without misattributing the empty result to
        // the keyword tier.
      }

      if (Object.keys(patch).length > 0) {
        await ctx.sequencer!.patchState(patch);
      }
      return { skillsMatched: matchedSkills.length };
    },
  });
}
