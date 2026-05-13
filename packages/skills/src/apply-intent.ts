/**
 * Final step of intentSelector — collapses the cross-tier sequencer state
 * into the active-skills session-state slot.
 *
 * `activeSkills` is **replaced** (not appended) here for the up-front
 * path's per-turn semantics. Mid-flow `runSkill` calls within the same
 * turn still append on top via the existing `pushActiveSkill` path; the
 * dedup-by-name+mode logic there keeps the array clean.
 *
 * Each entry carries the activation `source` (slash / keyword /
 * classifier) and the skill's declared `contextMode` (`inline` / `fork` /
 * `pattern`) so the badge surfaces the right variant and `runSkill` can
 * pick the right dispatch route when invoked mid-flow.
 *
 * Note: intent-selector only WRITES the entries; it doesn't dispatch
 * fork or pattern skills on its own. For those modes, the parent
 * generator must have the `runSkill` tool available (the agent calls
 * `runSkill` when it sees a matched non-inline skill in its catalog).
 */

import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import type { SkillState } from "@flow-state-dev/core";
import { activeSkillStateSchema } from "./active-skill-state";
import { intentSequencerStateSchema } from "./intent-types";
import { skillManifestKey } from "./collection";
import { getCollection } from "./internal/get-collection";

const inputSchema = z.object({ message: z.string() }).passthrough();
const outputSchema = z.object({
  skillCount: z.number(),
  intentSource: z.string(),
});

export interface ApplyIntentOptions {
  /** Resource registry key for the skills collection. Default `"skills"`. */
  collectionKey?: string;
}

/** Build the apply-intent handler. */
export function createApplyIntent(options: ApplyIntentOptions = {}) {
  const collectionKey = options.collectionKey ?? "skills";
  return handler({
    name: "apply-intent",
    inputSchema,
    outputSchema,
    sequencerStateSchema: intentSequencerStateSchema,
    sessionStateSchema: activeSkillStateSchema,
    execute: async (_input, ctx) => {
      const seq = ctx.sequencer?.state;
      const skills = seq?.skills ?? [];
      // Each tier produces uniformly-sourced matches, so the top-level
      // intent source is whichever tier produced the first skill match.
      // No matches → classifier was the last tier to run.
      const intentSource = skills[0]?.source ?? "classifier";

      // Look up each matched skill's contextMode so the entry's mode
      // reflects what the skill actually does, not a hardcoded "inline".
      // Fork / pattern mode entries surface correctly on the badge and
      // signal to `runSkill` which dispatch route to take.
      const collection = getCollection(ctx, collectionKey);
      const activeSkillEntries = skills.map((s) => {
        const manifest = collection?.getOptional(skillManifestKey(s.name));
        const mode = (manifest?.state as SkillState | undefined)?.contextMode ?? "inline";
        return {
          name: s.name,
          mode,
          input: s.input,
          activatedAt: Date.now(),
          source: s.source,
        };
      });
      await ctx.session.patchState({ activeSkills: activeSkillEntries });

      return { skillCount: skills.length, intentSource };
    },
  });
}
