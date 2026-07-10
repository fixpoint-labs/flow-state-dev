/**
 * Tier 1 of skillActivator — literal slash-prefix match.
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
import { handler, SLASH_COMMAND_PATTERN } from "@flow-state-dev/core";
import type { SkillState } from "@flow-state-dev/core";
import { skillManifestKey } from "./collection";
import { getCollection } from "./internal/get-collection";
import { skillActivatorStateSchema } from "./skill-activation-types";

const inputSchema = z.object({ message: z.string() }).passthrough();
const outputSchema = z.object({ matched: z.boolean() });

export interface SlashMatchOptions {
  collectionKey: string;
}

/**
 * Build the tier-1 slash-match handler.
 *
 * Returns a handler that, when the user message matches `/<skill-name>` and
 * the named skill is enabled, patches the sequencer state with a single
 * `MatchedSkill` and `resolved: true`.
 */
export function createSkillSlashMatch(opts: SlashMatchOptions) {
  return handler({
    name: "skill-slash-match",
    inputSchema,
    outputSchema,
    sequencerStateSchema: skillActivatorStateSchema,
    execute: async (input, ctx) => {
      const message = (input as { message: string }).message ?? "";
      const match = message.match(SLASH_COMMAND_PATTERN);
      if (!match) return { matched: false };

      const skillName = match[1]!;
      const argument = (match[2] ?? "").trim();

      const collection = getCollection(ctx, opts.collectionKey);
      if (!collection) return { matched: false };

      const manifest = await collection.getOptional(skillManifestKey(skillName));
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
