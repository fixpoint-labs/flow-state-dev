/**
 * Per-scope resource registry construction and resource normalization helpers.
 *
 * `createScopeResourceRegistry` builds the `ResourceRegistry` for a single
 * scope (session/user/org), handling static resources, collection refs with
 * LRU eviction, lazy-load wrappers, and lifecycle hooks. The normalization
 * and load helpers are used by both the registry and the main execution
 * context assembly to initialize per-scope caches.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  CollectionHookContext,
  JsonObject,
  JsonValue,
  ResourceConfig,
  ResourceCollectionConfig,
  ResourceCollectionRef,
  ResourceRef,
  ResourceRegistry,
  ScopeType,
} from "@flow-state-dev/core/types";
import {
  resolveCollectionKey,
  matchesPattern,
  getPatternPrefix,
} from "@flow-state-dev/core/types";
import type { ResourceLoadRecord } from "@flow-state-dev/core/items";
import { cloneValue, resolveClientProjection } from "@flow-state-dev/core/helpers";
import { isTraceObservabilityEnabled } from "@flow-state-dev/core";
import { createResourceEdgeApi } from "@flow-state-dev/core/graph";
import type { ContentScopeType, ContentStore, ResourceStateStore } from "../stores/types";
import { resourceStorageKeys } from "../resources/storage-keys";
import {
  isAnchoredPath,
  isParsedResourceTemplate,
  resolveContentPath,
} from "../resources/content-paths";
import { isJsonObject, asJsonObject } from "../utils/json-helpers";
import {
  parseResourceTemplate,
  renderResourceTemplate,
} from "@flow-state-dev/core/resource-template";
import { loadResourceTemplate } from "@flow-state-dev/core/resource-template/node";

function asJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => asJsonValue(entry)) as JsonValue;
  }

  if (!isJsonObject(value)) {
    return {};
  }

  const out: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = asJsonValue(entry);
  }

  return out;
}

/**
 * FIX-751: the state delta a mutation threads to `onResourceChanged` as its 4th
 * arg, used by the reactive dispatcher to build the `ResourceChange` payload.
 * `state` is the post-mutation state (omit for `deleted`); `prevState` the
 * pre-mutation state (omit for `created`); `evicted` is `true` only for a
 * capacity-driven removal. Declared once here and imported type-only by the
 * dispatcher and the execution context so the shape can't drift.
 */
export interface ResourceChangeDelta {
  state?: JsonObject;
  prevState?: JsonObject;
  evicted?: boolean;
}

function updateObjectState(
  currentState: JsonObject,
  updates: Partial<JsonObject>
): JsonObject {
  const next: JsonObject = {
    ...currentState
  };

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete next[key];
      continue;
    }

    next[key] = value;
  }

  return next;
}

/**
 * Outcome of a lazy on-demand load. `fetched` is true only when a real store
 * round-trip occurred (false for a cache short-circuit); `durationMs` is the
 * wall time of that round-trip. The lazy collection accessor wrapper uses this
 * to record a resource-load (`cacheHit = !fetched`) tagged with the accessor
 * that triggered it (FIX-701).
 */
export type LazyLoadOutcome = { fetched: boolean; durationMs: number };

/**
 * FIX-688: on-demand loaders backing a scope's lazy collection accessors.
 * `getInstance` loads a single instance (state + content) into the per-scope
 * cache so the ref handed back reads synchronously; `getByPrefix` bulk-loads a
 * collection's prefix for `list`/`count`. Both single-flight and merge
 * cache-wins so a concurrent mutation is never clobbered by an in-flight read.
 */
export type ScopeLazyLoad = {
  getInstance(storageKey: string): Promise<LazyLoadOutcome>;
  getByPrefix(keyPrefix: string): Promise<LazyLoadOutcome>;
};
function normalizeResourceDefault(config: ResourceConfig): JsonObject {
  if (config.default !== undefined && isJsonObject(config.default)) {
    return cloneValue(config.default);
  }

  const parsedFromUndefined = config.stateSchema.safeParse(undefined);
  if (parsedFromUndefined.success && isJsonObject(parsedFromUndefined.data)) {
    return asJsonObject(parsedFromUndefined.data);
  }

  const parsedFromEmptyObject = config.stateSchema.safeParse({});
  if (parsedFromEmptyObject.success && isJsonObject(parsedFromEmptyObject.data)) {
    return asJsonObject(parsedFromEmptyObject.data);
  }

  return {};
}

export function normalizeStateDefault(
  stateSchema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } } | undefined
): JsonObject {
  if (stateSchema === undefined) {
    return {};
  }

  const parsedFromUndefined = stateSchema.safeParse(undefined);
  if (parsedFromUndefined.success) {
    return asJsonObject(parsedFromUndefined.data);
  }

  const parsedFromEmptyObject = stateSchema.safeParse({});
  if (parsedFromEmptyObject.success) {
    return asJsonObject(parsedFromEmptyObject.data);
  }

  return {};
}

function normalizeResourceState(
  config: ResourceConfig,
  value: unknown
): JsonObject {
  const parsed = config.stateSchema.safeParse(value);
  if (parsed.success && isJsonObject(parsed.data)) {
    return asJsonObject(parsed.data);
  }

  return normalizeResourceDefault(config);
}

export function isCollectionConfig(config: unknown): config is ResourceCollectionConfig {
  return (
    typeof config === "object" &&
    config !== null &&
    "pattern" in config &&
    typeof (config as ResourceCollectionConfig).pattern === "string"
  );
}

export function normalizeScopeResources(
  configs: Record<string, ResourceConfig | ResourceCollectionConfig> | undefined,
  seed: Record<string, unknown> | undefined
): Record<string, JsonObject> {
  const normalized: Record<string, JsonObject> = {};
  const storageKeys = resourceStorageKeys(configs);

  for (const [accessor, config] of Object.entries(configs ?? {})) {
    // Skip collection configs — their instances are stored with path-based keys
    if (isCollectionConfig(config)) continue;

    const storageKey = storageKeys[accessor]!;
    if (storageKey in normalized) continue; // dual-registered alias
    normalized[storageKey] = normalizeResourceState(
      config,
      seed?.[storageKey]
    );
  }

  // Preserve any collection instance data from seed
  if (seed !== undefined) {
    for (const [key, value] of Object.entries(seed)) {
      if (key in normalized) continue; // already handled as static
      if (isJsonObject(value)) {
        normalized[key] = asJsonObject(value);
      }
    }
  }

  return normalized;
}

