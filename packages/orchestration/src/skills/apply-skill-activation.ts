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
 * classifier). Since fork/pattern modes were removed (FIX-918), every
 * activated skill is inline, so the entry `mode` is stamped `"inline"`
 * unconditionally — never read from a possibly-stale persisted
 * `contextMode`, which the binding reader would then skip if it still
 * said `"pattern"`/`"fork"` on a pre-migration manifest.
 */

import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import { activeSkillsArraySchema } from "./active-skill-state";
import {
  replaceActivations,
  type ExplicitActivationScope,
} from "./activation-store";
import { skillActivatorStateSchema } from "./skill-activation-types";

const inputSchema = z.object({ message: z.string() }).passthrough();
const outputSchema = z.object({
  skillCount: z.number(),
  activationSource: z.string(),
});

export interface ApplySkillActivationOptions {
  /** Resource registry key for the skills collection. Default `"skills"`. */
  collectionKey?: string;
  /**
   * Where the matcher writes its resolved activations. Default
   * `{ scope: "session", field: "activeSkills" }` (the legacy session-global
   * slot). Point this at a v2 binding's explicit `activeState` field to feed a
   * per-generator binding from an up-front matcher.
   */
  activeState?: { scope: ExplicitActivationScope; field: string };
  /**
   * Restrict matches to this set of skill names — the target binding's
   * `allowed` set. A `/skill` or keyword hit for a skill outside the binding
   * would otherwise land in the shared field and render on a generator that was
   * never given that skill.
   */
  allowed?: readonly string[];
}

/** Build the apply-skill-activation handler. */
export function createApplySkillActivation(options: ApplySkillActivationOptions = {}) {
  const scope: ExplicitActivationScope = options.activeState?.scope ?? "session";
  const field = options.activeState?.field ?? "activeSkills";
  const allowedSet = options.allowed ? new Set(options.allowed) : undefined;
  const scopeSchema = z.object({ [field]: activeSkillsArraySchema });
  return handler({
    name: "apply-skill-activation",
    inputSchema,
    outputSchema,
    sequencerStateSchema: skillActivatorStateSchema,
    [`${scope}StateSchema`]: scopeSchema,
    execute: async (_input, ctx) => {
      const seq = ctx.sequencer?.state;
      // Scope matches to the target binding's `allowed` set (if any) so a hit
      // for a skill the generator wasn't given never lands in the shared field.
      const skills = (seq?.skills ?? []).filter(
        (s) => !allowedSet || allowedSet.has(s.name),
      );
      // Each tier produces uniformly-sourced matches, so the top-level
      // activation source is whichever tier produced the first skill match.
      // No matches → classifier was the last tier to run.
      const activationSource = skills[0]?.source ?? "classifier";

      // Inline is the only mode after FIX-918, so stamp it directly rather
      // than reading a possibly-stale persisted `contextMode` (a pre-migration
      // manifest could still say `"pattern"`/`"fork"`, which the binding reader
      // would then skip — dropping the migrated skill's body).
      const activeSkillEntries = skills.map((s) => ({
        name: s.name,
        mode: "inline" as const,
        input: s.input,
        activatedAt: Date.now(),
        source: s.source,
      }));
      // Replace (per-turn semantics) the resolved set at the configured scope
      // + field. Default target is session `activeSkills` (legacy slot).
      // Goes through the shared activation-store helper so the matcher, the
      // load tool, and the reader agree on one write model.
      await replaceActivations(ctx, { kind: "explicit", scope, field }, activeSkillEntries);

      return { skillCount: skills.length, activationSource };
    },
  });
}
