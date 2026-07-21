/**
 * Shared catalog primitive: list the enabled (non-disabled) skills in a
 * collection. Used by the v1 runSkill router, the v1 catalog context formatter,
 * and the v2 binding load tool — factored here so the v2 binding does not pull
 * in the v1 router module just to read the catalog.
 */

import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { SkillContextMode, SkillState } from "@flow-state-dev/core";

export interface EnabledSkill {
  name: string;
  description: string;
  /** The skill's declared context mode (`inline` when undeclared). */
  mode: SkillContextMode;
}

/** List enabled (non-disabled) skills for a tool surface. */
export async function listEnabledSkills(
  collection: ResourceCollectionRef,
): Promise<EnabledSkill[]> {
  const out: EnabledSkill[] = [];
  const seen = new Set<string>();
  for (const ref of await collection.list()) {
    // The collection holds a mix of SKILL.md manifests and supporting files.
    // Manifests have keys ending in `/SKILL.md` once stripped of the prefix.
    if (!ref.path.endsWith("/SKILL.md")) continue;
    const state = ref.state as unknown as SkillState;
    if (state.disableModelInvocation) continue;
    // Extract skill name from the storage key — strip prefix and `/SKILL.md`.
    const segments = ref.path.split("/");
    if (segments.length < 2) continue;
    const name = segments[segments.length - 2]!;
    if (seen.has(name)) continue;
    seen.add(name);
    let desc = state.description ?? "";
    if (state.whenToUse) desc = `${desc}\n${state.whenToUse}`;
    out.push({ name, description: desc, mode: state.contextMode ?? "inline" });
  }
  return out;
}
