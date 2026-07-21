/**
 * Shared renderer for an active-skill body block.
 *
 * Both the legacy session-global formatter (`context-fn.ts`) and the v2
 * per-generator binding reader (`binding-reader.ts`) render an active skill
 * the same way: load the manifest, strip its frontmatter, substitute
 * `$ARGUMENTS` / `${SKILL_DIR}`, and wrap the result in an
 * `<active_skill name="...">` block with the skill's `allowed-tools`
 * restriction note appended. Keeping one renderer avoids two copies drifting
 * apart (per the repo's no-duplicate-helpers convention).
 */

import path from "node:path";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { SkillState } from "@flow-state-dev/core";
import { skillManifestKey } from "./collection";
import { substitute } from "./skill-md";
import { stripFrontmatter } from "./internal/strip-frontmatter";

/**
 * Render a single inline skill's `<active_skill>` block, or `null` when the
 * skill has no manifest in the collection (deleted / never seeded).
 *
 * @param collection - the skills resource collection
 * @param name       - the skill name (parent directory of its `SKILL.md`)
 * @param mountPath  - workspace mount prefix for `${SKILL_DIR}` substitution
 * @param input      - the activation's `$ARGUMENTS` value, if any
 */
export async function renderActiveSkillBody(
  collection: ResourceCollectionRef,
  name: string,
  mountPath: string,
  input: string | undefined,
): Promise<string | null> {
  const manifest = await collection.getOptional(skillManifestKey(name));
  if (!manifest) return null;
  const raw = (await manifest.readContent()) ?? "";
  const body = stripFrontmatter(raw);
  const substituted = substitute(body, {
    arguments: input,
    skillDir: path.posix.join("/workspace", mountPath, name),
  });
  const state = manifest.state as unknown as SkillState;
  const restriction =
    state.allowedTools && state.allowedTools.length > 0
      ? `\n(While this skill is active, only these tools are available: ${state.allowedTools.join(", ")}.)`
      : "";
  return `<active_skill name="${name}">\n${substituted}${restriction}\n</active_skill>`;
}
