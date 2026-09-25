/**
 * The catalog tier 3 of `createSkillActivator` offers: which skills a model
 * may pick from, and how each is described.
 *
 * One lister serves both tier-3 paths, the generator classifier's prompt and
 * the evaluator's options, so the two can never disagree about which skills
 * a binding allows.
 */

import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { SkillState } from "@flow-state-dev/core";

/** One skill offered to tier 3: its name and the text that describes it. */
export interface OfferedSkill {
  name: string;
  /** The skill's `description`, followed by `whenToUse` on its own line when set. */
  description: string;
}

/**
 * List the skills tier 3 may offer, in collection order: skills in
 * `allowedSet` (when given), not marked `disableModelInvocation`, at most
 * `cap` of them.
 *
 * @param collection - The skills collection, or `undefined` when none is installed.
 * @param cap - Maximum number of skills returned.
 * @param allowedSet - The binding's allowed names; `undefined` allows every skill.
 */
export async function listOfferedSkills(
  collection: ResourceCollectionRef | undefined,
  cap: number,
  allowedSet: Set<string> | undefined,
): Promise<OfferedSkill[]> {
  if (!collection) return [];
  const out: OfferedSkill[] = [];
  const seen = new Set<string>();
  for (const ref of await collection.list()) {
    if (out.length >= cap) break;
    if (!ref.path.endsWith("/SKILL.md")) continue;
    const segments = ref.path.split("/");
    if (segments.length < 2) continue;
    const skillName = segments[segments.length - 2]!;
    if (seen.has(skillName)) continue;
    seen.add(skillName);
    if (allowedSet && !allowedSet.has(skillName)) continue;
    const state = ref.state as unknown as SkillState;
    if (state.disableModelInvocation) continue;
    let desc = state.description ?? "";
    if (state.whenToUse) desc = `${desc}\n${state.whenToUse}`;
    out.push({ name: skillName, description: desc });
  }
  return out;
}
