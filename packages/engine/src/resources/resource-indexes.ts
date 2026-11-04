/**
 * Declared field indexes, engine side: the startup check on declarations, the
 * index writer every resource write passes, and the lookup `findBy` reads.
 *
 * **The writer** ({@link withResourceIndexWriter}) wraps the `StoreRegistry`
 * the runtime resolves, so every handle derived from it, the run's resource
 * registry, the resource routes, and host code given `runtime.stores`, writes a
 * row together with its index entries. It computes a key's entries from every
 * registered declaration whose scope and pattern match the key, not from the
 * writing flow's, so a flow that declares the same pattern without `indexes`
 * still keeps another flow's index whole.
 *
 * **The lookup** ({@link findIndexedKeys}) answers from the store's index
 * when the scope's index is built, and otherwise builds it: it marks the build
 * begun, scans the collection's rows, adds their entries and marks the index
 * built only if no undeclared write cleared the marker during the scan. A
 * store without index verbs is not asked: the caller scans instead.
 *
 * **The check** ({@link admitIndexedCollections}) runs when a flow registers:
 * one index name at two versions on overlapping patterns in one scope is
 * refused, because the two would keep clearing each other's build. Functions
 * cannot be compared, so name and version are the identity.
 *
 * The rule the store keeps is on `ResourceStateIndexes` (`stores/types.ts`);
 * the canonical value form is core's (`canonicalIndexValues`).
 */
import {
  canonicalIndexValues,
  declaredIndexes,
  matchesPattern,
  type DeclaredResourceIndex,
} from "@flow-state-dev/core/types";
import type {
  ResourceIndexBuildEntry,
  ResourceIndexEntry,
  ResourceStateIndexes,
  ResourceStateStore,
  StorageScopeType,
  StoreRegistry,
} from "../stores/types";
import { isCollectionConfig } from "./is-collection-config";
import { patternsReach } from "./owner-private";

/** A collection that declares indexes, as the writer and the check read it. */
export interface IndexedCollection {
  pattern: string;
  scope: "session" | "user" | "org";
  indexes: readonly DeclaredResourceIndex[];
}

/** The declaration scope a storage scope's rows belong to: a lineage cell holds session rows. */
function declarationScopeOf(scopeType: StorageScopeType): IndexedCollection["scope"] {
  return scopeType === "lineage" ? "session" : scopeType;
}

/** The indexed collections among a flow's resources. */
function indexedCollectionsOf(resources: Record<string, unknown> | undefined): IndexedCollection[] {
  const out: IndexedCollection[] = [];
  for (const entry of Object.values(resources ?? {})) {
    if (!isCollectionConfig(entry)) continue;
    const config = entry as { pattern: string; scope?: unknown; indexes?: Record<string, unknown> };
    const indexes = declaredIndexes(config);
    if (indexes.length === 0) continue;
    if (config.scope !== "session" && config.scope !== "user" && config.scope !== "org") continue;
    out.push({ pattern: config.pattern, scope: config.scope, indexes });
  }
  return out;
}

/**
 * The startup check, for one registration. Throws when the incoming flow
 * declares an index name at a version another declaration in the same scope,
 * on a pattern that can reach the same keys, declares differently, whether
 * that declaration is the incoming flow's own or one already admitted.
 *
 * @returns every indexed collection the registry holds once this flow is
 * admitted. Kept for good, like the owner-key fence's declarations: the rows
 * outlive the registration.
 */
export function admitIndexedCollections(
  incoming: { resources?: Record<string, unknown> },
  known: readonly IndexedCollection[]
): readonly IndexedCollection[] {
  const added = indexedCollectionsOf(incoming.resources);
  if (added.length === 0) return known;
  const all = [...known];
  for (const collection of added) {
    for (const prior of all) {
      if (prior.scope !== collection.scope || !patternsReach(prior.pattern, collection.pattern)) continue;
      for (const index of collection.indexes) {
        const clash = prior.indexes.find((other) => other.name === index.name && other.version !== index.version);
        if (clash === undefined) continue;
        throw new Error(
          `Index "${index.name}" is declared at version ${index.version} on collection "${collection.pattern}" ` +
            `and at version ${clash.version} on collection "${prior.pattern}", in ${collection.scope} scope, ` +
            `and the two patterns can reach the same keys. Declare one version.`
        );
      }
    }
    const same = all.some(
      (prior) =>
        prior.scope === collection.scope &&
        prior.pattern === collection.pattern &&
        prior.indexes.length === collection.indexes.length &&
        prior.indexes.every((index, i) => index.stored === collection.indexes[i]!.stored)
    );
    if (!same) all.push(collection);
  }
  return all;
}

