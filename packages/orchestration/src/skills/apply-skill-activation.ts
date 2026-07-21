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
 * classifier) and the skill's declared `contextMode` (`inline` / `fork` /
 * `pattern`) so the badge surfaces the right variant and `runSkill` can
 * pick the right dispatch route when invoked mid-flow.
 *
 * Note: skillActivator only WRITES the entries; it doesn't dispatch
 * fork or pattern skills on its own. For those modes, the parent
 * generator must have the `runSkill` tool available (the agent calls
 * `runSkill` when it sees a matched non-inline skill in its catalog).
 */

import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import type { SkillState } from "@flow-state-dev/core";
import { activeSkillsArraySchema } from "./active-skill-state";
import type { ExplicitActivationScope } from "./activation-store";
import { skillActivatorStateSchema } from "./skill-activation-types";
import { skillManifestKey } from "./collection";
import { getCollection } from "./internal/get-collection";

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
  const collectionKey = options.collectionKey ?? "skills";
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

      // Look up each matched skill's contextMode so the entry's mode
      // reflects what the skill actually does, not a hardcoded "inline".
      // Fork / pattern mode entries surface correctly on the badge and
      // signal to `runSkill` which dispatch route to take.
      const collection = getCollection(ctx, collectionKey);
      const activeSkillEntries = await Promise.all(
        skills.map(async (s) => {
          const manifest = await collection?.getOptional(skillManifestKey(s.name));
          const mode =
            (manifest?.state as SkillState | undefined)?.contextMode ?? "inline";
          return {
            name: s.name,
            mode,
            input: s.input,
            activatedAt: Date.now(),
            source: s.source,
          };
        }),
      );
      // Replace (per-turn semantics) the resolved set at the configured scope
      // + field. Default target is session `activeSkills` (legacy slot).
      const handle = ctx[scope] as { patchState: (u: Record<string, unknown>) => Promise<unknown> };
      await handle.patchState({ [field]: activeSkillEntries });

      return { skillCount: skills.length, activationSource };
    },
  });
}
