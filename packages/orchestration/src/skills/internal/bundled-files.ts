/**
 * Shared lookup for a skill's bundled files by `prompt-ref`-style path.
 *
 * Two callers resolve the same reference at different times — `library.ts`
 * validates a static agent's `prompt-ref` at build time, and
 * `delegation-surface.ts` inlines the body at materialization time. Both must
 * agree on what "the file exists" means, or a skill passes build validation and
 * then fails to materialize (or vice versa), so the matching rule lives here
 * once rather than in two hand-kept-identical copies.
 */

import type { SkillFile } from "@flow-state-dev/core";

/**
 * Strip a leading `./` or `/` so refs and stored paths compare on equal terms.
 *
 * Deliberately narrower than `normalizeSkillFilePath` in `../collection.ts`,
 * which additionally collapses interior `.` segments and rejects `..` on the
 * way to a storage key. This preserves the rule the two inline copies used, so
 * the extraction stays behavior-identical. The two are worth unifying, but that
 * changes what a programmatic `InitialSkill.files` entry resolves to and wants
 * its own change with `collection.test.ts` coverage.
 */
function normalize(path: string): string {
  return path.replace(/^\.\//, "").replace(/^\//, "");
}

/**
 * Find the bundled file a `prompt-ref` names, or `undefined` when the skill
 * bundles no such file (or bundles no files at all). Both the reference and each
 * stored path are normalized, so `./prompts/a.md` and `prompts/a.md` match.
 */
export function findBundledFile(
  files: SkillFile[] | undefined,
  ref: string,
): SkillFile | undefined {
  if (!files) return undefined;
  const wanted = normalize(ref);
  return files.find((f) => f.path === wanted || normalize(f.path) === wanted);
}
