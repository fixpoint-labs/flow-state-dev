/**
 * Declared field indexes, engine side: the startup check on declarations, the
 * index writer every resource write passes, and the lookup `findBy` reads.
 *
 * **The writer** ({@link withResourceIndexWriter}) wraps the `StoreRegistry`
 * the runtime resolves, so every handle derived from it, the run's resource
 * registry, the resource routes, and host code given `runtime.stores`, writes a
 * row together with its index entries. It computes a key's entries from every
 * registered declaration whose scope and pattern match the key and whose flow
 * keeps that key in the cell being written, not from the writing flow's, so a
 * flow that declares the same pattern without `indexes` still keeps another
 * flow's index whole, and a flow-isolated collection's index never runs on
 * another flow's isolated rows (whose schema it was never checked against).
 * A session or lineage cell's id names no flow, so there the writer takes the
 * cell's owner from the engine's own write ({@link ownedWrite}, stamped from
 * the flow the session record resolved to), or, for a write that carries none,
 * from the session record; only that flow's session declarations apply.
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
  getPatternPrefix,
  matchesPattern,
  type DeclaredResourceIndex,
} from "@flow-state-dev/core/types";
import type {
  ResourceIndexBuildEntry,
  ResourceIndexEntry,
  ResourceStateIndexes,
  ResourceStateSetOptions,
  ResourceStateStore,
  StorageScopeType,
  StoreRegistry,
} from "../stores/types";
import { resolveResourceIsolation, resourceCellInstance, toIsolationFlow } from "../stores/scope-keys";
import { isCollectionConfig } from "./is-collection-config";
import { resolveOwnershipFlag, sessionRoutingIndex, type OwnershipBuckets } from "./lineage-scope";
import { patternsReach } from "./owner-private";
import { resourceStorageKeys } from "./storage-keys";

/** A collection that declares indexes, as the writer and the check read it. */
export interface IndexedCollection {
  pattern: string;
  scope: "session" | "user" | "org";
  indexes: readonly DeclaredResourceIndex[];
  /** The id of the flow that declared it. */
  flowId: string;
  /** The cell its flow keeps `key` in (see {@link cellOfWrite}), by that flow's routing. */
  cellOf(key: string): string;
}

/** A flow as the index declarations read it. */
type IndexedFlow = {
  id: string;
  isolateUserState?: boolean;
  isolateOrgState?: boolean;
  resources?: Record<string, unknown>;
};

/** The declaration scope a storage scope's rows belong to: a lineage cell holds session rows. */
function declarationScopeOf(scopeType: StorageScopeType): IndexedCollection["scope"] {
  return scopeType === "lineage" ? "session" : scopeType;
}

/**
 * Which cell of its scope a write lands in: `lineage` or `session` at session
 * scope; `shared` or `flow:<id>` (isolated to that flow) at user and org
 * scope. `undefined` for a user or org `scopeId` of no shape the engine builds,
 * where every declaration in the scope applies.
 */
function cellOfWrite(scopeType: StorageScopeType, scopeId: string): string | undefined {
  if (scopeType === "lineage" || scopeType === "session") return scopeType;
  const instance = resourceCellInstance(scopeType, scopeId);
  if (instance === undefined) return undefined;
  return instance === null ? "shared" : `flow:${instance}`;
}

/**
 * How `flow` routes a key of `scope` to a cell, in {@link cellOfWrite}'s
 * terms: the declaration owning the key (longest prefix) decides, as it does
 * in execution, and an undeclared key takes the flow's default.
 */
function cellRouterOf(flow: IndexedFlow, scope: IndexedCollection["scope"]): (key: string) => string {
  if (scope === "session") {
    const { buckets } = sessionRoutingIndex(flow.resources);
    return (key) => (resolveOwnershipFlag(buckets, key) === true ? "lineage" : "session");
  }
  const isolation = toIsolationFlow(flow);
  const entries = Object.entries(flow.resources ?? {}).filter(
    ([, def]) => (def as { scope?: string } | null)?.scope === scope
  );
  const storageKeys = resourceStorageKeys(Object.fromEntries(entries));
  const singles = new Map<string, boolean>();
  const prefixes: Array<{ prefix: string; flag: boolean }> = [];
  for (const [accessor, def] of entries) {
    const flag = resolveResourceIsolation((def as { flowIsolation?: boolean }).flowIsolation, isolation, scope);
    if (isCollectionConfig(def)) {
      const rawPrefix = getPatternPrefix(def.pattern);
      prefixes.push({ prefix: rawPrefix === "" ? "" : `${rawPrefix}/`, flag });
    } else {
      singles.set(storageKeys[accessor] ?? accessor, flag);
    }
  }
  const buckets: OwnershipBuckets = { singles, prefixes };
  const fallback = scope === "user" ? isolation.isolateUserState : isolation.isolateOrgState;
  return (key) => ((resolveOwnershipFlag(buckets, key) ?? fallback) ? `flow:${flow.id}` : "shared");
}

