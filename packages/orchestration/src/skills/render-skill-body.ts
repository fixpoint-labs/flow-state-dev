/**
 * Shared renderer for an active-skill body block.
 *
 * Both the legacy session-global formatter (`context-fn.ts`) and the v2
 * per-generator binding reader (`binding-reader.ts`) render an active skill
 * the same way: load the manifest, strip its frontmatter, substitute
 * `$ARGUMENTS` / `${SKILL_DIR}`, and wrap the result in an
 * `<active_skill name="...">` block with a note naming the skill's
 * `allowed-tools`. Keeping one renderer avoids two copies drifting apart
 * (per the repo's no-duplicate-helpers convention).
 *
 * **What that note may say, and why it is narrow (FIX-1451).** `allowed-tools`
 * grants nothing. `createSkillsLibrary` validates the names against the
 * catalog and, under `registerCatalogTools: false` — the stock worker posture
 * — registers none of them; a seat's own `tools:` is the entire grant, and
 * nothing at runtime narrows a generator's tools to a skill's list either. So
 * the shipped note ("only these tools are available: ...") was wrong in both
 * directions at once: it promised tools the seat could not call, and claimed
 * exclusivity over tools it could.
 *
 * The fix is phrasing, not plumbing, because the honest sentence is the only
 * one this function is in a position to write. It is handed a collection, a
 * name, a mount path and an argument string — it cannot see the consuming
 * generator's tool list, and for a workforce seat that list is assembled per
 * turn from `ctx.flow.config.tools` plus the seat's own colocated blocks,
 * which are not catalog keys at all. An intersection rendered here would be a
 * guess wearing the same grant-shaped sentence. So: describe the skill, say
 * nothing about the seat, and say which of the two it is out loud.
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
  const state = manifest.state as unknown as SkillState;
  // Honor the LIVE manifest, not a build-time snapshot:
  //  - a skill edited to fork/pattern after binding must not render as
  //    `<active_skill>` context — those are dispatch routes, not injections;
  //  - a skill flagged `disable-model-invocation` must never reach the model
  //    through any path, so a draft/admin-only skill can't leak in here either.
  if (state.disableModelInvocation) return null;
  if ((state.contextMode ?? "inline") !== "inline") return null;
  const raw = (await manifest.readContent()) ?? "";
  const body = stripFrontmatter(raw);
  const substituted = substitute(body, {
    arguments: input,
    skillDir: path.posix.join("/workspace", mountPath, name),
  });
  // `allowed-tools` is the skill author's INTENT, and this function has no way
  // to learn the consuming generator's actual tool list — so the note describes
  // the skill and says nothing about the seat (FIX-1451). See the module
  // docstring for why the honest phrasing is load-bearing rather than fussy.
  const intent =
    state.allowedTools && state.allowedTools.length > 0
      ? `\n(Tools this skill is written around: ${state.allowedTools.join(", ")}. ` +
        `That is the skill's intent, not a grant — whether this seat can call them is ` +
        `decided by its own tool configuration, so some may be missing and others not ` +
        `listed here may be present.)`
      : "";
  return `<active_skill name="${name}">\n${substituted}${intent}\n</active_skill>`;
}
