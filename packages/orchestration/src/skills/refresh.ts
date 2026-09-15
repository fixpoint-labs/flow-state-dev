/**
 * Refresh already-seeded skills from their source — the deliberate act that
 * pulls a company edit into a catalog that already holds a copy.
 *
 * Seeding writes a COPY. That is the privacy promise (`seeding.ts`): a later
 * edit upstream does not reach a catalog that already has the skill, and a
 * deletion is not undone. The price is that a typo fixed at the source stays
 * wrong everywhere it was already seeded, and nothing here should be mistaken
 * for a background job that closes that gap — this is a call someone makes.
 *
 * **Two rules, and the second is the one an implementation gets wrong.**
 *
 * 1. It touches only names whose manifest is still there. A skill the holder
 *    deleted stays deleted; restoring it is a separate, explicit act. (Same
 *    decision `needsResed`'s missing-manifest early return already preserves.)
 * 2. For a name it does touch, it replaces that skill's folder **whole** —
 *    write the source, then delete every key the source does not carry. An
 *    overwrite-only refresh writes the source's files over the old ones and
 *    leaves everything else, so a supporting file WITHDRAWN upstream survives
 *    and stays reachable through `prompt-ref`. Withdrawn instructions that
 *    outlive the withdrawal are the defect this exists to close.
 *
 * Whole-folder replacement is this path's rule and **not** `ensureSeeded`'s. A
 * file inside a folder that the source never had is the holder's own edit;
 * deleting it on an ordinary seeding pass would be exactly the propagation the
 * copy-in decision forbids. Refresh is where that loss is the point — and it is
 * all-or-nothing per skill, so a local addition inside a refreshed skill's
 * folder does not survive.
 *
 * The write order (write, then prune) and the one folder-writing primitive both
 * live in `internal/write-skill-folder.ts`, which `seeding.ts` shares.
 */

import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { InitialSkill } from "@flow-state-dev/core";
import { skillManifestKey } from "./collection";
import { writeSkillFolder } from "./internal/write-skill-folder";
import { validateSkillName } from "./skill-md";

/** What {@link refreshSeededSkills} did, per source skill. */
export interface RefreshSeededSkillsResult {
  /** Names whose folder was replaced from the source. */
  refreshed: string[];
  /**
   * Names the collection does not hold — deleted deliberately, or never seeded.
   * Left alone either way.
   */
  skipped: string[];
  /**
   * Keys deleted because the new source no longer carries them, as bare
   * collection keys (`"<name>/reference/old.md"`). Empty on a refresh that only
   * updated bodies.
   */
  removed: string[];
  /**
   * Skills whose refresh threw, with the error.
   *
   * **A refresh that touched storage must never report as a refresh that did
   * nothing.** One bad folder does not cost the rest of the run — the loop
   * continues, as seeding's does — but a caller reading `refreshed: []` and an
   * empty `removed` would otherwise conclude the catalog is untouched when it
   * may not be. A non-empty `failed` is the signal to look. Keys removed before
   * a failure are still in `removed`, so what did happen is nameable.
   */
  failed: Array<{ name: string; error: Error }>;
}

/**
 * Rewrite each source skill's folder in `collection`, for the names it already
 * holds.
 *
 * @param collection - The skills collection to refresh (any scope).
 * @param sources - The current source skills. A name absent from the
 *   collection is skipped; a name absent from `sources` is untouched, so a
 *   caller can refresh one skill by passing one.
 * @returns Which names were refreshed, which were skipped, which keys the
 *   replacement removed, and which skills failed.
 *
 * @example
 *   // Pull the company's current copy of one skill onto a catalog holding it.
 *   const { refreshed, failed } = await refreshSeededSkills(collection, [houseStyle]);
 *   if (failed.length > 0) throw new Error(`refresh incomplete: ${failed[0]!.name}`);
 */
export async function refreshSeededSkills(
  collection: ResourceCollectionRef,
  sources: InitialSkill[],
): Promise<RefreshSeededSkillsResult> {
  const refreshed: string[] = [];
  const skipped: string[] = [];
  const removed: string[] = [];
  const failed: RefreshSeededSkillsResult["failed"] = [];

  for (const skill of sources) {
    try {
      validateSkillName(skill.name);
    } catch (err) {
      console.warn(`[skills] refresh skipped "${skill.name}": ${(err as Error).message}`);
      skipped.push(skill.name);
      continue;
    }

    // Rule 1. A missing manifest is a deliberate deletion (or a name that was
    // never seeded here), and either way refresh is not the act that revives it.
    if (!(await collection.getOptional(skillManifestKey(skill.name)))) {
      skipped.push(skill.name);
      continue;
    }

    try {
      const result = await writeSkillFolder(collection, skill, { prune: true });
      removed.push(...result.removed);
      refreshed.push(skill.name);
    } catch (err) {
      // Collected, not swallowed. Because the primitive writes before it
      // prunes, a failure here leaves the folder complete-plus-stale rather
      // than half-destroyed — but "probably fine" is not a thing to report as
      // silence, so the skill is named and the caller decides.
      failed.push({ name: skill.name, error: err as Error });
      console.warn(
        `[skills] failed to refresh "${skill.name}": ${(err as Error).message}; ` +
          `the folder may still hold files the source has dropped until the next refresh`,
      );
    }
  }

  return { refreshed, skipped, removed, failed };
}
