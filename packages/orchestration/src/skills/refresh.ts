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
 * 2. For a name it does touch, it replaces that skill's folder **whole**: list
 *    the folder, delete every key the new source does not carry, then write the
 *    source. An overwrite-only refresh writes the source's files over the old
 *    ones and leaves everything else — so a supporting file WITHDRAWN upstream
 *    survives the refresh and stays reachable through `prompt-ref`. Withdrawn
 *    instructions that outlive the withdrawal are the defect this exists to
 *    close.
 *
 * Whole-folder replacement is this path's rule and **not** `ensureSeeded`'s. A
 * file inside a folder that the source never had is the holder's own edit;
 * deleting it on an ordinary seeding pass would be exactly the propagation the
 * copy-in decision forbids. Refresh is where that loss is the point — and it is
 * all-or-nothing per skill, so a local addition inside a refreshed skill's
 * folder does not survive.
 */

import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { InitialSkill } from "@flow-state-dev/core";
import { skillFileKey, skillManifestKey } from "./collection";
import { parseSkillMd, validateSkillName } from "./skill-md";

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
}

/**
 * Rewrite each source skill's folder in `collection`, for the names it already
 * holds.
 *
 * @param collection - The skills collection to refresh (any scope).
 * @param sources - The current source skills. A name absent from the
 *   collection is skipped; a name absent from `sources` is untouched, so a
 *   caller can refresh one skill by passing one.
 * @returns Which names were refreshed, which were skipped, and which keys the
 *   replacement removed.
 *
 * @example
 *   // Pull the company's current copy of one skill onto a catalog holding it.
 *   await refreshSeededSkills(collection, [houseStyle]);
 */
export async function refreshSeededSkills(
  collection: ResourceCollectionRef,
  sources: InitialSkill[],
): Promise<RefreshSeededSkillsResult> {
  const refreshed: string[] = [];
  const skipped: string[] = [];
  const removed: string[] = [];

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
    const manifestKey = skillManifestKey(skill.name);
    if (!(await collection.getOptional(manifestKey))) {
      skipped.push(skill.name);
      continue;
    }

    try {
      removed.push(...(await replaceFolder(collection, skill)));
      refreshed.push(skill.name);
    } catch (err) {
      // Per skill, like seeding: one unwritable folder must not cost the rest
      // of the refresh. The folder is left mid-replacement and the next refresh
      // redoes it from the source.
      console.warn(
        `[skills] failed to refresh "${skill.name}": ${(err as Error).message}; the folder may be partial until the next refresh`,
      );
    }
  }

  return { refreshed, skipped, removed };
}

/**
 * Replace one skill's folder with the source's, deleting first.
 *
 * Deletes before writing so a key the source both drops AND re-adds under a
 * different normalization cannot be removed after it was written. Returns the
 * keys it deleted.
 */
async function replaceFolder(
  collection: ResourceCollectionRef,
  skill: InitialSkill,
): Promise<string[]> {
  // Validate up front so a broken source never half-replaces a working folder.
  const parsed = parseSkillMd(skill.skillMd, { expectedName: skill.name });
  parsed.state._seededAt = new Date().toISOString();

  const manifestKey = skillManifestKey(skill.name);
  const sourceKeys = new Set<string>([manifestKey]);
  for (const file of skill.files ?? []) {
    sourceKeys.add(skillFileKey(skill.name, file.path));
  }

  const removed: string[] = [];
  for (const ref of await collection.list(`${skill.name}/`)) {
    const key = bareKey(collection, ref.path);
    if (sourceKeys.has(key)) continue;
    await collection.delete(key);
    removed.push(key);
  }

  const manifest = await collection.create(
    manifestKey,
    parsed.state as unknown as Record<string, never>,
    { replace: true },
  );
  await manifest.writeContent(skill.skillMd);

  for (const file of skill.files ?? []) {
    const ref = await collection.getOrCreate(skillFileKey(skill.name, file.path));
    await ref.writeContent(file.content);
  }

  return removed;
}

/**
 * A listed ref's `path` is the FULL storage key (`"skills/house-style/SKILL.md"`),
 * while `list(prefix)` and `delete(key)` take keys relative to the collection's
 * own prefix. This is the one conversion between them.
 *
 * The prefix is read off the collection's pattern rather than passed in, so a
 * caller cannot hand a prefix that disagrees with the collection it is
 * refreshing. `defineSkillsCollection` always builds `"<prefix>/**"`.
 */
function bareKey(collection: ResourceCollectionRef, storagePath: string): string {
  const prefix = collection.pattern.replace(/\/\*\*$/, "");
  return prefix.length > 0 && storagePath.startsWith(`${prefix}/`)
    ? storagePath.slice(prefix.length + 1)
    : storagePath;
}