export function normalizeScopeResourceContent(
  configs: Record<string, ResourceConfig | ResourceCollectionConfig> | undefined,
  seed: Record<string, unknown> | undefined
): Record<string, string> {
  const normalized: Record<string, string> = {};
  const storageKeys = resourceStorageKeys(configs);

  for (const [accessor, config] of Object.entries(configs ?? {})) {
    // Skip collection configs — collection instances don't have definition-time content
    if (isCollectionConfig(config)) continue;

    const storageKey = storageKeys[accessor]!;
    if (storageKey in normalized) continue; // dual-registered alias

    const existing = seed?.[storageKey];
    if (typeof existing === "string") {
      normalized[storageKey] = existing;
      continue;
    }

    if (typeof config.content === "string") {
      normalized[storageKey] = config.content;
      continue;
    }

    const contentFile = config.contentFile;
    if (typeof contentFile === "string" || isAnchoredPath(contentFile)) {
      // Bare strings resolve from the working directory; anchored paths
      // resolve relative to their declaring module first (see content-paths).
      const filePath = resolveContentPath(contentFile, "contentFile", accessor);
      try {
        normalized[storageKey] = readFileSync(filePath, "utf8");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Failed to load contentFile for resource "${accessor}" (path: ${filePath}): ${message}`
        );
      }
    }
  }

  // Preserve any collection instance content from seed
  if (seed !== undefined) {
    for (const [key, value] of Object.entries(seed)) {
      if (key in normalized) continue;
      if (typeof value === "string") {
        normalized[key] = value;
      }
    }
  }

  return normalized;
}

/**
 * Resolve string and anchored-path `contentTemplate` values into parsed
 * `ResourceTemplate` objects in-place. Called once per execution context so
 * downstream code always sees a `ResourceTemplate`, never a raw path. Bare
 * strings resolve from the working directory; `AnchoredPath` values resolve
 * relative to their declaring module first (see `resolveContentPath`).
 */
export function resolveStringContentTemplates(
  configs: Record<string, ResourceConfig | ResourceCollectionConfig>
): void {
  for (const [accessor, config] of Object.entries(configs)) {
    const contentTemplate = config.contentTemplate;
    if (typeof contentTemplate !== "string" && !isAnchoredPath(contentTemplate)) continue;
    const filePath = resolveContentPath(contentTemplate, "contentTemplate", accessor);
    try {
      (config as { contentTemplate: unknown }).contentTemplate =
        loadResourceTemplate(filePath, pathToFileURL(filePath).href);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        `Failed to load contentTemplate for resource "${accessor}" (path: ${filePath}): ${message}`
      );
    }
  }
}

/**
 * Load only the content a scope's declared resources reference. Fixed
 * resources resolve to a single storage key (`content.get`); collections
 * resolve to their pattern prefix (`content.getByPrefix`, where an empty
 * prefix loads every instance in the scope). A scope with no declared
 * resources issues no content read at all. The merged map seeds
 * `normalizeScopeResourceContent`, so undeclared keys never enter the
 * execution context.
 */
export async function loadDeclaredScopeContent(
  content: ContentStore,
  scopeType: ContentScopeType,
  scopeId: string,
  configs: Record<string, ResourceConfig | ResourceCollectionConfig>
): Promise<Record<string, string>> {
  const accessors = Object.entries(configs);
  if (accessors.length === 0) return {};

  const storageKeys = resourceStorageKeys(configs);
  const fixedKeys = new Set<string>();
  const collectionReads: Array<Promise<Record<string, string>>> = [];

  for (const [accessor, config] of accessors) {
    if (isCollectionConfig(config)) {
      const prefix = getPatternPrefix(config.pattern);
      // A non-empty static prefix targets the collection's `prefix/...`
      // namespace; an empty prefix (e.g. `[topic]/observations`) loads
      // every key in the scope.
      const keyPrefix = prefix === "" ? "" : `${prefix}/`;
      collectionReads.push(content.getByPrefix(scopeType, scopeId, keyPrefix));
    } else {
      fixedKeys.add(storageKeys[accessor]!);
    }
  }

  const [collectionResults, fixedResults] = await Promise.all([
    Promise.all(collectionReads),
    Promise.all(
      [...fixedKeys].map(
        async (key) => [key, await content.get(scopeType, scopeId, key)] as const
      )
    )
  ]);

  const seed: Record<string, string> = {};
  for (const result of collectionResults) {
    Object.assign(seed, result);
  }
  for (const [key, value] of fixedResults) {
    if (typeof value === "string") seed[key] = value;
  }
  return seed;
}

/**
 * Load only the state a scope's declared resources reference (FIX-689), the
 * state-layer twin of `loadDeclaredScopeContent`. Fixed resources resolve to a
 * single storage key (`resourceState.get`); collections resolve to their
 * pattern prefix (`resourceState.getByPrefix`, where an empty prefix loads
 * every instance in the scope). A scope with no declared resources issues no
 * state read at all. The merged map seeds `normalizeScopeResources`, which
 * fills declared single-resource defaults and preserves loaded collection
 * instances — so undeclared keys never enter the execution context.
 */
export async function loadDeclaredResourceState(
  resourceState: ResourceStateStore,
  scopeType: ContentScopeType,
  scopeId: string,
  configs: Record<string, ResourceConfig | ResourceCollectionConfig>
): Promise<Record<string, JsonObject>> {
  const accessors = Object.entries(configs);
  if (accessors.length === 0) return {};

  const storageKeys = resourceStorageKeys(configs);
  const fixedKeys = new Set<string>();
  const collectionReads: Array<Promise<Record<string, JsonObject>>> = [];

  for (const [accessor, config] of accessors) {
    if (isCollectionConfig(config)) {
      const prefix = getPatternPrefix(config.pattern);
      const keyPrefix = prefix === "" ? "" : `${prefix}/`;
      collectionReads.push(resourceState.getByPrefix(scopeType, scopeId, keyPrefix));
    } else {
      fixedKeys.add(storageKeys[accessor]!);
    }
  }

  const [collectionResults, fixedResults] = await Promise.all([
    Promise.all(collectionReads),
    Promise.all(
      [...fixedKeys].map(
        async (key) => [key, await resourceState.get(scopeType, scopeId, key)] as const
      )
    )
  ]);

  const seed: Record<string, JsonObject> = {};
  for (const result of collectionResults) {
    Object.assign(seed, result);
  }
  for (const [key, value] of fixedResults) {
    if (value !== undefined) seed[key] = value;
  }
  return seed;
}

/**
 * FIX-688 Wave 1: narrow a scope's declared resources to the flow-level,
 * non-lazy subset that loads at request start. Resources declared inside an
 * action's block tree load at action/block dispatch (Waves 2 & 3); lazy
 * resources load on first access. When `flowLevelKeys` covers every accessor
 * (the back-compat default), this returns the full set — preserving the
 * pre-FIX-688 "load everything at request start" behaviour.
 */
export function filterFlowLevelEager(
  configs: Record<string, ResourceConfig | ResourceCollectionConfig>,
  flowLevelKeys: ReadonlySet<string>
): Record<string, ResourceConfig | ResourceCollectionConfig> {
  const out: Record<string, ResourceConfig | ResourceCollectionConfig> = {};
  for (const [accessor, config] of Object.entries(configs)) {
    if (!flowLevelKeys.has(accessor)) continue;
    if ((config as { prefetchMode?: string }).prefetchMode === "lazy") continue;
    out[accessor] = config;
  }
  return out;
}

export function createScopeResourceRegistry<TResources extends Record<string, ResourceRef<any>>>(
  options: {
    scope: ScopeType;
    /**
     * Identifier of the concrete scope instance — `userId` for `"user"`,
     * `orgId` for `"org"`, `sessionId` for `"session"`. Threaded into
     * `CollectionHookContext.scopeId` so per-instance lifecycle hooks
     * can correlate mutations back to the owning entity.
     */
    scopeId: string;
    configs: Record<string, ResourceConfig | ResourceCollectionConfig> | undefined;
    readResources: () => Record<string, JsonObject>;
    readResourceContent: () => Record<string, string>;
    /**
     * Persist a single resource / collection-instance state key (FIX-744).
     * Commits the one key to the durable store and mutates the live scope
     * cache IN PLACE (`cache[key] = value`) — never snapshots and replaces the
     * whole map. This is what lets concurrent distinct-key writes from
     * parallel branches coexist in the in-memory view instead of clobbering.
     */
    persistResourceKey: (key: string, value: JsonObject) => Promise<void>;
    /** Remove a single state key: durable per-key delete plus in-place live-cache delete. */
    deleteResourceKey: (key: string) => Promise<void>;
    /** Persist a single resource's content body: durable per-key write plus in-place live-cache set. */
    persistResourceContentKey: (key: string, content: string) => Promise<void>;
    /** Remove a single resource's content body: durable per-key delete plus in-place live-cache delete. */
    deleteResourceContentKey: (key: string) => Promise<void>;
    /**
     * Called after any resource mutation so the streaming layer can push change
     * events to clients. The optional `projection` carries the mutated
     * instance's projected `clientData` slice — populated only for resources
     * declaring `client.live: true` — so the change event ships an inline delta
     * the client merges without a refetch (FIX-739). Omitted for non-live
     * resources (the streaming layer falls back to a batched refetch) and for
     * `deleted` / content-only changes (nothing to project).
     */
    onResourceChanged?: (
      resourcePath: string,
      changeType: "created" | "updated" | "deleted",
      projection?: { delta: JsonValue },
      // FIX-751: state delta for the reactive dispatcher (see ResourceChangeDelta).
      // Awaitable so reactive blocks run inline within the mutating turn.
      change?: ResourceChangeDelta
    ) => void | Promise<void>;
    /**
     * FIX-688: on-demand loaders for `prefetchMode: 'lazy'` collections. When
     * present, lazy collection accessors ensure the target instance/prefix is
     * loaded into the cache before delegating to the eager method body. Omitted
     * for scopes/contexts that don't support lazy loading (mock registries),
     * where a lazy collection falls back to the eager cache-only behaviour.
     */
    lazyLoad?: ScopeLazyLoad;
    /**
     * FIX-701: trace observability. `recordResourceLoad` pushes one load record
     * (gating + aggregation happen in the execution context); `resolveEagerSource`
     * tells an eager cache-hit read which wave paid for the prefetch. Both omitted
     * in mock/unit contexts, where reads are not recorded.
     */
    recordResourceLoad?: (rec: Omit<ResourceLoadRecord, "count">) => void;
    resolveEagerSource?: (keyOrPrefix: string) => ResourceLoadRecord["source"];
    /** Cross-scope template resolver, populated post-construction. */
    templateResolverRef?: { current: ((ref: string) => string | null) | null };
  }
): ResourceRegistry<TResources> {
  const handles = {} as Record<string, ResourceRef<JsonObject> | ResourceCollectionRef<JsonObject>>;
  const configs = options.configs ?? {};

  /**
   * Compute the live projection payload for a mutation, or `undefined` when the
   * resource hasn't opted into `client.live`. Reuses `resolveClientProjection`
   * so the streamed delta is byte-identical to the slice the snapshot builder
   * would later send. A throwing `client.data` projection degrades to no delta
   * (the mutation already committed; the client falls back to a batched
   * refetch) rather than failing the mutation (FIX-739).
   *
   * Ordering: callers `await` this between persist and emit. For the common
   * `expose`/`exclude` projection it resolves synchronously, so emit order
   * matches persist order. A `client.data` function may be async; the client
   * merge is last-write-wins, so two *concurrent* mutations to the same
   * instance whose `data()` promises resolve out of order could surface a stale
   * delta. That requires concurrent writers on one instance — rare in practice;
   * sequential mutations (the norm) are always ordered.
   */
  const liveProjection = async (
    cfg: { client?: { live?: boolean } } | undefined,
    nextState: JsonObject
  ): Promise<{ delta: JsonValue } | undefined> => {
    if (cfg?.client?.live !== true) return undefined;
    try {
      const delta = await resolveClientProjection(
        cfg.client as Parameters<typeof resolveClientProjection>[0],
        nextState
      );
      return { delta };
    } catch {
      return undefined;
    }
  };

  const persistResourceState = async (
    name: string,
    config: ResourceConfig,
    next: unknown
  ): Promise<void> => {
    if (config.writable === false) {
      throw new Error(`Resource "${name}" is read-only`);
    }

    await options.persistResourceKey(name, normalizeResourceState(config, next));
  };

  // --- Namespace instance persistence helpers ---
  const persistNamespaceInstanceState = async (
    storageKey: string,
    nsConfig: ResourceCollectionConfig,
    next: unknown
  ): Promise<void> => {
    const parsed = nsConfig.stateSchema.safeParse(next);
    const value = parsed.success && isJsonObject(parsed.data) ? asJsonObject(parsed.data) : {};

    await options.persistResourceKey(storageKey, value);
  };

  const deleteNamespaceInstance = async (
    storageKey: string
  ): Promise<void> => {
    await options.deleteResourceKey(storageKey);

    // Also remove content if present
    if (storageKey in options.readResourceContent()) {
      await options.deleteResourceContentKey(storageKey);
    }
  };

  /**
   * Create a ResourceRef for a collection instance at a given storage key.
   */
  function createNamespaceInstanceRef(
    storageKey: string,
    nsConfig: ResourceCollectionConfig,
    nsHookCtx?: CollectionHookContext
  ): ResourceRef<JsonObject> {
    const readState = (): JsonObject => {
      const raw = options.readResources()[storageKey];
      if (raw !== undefined) return cloneValue(raw);
      // Parse defaults from schema
      const parsed = nsConfig.stateSchema.safeParse({});
      return parsed.success && isJsonObject(parsed.data) ? asJsonObject(parsed.data) : {};
    };

    const ref: ResourceRef<JsonObject> = {
      path: storageKey,
      scope: options.scope,
      uri: `${options.scope}/${storageKey}`,
      config: nsConfig as unknown as ResourceConfig,
      get state() {
        return readState();
      },
      async patchState(updates: Partial<JsonObject>): Promise<void> {
        const prev = readState();
        await persistNamespaceInstanceState(
          storageKey,
          nsConfig,
          updateObjectState(prev, updates)
        );
        if (nsConfig.onInstanceUpdated && nsHookCtx) {
          await nsConfig.onInstanceUpdated(
            storageKey,
            readState(),
            prev,
            nsHookCtx
          );
        }
        await options.onResourceChanged?.(storageKey, "updated", await liveProjection(nsConfig, readState()), { state: readState(), prevState: prev, evicted: false });
      },
      async setState(nextState: JsonObject): Promise<void> {
        const prev = readState();
        await persistNamespaceInstanceState(storageKey, nsConfig, nextState);
        if (nsConfig.onInstanceUpdated && nsHookCtx) {
          await nsConfig.onInstanceUpdated(
            storageKey,
            readState(),
            prev,
            nsHookCtx
          );
        }
        await options.onResourceChanged?.(storageKey, "updated", await liveProjection(nsConfig, readState()), { state: readState(), prevState: prev, evicted: false });
      },
      async updateState(
        updater: (state: JsonObject) => JsonObject | Promise<JsonObject>
      ): Promise<void> {
        // Pass the updater a fresh clone so an in-place mutation can't alias
        // `prev` — `prev` is the pre-mutation state for the hook and reactive payload.
        const prev = readState();
        const next = await updater(readState());
        await persistNamespaceInstanceState(storageKey, nsConfig, next);
        if (nsConfig.onInstanceUpdated && nsHookCtx) {
          await nsConfig.onInstanceUpdated(
            storageKey,
            readState(),
            prev,
            nsHookCtx
          );
        }
        await options.onResourceChanged?.(storageKey, "updated", await liveProjection(nsConfig, readState()), { state: readState(), prevState: prev, evicted: false });
      },
      async readContentRaw(): Promise<string | null> {
        if (isParsedResourceTemplate(nsConfig.contentTemplate)) {
          return nsConfig.contentTemplate.source;
        }
        if (nsConfig.contentTemplateRef !== undefined) {
          const resolver = options.templateResolverRef?.current;
          if (!resolver) return null;
          return resolver(nsConfig.contentTemplateRef);
        }
        const content = options.readResourceContent()[storageKey];
        return typeof content === "string" ? content : null;
      },
      async readContent(): Promise<string | null> {
        if (isParsedResourceTemplate(nsConfig.contentTemplate)) {
          return renderResourceTemplate(nsConfig.contentTemplate, readState());
        }
        if (nsConfig.contentTemplateRef !== undefined) {
          const resolver = options.templateResolverRef?.current;
          if (!resolver) {
            throw new Error(
              `Cannot resolve contentTemplateRef "${nsConfig.contentTemplateRef}" for collection instance "${storageKey}" — template resolver not available`
            );
          }
          const rawTemplate = resolver(nsConfig.contentTemplateRef);
          if (rawTemplate === null) return null;
          const template = parseResourceTemplate(rawTemplate);
          return renderResourceTemplate(template, readState());
        }
        const raw = options.readResourceContent()[storageKey];
        return typeof raw === "string" ? raw : null;
      },
      async writeContent(content: string): Promise<void> {
        await options.persistResourceContentKey(storageKey, content);
        // Content-only change carries no state delta. Fire the seam so the
        // FIX-739 client projection refreshes, but pass no 4th arg: the reactive
        // dispatcher skips content-only changes (reactive bindings react to state
        // mutations, not content writes).
        await options.onResourceChanged?.(storageKey, "updated");
      }
    };

    // Attach the typed-edge API when the collection declared an `edges` slot,
    // so each instance ref carries `.edges` backed by its own state.
    if (nsConfig.edges) {
      (ref as { edges?: unknown }).edges = createResourceEdgeApi(
        ref as never,
        nsConfig.edges === true ? {} : nsConfig.edges
      );
    }

    return ref;
  }

  // Storage key for each accessor. Dual-registered aliases collapse to a
  // single canonical key so their state lives in one slot (FIX-591).
  const storageKeys = resourceStorageKeys(configs);

  for (const [resourceName, config] of Object.entries(configs)) {
    if (isCollectionConfig(config)) {
      // --- Create collection ref ---
      const nsConfig = config;
      // LRU tracking: storageKey → last access timestamp
      const lruAccess = new Map<string, number>();

      /** Populated hook context for lifecycle callbacks. */
      const hookCtx: CollectionHookContext = {
        log: (_message: string) => {
          // Hook log messages are available for debugging; runtime logger
          // integration is handled at a higher level when available.
        },
        scopeType: options.scope,
        scopeId: options.scopeId,
      };

      // FIX-701: prefix for this collection's list/count reads (e.g. "files/").
      const nsPatternPrefix = getPatternPrefix(nsConfig.pattern);
      const nsCollectionKeyPrefix = nsPatternPrefix === "" ? "" : `${nsPatternPrefix}/`;
      // Record an eager collection read as a cache hit (the data is already in
      // the per-scope cache). Skipped for lazy collections — their wrapper
      // records the read itself with fetch/cache-hit detail, so recording here
      // too would double-count. No-op when no recorder is wired (mock contexts).
      const recordEagerRead = (
        accessor: ResourceLoadRecord["accessor"],
        storageKey: string
      ): void => {
        if (!isTraceObservabilityEnabled()) return; // zero work per read when off
        if (nsConfig.prefetchMode === "lazy") return;
        options.recordResourceLoad?.({
          storageKey,
          scope: options.scope as ResourceLoadRecord["scope"],
          // All instances of a collection share the wave that loaded its
          // prefix, so resolve the source from the prefix, not the instance key.
          source: options.resolveEagerSource?.(nsCollectionKeyPrefix) ?? "action-eager",
          durationMs: 0,
          cacheHit: true,
          accessor
        });
      };

      const nsHandle: ResourceCollectionRef<JsonObject> = {
        pattern: nsConfig.pattern,
        scope: options.scope,
        config: nsConfig,

        async get(key: string | Record<string, string>): Promise<ResourceRef<JsonObject>> {
          const storageKey = resolveCollectionKey(nsConfig.pattern, key);
          const resources = options.readResources();
          if (!(storageKey in resources)) {
            // Record nothing — a throwing get read no cached instance.
            throw new Error(`Resource instance "${storageKey}" not found in collection "${nsConfig.pattern}"`);
          }
          recordEagerRead("get", storageKey);
          lruAccess.set(storageKey, Date.now());
          return createNamespaceInstanceRef(storageKey, nsConfig, hookCtx);
        },

        async getOptional(key: string | Record<string, string>): Promise<ResourceRef<JsonObject> | undefined> {
          const storageKey = resolveCollectionKey(nsConfig.pattern, key);
          const resources = options.readResources();
          if (!(storageKey in resources)) {
            // Absent instance read nothing from cache — no load record.
            return undefined;
          }
          recordEagerRead("getOptional", storageKey);
          lruAccess.set(storageKey, Date.now());
          return createNamespaceInstanceRef(storageKey, nsConfig, hookCtx);
        },

        async create(
          key: string | Record<string, string>,
          initial?: Partial<JsonObject>,
          createOptions?: { replace?: boolean }
        ): Promise<ResourceRef<JsonObject>> {
          const storageKey = resolveCollectionKey(nsConfig.pattern, key);

          // Validate that key matches pattern
          if (!matchesPattern(nsConfig.pattern, storageKey)) {
            throw new Error(
              `Key "${storageKey}" does not match collection pattern "${nsConfig.pattern}"`
            );
          }

          const resources = options.readResources();
          const exists = storageKey in resources;
          const replace = createOptions?.replace === true;

          if (exists && !replace) {
            throw new Error(`Resource instance "${storageKey}" already exists`);
          }

          // Check instance limits ONLY when adding a new instance. The replace
          // branch reuses an existing storage slot, so it can't push us over
          // maxInstances.
          if (!exists) {
            const currentCount = countInstances(nsConfig.pattern, resources);
            if (nsConfig.maxInstances !== undefined && currentCount >= nsConfig.maxInstances) {
              const eviction = nsConfig.eviction ?? "none";
              if (eviction === "none") {
                throw new Error(
                  `Namespace "${nsConfig.pattern}" has reached maxInstances (${nsConfig.maxInstances})`
                );
              }
              // Evict one instance — persists the deletion
              await evictInstance(nsConfig, resources, eviction, lruAccess, options.deleteResourceKey, hookCtx, options.onResourceChanged);
            }
          }

          // Validate state via schema — throw on invalid input, never silent fallback.
          // Defaults declared on the schema (e.g. `.nullable().default(null)`,
          // per BP-023) fill missing fields on both the create and replace
          // branches, so callers only supply the non-nullable scaffold.
          const parseResult = nsConfig.stateSchema.safeParse(initial ?? {});
          if (!parseResult.success) {
            const issue = parseResult.error.issues[0];
            const issuePath = issue === undefined ? "" : issue.path.join(".");
            const issueMessage = issue === undefined ? "schema validation failed" : issue.message;
            const pathSuffix = issuePath.length > 0 ? ` at "${issuePath}"` : "";
            const opLabel = replace && exists ? "create(replace)" : "create";
            throw new Error(
              `Namespace "${nsConfig.pattern}" ${opLabel}("${storageKey}") state validation failed${pathSuffix}: ${issueMessage}`
            );
          }

          const state = isJsonObject(parseResult.data) ? asJsonObject(parseResult.data) : {};

          // Capture (cloned) prior state for the updated-hook before
          // persisting. Clone so hook code that caches or mutates `prev`
          // can't observe stale store internals — matches the defensive
          // copy on the per-instance `setState`/`patchState` paths.
          const prevState = exists
            ? (cloneValue(resources[storageKey] as JsonObject) as JsonObject)
            : undefined;

          await options.persistResourceKey(storageKey, state);

          lruAccess.set(storageKey, Date.now());

          if (exists) {
            if (nsConfig.onInstanceUpdated) {
              await nsConfig.onInstanceUpdated(storageKey, state, prevState ?? {}, hookCtx);
            }
            await options.onResourceChanged?.(storageKey, "updated", await liveProjection(nsConfig, state), { state, prevState, evicted: false });
          } else {
            if (nsConfig.onInstanceCreated) {
              await nsConfig.onInstanceCreated(storageKey, state, hookCtx);
            }
            await options.onResourceChanged?.(storageKey, "created", await liveProjection(nsConfig, state), { state, prevState: undefined, evicted: false });
          }

          return createNamespaceInstanceRef(storageKey, nsConfig, hookCtx);
        },

        async getOrCreate(
          key: string | Record<string, string>,
          initial?: Partial<JsonObject>
        ): Promise<ResourceRef<JsonObject>> {
          const storageKey = resolveCollectionKey(nsConfig.pattern, key);
          const resources = options.readResources();
          if (storageKey in resources) {
            lruAccess.set(storageKey, Date.now());
            return createNamespaceInstanceRef(storageKey, nsConfig, hookCtx);
          }
          return nsHandle.create(key, initial);
        },

        async upsert(
          key: string | Record<string, string>,
          update: Partial<JsonObject>,
          createOnly?: Partial<JsonObject>
        ): Promise<ResourceRef<JsonObject>> {
          const storageKey = resolveCollectionKey(nsConfig.pattern, key);

          // Validate that key matches pattern. We do this here so the
          // create-branch error (from nsHandle.create) and the patch-branch
          // path produce equivalent diagnostics.
          if (!matchesPattern(nsConfig.pattern, storageKey)) {
            throw new Error(
              `Key "${storageKey}" does not match collection pattern "${nsConfig.pattern}"`
            );
          }

          const resources = options.readResources();
          const exists = storageKey in resources;

          if (exists) {
            // Patch branch: merge `update` over existing state, validate the
            // merged shape explicitly, then persist. We pre-validate (rather
            // than rely on `persistNamespaceInstanceState`'s safeParse-with-
            // empty-fallback) so a bad `update` throws loudly — matching the
            // create branch's behavior. Without this, an invalid `update`
            // would silently overwrite the resource with `{}` on the patch
            // branch but throw on the create branch — an asymmetry that
            // makes caller bugs hard to detect.
            const rawPrev = resources[storageKey] as JsonObject;
            const merged = updateObjectState(rawPrev, update);
            const parseResult = nsConfig.stateSchema.safeParse(merged);
            if (!parseResult.success) {
              const issue = parseResult.error.issues[0];
              const issuePath = issue === undefined ? "" : issue.path.join(".");
              const issueMessage = issue === undefined ? "schema validation failed" : issue.message;
              const pathSuffix = issuePath.length > 0 ? ` at "${issuePath}"` : "";
              throw new Error(
                `Namespace "${nsConfig.pattern}" upsert("${storageKey}") state validation failed${pathSuffix}: ${issueMessage}`
              );
            }
            // Clone `prev` before passing it to the hook — matches the
            // defensive copy `readState()` does on the per-instance
            // `patchState` path. Hook code that caches or mutates `prev`
            // shouldn't be able to observe stale store internals.
            const prev = cloneValue(rawPrev) as JsonObject;
            await persistNamespaceInstanceState(storageKey, nsConfig, merged);
            lruAccess.set(storageKey, Date.now());
            const postState = (options.readResources()[storageKey] as JsonObject | undefined) ?? {};
            if (nsConfig.onInstanceUpdated) {
              await nsConfig.onInstanceUpdated(storageKey, postState, prev, hookCtx);
            }
            await options.onResourceChanged?.(storageKey, "updated", await liveProjection(nsConfig, postState), { state: postState, prevState: prev, evicted: false });
            return createNamespaceInstanceRef(storageKey, nsConfig, hookCtx);
          }

          // Create branch: delegate to `create`. Merge `update` over
          // `createOnly` so update wins on overlapping keys (the delta is
          // the "what I'm trying to express now"; createOnly is the
          // scaffold that only matters at first creation).
          const initial = { ...(createOnly ?? {}), ...update };
          return nsHandle.create(key, initial);
        },

        async list(prefix?: string): Promise<ResourceRef<JsonObject>[]> {
          recordEagerRead("list", nsCollectionKeyPrefix);
          const resources = options.readResources();
          const instances: ResourceRef<JsonObject>[] = [];

          for (const storageKey of Object.keys(resources)) {
            if (!matchesPattern(nsConfig.pattern, storageKey)) continue;
            if (prefix !== undefined) {
              const nsPrefix = getPatternPrefix(nsConfig.pattern);
              const fullPrefix = nsPrefix.length > 0 ? `${nsPrefix}/${prefix}` : prefix;
              if (!storageKey.startsWith(fullPrefix)) continue;
            }
            instances.push(createNamespaceInstanceRef(storageKey, nsConfig, hookCtx));
          }

          return instances;
        },

        async delete(key: string | Record<string, string>): Promise<void> {
          const storageKey = resolveCollectionKey(nsConfig.pattern, key);
          const resources = options.readResources();
          if (!(storageKey in resources)) {
            // Idempotent — no-op if instance doesn't exist
            return;
          }

          // Capture the about-to-be-deleted state before the per-key delete so
          // the reactive `deleted` payload can carry it as `prevState`.
          const deletedPrevState = cloneValue(resources[storageKey] as JsonObject) as JsonObject;

          await deleteNamespaceInstance(storageKey);
          lruAccess.delete(storageKey);

          if (nsConfig.onInstanceDeleted) {
            await nsConfig.onInstanceDeleted(storageKey, hookCtx);
          }

          // A live collection streams deletes too (delta `null`) so the client
          // tombstones the item mid-stream without a refetch; the collection's
          // count / list membership reconcile on the next snapshot. Non-live
          // deletes carry no delta and fall through to the batched-refetch path.
          await options.onResourceChanged?.(
            storageKey,
            "deleted",
            nsConfig.client?.live === true ? { delta: null } : undefined,
            { state: undefined, prevState: deletedPrevState, evicted: false }
          );
        },

        async count(): Promise<number> {
          recordEagerRead("count", nsCollectionKeyPrefix);
          const resources = options.readResources();
          return countInstances(nsConfig.pattern, resources);
        }
      };

      // FIX-688/FIX-700: lazy collections hold only a partial cache and need
      // to load instances on demand before reads. The eager nsHandle already
      // has async reads (FIX-700), so we only need to inject the load-first
      // wrapper for lazy collections — the API contract is the same either way.
      if (nsConfig.prefetchMode === "lazy" && options.lazyLoad !== undefined) {
        const lazyLoad = options.lazyLoad;
        const nsPrefix = getPatternPrefix(nsConfig.pattern);
        const collectionKeyPrefix = nsPrefix === "" ? "" : `${nsPrefix}/`;
        const ensureInstance = (key: string | Record<string, string>): Promise<LazyLoadOutcome> =>
          lazyLoad.getInstance(resolveCollectionKey(nsConfig.pattern, key));
        const ensurePrefix = (): Promise<LazyLoadOutcome> => lazyLoad.getByPrefix(collectionKeyPrefix);
        // FIX-701: record a lazy read — `cacheHit = !fetched` (true when the
        // ensure short-circuited on an already-loaded key/prefix), with the
        // store round-trip's wall time. The accessor that triggered it is the
        // label; the eager nsHandle delegate below suppresses its own record.
        const recordLazyRead = (
          accessor: ResourceLoadRecord["accessor"],
          keyOrPrefix: string,
          outcome: LazyLoadOutcome
        ): void => {
          if (!isTraceObservabilityEnabled()) return; // zero work per read when off
          options.recordResourceLoad?.({
            storageKey: keyOrPrefix,
            scope: options.scope as ResourceLoadRecord["scope"],
            source: "lazy",
            durationMs: outcome.durationMs,
            cacheHit: !outcome.fetched,
            accessor
          });
        };

        const lazyHandle: ResourceCollectionRef<JsonObject> = {
          pattern: nsConfig.pattern,
          scope: options.scope,
          config: nsConfig,
          async get(key: string | Record<string, string>): Promise<ResourceRef<JsonObject>> {
            const outcome = await ensureInstance(key);
            recordLazyRead("get", resolveCollectionKey(nsConfig.pattern, key), outcome);
            return nsHandle.get(key);
          },
          async getOptional(
            key: string | Record<string, string>
          ): Promise<ResourceRef<JsonObject> | undefined> {
            const outcome = await ensureInstance(key);
            recordLazyRead("getOptional", resolveCollectionKey(nsConfig.pattern, key), outcome);
            return nsHandle.getOptional(key);
          },
          async list(prefix?: string): Promise<ResourceRef<JsonObject>[]> {
            const outcome = await ensurePrefix();
            recordLazyRead("list", collectionKeyPrefix, outcome);
            return nsHandle.list(prefix);
          },
          async count(): Promise<number> {
            const outcome = await ensurePrefix();
            recordLazyRead("count", collectionKeyPrefix, outcome);
            return nsHandle.count();
          },
          async create(
            key: string | Record<string, string>,
            initial?: Partial<JsonObject>,
            createOptions?: { replace?: boolean }
          ): Promise<ResourceRef<JsonObject>> {
            await ensureInstance(key);
            return nsHandle.create(key, initial, createOptions);
          },
          async getOrCreate(
            key: string | Record<string, string>,
            initial?: Partial<JsonObject>
          ): Promise<ResourceRef<JsonObject>> {
            await ensureInstance(key);
            return nsHandle.getOrCreate(key, initial);
          },
          async upsert(
            key: string | Record<string, string>,
            update: Partial<JsonObject>,
            createOnly?: Partial<JsonObject>
          ): Promise<ResourceRef<JsonObject>> {
            await ensureInstance(key);
            return nsHandle.upsert(key, update, createOnly);
          },
          async delete(key: string | Record<string, string>): Promise<void> {
            await ensureInstance(key);
            return nsHandle.delete(key);
          }
        };

        handles[resourceName] = lazyHandle as unknown as ResourceRef<JsonObject>;
        continue;
      }

      handles[resourceName] = nsHandle as unknown as ResourceRef<JsonObject>;
      continue;
    }

    // --- Static resource ---
    // Storage key may differ from the accessor name when this ref is
    // dual-registered under a different alias elsewhere in the flow.
    const storageKey = storageKeys[resourceName] ?? resourceName;

    const readState = (): JsonObject =>
      cloneValue(
        options.readResources()[storageKey] ??
          normalizeResourceDefault(config)
      );

    // Static single resources don't emit resource_change on state mutation by
    // default (only collections do). A `client.live: true` single resource opts
    // into emission so its projected delta merges into the client snapshot
    // mid-stream (FIX-739); non-live singles stay silent on the streaming side.
    //
    // FIX-751: a single with `reactTo` also needs the seam to fire so its
    // reactive block runs, even when it isn't live. So we fire whenever the
    // resource is live OR declares `reactTo`. The live `projection` stays gated
    // on `client.live` (only live resources compute a delta); the `change`
    // delta carries `{ state, prevState }` so the dispatcher can build the
    // payload. `prev` is the pre-mutation state, captured by the caller.
    const notifySingleChange = async (prev: JsonObject): Promise<void> => {
      if (config.client?.live !== true && config.reactTo === undefined) return;
      const projection =
        config.client?.live === true
          ? await liveProjection(config, readState())
          : undefined;
      await options.onResourceChanged?.(
        storageKey,
        "updated",
        projection,
        { state: readState(), prevState: prev, evicted: false }
      );
    };

    handles[resourceName] = {
      path: storageKey,
      scope: options.scope,
      uri: `${options.scope}/${storageKey}`,
      config,
      get state() {
        return readState();
      },
      async patchState(updates: Partial<JsonObject>): Promise<void> {
        const prev = readState();
        await persistResourceState(
          storageKey,
          config,
          updateObjectState(prev, updates)
        );
        await notifySingleChange(prev);
      },
      async setState(nextState: JsonObject): Promise<void> {
        const prev = readState();
        await persistResourceState(storageKey, config, nextState);
        await notifySingleChange(prev);
      },
      async updateState(
        updater: (
          state: JsonObject
        ) => JsonObject | Promise<JsonObject>
      ): Promise<void> {
        // Pass the updater a fresh clone so an in-place mutation can't alias
        // `prev` — `prev` is the pre-mutation `prevState` for the reactive payload.
        const prev = readState();
        const next = await updater(readState());
        await persistResourceState(storageKey, config, next);
        await notifySingleChange(prev);
      },
      async readContentRaw(): Promise<string | null> {
        if (isParsedResourceTemplate(config.contentTemplate)) {
          return config.contentTemplate.source;
        }
        if (config.contentTemplateRef !== undefined) {
          const resolver = options.templateResolverRef?.current;
          if (!resolver) return null;
          return resolver(config.contentTemplateRef);
        }
        const content = options.readResourceContent()[storageKey];
        return typeof content === "string" ? content : null;
      },
      async readContent(): Promise<string | null> {
        if (isParsedResourceTemplate(config.contentTemplate)) {
          return renderResourceTemplate(config.contentTemplate, readState());
        }
        if (config.contentTemplateRef !== undefined) {
          const resolver = options.templateResolverRef?.current;
          if (!resolver) {
            throw new Error(
              `Cannot resolve contentTemplateRef "${config.contentTemplateRef}" for resource "${resourceName}" — template resolver not available`
            );
          }
          const rawTemplate = resolver(config.contentTemplateRef);
          if (rawTemplate === null) return null;
          const template = parseResourceTemplate(rawTemplate);
          return renderResourceTemplate(template, readState());
        }
        const raw = options.readResourceContent()[storageKey];
        if (typeof raw !== "string") {
          return null;
        }

        if (config.render === undefined) {
          return raw;
        }

        return await config.render(raw, readState());
      },
      async writeContent(content: string): Promise<void> {
        if (config.writable === false) {
          throw new Error(`Resource "${resourceName}" content is read-only`);
        }

        await options.persistResourceContentKey(storageKey, content);
        // Content-only change carries no state delta. Fire the seam so the
        // FIX-739 client projection refreshes, but pass no 4th arg: the reactive
        // dispatcher skips content-only changes (reactive bindings react to state
        // mutations, not content writes). Mirrors the collection-instance content
        // path (FIX-756 parity).
        await options.onResourceChanged?.(storageKey, "updated");
      }
    };

    // Attach the typed-edge API when the resource declared an `edges` slot.
    // It reads/writes through this ref's own state via `updateState`, so edge
    // writes persist and emit `onResourceChanged` like any other state write.
    if (config.edges) {
      (handles[resourceName] as { edges?: unknown }).edges = createResourceEdgeApi(
        handles[resourceName] as never,
        config.edges === true ? {} : config.edges
      );
    }
  }

  return {
    ...(handles as TResources),
    get(name) {
      const handle = handles[String(name)];
      if (handle === undefined) {
        throw new Error(`Resource "${String(name)}" is not registered`);
      }

      return handle as TResources[keyof TResources];
    },
    list() {
      return Object.values(handles) as Array<TResources[keyof TResources]>;
    }
  } as ResourceRegistry<TResources>;
}

function countInstances(
  pattern: string,
  resources: Record<string, JsonObject>
): number {
  let count = 0;
  for (const key of Object.keys(resources)) {
    if (matchesPattern(pattern, key)) count++;
  }
  return count;
}

async function evictInstance(
  nsConfig: ResourceCollectionConfig,
  resources: Record<string, JsonObject>,
  policy: "lru" | "oldest",
  lruAccess: Map<string, number>,
  deleteResourceKey: (key: string) => Promise<void>,
  hookCtx: CollectionHookContext,
  // FIX-751: fired after the per-key delete with `evicted: true` so a reactive
  // `deleted` binding can distinguish a capacity eviction from an explicit
  // delete. Omitted by callers that don't wire the seam (mock registries).
  onResourceChanged?: (
    resourcePath: string,
    changeType: "created" | "updated" | "deleted",
    projection?: { delta: JsonValue },
    change?: ResourceChangeDelta
  ) => void | Promise<void>
): Promise<void> {
  const keys = Object.keys(resources).filter((k) =>
    matchesPattern(nsConfig.pattern, k)
  );

  if (keys.length === 0) return;

  let evictKey: string;
  if (policy === "lru") {
    // Evict least-recently-used (lowest timestamp in lruAccess)
    evictKey = keys.reduce((oldest, key) => {
      const oldestTime = lruAccess.get(oldest) ?? 0;
      const keyTime = lruAccess.get(key) ?? 0;
      return keyTime < oldestTime ? key : oldest;
    }, keys[0]!);
  } else {
    // "oldest" — evict first key (insertion order)
    evictKey = keys[0]!;
  }

  // Capture the evicted state before the delete so the reactive `deleted`
  // payload can carry it as `prevState`.
  const evictedPrevState = cloneValue(resources[evictKey] as JsonObject) as JsonObject;

  // Per-key delete: removes evictKey from the durable store and the live cache
  // in place, leaving sibling instances untouched.
  await deleteResourceKey(evictKey);
  lruAccess.delete(evictKey);

  if (nsConfig.onInstanceDeleted) {
    await nsConfig.onInstanceDeleted(evictKey, hookCtx);
  }

  // A live collection streams evictions too (delta `null`) so the client
  // tombstones the item mid-stream, matching the explicit `delete()` path.
  await onResourceChanged?.(
    evictKey,
    "deleted",
    nsConfig.client?.live === true ? { delta: null } : undefined,
    { state: undefined, prevState: evictedPrevState, evicted: true }
  );
}
