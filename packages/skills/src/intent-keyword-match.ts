/**
 * Tier 2 of intentSelector — local keyword scan.
 *
 * Two parallel scans on the lowercased message:
 *   1. Thinking-style keywords passed in via options (table maps style → tokens).
 *   2. Per-skill keywords read from the collection's SKILL.md frontmatter.
 *
 * Either scan can succeed independently. The handler reports the partial
 * results into sequencer state. The sequencer is considered "resolved" only
 * when both dimensions are covered (style matched AND skill scan reached a
 * conclusion — either matched or short-circuited because the catalog has
 * no skills with keywords). When partially resolved, tier 3 fills the gap
 * for whichever dimension is still null.
 *
 * The skill scan is O(n) over the collection per turn. For collections
 * under ~100 entries this is sub-millisecond. Larger catalogs should
 * consider keyword indexing at hydrate time — see FIX-421 spec §11.
 */

import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import type {
  BlockContext,
  ResourceCollectionRef,
  ScopeType,
  ThinkingStyle,
} from "@flow-state-dev/core/types";
import type { SkillState } from "@flow-state-dev/core";
import { intentSequencerStateSchema } from "./intent-types";

const inputSchema = z.object({ message: z.string() }).passthrough();
const outputSchema = z.object({
  styleMatched: z.boolean(),
  skillsMatched: z.number(),
});

/**
 * Map of thinking-style identifier → keyword tokens that should activate it.
 * Tokens are matched case-insensitively as plain substrings of the user
 * message. Order is significant: the first style with a matching token wins
 * (use this to give more specific styles priority over more general ones).
 */
export type ThinkingStyleKeywordTable = ReadonlyArray<{
  style: ThinkingStyle;
  keywords: readonly string[];
}>;

export interface KeywordMatchOptions {
  collectionKey: string;
  scope: ScopeType;
  /** Style → keyword tokens. Empty array disables the style-keyword scan. */
  thinkingStyleKeywords?: ThinkingStyleKeywordTable;
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
 * Build the tier-2 keyword-match handler.
 *
 * Skipped at runtime when the sequencer is already `resolved` (tier 1 fired).
 * Otherwise scans for both style and skill matches and writes partial
 * findings into sequencer state.
 */
export function createIntentKeywordMatch(opts: KeywordMatchOptions) {
  const styleTable = opts.thinkingStyleKeywords ?? [];

  return handler({
    name: "intent-keyword-match",
    inputSchema,
    outputSchema,
    sequencerStateSchema: intentSequencerStateSchema,
    execute: async (input, ctx) => {
      // Tier 1 may have already resolved — gate is on the sequencer's `.tapIf`,
      // but defend against direct invocation by treating an existing resolve
      // as a no-op.
      if (ctx.sequencer?.state.resolved) {
        return { styleMatched: false, skillsMatched: 0 };
      }

      const message = (input as { message: string }).message ?? "";
      const lowered = message.toLowerCase();

      // 1. Thinking-style scan — first match wins.
      let matchedStyle: ThinkingStyle | null = null;
      for (const row of styleTable) {
        if (row.keywords.some((kw) => lowered.includes(kw.toLowerCase()))) {
          matchedStyle = row.style;
          break;
        }
      }

      // 2. Skill scan — collect every skill whose keywords match.
      const matchedSkills: Array<{ name: string }> = [];
      let catalogScanned = false;
      const collection = getCollection(ctx, opts.scope, opts.collectionKey);
      if (collection) {
        catalogScanned = true;
        const seen = new Set<string>();
        for (const ref of collection.list()) {
          if (!ref.name.endsWith("/SKILL.md")) continue;
          const segments = ref.name.split("/");
          if (segments.length < 2) continue;
          const skillName = segments[segments.length - 2]!;
          if (seen.has(skillName)) continue;
          const state = ref.state as unknown as SkillState;
          if (state.disableModelInvocation) continue;
          if (!state.keywords || state.keywords.length === 0) continue;
          if (state.keywords.some((kw) => lowered.includes(kw))) {
            matchedSkills.push({ name: skillName });
            seen.add(skillName);
          }
        }
      }

      // Write whichever dimensions resolved. Skill matches stack with any
      // existing entries (tier 1 won't have run if we're here, but the
      // sequencer state shape allows accumulation).
      const patch: Record<string, unknown> = {};
      if (matchedStyle !== null) {
        patch.thinkingStyle = matchedStyle;
        patch.thinkingStyleSource = "keyword" as const;
      }
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
      }

      // Resolution rule (FIX-421 spec §3.2): both dimensions covered.
      // - style covered: matched OR table is empty (no style classification expected)
      // - skills covered: matched OR no candidate skills declare `keywords` at all
      const styleCovered =
        matchedStyle !== null || styleTable.length === 0;
      const skillsCovered =
        matchedSkills.length > 0 ||
        !catalogScanned ||
        countSkillsWithKeywords(collection) === 0;
      if (styleCovered && skillsCovered) {
        patch.resolved = true;
      }

      if (Object.keys(patch).length > 0) {
        await ctx.sequencer!.patchState(patch);
      }
      return {
        styleMatched: matchedStyle !== null,
        skillsMatched: matchedSkills.length,
      };
    },
  });
}

/** Count enabled skills that declare a non-empty `keywords` frontmatter. */
function countSkillsWithKeywords(
  collection: ResourceCollectionRef | undefined,
): number {
  if (!collection) return 0;
  let n = 0;
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
    if (state.keywords && state.keywords.length > 0) n++;
  }
  return n;
}