/** The indexed collections among a flow's resources. */
function indexedCollectionsOf(flow: IndexedFlow): IndexedCollection[] {
  const out: IndexedCollection[] = [];
  for (const entry of Object.values(flow.resources ?? {})) {
    if (!isCollectionConfig(entry)) continue;
    const config = entry as { pattern: string; scope?: unknown; indexes?: Record<string, unknown> };
    const indexes = declaredIndexes(config);
    if (indexes.length === 0) continue;
    if (config.scope !== "session" && config.scope !== "user" && config.scope !== "org") continue;
    out.push({
      pattern: config.pattern,
      scope: config.scope,
      indexes,
      flowId: flow.id,
      cellOf: cellRouterOf(flow, config.scope),
    });
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
  incoming: IndexedFlow,
  known: readonly IndexedCollection[]
): readonly IndexedCollection[] {
  const added = indexedCollectionsOf(incoming);
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
        prior.flowId === collection.flowId &&
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
 * key and whose flow keeps the key in the cell being written. Every index
 * function sees the key and the state being written.
 */
function indexEntriesFor(
  collections: readonly IndexedCollection[],
  scopeType: StorageScopeType,
  scopeId: string,
  key: string,
  state: Record<string, unknown>,
  owner: string | undefined
): ResourceIndexEntry[] {
  const scope = declarationScopeOf(scopeType);
  const cell = cellOfWrite(scopeType, scopeId);
  const entries: ResourceIndexEntry[] = [];
  const seen = new Set<string>();
  for (const collection of collections) {
    if (collection.scope !== scope || !matchesPattern(collection.pattern, key)) continue;
    if (cell !== undefined && collection.cellOf(key) !== cell) continue;
    if (owner !== undefined && collection.flowId !== owner) continue;
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

/** Where {@link ownedWrite} stamps the owning flow on a write's options. */
const CELL_OWNER = Symbol("resourceCellOwner");

type OwnedSetOptions = ResourceStateSetOptions & { [CELL_OWNER]?: string };

/**
 * The `set` options that name `flowId` as the owner of the session or lineage
 * cell being written. For the engine's own writes, which hold the flow the
 * session record resolved to; a symbol, so no request input can carry it.
 * Ignored at user and org scope, whose cell ids already name their flow.
 */
export function ownedWrite(flowId: string): ResourceStateSetOptions {
  return { [CELL_OWNER]: flowId } as OwnedSetOptions;
}

/**
 * The flow whose session declarations apply to a write: the stamped owner,
 * else for a session cell the session record's `flowId`. `undefined` (every
 * declaration applies) at user and org scope, for a lineage cell written
 * without a stamp, and for a session with no record or a legacy one.
 */
async function cellOwnerOf(
  sessions: StoreRegistry["session"],
  scopeType: StorageScopeType,
  scopeId: string,
  options: OwnedSetOptions | undefined
): Promise<string | undefined> {
  if (scopeType !== "session" && scopeType !== "lineage") return undefined;
  const stamped = options?.[CELL_OWNER];
  if (stamped !== undefined || scopeType === "lineage") return stamped;
  return (await sessions.get(scopeId))?.flowId ?? undefined;
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
  const set: ResourceStateStore["set"] = async (scopeType, scopeId, key, state, expectedVersion, options) => {
    const { [CELL_OWNER]: _stamp, ...rest } = (options ?? {}) as OwnedSetOptions;
    const owner = await cellOwnerOf(stores.session, scopeType, scopeId, options);
    const computed = indexEntriesFor(collections(), scopeType, scopeId, key, state, owner);
    const ids = new Set(computed.map((entry) => `${entry.collection}\n${entry.index}`));
    const passed = (rest.indexEntries ?? []).filter((entry) => !ids.has(`${entry.collection}\n${entry.index}`));
    return store.set(scopeType, scopeId, key, state, expectedVersion, {
      ...rest,
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
