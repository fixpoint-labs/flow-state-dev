/**
 * Tier 1 of intentSelector — literal slash-prefix match.
 *
 * Scans the user message for a leading `/<skill-name>` token. If the named
 * skill exists in the configured collection and is not
 * `disable-model-invocation: true`, marks the sequencer as resolved with
 * `intentSource: "slash"`. Tiers 2 (keyword) and 3 (classifier) are gated
 * off the same `resolved` flag and skip when slash matched.
 *
 * Slash matching is deliberate user input — we do not also try to classify
 * the message for a thinking style. Style for that turn is left to whatever
 * the apply handler resolves from session state or input override.
 *
 * Non-match cases (unknown skill, disabled skill, no slash, slash with no
 * name) all fall through silently — tier 2 picks up from there with the
 * original message intact.
 */

import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import type {
  BlockContext,
  ResourceCollectionRef,
  ScopeType,
} from "@flow-state-dev/core/types";
import type { SkillState } from "@flow-state-dev/core";
import { skillManifestKey } from "./collection";
import { intentSequencerStateSchema } from "./intent-types";

/** Pattern: `/skill-name` at the start of the message, optional argument tail. */
const SLASH_PATTERN = /^\/([a-z0-9][a-z0-9-]{0,63})(?:\s+([\s\S]*))?$/;

const inputSchema = z.object({ message: z.string() }).passthrough();
const outputSchema = z.object({ matched: z.boolean() });

export interface SlashMatchOptions {
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
  // Fallback: scan list() for a ref whose pattern matches our key prefix.
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
 * Build the tier-1 slash-match handler.
 *
 * Returns a handler that, when the user message matches `/<skill-name>` and
 * the named skill is enabled, patches the sequencer state with a single
 * `MatchedSkill` and `resolved: true`.
 */
export function createIntentSlashMatch(opts: SlashMatchOptions) {
  return handler({
    name: "intent-slash-match",
    inputSchema,
    outputSchema,
    sequencerStateSchema: intentSequencerStateSchema,
    execute: async (input, ctx) => {
      const message = (input as { message: string }).message ?? "";
      const match = message.match(SLASH_PATTERN);
      if (!match) return { matched: false };

      const skillName = match[1]!;
      const argument = (match[2] ?? "").trim();

      const collection = getCollection(ctx, opts.scope, opts.collectionKey);
      if (!collection) return { matched: false };

      const manifest = collection.getOptional(skillManifestKey(skillName));
      if (!manifest) return { matched: false };

      const state = manifest.state as unknown as SkillState;
      if (state.disableModelInvocation) return { matched: false };

      await ctx.sequencer!.patchState({
        resolved: true,
        skills: [
          {
            name: skillName,
            input: argument,
            source: "slash" as const,
          },
        ],
      });
      return { matched: true };
    },
  });
}
