/**
 * The one place a skill's folder is written.
 *
 * Seeding and refreshing both lay down the same thing — parse the source, stamp
 * `_seededAt`, replace the manifest, then write each supporting file under its
 * normalized key — and differ only in whether they afterwards **prune** what the
 * new source no longer carries. Two copies of that sequence drift the moment the
 * key rules or the stamp change, and the copies were created a commit apart, so
 * this collapses them before the drift can start rather than after.
 *
 * **Write first, prune second, and never the other way round.** There is no
 * transaction across these calls. Pruning first reads more natural — clear the
 * folder, then lay down the new one — and turns any storage failure partway
 * through into a live skill left half-destroyed while still looking present.
 * Writing first inverts the failure: every key the source carries is in place
 * before anything is removed, so a failure leaves a folder that is complete plus
 * some stale extras — the state a refresh already tolerates between runs, and
 * one the next refresh fixes by itself. Worst case a withdrawn file outlives the
 * withdrawal by one refresh; best case nothing is lost.
 */

import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { InitialSkill } from "@flow-state-dev/core";
import { skillFileKey, skillManifestKey } from "../collection";
import { parseSkillMd } from "../skill-md";

export interface WriteSkillFolderOptions {
  /**
   * Also delete every key under `<name>/` that the source does not carry.
   *
   * Off for ordinary seeding, which must stay **additive**: a file inside a
   * skill's folder that the source never had is the holder's own edit, and
   * removing it on a routine pass is exactly the propagation that copy-in
   * exists to refuse. On for a refresh, where that loss is the point.
   */
  prune?: boolean;
}

/** What the write did. `removed` is always empty unless `prune` was set. */
export interface WriteSkillFolderResult {
  removed: string[];
}

/**
 * Write one skill's folder from its source, optionally pruning what the source
 * no longer carries.
 *
 * Throws if the source does not parse, before touching storage — a broken
 * source must never half-replace a working folder.
 */
export async function writeSkillFolder(
  collection: ResourceCollectionRef,
  skill: InitialSkill,
  options: WriteSkillFolderOptions = {},
): Promise<WriteSkillFolderResult> {
  // Parse up front: this is the one check that can reject a source without
  // having written anything, so it runs before the first write, not beside it.
  const parsed = parseSkillMd(skill.skillMd, { expectedName: skill.name });
  parsed.state._seededAt = new Date().toISOString();

  const manifestKey = skillManifestKey(skill.name);

  const manifest = await collection.create(
    manifestKey,
    parsed.state as unknown as Record<string, never>,
    { replace: true },
  );
  await manifest.writeContent(skill.skillMd);

  for (const file of skill.files ?? []) {
    // `getOrCreate` makes the ensure-then-write a single call.
    const ref = await collection.getOrCreate(skillFileKey(skill.name, file.path));
    await ref.writeContent(file.content);
  }

  if (options.prune !== true) return { removed: [] };

  // Listed AFTER the writes, so a key the source both drops and re-adds under a
  // different normalization is seen in its written form and kept, rather than
  // removed a moment after being laid down.
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

  return { removed };
}

/**
 * A listed ref's `path` is the FULL storage key (`"skills/house-style/SKILL.md"`),
 * while `list(prefix)` and `delete(key)` take keys relative to the collection's
 * own prefix. This is the one conversion between them.
 *
 * The prefix is read off the collection's pattern rather than passed in, so a
 * caller cannot hand a prefix that disagrees with the collection it is writing
 * to. `defineSkillsCollection` always builds `"<prefix>/**"`.
 */
function bareKey(collection: ResourceCollectionRef, storagePath: string): string {
  const prefix = collection.pattern.replace(/\/\*\*$/, "");
  return prefix.length > 0 && storagePath.startsWith(`${prefix}/`)
    ? storagePath.slice(prefix.length + 1)
    : storagePath;
}
