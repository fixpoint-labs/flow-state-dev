/**
 * Final step of skillActivator — collapses the cross-tier sequencer state
 * into the active-skills session-state slot.
 *
 * `activeSkills` is **replaced** (not appended) here for the up-front
 * path's per-turn semantics. Mid-flow `runSkill` calls within the same
 * turn still append on top via the existing `pushActiveSkill` path; the
 * dedup-by-name+mode logic there keeps the array clean.
 *
 * Each entry carries the activation `source` (slash / keyword /
 * classifier) so consumers can render a tier badge per skill without
 * needing a separate surface mirror.
 */

import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import { activeSkillStateSchema } from "./active-skill-state";
import { skillActivatorStateSchema } from "./skill-activation-types";

const inputSchema = z.object({ message: z.string() }).passthrough();
const outputSchema = z.object({
  skillCount: z.number(),
  activationSource: z.string(),
});

/** Build the apply-skill-activation handler. */
export function createApplySkillActivation() {
  return handler({
    name: "apply-skill-activation",
    inputSchema,
    outputSchema,
    sequencerStateSchema: skillActivatorStateSchema,
    sessionStateSchema: activeSkillStateSchema,
    execute: async (_input, ctx) => {
      const seq = ctx.sequencer?.state;
      const skills = seq?.skills ?? [];
      // Each tier produces uniformly-sourced matches, so the top-level
      // activation source is whichever tier produced the first skill match.
      // No matches → classifier was the last tier to run.
      const activationSource = skills[0]?.source ?? "classifier";

      const activeSkillEntries = skills.map((s) => ({
        name: s.name,
        mode: "inline" as const,
        input: s.input,
        activatedAt: Date.now(),
        source: s.source,
      }));
      await ctx.session.patchState({ activeSkills: activeSkillEntries });

      return { skillCount: skills.length, activationSource };
    },
  });
}
