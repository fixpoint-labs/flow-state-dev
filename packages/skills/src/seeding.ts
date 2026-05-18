/**
 * Idempotent seeding of `initialSkills` into a skills collection.
 *
 * Seeding is lazy: the runSkill tool calls `ensureSeeded` on its first
 * invocation per process (the seeder caches per-collection-ref). The
 * `_meta` resource tracks `seededNames` so a user-deleted skill never
 * reappears, and a newly added `initialSkills` entry seeds on the next
 * lazy run.
 *
 * Mid-seed failures: each skill is written atomically (manifest then
 * supporting files); `seededNames` is only updated after a skill's full
 * folder lands. If a folder write fails midway, the seeder logs and
 * continues with the next skill — partial folders are visible but the
 * name is NOT recorded, so the next ensureSeeded retries from scratch
 * (delete + re-create the manifest first).
 */

import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { InitialSkill, SkillsCollectionMeta } from "@flow-state-dev/core";
import { META_KEY, skillFileKey, skillManifestKey } from "./collection";
import { parseSkillMd, validateSkillName } from "./skill-md";

/** Per-(collection-ref, processInstance) sentinel — seed at most once. */
const sentinel = new WeakMap<object, Promise<void>>();

/**
 * Ensure all `initialSkills` whose names are not in `_meta.seededNames`
 * have been written to the collection. Safe to call repeatedly — the work
 * is memoized per `collection` ref via a WeakMap.
 *
 * @param collection - The skills collection (any scope).
 * @param initialSkills - The bundled defaults.
 */
export async function ensureSeeded(
  collection: ResourceCollectionRef,
  initialSkills: InitialSkill[] | undefined,
): Promise<void> {
  if (!initialSkills || initialSkills.length === 0) return;
  // Memoize per collection ref so concurrent calls share one seed pass.
  const cached = sentinel.get(collection);
  if (cached) return cached;
  const promise = doSeed(collection, initialSkills);
  sentinel.set(collection, promise);
  try {
    await promise;
  } catch (err) {
    // On failure, drop the cache so a retry can run.
    sentinel.delete(collection);
    throw err;
  }
}

async function doSeed(
  collection: ResourceCollectionRef,
  initialSkills: InitialSkill[],
): Promise<void> {
  const meta = await loadMeta(collection);
  const alreadySeeded = new Set(meta.seededNames);

  const additions: string[] = [];

  for (const skill of initialSkills) {
    try {
      validateSkillName(skill.name);
    } catch (err) {
      console.warn(`[skills] skipped initial skill: ${(err as Error).message}`);
      continue;
    }
    if (alreadySeeded.has(skill.name) && !needsResed(collection, skill)) continue;

    try {
      await seedOne(collection, skill);
      if (!alreadySeeded.has(skill.name)) additions.push(skill.name);
    } catch (err) {
      console.warn(
        `[skills] failed to seed "${skill.name}": ${(err as Error).message}; will retry on next hydrate`,
      );
    }
  }

  if (additions.length > 0) {
    const next: SkillsCollectionMeta = {
      seededNames: [...meta.seededNames, ...additions],
    };
    await writeMeta(collection, next);
  }
}

/**
 * Decide whether an already-seeded skill needs to be re-seeded because
 * the persisted state has drifted from what the source SKILL.md would
 * now produce. This catches the schema-evolution case: when the
 * collection's state schema gains a new field (e.g. pattern binding),
 * older persisted records lack it and `normalizeResourceState` would
 * have wiped them at write time. The bare presence-check below is the
 * minimum signal — a parsed SKILL.md with a `contextMode` or
 * `patternBinding` whose persisted record is missing them is stale.
 *
 * Intentionally conservative: returns `false` on any parse error or
 * unknown state shape so a malformed source skill doesn't loop the
 * seeder. Returns `false` when both source and persisted agree on
 * having (or lacking) the fields.
 */
function needsResed(
  collection: ResourceCollectionRef,
  skill: InitialSkill,
): boolean {
  let parsed: ReturnType<typeof parseSkillMd>;
  try {
    parsed = parseSkillMd(skill.skillMd);
  } catch {
    return false;
  }
  const ref = collection.getOptional(skillManifestKey(skill.name));
  // A missing manifest on an already-seeded skill means the user
  // deleted it deliberately — preserve that decision, do not re-seed.
  if (!ref) return false;
  const persisted = ref.state as Record<string, unknown> | undefined;
  if (!persisted) return false;
  if (parsed.state.contextMode !== undefined && persisted.contextMode !== parsed.state.contextMode) {
    return true;
  }
  if (parsed.state.patternBinding !== undefined && persisted.patternBinding === undefined) {
    return true;
  }
  return false;
}

/**
 * Write a single skill's full folder. Idempotent: if a partial folder
 * exists from a prior failed seed, existing entries are overwritten.
 */
async function seedOne(
  collection: ResourceCollectionRef,
  skill: InitialSkill,
): Promise<void> {
  // Validate the SKILL.md text up front so we never half-write a broken skill.
  const parsed = parseSkillMd(skill.skillMd);
  parsed.state._seededAt = new Date().toISOString();

  const manifestKey = skillManifestKey(skill.name);
  const stateRecord = parsed.state as unknown as Record<string, unknown>;
  const existingManifest = collection.getOptional(manifestKey);
  if (existingManifest) {
    await existingManifest.setState({ ...stateRecord } as never);
    await existingManifest.writeContent(skill.skillMd);
  } else {
    const ref = await collection.create(manifestKey, stateRecord as never);
    await ref.writeContent(skill.skillMd);
  }

  for (const file of skill.files ?? []) {
    const key = skillFileKey(skill.name, file.path);
    const existingFile = collection.getOptional(key);
    if (existingFile) {
      await existingFile.writeContent(file.content);
    } else {
      const ref = await collection.create(key);
      await ref.writeContent(file.content);
    }
  }
}

async function loadMeta(
  collection: ResourceCollectionRef,
): Promise<SkillsCollectionMeta> {
  const ref = collection.getOptional(META_KEY);
  if (!ref) return { seededNames: [] };
  const state = ref.state as Record<string, unknown>;
  const seeded = state.seededNames;
  if (Array.isArray(seeded)) {
    return { seededNames: seeded.filter((s): s is string => typeof s === "string") };
  }
  return { seededNames: [] };
}

async function writeMeta(
  collection: ResourceCollectionRef,
  meta: SkillsCollectionMeta,
): Promise<void> {
  const existing = collection.getOptional(META_KEY);
  if (existing) {
    await existing.setState({ seededNames: meta.seededNames });
  } else {
    await collection.create(META_KEY, { seededNames: meta.seededNames });
  }
}

/** Test-only: clear the seeding sentinel cache. Not exported from the
 *  package barrel. */
export function _resetSeedingCache(collection?: ResourceCollectionRef): void {
  if (collection) sentinel.delete(collection);
  // No way to clear the entire WeakMap; tests pass the specific ref.
}
