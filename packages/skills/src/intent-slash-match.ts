/**
 * Tier 1 of intentSelector — literal slash-prefix match.
 *
 * Scans the user message for a leading `/<skill-name>` token. If the named
 * skill exists in the configured collection and is not
 * `disable-model-invocation: true`, marks the sequencer as resolved.
 * Tiers 2 (keyword) and 3 (classifier) are gated off the same `resolved`
 * flag and skip when slash matched.
 *
 * Non-match cases (unknown skill, disabled skill, no slash, slash with no
 * name) all fall through silently — tier 2 picks up from there with the
 * original message intact.
 */

import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import type { ScopeType } from "@flow-state-dev/core/types";
import type { SkillState } from "@flow-state-dev/core";
import { skillManifestKey } from "./collection";
import { getCollection } from "./internal/get-collection";
import { intentSequencerStateSchema } from "./intent-types";

/** Pattern: `/skill-name` at the start of the message, optional argument tail. */
const SLASH_PATTERN = /^\/([a-z0-9][a-z0-9-]{0,63})(?:\s+([\s\S]*))?$/;

const inputSchema = z.object({ message: z.string() }).passthrough();
const outputSchema = z.object({ matched: z.boolean() });

export interface SlashMatchOptions {
  collectionKey: string;
  scope: ScopeType;
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