/**
 * A row's entries for every declared index whose scope and pattern cover its
 * key. Every index function sees the key and the state being written.
 */
export function indexEntriesFor(
  collections: readonly IndexedCollection[],
  scopeType: StorageScopeType,
  key: string,
  state: Record<string, unknown>
): ResourceIndexEntry[] {
  const scope = declarationScopeOf(scopeType);
  const entries: ResourceIndexEntry[] = [];
  const seen = new Set<string>();
  for (const collection of collections) {
    if (collection.scope !== scope || !matchesPattern(collection.pattern, key)) continue;
    for (const index of collection.indexes) {
      const id = `${collection.pattern}\n${index.stored}`;
      if (seen.has(id)) continue;
      seen.add(id);
      entries.push({
        collection: collection.pattern,
        index: index.stored,
        values: canonicalIndexValues(index.value(key, state as never)),
      });
    }
  }
  return entries;
}

/** Every resource-state store this module has wrapped, so a registry is wrapped once. */
const WRITERS = new WeakSet<object>();

/**
 * The registry with its resource-state store's `set` handing the store every
 * row's index entries, computed from `collections()` (read on each write, so a
 * flow registered later is covered). Entries a caller passes for an index no
 * declaration computes are kept. Every other store and verb is the original.
 * A registry already wrapped is returned as it is.
 */
export function withResourceIndexWriter<T extends StoreRegistry>(
  stores: T,
  collections: () => readonly IndexedCollection[]
): T {
  if (WRITERS.has(stores.resourceState)) return stores;
  const store = stores.resourceState;
  const set: ResourceStateStore["set"] = (scopeType, scopeId, key, state, expectedVersion, options) => {
    const computed = indexEntriesFor(collections(), scopeType, key, state);
    const ids = new Set(computed.map((entry) => `${entry.collection}\n${entry.index}`));
    const passed = (options?.indexEntries ?? []).filter((entry) => !ids.has(`${entry.collection}\n${entry.index}`));
    return store.set(scopeType, scopeId, key, state, expectedVersion, {
      ...options,
      indexEntries: [...computed, ...passed],
    });
  };
  // A method assigned on the wrapper (a test's instrumented `get`) lands on
  // the store, except `set`, which would bypass the writer.
  let assignedSet: ResourceStateStore["set"] | undefined;
  const wrapper = new Proxy(store, {
    get(target, key) {
      if (key === "set") return assignedSet ?? set;
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
    set(target, key, value) {
      if (key !== "set") return Reflect.set(target, key, value, target);
      assignedSet = value === set ? undefined : (value as ResourceStateStore["set"]);
      return true;
    },
  });
  WRITERS.add(wrapper);
  return { ...stores, resourceState: wrapper };
}

/** Where a collection's rows live in one scope, as a lookup reads them. */
export interface IndexedLookupTarget {
  store: ResourceStateStore;
  indexes: ResourceStateIndexes;
  scopeType: StorageScopeType;
  scopeId: string;
  /** The collection's full declared pattern. */
  collection: string;
  /** The storage prefix its rows sit under: `""` or ending in `/`. */
  keyPrefix: string;
}

/**
 * The keys with an entry of canonical `value` for `index`, from the store's
 * index, building it first when the scope's index is not built. A superset:
 * the caller re-checks each key against its row.
 */
export async function findIndexedKeys(
  target: IndexedLookupTarget,
  index: DeclaredResourceIndex,
  value: string
): Promise<string[]> {
  const { store, indexes, scopeType, scopeId, collection, keyPrefix } = target;
  if ((await indexes.state(scopeType, scopeId, collection, index.stored)) === "built") {
    return indexes.findKeys(scopeType, scopeId, collection, index.stored, value);
  }
  // Mark the build begun before reading, so a write that lands during the
  // scan and does not carry this index's entries clears the marker, and the
  // build does not claim a row it never saw.
  const build = await indexes.beginBuild(scopeType, scopeId, collection, index.stored);
  const rows = await store.getByPrefix(scopeType, scopeId, keyPrefix);
  const entries: ResourceIndexBuildEntry[] = [];
  for (const [key, row] of Object.entries(rows)) {
    if (!matchesPattern(collection, key)) continue;
    entries.push({ key, values: canonicalIndexValues(index.value(key, row.state as never)) });
  }
  // When a write cleared the marker, the scan still answers this lookup; the
  // next one builds again.
  await indexes.completeBuild(scopeType, scopeId, collection, index.stored, build, entries);
  return entries
    .filter((entry) => entry.values.includes(value))
    .map((entry) => entry.key)
    .sort();
}
