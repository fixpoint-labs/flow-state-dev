/**
 * The one definition of "a skill you can load".
 *
 * `listEnabledSkills` is the reader, but it is not the answer. It drops
 * `disable-model-invocation` and nothing else, while the load tool accepts a
 * name only when the skill is also `inline` — fork/pattern skills are dispatch
 * routes, not context injections — and also inside the binding's `allowed` set
 * when it declares one.
 *
 * That second filter is read by three surfaces: the discovery door
 * (`skillsManifestSource`), the ambient catalog listing
 * (`buildLoadCatalogContext`), and the load tool's own "Available:" line when
 * it is handed a name it cannot find. Each of them is telling the model what it
 * may ask for, so a copy that drifts produces the one failure this area is
 * written to prevent: a surface advertises a skill the loader refuses, and the
 * model has no way to learn otherwise. Keeping the rule in one function is what
 * makes "the catalog cannot lie" a property of the code rather than a promise.
 */

import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { listEnabledSkills, type EnabledSkill } from "./list-enabled-skills";

export interface ListLoadableInlineSkillsOptions {
  /**
   * The names the binding's load tool will accept. Omitted, every enabled
   * inline skill is loadable — which is what an `allowed`-less binding accepts.
   *
   * A `Set` rather than an array because every caller already builds one once,
   * at factory time, and rebuilding it per read would be the only cost this
   * helper added.
   */
  allowed?: ReadonlySet<string>;
}

/**
 * List the skills a binding's load tool would accept.
 *
 * @param collection The skills collection to read.
 * @param options The binding's `allowed` set, when it declares one.
 * @returns The enabled, `inline`, in-set skills, in `listEnabledSkills` order.
 */
export async function listLoadableInlineSkills(
  collection: ResourceCollectionRef,
  options: ListLoadableInlineSkillsOptions = {},
): Promise<EnabledSkill[]> {
  const { allowed } = options;
  const enabled = await listEnabledSkills(collection);
  return enabled.filter(
    (skill) => skill.mode === "inline" && (allowed === undefined || allowed.has(skill.name)),
  );
}
