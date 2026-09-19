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
 * **What that note may say, and why it is narrow (FIX-1451).** The note is
 * about one thing only: what the consuming generator can CALL. On that path
 * `allowed-tools` decides nothing. `createSkillsLibrary` validates the names
 * against the catalog and then contributes the whole catalog, or — under
 * `registerCatalogTools: false`, the stock worker posture — contributes none
 * of it; the generator's own `tools:` is the boundary, and nothing at runtime
 * narrows a generator's tools to a skill's list. So the shipped note ("only
 * these tools are available: ...") was wrong in both directions at once: it
 * promised tools the generator could not call, and claimed exclusivity over
 * tools it could.
 *
 * (`allowed-tools` is not inert everywhere — when a skill declares `agents:`
 * it gates which catalog keys become delegation task seats, per
 * `resolveToolSeats`. That is a different question from what the generator
 * may call, so the note stays silent about it rather than blurring the two.)
 *
 * The fix is phrasing, not plumbing, because the honest sentence is the only
 * one this function is in a position to write. It is handed a collection, a
 * name, a mount path and an argument string — it cannot see the consuming
 * generator's tool list, and for a workforce seat that list is assembled per
 * turn from `ctx.flow.config.tools` plus the seat's own colocated blocks,
 * which are not catalog keys at all. An intersection rendered here would be a
 * guess wearing the same grant-shaped sentence. So: describe the skill, say
 * nothing about the consuming generator's access, and say which of the two it
 * is out loud.
 */

import path from "node:path";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { SkillState } from "@flow-state-dev/core";
import { skillManifestKey } from "./collection";
import { substitute } from "./skill-md";
import { stripFrontmatter } from "./internal/strip-frontmatter";

/**
 * The `allowed-tools` note, in one place so a test can assert the exact text
 * rather than approximate it with patterns (FIX-1451). Two files were each
 * carrying their own regex inventory of phrasings this note must not use,
 * which is a weaker check than it looks: "only these tools are usable" would
 * have satisfied every one of them.
 *
 * It says **"this generator"**, never "this seat". This renderer is shared by
 * both skill entry points, and the legacy `createSkillsCapability` attaches to
 * an ordinary generator with no seat anywhere — "seat" is workforce
 * vocabulary, and on that path it would be undefined terminology in a model's
 * prompt.
 *
 * @param allowedTools - the skill's declared `allowed-tools`, non-empty.
 */
export function formatAllowedToolsIntentNote(
  allowedTools: readonly string[],
): string {
  return (
    `(Tools this skill is written around: ${allowedTools.join(", ")}. ` +
    `That is the skill's intent, not a grant — whether this generator can ` +
    `call them is decided by its own tool configuration, so some may be ` +
    `missing and others not listed here may be present.)`
  );
}

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
  // the skill and says nothing about the generator's access (FIX-1451). See the
  // module docstring for why the honest phrasing is load-bearing, not fussy.
  const intent =
    state.allowedTools && state.allowedTools.length > 0
      ? `\n${formatAllowedToolsIntentNote(state.allowedTools)}`
      : "";
  return `<active_skill name="${name}">\n${substituted}${intent}\n</active_skill>`;
}
