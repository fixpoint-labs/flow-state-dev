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

import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { InitialSkill, SkillsCollectionMeta } from "@flow-state-dev/core";
import { META_KEY, skillFileKey, skillManifestKey } from "./collection";
import { parseSkillMd, validateSkillName } from "./skill-md";

/**
 * Bundled defaults, as a fixed array or as a per-execution resolver.
 *
 * A resolver returning `undefined` (or an empty array) means this execution
 * seeds nothing — `ensureSeeded` returns before any storage read. Keep a
 * resolver to an O(1) read of something already resolved: it runs on every
 * render of every binding.
 */
export type InitialSkillsSource =
  | InitialSkill[]
  | ((ctx: BlockContext) => InitialSkill[] | undefined);

/** Per-(collection-ref, processInstance) sentinel — seed at most once. */
const sentinel = new WeakMap<object, Promise<void>>();

/**
 * Ensure all `initialSkills` whose names are not in `_meta.seededNames`
 * have been written to the collection. Safe to call repeatedly — the work
 * is memoized per `collection` ref via a WeakMap.
 *
 * A function source is resolved against `ctx` here. The memo is keyed on the
 * collection ref, so every site in one request shares one write; they also
 * share the library's source, so the first caller's context is the execution's.
 *
 * @param collection - The skills collection (any scope).
 * @param initialSkills - The bundled defaults, or a per-execution resolver.
 * @param ctx - Required when `initialSkills` is a function.
 */
export async function ensureSeeded(
  collection: ResourceCollectionRef,
  initialSkills: InitialSkillsSource | undefined,
  ctx?: BlockContext,
): Promise<void> {
  const resolved =
    typeof initialSkills === "function"
      ? ctx
        ? initialSkills(ctx)
        : undefined
      : initialSkills;
  if (!resolved || resolved.length === 0) return;
  // Memoize per collection ref so concurrent calls share one seed pass.
  const cached = sentinel.get(collection);
  if (cached) return cached;
  const promise = doSeed(collection, resolved);
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
    if (alreadySeeded.has(skill.name) && !(await needsResed(collection, skill)))
      continue;

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
async function needsResed(
  collection: ResourceCollectionRef,
  skill: InitialSkill,
): Promise<boolean> {
  let parsed: ReturnType<typeof parseSkillMd>;
  try {
    parsed = parseSkillMd(skill.skillMd);
  } catch {
    return false;
  }
  const ref = await collection.getOptional(skillManifestKey(skill.name));
  // A missing manifest on an already-seeded skill means the user
  // deleted it deliberately — preserve that decision, do not re-seed.
  if (!ref) return false;
  const persisted = ref.state as Record<string, unknown> | undefined;
  if (!persisted) return false;
  // Migration (FIX-918): the source dropped `contextMode`/`patternBinding` and
  // now declares `agents:`, but a pre-migration persisted record still carries
  // the old shape. `renderActiveSkillBody` skips a non-inline manifest, so the
  // migrated body would never render until manual delete/reimport. Reseed when
  // the persisted record is stale relative to the current source:
  //  - it still carries a legacy (non-inline) contextMode the source has dropped, or
  //  - the source declares `agents:` the persisted record lacks.
  if (persisted.contextMode !== undefined && persisted.contextMode !== "inline") {
    return true;
  }
  if (parsed.state.agents !== undefined && persisted.agents === undefined) {
    return true;
  }
  if (parsed.state.contextMode !== undefined && persisted.contextMode !== parsed.state.contextMode) {
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
  const parsed = parseSkillMd(skill.skillMd, { expectedName: skill.name });
  parsed.state._seededAt = new Date().toISOString();

  const manifestKey = skillManifestKey(skill.name);
  const stateRecord = parsed.state as unknown as Record<string, unknown>;
  const manifest = await collection.create(
    manifestKey,
    stateRecord as never,
    { replace: true },
  );
  await manifest.writeContent(skill.skillMd);

  for (const file of skill.files ?? []) {
    const key = skillFileKey(skill.name, file.path);
    // File entries carry their content in `writeContent`; state is unused.
    // `getOrCreate` makes the ensure-then-write a single call.
    const ref = await collection.getOrCreate(key);
    await ref.writeContent(file.content);
  }
}

async function loadMeta(
  collection: ResourceCollectionRef,
): Promise<SkillsCollectionMeta> {
  const ref = await collection.getOptional(META_KEY);
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
  await collection.create(
    META_KEY,
    { seededNames: meta.seededNames },
    { replace: true },
  );
}

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
 * holds. Additive `ensureSeeded` never deletes; this call is the one that does.
 *
 * Touches only names whose manifest is still there. For a name it does touch,
 * it deletes every key the new source does not carry, then writes through
 * the same path seeding uses so a withdrawn supporting file cannot stay reachable.
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

    const manifestKey = skillManifestKey(skill.name);
    if (!(await collection.getOptional(manifestKey))) {
      skipped.push(skill.name);
      continue;
    }

    try {
      removed.push(...(await replaceFolder(collection, skill)));
      refreshed.push(skill.name);
    } catch (err) {
      console.warn(
        `[skills] failed to refresh "${skill.name}": ${(err as Error).message}; the folder may be partial until the next refresh`,
      );
    }
  }

  return { refreshed, skipped, removed };
}

/**
 * Replace one skill's folder with the source's. Parse first so a broken
 * source never half-replaces a working folder; delete extras; then write
 * through the same path seeding uses.
 */
async function replaceFolder(
  collection: ResourceCollectionRef,
  skill: InitialSkill,
): Promise<string[]> {
  parseSkillMd(skill.skillMd, { expectedName: skill.name });

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

  await seedOne(collection, skill);
  return removed;
}

/**
 * A listed ref's `path` is the full storage key; `list` / `delete` take keys
 * relative to the collection prefix. `defineSkillsCollection` always builds
 * `"<prefix>/**"`.
 */
function bareKey(collection: ResourceCollectionRef, storagePath: string): string {
  const prefix = collection.pattern.replace(/\/\*\*$/, "");
  return prefix.length > 0 && storagePath.startsWith(`${prefix}/`)
    ? storagePath.slice(prefix.length + 1)
    : storagePath;
}

/** Test-only: clear the seeding sentinel cache. Not exported from the
 *  package barrel. */
export function _resetSeedingCache(collection?: ResourceCollectionRef): void {
  if (collection) sentinel.delete(collection);
  // No way to clear the entire WeakMap; tests pass the specific ref.
}
