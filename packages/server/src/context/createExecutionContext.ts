import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import type {
  AnyResourceRef,
  ItemQuery,
  JournalEntry,
  JournalEntryInput,
  JsonObject,
  JsonValue,
  LLMMessage,
  MessageLimit,
  CollectionHookContext,
  OrgScopeHandle,
  RequestScopeHandle,
  ResourceConfig,
  ResourceRef,
  ResourceRegistry,
  ResourceCollectionConfig,
  ResourceCollectionRef,
  ScopeType,
  SessionItem,
  SessionItemViews,
  SessionMetadataInput,
  SessionScopeHandle,
  UserScopeHandle,
  FlowInstance,
  TokenCounter
} from "@flow-state-dev/core/types";
import {
  isDefinedResourceCollection,
  resolveCollectionKey,
  normalizeResourcePath,
  matchesPattern,
  getPatternPrefix,
} from "@flow-state-dev/core/types";
import type {
  AgentType,
  BlockTraceItem,
  ToolOutputItem,
  ComponentItem,
  ContainerItem,
  Content,
  ItemProvenance,
  MessageItem,
  OutputItem,
  RouterDecisionItem,
  StateChangeItem,
  StateSnapshotItem,
  StatusItem
} from "@flow-state-dev/core/items";
import { resolveItemVisibility } from "@flow-state-dev/core/items";
import type { BlockValueInternal } from "@flow-state-dev/core/items/internal";
import { resolveBlockValueInternal } from "@flow-state-dev/core/items/internal";
import type { BlockContext, BlockOutputHint, BlockResult, ExecutionParent, StateRef } from "@flow-state-dev/core/types";
import { createScopeStateOps, createStateContainer } from "../stores/state-container";
import { createScopePersist } from "../stores/scope-persist";
import type { TraceStore } from "../stores/types";
import type {
  ContentScopeType,
  ContentStore,
  ResourceStateStore,
  OrgRecord,
  RequestRecord,
  SessionRecord,
  UserRecord
} from "../stores/types";
import { createModelResolver } from "@flow-state-dev/core/models";
import type { ModelResolver } from "@flow-state-dev/core";
import { sanitizeToolName } from "@flow-state-dev/core/helpers";
import { logRuntimeEvent, summarizeForLog } from "../execution/logging";
import { createRequestWorkPool } from "../execution/request-work-pool";
import { isTraceObservabilityEnabled } from "@flow-state-dev/core";
import type { TracingLevel } from "@flow-state-dev/core";
import { cloneValue, deepEqual, getTransientKeys } from "@flow-state-dev/core/helpers";
import { AmbiguousBlockNameError } from "../errors/flow-error";
import { normalizeError } from "../errors/normalize-error";
import { isJsonObject, asJsonObject } from "../utils/json-helpers";
import {
  resolveUserStorageKey,
  resolveOrgStorageKey
} from "../stores/scope-keys";
import { resourceStorageKeys } from "../resources/storage-keys";
import type { CreateExecutionContextOptions, ExecutionContext } from "./types";
import { OrgBindingMismatchError, UserBindingMismatchError } from "./binding-errors";


function normalizeLimit(
  valuesLength: number,
  limit: MessageLimit | undefined
): number {
  if (limit === undefined) {
    return valuesLength;
  }

  if (typeof limit === "number") {
    return Math.max(0, Math.min(valuesLength, limit));
  }

  if ("turns" in limit) {
    return Math.max(0, Math.min(valuesLength, limit.turns));
  }

  return Math.max(0, Math.min(valuesLength, limit.tokens));
}

function listByQuery<TValue>(
  values: TValue[],
  query: { limit?: MessageLimit } | undefined
): TValue[] {
  const max = normalizeLimit(values.length, query?.limit);
  if (max >= values.length) {
    return [...values];
  }

  return values.slice(Math.max(0, values.length - max));
}

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

function normalizeStateDefault(
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

function isCollectionConfig(config: unknown): config is ResourceCollectionConfig {
  return (
    typeof config === "object" &&
    config !== null &&
    "pattern" in config &&
    typeof (config as ResourceCollectionConfig).pattern === "string"
  );
}

function normalizeScopeResources(
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

function normalizeScopeResourceContent(
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

    if (typeof config.contentFile === "string") {
      try {
        // contentFile is resolved relative to process.cwd()
        normalized[storageKey] = readFileSync(config.contentFile, "utf8");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Failed to load contentFile for resource "${accessor}" (path: ${config.contentFile}): ${message}`
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
 * Load only the content a scope's declared resources reference. Fixed
 * resources resolve to a single storage key (`content.get`); collections
 * resolve to their pattern prefix (`content.getByPrefix`, where an empty
 * prefix loads every instance in the scope). A scope with no declared
 * resources issues no content read at all. The merged map seeds
 * `normalizeScopeResourceContent`, so undeclared keys never enter the
 * execution context.
 */
async function loadDeclaredScopeContent(
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
async function loadDeclaredResourceState(
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
function filterFlowLevelEager(
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
 * FIX-688: on-demand loaders backing a scope's lazy collection accessors.
 * `getInstance` loads a single instance (state + content) into the per-scope
 * cache so the ref handed back reads synchronously; `getByPrefix` bulk-loads a
 * collection's prefix for `list`/`count`. Both single-flight and merge
 * cache-wins so a concurrent mutation is never clobbered by an in-flight read.
 */
type ScopeLazyLoad = {
  getInstance(storageKey: string): Promise<void>;
  getByPrefix(keyPrefix: string): Promise<void>;
};

function createScopeResourceRegistry<TResources extends Record<string, ResourceRef<any>>>(
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
    persistResources: (next: Record<string, JsonObject>) => Promise<void>;
    readResourceContent: () => Record<string, string>;
    persistResourceContent: (next: Record<string, string>) => Promise<void>;
    /** Called after any resource mutation so the streaming layer can push change events to clients. */
    onResourceChanged?: (resourcePath: string, changeType: "created" | "updated" | "deleted") => void;
    /**
     * FIX-688: on-demand loaders for `prefetchMode: 'lazy'` collections. When
     * present, lazy collection accessors ensure the target instance/prefix is
     * loaded into the cache before delegating to the eager method body. Omitted
     * for scopes/contexts that don't support lazy loading (mock registries),
     * where a lazy collection falls back to the eager cache-only behaviour.
     */
    lazyLoad?: ScopeLazyLoad;
  }
): ResourceRegistry<TResources> {
  const handles = {} as Record<string, ResourceRef<JsonObject> | ResourceCollectionRef<JsonObject>>;
  const configs = options.configs ?? {};

  const persistResourceState = async (
    name: string,
    config: ResourceConfig,
    next: unknown
  ): Promise<void> => {
    if (config.writable === false) {
      throw new Error(`Resource "${name}" is read-only`);
    }

    const nextResources = {
      ...options.readResources(),
      [name]: normalizeResourceState(config, next)
    };

    await options.persistResources(nextResources);
  };

  const persistResourceContent = async (
    name: string,
    content: string
  ): Promise<void> => {
    const nextContent = {
      ...options.readResourceContent(),
      [name]: content
    };

    await options.persistResourceContent(nextContent);
  };

  // --- Namespace instance persistence helpers ---
  const persistNamespaceInstanceState = async (
    storageKey: string,
    nsConfig: ResourceCollectionConfig,
    next: unknown
  ): Promise<void> => {
    const parsed = nsConfig.stateSchema.safeParse(next);
    const value = parsed.success && isJsonObject(parsed.data) ? asJsonObject(parsed.data) : {};

    const nextResources = {
      ...options.readResources(),
      [storageKey]: value
    };

    await options.persistResources(nextResources);
  };

  const deleteNamespaceInstance = async (
    storageKey: string
  ): Promise<void> => {
    const current = options.readResources();
    const next = { ...current };
    delete next[storageKey];

    await options.persistResources(next);

    // Also remove content if present
    const currentContent = options.readResourceContent();
    if (storageKey in currentContent) {
      const nextContent = { ...currentContent };
      delete nextContent[storageKey];
      await options.persistResourceContent(nextContent);
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

    return {
      name: storageKey,
      scope: options.scope,
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
        options.onResourceChanged?.(storageKey, "updated");
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
        options.onResourceChanged?.(storageKey, "updated");
      },
      async updateState(
        updater: (state: JsonObject) => JsonObject | Promise<JsonObject>
      ): Promise<void> {
        const prev = readState();
        const next = await updater(prev);
        await persistNamespaceInstanceState(storageKey, nsConfig, next);
        if (nsConfig.onInstanceUpdated && nsHookCtx) {
          await nsConfig.onInstanceUpdated(
            storageKey,
            readState(),
            prev,
            nsHookCtx
          );
        }
        options.onResourceChanged?.(storageKey, "updated");
      },
      async readContentRaw(): Promise<string | null> {
        const content = options.readResourceContent()[storageKey];
        return typeof content === "string" ? content : null;
      },
      async readContent(): Promise<string | null> {
        const raw = options.readResourceContent()[storageKey];
        return typeof raw === "string" ? raw : null;
      },
      async writeContent(content: string): Promise<void> {
        const nextContent = {
          ...options.readResourceContent(),
          [storageKey]: content
        };
        await options.persistResourceContent(nextContent);
        options.onResourceChanged?.(storageKey, "updated");
      }
    };
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

      const nsHandle: ResourceCollectionRef<JsonObject> = {
        pattern: nsConfig.pattern,
        scope: options.scope,
        config: nsConfig,

        get(key: string | Record<string, string>): ResourceRef<JsonObject> {
          const storageKey = resolveCollectionKey(nsConfig.pattern, key);
          const resources = options.readResources();
          if (!(storageKey in resources)) {
            throw new Error(`Resource instance "${storageKey}" not found in collection "${nsConfig.pattern}"`);
          }
          lruAccess.set(storageKey, Date.now());
          return createNamespaceInstanceRef(storageKey, nsConfig, hookCtx);
        },

        getOptional(key: string | Record<string, string>): ResourceRef<JsonObject> | undefined {
          const storageKey = resolveCollectionKey(nsConfig.pattern, key);
          const resources = options.readResources();
          if (!(storageKey in resources)) {
            return undefined;
          }
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
              await evictInstance(nsConfig, resources, eviction, lruAccess, options.persistResources, hookCtx);
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

          const nextResources = { ...(options.readResources()), [storageKey]: state };
          await options.persistResources(nextResources);

          lruAccess.set(storageKey, Date.now());

          if (exists) {
            if (nsConfig.onInstanceUpdated) {
              await nsConfig.onInstanceUpdated(storageKey, state, prevState ?? {}, hookCtx);
            }
            options.onResourceChanged?.(storageKey, "updated");
          } else {
            if (nsConfig.onInstanceCreated) {
              await nsConfig.onInstanceCreated(storageKey, state, hookCtx);
            }
            options.onResourceChanged?.(storageKey, "created");
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
            if (nsConfig.onInstanceUpdated) {
              const next = (options.readResources()[storageKey] as JsonObject | undefined) ?? {};
              await nsConfig.onInstanceUpdated(storageKey, next, prev, hookCtx);
            }
            options.onResourceChanged?.(storageKey, "updated");
            return createNamespaceInstanceRef(storageKey, nsConfig, hookCtx);
          }

          // Create branch: delegate to `create`. Merge `update` over
          // `createOnly` so update wins on overlapping keys (the delta is
          // the "what I'm trying to express now"; createOnly is the
          // scaffold that only matters at first creation).
          const initial = { ...(createOnly ?? {}), ...update };
          return nsHandle.create(key, initial);
        },

        list(prefix?: string): ResourceRef<JsonObject>[] {
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

          await deleteNamespaceInstance(storageKey);
          lruAccess.delete(storageKey);

          if (nsConfig.onInstanceDeleted) {
            await nsConfig.onInstanceDeleted(storageKey, hookCtx);
          }

          options.onResourceChanged?.(storageKey, "deleted");
        },

        count(): number {
          const resources = options.readResources();
          return countInstances(nsConfig.pattern, resources);
        }
      };

      // FIX-688: a lazy collection holds only a partial cache. Wrap the eager
      // handle so each accessor first ensures the target instance (or, for
      // list/count, the collection prefix) is loaded into the cache, then
      // delegates to the eager body — which reads/writes the now-populated
      // cache. Reads (get/getOptional/list/count) become async; mutations were
      // already async. maxInstances/eviction stay best-effort (they only see
      // loaded instances), as documented on the config type.
      if (nsConfig.prefetchMode === "lazy" && options.lazyLoad !== undefined) {
        const lazyLoad = options.lazyLoad;
        const nsPrefix = getPatternPrefix(nsConfig.pattern);
        const collectionKeyPrefix = nsPrefix === "" ? "" : `${nsPrefix}/`;
        const ensureInstance = (key: string | Record<string, string>): Promise<void> =>
          lazyLoad.getInstance(resolveCollectionKey(nsConfig.pattern, key));
        const ensurePrefix = (): Promise<void> => lazyLoad.getByPrefix(collectionKeyPrefix);

        const lazyHandle = {
          pattern: nsConfig.pattern,
          scope: options.scope,
          config: nsConfig,
          async get(key: string | Record<string, string>): Promise<ResourceRef<JsonObject>> {
            await ensureInstance(key);
            return nsHandle.get(key);
          },
          async getOptional(
            key: string | Record<string, string>
          ): Promise<ResourceRef<JsonObject> | undefined> {
            await ensureInstance(key);
            return nsHandle.getOptional(key);
          },
          async list(prefix?: string): Promise<ResourceRef<JsonObject>[]> {
            await ensurePrefix();
            return nsHandle.list(prefix);
          },
          async count(): Promise<number> {
            await ensurePrefix();
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

    handles[resourceName] = {
      name: storageKey,
      scope: options.scope,
      config,
      get state() {
        return readState();
      },
      async patchState(updates: Partial<JsonObject>): Promise<void> {
        await persistResourceState(
          storageKey,
          config,
          updateObjectState(readState(), updates)
        );
      },
      async setState(nextState: JsonObject): Promise<void> {
        await persistResourceState(storageKey, config, nextState);
      },
      async updateState(
        updater: (
          state: JsonObject
        ) => JsonObject | Promise<JsonObject>
      ): Promise<void> {
        const next = await updater(readState());
        await persistResourceState(storageKey, config, next);
      },
      async readContentRaw(): Promise<string | null> {
        const content = options.readResourceContent()[storageKey];
        return typeof content === "string" ? content : null;
      },
      async readContent(): Promise<string | null> {
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

        await persistResourceContent(storageKey, content);
      }
    };
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
  persistResources: (next: Record<string, JsonObject>) => Promise<void>,
  hookCtx: CollectionHookContext
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

  // Persist the deletion without mutating the caller's map — persistResources
  // diffs next-vs-cache to derive the per-key delete, so the cache must still
  // hold evictKey when it runs.
  const next = { ...resources };
  delete next[evictKey];
  await persistResources(next);
  lruAccess.delete(evictKey);

  if (nsConfig.onInstanceDeleted) {
    await nsConfig.onInstanceDeleted(evictKey, hookCtx);
  }
}

function ensureJournalDefaults(record: SessionRecord): void {
  if (!Array.isArray(record.journal)) {
    record.journal = [];
  }
}

function defineStateProperty<THandle extends object, TState extends object>(
  handle: THandle,
  readState: () => Readonly<TState>
): THandle & { readonly state: Readonly<TState> } {
  return Object.defineProperty(handle, "state", {
    enumerable: true,
    get: readState
  }) as THandle & { readonly state: Readonly<TState> };
}

/**
 * Set of item types that enter LLM context.
 * `tool_output` is the dedicated tool-result type.
 */
const LLM_AUDIENCE_TYPES = new Set([
  "message",
  "reasoning",
  "tool_output"
]);

/**
 * Set of item types visible to the client.
 * `block_trace`, `context` are NOT client-visible.
 */
const CLIENT_AUDIENCE_TYPES = new Set([
  "message",
  "reasoning",
  "component",
  "container",
  "tool_output",
  "status",
  "source",
  "state_change",
  "resource_change",
  "error",
]);

/**
 * Converts a persisted OutputItem into an LLM-ready message.
 *
 * Items with `history: false` (resolved via `resolveItemVisibility`) are
 * excluded. Returns an empty array for item types that don't map to
 * conversation messages (status, state_change, resource_change, etc.).
 *
 * `allItems` is used to resolve `block_output` BlockValue refs back to their
 * source items (FIX-413); pass the same list you're iterating over.
 */
function itemToLLMMessages(item: OutputItem | BlockTraceItem, allItems: readonly (OutputItem | BlockTraceItem)[]): LLMMessage[] {
  if (!resolveItemVisibility(item as OutputItem).history) {
    return [];
  }

  if (item.type === "message") {
    const msg = item as MessageItem;
    const text = (msg.content ?? [])
      .filter((c) => c.type === "output_text")
      .map((c) => (c as { text: string }).text)
      .join("");

    if (text.length === 0) {
      return [];
    }

    return [{ role: msg.role, content: text }];
  }

  if (item.type === "reasoning") {
    const summary = (item as { summary: Content[] }).summary ?? [];
    const text = summary
      .filter((c) => c.type === "output_text" || c.type === "reasoning_text")
      .map((c) => (c as { text: string }).text)
      .join("");

    return text.length > 0
      ? [{ role: "assistant", content: text }]
      : [];
  }

  if (item.type === "tool_output") {
    const bto = item as ToolOutputItem;
    const resultText = bto.status === "failed" && bto.error
      ? `Tool "${bto.toolCall.name}" failed: ${bto.error.message}`
      : typeof bto.output === "string"
        ? bto.output
        : JSON.stringify(bto.output);

    let input: Record<string, unknown> = {};
    try { input = JSON.parse(bto.toolCall.arguments); } catch { /* use empty */ }
    // Replay uses the model-facing alias the LLM saw, not the framework
    // block name. Items written before the `alias` field existed fall back
    // to deriving it from `name`; once those have aged out, the fallback can
    // be removed.
    const replayName = bto.toolCall.alias ?? sanitizeToolName(bto.toolCall.name);
    return [
      {
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: bto.toolCall.callId,
          toolName: replayName,
          input
        }]
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: bto.toolCall.callId,
          toolName: replayName,
          output: { type: "text", value: resultText }
        }]
      }
    ];
  }

  return [];
}

/**
 * Trims orphaned tool messages from the start/end of a sliced message array.
 * AI SDK v6 requires assistant tool-call messages to be immediately followed
 * by their matching tool-result messages. When a numeric or token-based limit
 * slices mid-pair, the orphaned message causes models to produce empty output
 * (AI_NoOutputGeneratedError). This function:
 *  - Drops leading `tool` role messages (orphaned results without their call)
 *  - Drops trailing `assistant` messages that contain only tool-call parts
 *    (orphaned calls without their result)
 */
function trimOrphanedToolMessages(messages: LLMMessage[]): LLMMessage[] {
  let start = 0;
  let end = messages.length;

  // Trim leading orphaned tool-result messages
  while (start < end && messages[start]!.role === "tool") {
    start++;
  }

  // Trim trailing orphaned assistant tool-call messages
  while (end > start) {
    const last = messages[end - 1]!;
    if (last.role !== "assistant" || !Array.isArray(last.content)) break;
    const isToolCallOnly = last.content.every(
      (part: any) => part.type === "tool-call"
    );
    if (!isToolCallOnly) break;
    end--;
  }

  if (start === 0 && end === messages.length) return messages;
  return messages.slice(start, end);
}

/**
 * Expands the items of a single RequestRecord into LLM-ready messages.
 *
 * Applies, in order: a stable sort by `(ts, itemIndex)`, the transient
 * filter, the allowed-item-types filter, and `itemToLLMMessages` per item.
 * `itemToLLMMessages` internally applies `resolveItemVisibility` so
 * sub-agent and trace items are dropped here as well.
 *
 * `allowedRoles`, when set, drops any produced LLM message whose role is
 * not in the allowlist.
 *
 * Sort-equivalence assumption: this expands and sorts items per request,
 * not globally. That is safe because completed prior requests have
 * non-overlapping `(ts, itemIndex)` ranges — `priorRequests` is sorted by
 * `startedAtMs` and a completed request's items have timestamps strictly
 * within its lifetime. Concatenating expansions of pre-ordered requests
 * therefore preserves the same global ordering the previous flatten-then-
 * sort path produced.
 */
function expandRequestToMessages(
  items: readonly (OutputItem | BlockTraceItem)[],
  allowedTypes: Set<string>,
  allowedRoles: Set<"user" | "assistant" | "system" | "developer" | "tool"> | undefined,
): LLMMessage[] {
  const sorted = [...items].sort((a, b) => {
    const tsDiff = a.ts - b.ts;
    return tsDiff !== 0 ? tsDiff : a.itemIndex - b.itemIndex;
  });

  const out: LLMMessage[] = [];
  for (const item of sorted) {
    if (item.transient === true) continue;
    if (!allowedTypes.has(item.type)) continue;

    const llmMessages = itemToLLMMessages(item, sorted);
    for (const llmMessage of llmMessages) {
      if (
        allowedRoles !== undefined &&
        !allowedRoles.has(
          llmMessage.role as "user" | "assistant" | "system" | "developer" | "tool"
        )
      ) {
        continue;
      }
      out.push(llmMessage);
    }
  }
  return out;
}

type SelectedTurn = { messages: LLMMessage[] };

/**
 * Selects which prior requests participate in history given the limit,
 * returning each selected turn's pre-expanded `LLMMessage[]` so callers
 * can assemble the final array without re-expanding.
 *
 * Turn-based (bare `number` or `{ turns: N }`): returns the last N
 * completed prior requests. Guards `Array.prototype.slice(-0)` — which
 * returns the whole array — by explicitly returning `[]` for N <= 0.
 *
 * Token-based (`{ tokens: T }`): walks `priorRequests` from the end,
 * expanding each candidate to its LLM messages and counting tokens. A
 * candidate is accepted whole if it fits the remaining budget; otherwise
 * walking stops (turns are never split). If the first (most recent) prior
 * turn alone exceeds the budget, it is accepted anyway — returning an
 * empty history when a single oversized turn exists hides more context
 * than it saves.
 *
 * `undefined` limit returns all prior requests.
 */
async function selectRequestsByLimit(
  priorRequests: RequestRecord[],
  limit: MessageLimit | undefined,
  tokenCounter: TokenCounter,
  resolveModelId: () => string,
  allowedTypes: Set<string>,
  allowedRoles: Set<"user" | "assistant" | "system" | "developer" | "tool"> | undefined,
): Promise<SelectedTurn[]> {
  const expand = (request: RequestRecord): SelectedTurn => ({
    messages: expandRequestToMessages(
      request.items ?? [],
      allowedTypes,
      allowedRoles,
    ),
  });

  if (limit === undefined) {
    return priorRequests.map(expand);
  }

  // Turn-based: bare number or { turns: N }
  if (typeof limit === "number" || "turns" in limit) {
    const turns = typeof limit === "number" ? limit : limit.turns;
    if (turns <= 0) return [];
    return priorRequests.slice(-turns).map(expand);
  }

  // Token-based: pack whole turns from the end, never split. Each
  // candidate is expanded exactly once and the expansion is reused in
  // the final assembly — no double-expansion.
  const budget = limit.tokens;
  const model = resolveModelId();
  const selected: SelectedTurn[] = [];
  let runningTokens = 0;

  for (let i = priorRequests.length - 1; i >= 0; i--) {
    const turn = expand(priorRequests[i]!);
    const candidateTokens = turn.messages.length === 0
      ? 0
      : await tokenCounter.countMessages(turn.messages, model);

    if (selected.length === 0) {
      // Most-recent-turn exception: always include the latest prior turn
      // even if it alone exceeds the budget.
      selected.unshift(turn);
      runningTokens = candidateTokens;
      continue;
    }

    if (runningTokens + candidateTokens > budget) {
      break;
    }

    selected.unshift(turn);
    runningTokens += candidateTokens;
  }

  return selected;
}

/**
 * Loads conversation history from prior completed requests in this session,
 * converts to LLM-ready messages, and applies turn-aware limiting.
 *
 * `limit` is interpreted as a count of conversational turns, where one
 * `RequestRecord` is one turn. Tool-call/result messages within a retained
 * turn are carried full-fidelity and do not decrement the budget. This
 * fixes the original failure mode where a tool-heavy turn could fully
 * consume an `N`-message window and evict the prior user message.
 *
 * Token-based limits are turn-aligned: whole turns are packed from the
 * end and never split. The most recent prior turn is always included
 * (even if alone over budget). See `selectRequestsByLimit`.
 *
 * Live items from the current (in-flight) request are always appended
 * regardless of limit — this preserves the retry-after-mid-turn-failure
 * scenario where the user's "try again" must see the in-flight tool state.
 *
 * Empty-of-LLM-content turns (turns whose items are all sub-agent or
 * non-LLM types) still count against `{ turns: N }` but contribute zero
 * messages. This keeps the slice logic at the request level and matches
 * the spec's documented v1 behavior.
 *
 * Optionally includes items from the current in-flight request via
 * `readLiveItems` so that blocks like `sessionTitleGenerator` running as
 * background work can see the current request's output.
 */
async function loadLLMHistory(
  priorRequests: RequestRecord[],
  tokenCounter: TokenCounter,
  resolveModelId: () => string,
  query?: ItemQuery,
  readLiveItems?: () => Array<OutputItem | BlockTraceItem>
): Promise<LLMMessage[]> {
  const allowedTypes = query?.itemTypes
    ? new Set(query.itemTypes)
    : LLM_AUDIENCE_TYPES;
  const allowedRoles = query?.roles ? new Set(query.roles) : undefined;

  const selectedTurns = await selectRequestsByLimit(
    priorRequests,
    query?.limit,
    tokenCounter,
    resolveModelId,
    allowedTypes,
    allowedRoles,
  );

  const messages: LLMMessage[] = [];
  for (const turn of selectedTurns) {
    messages.push(...turn.messages);
  }

  // Live items from the in-flight request are always included regardless
  // of limit. This is the retry/resume guarantee.
  if (readLiveItems !== undefined) {
    messages.push(
      ...expandRequestToMessages(readLiveItems(), allowedTypes, allowedRoles)
    );
  }

  // Defense-in-depth: with turn-aligned slicing orphans should be
  // structurally unreachable in normal operation, but keep the trim for
  // edge data states (e.g., a request whose items begin mid-tool-pair).
  return trimOrphanedToolMessages(messages);
}

/**
 * Converts an OutputItem (from the response emitter) to a SessionItem
 * so it can be included in the all() view alongside historical items.
 */
function outputItemToSessionItem(item: OutputItem): SessionItem {
  // Extract readable content for the payload based on item type.
  // Message items get their text extracted; other items pass through.
  let payload: unknown;
  if (item.type === "message") {
    const msg = item as MessageItem;
    const texts = msg.content
      .filter((c: Content) => c.type === "output_text")
      .map((c) => (c as { type: "output_text"; text: string }).text);
    payload = texts.length > 0 ? texts.join("") : msg.content;
  } else {
    payload = (item as Record<string, unknown>).output ?? item;
  }

  return {
    id: item.id,
    type: item.type,
    status: item.status,
    transient: item.transient,
    requestId: item.requestId,
    itemIndex: item.itemIndex,
    payload,
    ts: item.ts,
    agentType: item.agentType,
    agentName: item.agentName,
  };
}

/**
 * Applies `agentType` / `agentName` filters from a SessionItem query.
 * Both accept scalar or array form; scalar treated as single-element set.
 * Returns true if the item passes the filter (or no filter applies).
 */
function matchesIdentityFilter(
  item: SessionItem,
  query: ItemQuery | undefined,
): boolean {
  if (query?.agentType !== undefined) {
    const allowed = Array.isArray(query.agentType)
      ? new Set(query.agentType)
      : new Set([query.agentType]);
    if (item.agentType === undefined || !allowed.has(item.agentType)) {
      return false;
    }
  }
  if (query?.agentName !== undefined) {
    const allowed = Array.isArray(query.agentName)
      ? new Set(query.agentName)
      : new Set([query.agentName]);
    if (item.agentName === undefined || !allowed.has(item.agentName)) {
      return false;
    }
  }
  return true;
}

function createSessionItemViews(
  priorItems: SessionItem[],
  priorRequests: RequestRecord[],
  options: {
    tokenCounter: TokenCounter;
    resolveModelId: () => string;
    readLiveItems?: () => Array<OutputItem | BlockTraceItem>;
  }
): SessionItemViews {
  // Compute once — priorItems is immutable for the request lifetime.
  const priorIds = new Set(priorItems.map((i) => i.id));

  const select = (
    query: ItemQuery | undefined,
    audienceTypes?: Set<string>,
    clientOnly?: boolean
  ): SessionItem[] => {
    const includeTransient = query?.includeTransient === true;
    const itemTypeFilter = query?.itemTypes
      ? new Set(query.itemTypes)
      : undefined;

    // Merge prior request items (loaded eagerly at context creation) with
    // live items from the current request's response emitter.
    const liveItems = options.readLiveItems?.() ?? [];
    const liveSessionItems = liveItems.map(outputItemToSessionItem);
    const deduplicatedLive = liveSessionItems.filter((i) => !priorIds.has(i.id));
    const allItems = [...priorItems, ...deduplicatedLive];

    const filtered = allItems.filter((item) => {
      if (!includeTransient && item.transient === true) {
        return false;
      }

      // Visibility-based audience filtering: client view uses resolveItemVisibility.
      if (clientOnly && !resolveItemVisibility(item as unknown as OutputItem).client) {
        return false;
      }

      // Type-based audience filtering when provided (for LLM audience).
      if (audienceTypes !== undefined && !audienceTypes.has(item.type)) {
        return false;
      }

      // Explicit item type filter from query.
      if (itemTypeFilter !== undefined && !itemTypeFilter.has(item.type)) {
        return false;
      }

      // Identity filters (agentType, agentName) — honored by all views.
      if (!matchesIdentityFilter(item, query)) {
        return false;
      }

      return true;
    });

    return listByQuery(filtered, { limit: query?.limit });
  };

  return {
    all: (query) => select(query),
    client: (query) => select(query, undefined, true),
    history: (query) =>
      loadLLMHistory(
        priorRequests,
        options.tokenCounter,
        options.resolveModelId,
        query,
        options.readLiveItems
      ),
    selectForContext: (query) => select(query),
  };
}

function buildJournalEntry(entry: JournalEntryInput): JournalEntry {
  return {
    id: `journal_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    ts: Date.now(),
    ...entry
  };
}

type EmissionContext = {
  requestId: string;
  response: {
    emitItemAdded(item: OutputItem | BlockTraceItem | RouterDecisionItem | StateSnapshotItem): Promise<unknown>;
    emitItemDone(item: OutputItem | BlockTraceItem | RouterDecisionItem | StateSnapshotItem): Promise<unknown>;
    emitItemUpdated?(itemId: string, patch: Record<string, unknown>): Promise<unknown>;
    emitItemOneShot?(item: OutputItem | BlockTraceItem | RouterDecisionItem | StateSnapshotItem): Promise<unknown>;
    emitContentAdded?(itemId: string, contentIndex: number, content: Content): Promise<unknown>;
    emitContentDelta?(itemId: string, contentIndex: number, delta: string): Promise<unknown>;
    emitContentDone?(itemId: string, contentIndex: number, content: Content): Promise<unknown>;
    getSequenceNumber?(): number;
  };
  provenance: () => ItemProvenance;
  nextItemIndex: () => number;
  /** Container ownership tag — set when emitting inside a container scope. */
  ownedBy?: string;
  /**
   * Task attribution (FIX-658) — id of the task this scope is running, inherited
   * from the nearest enclosing scope marked via `ctx._markTaskScope`. Stamped
   * onto every item this scope emits.
   */
  taskId?: string;
  /**
   * Agent identity that scope-emitted items inherit. Set by the owning
   * generator; undefined at the root (runtime-level emissions carry no
   * identity). Callers may override per-emission via options.
   */
  agentType?: AgentType;
  agentName?: string;
};

function createEmitMessage(
  emCtx: EmissionContext
): {
  (text: string, options?: { agentType?: AgentType; agentName?: string; transient?: boolean }): void;
  (content: Content[], options?: { agentType?: AgentType; agentName?: string; transient?: boolean }): void;
} {
  return function emitMessage(
    textOrContent: string | Content[],
    options?: { agentType?: AgentType; agentName?: string; transient?: boolean }
  ): void {
    const content: Content[] =
      typeof textOrContent === "string"
        ? [{ type: "output_text", text: textOrContent }]
        : textOrContent;

    const itemIndex = emCtx.nextItemIndex();
    // FIX-478: explicit emit calls are user-facing content, not bookkeeping.
    // Default non-transient; the block's `transient` flag governs only the
    // auto-emitted block_trace item. Per-call
    // `{ transient: true }` is the explicit opt-in for live-only output.
    const item: MessageItem = {
      id: `item_message_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "message",
      status: "completed",
      transient: options?.transient === true ? true : undefined,
      requestId: emCtx.requestId,
      itemIndex,
      provenance: emCtx.provenance(),
      ts: Date.now(),
      ownedBy: emCtx.ownedBy,
      taskId: emCtx.taskId,
      agentType: options?.agentType ?? emCtx.agentType,
      agentName: options?.agentName ?? emCtx.agentName,
      role: "assistant",
      content
    };

    void emCtx.response.emitItemAdded(item);
    void emCtx.response.emitItemDone(item);
  };
}

function createEmitComponent(
  emCtx: EmissionContext
): (
  component: string,
  data: Record<string, unknown>,
  options?: {
    key?: string;
    agentType?: AgentType;
    agentName?: string;
    transient?: boolean;
  },
) => void {
  return function emitComponent(
    component: string,
    data: Record<string, unknown>,
    options?: {
      key?: string;
      agentType?: AgentType;
      agentName?: string;
      transient?: boolean;
    },
  ): void {
    const itemIndex = emCtx.nextItemIndex();
    // FIX-478: explicit emit calls are user-facing content, not bookkeeping.
    // Default non-transient; the block's `transient` flag governs only the
    // auto-emitted block_trace item. Per-call
    // `{ transient: true }` is the explicit opt-in (e.g. live-only progress
    // with dedup).
    // FIX-491: when a `key` is supplied, derive a deterministic item ID from
    // the key so subsequent emissions upsert in place — `itemsById` collapses
    // to one entry per `(requestId, key)`. The SSE event log still appends
    // an `item.added` + `item.done` event per emission; clients reconcile by
    // item ID and overwrite. `data` is replaced wholesale, never merged.
    const item: ComponentItem = {
      id:
        options?.key !== undefined
          ? `item_component_keyed:${options.key}`
          : `item_component_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "component",
      status: "completed",
      transient: options?.transient === true ? true : undefined,
      requestId: emCtx.requestId,
      itemIndex,
      provenance: emCtx.provenance(),
      ts: Date.now(),
      ownedBy: emCtx.ownedBy,
      taskId: emCtx.taskId,
      agentType: options?.agentType ?? emCtx.agentType,
      agentName: options?.agentName ?? emCtx.agentName,
      component,
      data,
      ...(options?.key !== undefined ? { key: options.key } : {}),
    };

    void emCtx.response.emitItemAdded(item);
    void emCtx.response.emitItemDone(item);
  };
}

type StateChangeScope = StateChangeItem["scope"];
type StateChangeOperation = StateChangeItem["operation"];

function shouldPersistScopeChange(flow: FlowInstance): boolean {
  const withFlags = flow as FlowInstance & {
    persistStateChanges?: boolean;
  };

  if (withFlags.persistStateChanges === true) {
    return true;
  }

  return process.env.NODE_ENV !== "production";
}

async function emitStateChangeItem(options: {
  response: unknown;
  requestId: string;
  nextItemIndex: () => number;
  provenance: () => ItemProvenance;
  scope: StateChangeScope;
  operation: StateChangeOperation;
  version: number;
  delta?: unknown;
  path?: string;
  blockInstanceId?: string;
  transient: boolean;
}): Promise<void> {
  const typed = options.response as {
    emitItemAdded?: (item: OutputItem) => Promise<unknown>;
    emitItemDone?: (item: OutputItem) => Promise<unknown>;
  };

  if (
    typeof typed.emitItemAdded !== "function" ||
    typeof typed.emitItemDone !== "function"
  ) {
    return;
  }

  const itemIndex = options.nextItemIndex();
  const item: StateChangeItem = {
    id: `item_state_change_${itemIndex}_${Math.random().toString(16).slice(2)}`,
    type: "state_change",
    status: "completed",
    transient: options.transient,
    requestId: options.requestId,
    itemIndex,
    provenance: options.provenance(),
    ts: Date.now(),
    scope: options.scope,
    blockInstanceId: options.blockInstanceId,
    operation: options.operation,
    path: options.path,
    delta: options.delta,
    version: options.version
  };

  await typed.emitItemAdded(item);
  await typed.emitItemDone(item);
}

function createTargetStateOps<TState extends JsonObject>(options: {
  container: ReturnType<typeof createStateContainer<TState>>;
  response: unknown;
  requestId: string;
  nextItemIndex: () => number;
  provenance: () => ItemProvenance;
  blockInstanceId: string;
  transientStateChanges: boolean;
  /**
   * Total budget for one target-state mutation (queue wait + execution).
   * Forwarded to `createScopeStateOps` so the in-memory lock branch
   * surfaces hangs as `ScopeMutationTimeoutError`.
   */
  mutationTimeoutMs?: number;
  /**
   * Top-level keys of the parent sequencer's `stateSchema` that were marked
   * with `transientSlot()`. Patches affecting only these keys are persisted
   * to the in-memory container (so later steps can read them) but suppressed
   * from `state_change` SSE emits and `state_snapshot` payloads.
   */
  transientKeys?: Set<string>;
}): Pick<StateRef<TState>, "patchState" | "setState" | "incState" | "pushState" | "setStateRecord" | "deleteStateRecord" | "atomicState"> {
  // Target state has no backing store. With no `persist` callback,
  // `createScopeStateOps` routes mutations through `withScopeLock`, which
  // serializes per-container without retries.
  const baseOps = createScopeStateOps<TState>(options.container, {
    mutationTimeoutMs: options.mutationTimeoutMs
  });
  const transientKeys = options.transientKeys ?? new Set<string>();

  function isTransientKey(key: string): boolean {
    return transientKeys.has(key);
  }

  function filterTransientFromDelta<T extends Record<string, unknown>>(
    delta: T
  ): { filtered: Partial<T>; hasNonTransient: boolean } {
    if (transientKeys.size === 0) {
      return { filtered: delta, hasNonTransient: Object.keys(delta).length > 0 };
    }
    const filtered: Record<string, unknown> = {};
    let hasNonTransient = false;
    for (const k of Object.keys(delta)) {
      if (!isTransientKey(k)) {
        filtered[k] = delta[k];
        hasNonTransient = true;
      }
    }
    return { filtered: filtered as Partial<T>, hasNonTransient };
  }

  return {
    async patchState(
      updatesOrKey: Partial<TState> | keyof TState,
      updater?: (current: TState[keyof TState]) => TState[keyof TState]
    ) {
      const committed = await (baseOps.patchState as (
        updatesOrKey: Partial<TState> | keyof TState,
        updater?: (current: TState[keyof TState]) => TState[keyof TState]
      ) => Promise<boolean>)(updatesOrKey, updater);
      if (!committed) return false;
      const version = options.container.getVersion();
      if (typeof updatesOrKey === "string") {
        if (isTransientKey(updatesOrKey)) return true;
        await emitStateChangeItem({
          response: options.response,
          requestId: options.requestId,
          nextItemIndex: options.nextItemIndex,
          provenance: options.provenance,
          scope: "block_instance",
          operation: "patch",
          path: updatesOrKey,
          delta: { path: updatesOrKey },
          version,
          blockInstanceId: options.blockInstanceId,
          transient: options.transientStateChanges
        });
        return true;
      }

      const { filtered, hasNonTransient } = filterTransientFromDelta(
        updatesOrKey as Record<string, unknown>
      );
      if (!hasNonTransient) return true;

      await emitStateChangeItem({
        response: options.response,
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: "block_instance",
        operation: "patch",
        delta: filtered,
        version,
        blockInstanceId: options.blockInstanceId,
        transient: options.transientStateChanges
      });
      return true;
    },
    async setState(nextState: TState) {
      const committed = await baseOps.setState(nextState);
      if (!committed) return false;
      const { filtered, hasNonTransient } = filterTransientFromDelta(
        nextState as Record<string, unknown>
      );
      if (!hasNonTransient) return true;
      await emitStateChangeItem({
        response: options.response,
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: "block_instance",
        operation: "set",
        delta: filtered,
        version: options.container.getVersion(),
        blockInstanceId: options.blockInstanceId,
        transient: options.transientStateChanges
      });
      return true;
    },
    async incState(increments: Record<string, number>) {
      const committed = await baseOps.incState(increments);
      if (!committed) return false;
      const { filtered, hasNonTransient } = filterTransientFromDelta(increments);
      if (!hasNonTransient) return true;
      await emitStateChangeItem({
        response: options.response,
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: "block_instance",
        operation: "increment",
        delta: filtered,
        version: options.container.getVersion(),
        blockInstanceId: options.blockInstanceId,
        transient: options.transientStateChanges
      });
      return true;
    },
    async pushState(field: string, value: unknown) {
      const committed = await baseOps.pushState(field, value);
      if (!committed) return false;
      if (isTransientKey(field)) return true;
      await emitStateChangeItem({
        response: options.response,
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: "block_instance",
        operation: "push",
        path: field,
        delta: value,
        version: options.container.getVersion(),
        blockInstanceId: options.blockInstanceId,
        transient: options.transientStateChanges
      });
      return true;
    },
    async setStateRecord(field: string, key: string, value: unknown) {
      const committed = await baseOps.setStateRecord(field, key, value);
      if (!committed) return false;
      if (isTransientKey(field)) return true;
      await emitStateChangeItem({
        response: options.response,
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: "block_instance",
        operation: "patch",
        path: `${field}.${key}`,
        delta: { [field]: { [key]: value } },
        version: options.container.getVersion(),
        blockInstanceId: options.blockInstanceId,
        transient: options.transientStateChanges
      });
      return true;
    },
    async deleteStateRecord(field: string, key: string) {
      const committed = await baseOps.deleteStateRecord(field, key);
      if (!committed) return false;
      if (isTransientKey(field)) return true;
      await emitStateChangeItem({
        response: options.response,
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: "block_instance",
        operation: "delete_key",
        path: `${field}.${key}`,
        delta: { [field]: key },
        version: options.container.getVersion(),
        blockInstanceId: options.blockInstanceId,
        transient: options.transientStateChanges
      });
      return true;
    },
    async atomicState(mutator: (state: Readonly<TState>) => Partial<TState>) {
      const before = options.container.read() as Record<string, unknown>;
      const committed = await baseOps.atomicState(mutator);
      if (!committed) return false;
      // atomicState has no structured delta. To honor transient slots we
      // diff before/after by top-level key — if every changed key is
      // transient, suppress the emit; otherwise emit as today.
      if (transientKeys.size > 0) {
        const after = options.container.read() as Record<string, unknown>;
        const changedKeys: string[] = [];
        const allKeys = new Set<string>([
          ...Object.keys(before),
          ...Object.keys(after)
        ]);
        for (const k of allKeys) {
          if (!deepEqual(before[k], after[k])) {
            changedKeys.push(k);
          }
        }
        if (changedKeys.length > 0 && changedKeys.every((k) => isTransientKey(k))) {
          return true;
        }
      }
      await emitStateChangeItem({
        response: options.response,
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: "block_instance",
        operation: "atomic",
        version: options.container.getVersion(),
        blockInstanceId: options.blockInstanceId,
        transient: options.transientStateChanges
      });
      return true;
    }
  };
}

/**
 * Wraps the bare `createScopeStateOps` result for a request/session/user/org
 * scope so each successful mutation emits a `state_change` SSE item carrying
 * the scope, operation, structured delta, and post-mutation version. The
 * shape mirrors `createTargetStateOps` (which handles the `block_instance`
 * scope) so React's `useSession` can reduce these into `snapshot.clientData`
 * mid-stream — see FIX-576.
 *
 * Behavior notes:
 * - No-op mutations (when the base op returns `false`) skip the emit, preserving
 *   the FIX-477 deep-equal short-circuit.
 * - `atomicState` emits with `delta: undefined` because the base op gives no
 *   structured diff; clients ignore atomic emits for clientData reduction and
 *   fall back to terminal-status snapshot refresh for those scopes.
 * - Provenance is fixed to `"runtime"` because scope-level mutations are not
 *   tied to a particular block instance.
 */
function wrapScopeOpsWithEmit<TState extends JsonObject>(args: {
  scope: "request" | "session" | "user" | "org";
  baseOps: Pick<StateRef<TState>, "patchState" | "setState" | "incState" | "pushState" | "setStateRecord" | "deleteStateRecord" | "atomicState">;
  container: ReturnType<typeof createStateContainer<TState>>;
  getResponse: () => unknown;
  requestId: string;
  nextItemIndex: () => number;
  transient: boolean;
}): Pick<StateRef<TState>, "patchState" | "setState" | "incState" | "pushState" | "setStateRecord" | "deleteStateRecord" | "atomicState"> {
  const provenance = (): ItemProvenance => ({
    blockName: "runtime",
    blockInstanceId: "runtime",
    phase: "main" as const
  });

  const emit = (params: {
    operation: StateChangeOperation;
    delta?: unknown;
    path?: string;
  }): Promise<void> =>
    emitStateChangeItem({
      response: args.getResponse(),
      requestId: args.requestId,
      nextItemIndex: args.nextItemIndex,
      provenance,
      scope: args.scope,
      operation: params.operation,
      delta: params.delta,
      path: params.path,
      version: args.container.getVersion(),
      transient: args.transient
    });

  return {
    async patchState(
      updatesOrKey: Partial<TState> | keyof TState,
      updater?: (current: TState[keyof TState]) => TState[keyof TState]
    ) {
      const committed = await (args.baseOps.patchState as (
        updatesOrKey: Partial<TState> | keyof TState,
        updater?: (current: TState[keyof TState]) => TState[keyof TState]
      ) => Promise<boolean>)(updatesOrKey, updater);
      if (!committed) return false;
      if (typeof updatesOrKey === "string") {
        await emit({
          operation: "patch",
          path: updatesOrKey,
          delta: { path: updatesOrKey }
        });
      } else {
        await emit({
          operation: "patch",
          delta: updatesOrKey as Record<string, unknown>
        });
      }
      return true;
    },
    async setState(nextState: TState) {
      const committed = await args.baseOps.setState(nextState);
      if (!committed) return false;
      await emit({ operation: "set", delta: nextState as Record<string, unknown> });
      return true;
    },
    async incState(increments: Record<string, number>) {
      const committed = await args.baseOps.incState(increments);
      if (!committed) return false;
      await emit({ operation: "increment", delta: increments });
      return true;
    },
    async pushState(field: string, value: unknown) {
      const committed = await args.baseOps.pushState(field, value);
      if (!committed) return false;
      await emit({ operation: "push", path: field, delta: value });
      return true;
    },
    async setStateRecord(field: string, key: string, value: unknown) {
      const committed = await args.baseOps.setStateRecord(field, key, value);
      if (!committed) return false;
      await emit({
        operation: "patch",
        path: `${field}.${key}`,
        delta: { [field]: { [key]: value } }
      });
      return true;
    },
    async deleteStateRecord(field: string, key: string) {
      const committed = await args.baseOps.deleteStateRecord(field, key);
      if (!committed) return false;
      await emit({
        operation: "delete_key",
        path: `${field}.${key}`,
        delta: { [field]: key }
      });
      return true;
    },
    async atomicState(mutator: (state: Readonly<TState>) => Partial<TState>) {
      const committed = await args.baseOps.atomicState(mutator);
      if (!committed) return false;
      await emit({ operation: "atomic" });
      return true;
    }
  };
}

/**
 * Request-scoped status slot. Shared across every `createEmitStatus` call
 * within a single request so nested scopes see the same "current message"
 * value — implements the single-slot semantics from FIX-387.
 */
type StatusSlot = { message: string };

function createEmitStatus(
  emCtx: EmissionContext,
  slot: StatusSlot
): (message: string | undefined, options?: { blocked?: boolean; backgroundTasks?: number; transient?: boolean }) => void {
  return function emitStatus(
    message: string | undefined,
    options?: { blocked?: boolean; backgroundTasks?: number; transient?: boolean }
  ): void {
    if (message !== undefined) {
      // Dedupe: skip when the proposed message matches the slot. `undefined`
      // callers fall through — they update signals only and always emit.
      if (message === slot.message) {
        return;
      }
      slot.message = message;
    }

    const itemIndex = emCtx.nextItemIndex();
    // FIX-478: status defaults to transient (live-only; statuses are
    // naturally ephemeral). Per-call `{ transient: false }` opts out for
    // symmetry with emitMessage / emitComponent. `false` produces a
    // persisted item; `undefined` keeps the field absent.
    const item: StatusItem = {
      id: `item_status_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "status",
      status: "completed",
      transient: options?.transient === false ? undefined : true,
      requestId: emCtx.requestId,
      itemIndex,
      provenance: emCtx.provenance(),
      ts: Date.now(),
      ownedBy: emCtx.ownedBy,
      taskId: emCtx.taskId,
      message: slot.message,
      blocked: options?.blocked,
      backgroundTasks: options?.backgroundTasks
    };

    void emCtx.response.emitItemAdded(item);
    void emCtx.response.emitItemDone(item);
  };
}

/**
 * Module-level set of deprecated alias names already warned for, debouncing
 * `console.warn` to once per process per name. The flat `ctx.emitMessage`
 * etc. methods route through this so the noise stays bounded across long
 * sessions while still nudging users toward `ctx.emit.*`.
 */
const DEPRECATED_ALIAS_WARNED = new Set<string>();

/**
 * Wraps an emission function so the first invocation per process logs a
 * single deprecation warning. The wrapper preserves the underlying
 * function's call signature exactly.
 */
function createDeprecatedAlias<TFn extends (...args: any[]) => any>(
  name: string,
  fn: TFn
): TFn {
  return function deprecatedAlias(...args: Parameters<TFn>): ReturnType<TFn> {
    if (!DEPRECATED_ALIAS_WARNED.has(name)) {
      DEPRECATED_ALIAS_WARNED.add(name);
      // eslint-disable-next-line no-console
      console.warn(
        `[flow-state-dev] ctx.${name}(...) is deprecated. Use ctx.emit.${
          name.replace(/^emit/, "").charAt(0).toLowerCase() +
          name.replace(/^emit/, "").slice(1)
        }(...) instead. Removed in next major.`
      );
    }
    return fn(...args);
  } as TFn;
}

/**
 * Build the three `ctx.emit.trace.*` impls. Each:
 *   - stamps `agentType: "trace"` on the item if missing,
 *   - emits item.added then item.done via the response emitter,
 *   - fire-and-forgets a TraceStore append for both events.
 *
 * The TraceStore writes are best-effort: errors are swallowed (with a
 * once-per-process console.warn fallback) so trace plumbing never breaks
 * primary execution.
 */
let TRACE_STORE_WRITE_WARNED = false;
function buildTraceEmitters(
  emCtx: EmissionContext,
  traces: TraceStore | undefined,
  _getBlockIdentity?: () => {
    blockName?: string;
    blockKind?: "handler" | "generator" | "sequencer" | "router";
    blockInstanceId?: string;
    parentBlockInstanceId?: string;
    phase?: "main" | "work";
  } | undefined
): {
  blockTrace: (item: BlockTraceItem) => void;
  routerDecision: (item: RouterDecisionItem) => void;
  stateSnapshot: (item: StateSnapshotItem) => void;
} {
  const requestId = emCtx.requestId;

  function recordTrace(
    type: "trace.item.added" | "trace.item.done",
    item: BlockTraceItem | RouterDecisionItem | StateSnapshotItem
  ): void {
    if (traces === undefined) return;
    const sequenceNumber =
      typeof emCtx.response.getSequenceNumber === "function"
        ? emCtx.response.getSequenceNumber()
        : 0;
    void traces
      .appendEvent(requestId, {
        requestId,
        sequenceNumber,
        ts: Date.now(),
        type,
        item,
      })
      .catch(() => {
        if (!TRACE_STORE_WRITE_WARNED) {
          TRACE_STORE_WRITE_WARNED = true;
          // eslint-disable-next-line no-console
          console.warn("[flow-state-dev] TraceStore append failed; further errors suppressed.");
        }
      });
  }

  function stampTrace<T extends { agentType?: AgentType }>(item: T): T {
    if (item.agentType === undefined) {
      (item as { agentType?: AgentType }).agentType = "trace";
    }
    return item;
  }

  return {
    blockTrace(item) {
      stampTrace(item);
      void emCtx.response
        .emitItemAdded(item)
        .then(() => {
          recordTrace("trace.item.added", item);
          return emCtx.response.emitItemDone(item);
        })
        .then(() => recordTrace("trace.item.done", item))
        .catch(() => { /* trace emission is best-effort */ });
    },
    routerDecision(item) {
      stampTrace(item);
      void emCtx.response
        .emitItemAdded(item)
        .then(() => {
          recordTrace("trace.item.added", item);
          return emCtx.response.emitItemDone(item);
        })
        .then(() => recordTrace("trace.item.done", item))
        .catch(() => { /* trace emission is best-effort */ });
    },
    stateSnapshot(item) {
      stampTrace(item);
      void emCtx.response
        .emitItemAdded(item)
        .then(() => {
          recordTrace("trace.item.added", item);
          return emCtx.response.emitItemDone(item);
        })
        .then(() => recordTrace("trace.item.done", item))
        .catch(() => { /* trace emission is best-effort */ });
    },
  };
}

export async function createExecutionContext<
  TRequestState extends JsonObject = JsonObject,
  TSessionState extends JsonObject = JsonObject,
  TUserState extends JsonObject = JsonObject,
  TOrgState extends JsonObject = JsonObject
>(
  options: CreateExecutionContextOptions<
    TRequestState,
    TSessionState,
    TUserState,
    TOrgState
  >
): Promise<
  ExecutionContext<TRequestState, TSessionState, TUserState, TOrgState>
> {
  const now = Date.now();
  const {
    flow,
    stores
  } = options;
  const transientStateChanges = !shouldPersistScopeChange(flow);
  // Per-mutation budget for in-memory state writes (target / sequencer /
  // any scope without a `persist` callback). Plumbed through to every
  // ScopeStateOpsOptions so the lock branch can fire
  // ScopeMutationTimeoutError instead of hanging the request. External-
  // store scopes still receive the option but ignore it — runWithCAS
  // owns its own retry/timeout semantics.
  const resolvedMutationTimeoutMs =
    flow.request?.mutationTimeoutMs ?? 30_000;
  // FIX-435: resources live in a single flat `flow.resources` map. Each
  // entry is routed to the appropriate scope storage via its intrinsic
  // `scope`. Partition the flat map back into per-scope buckets so the
  // existing per-scope storage helpers can keep doing their job.
  const flatFlowResources = (flow.resources ?? {}) as Record<
    string,
    (ResourceConfig | ResourceCollectionConfig) & { scope: "session" | "user" | "org" }
  >;
  const sessionResourceConfigs: Record<string, ResourceConfig | ResourceCollectionConfig> = {};
  const userResourceConfigs: Record<string, ResourceConfig | ResourceCollectionConfig> = {};
  const orgResourceConfigs: Record<string, ResourceConfig | ResourceCollectionConfig> = {};
  /**
   * accessor → scope mapping so the flat ctx.resources registry can route
   * gets/lists across all three per-scope registries below.
   */
  const accessorScope: Record<string, "session" | "user" | "org"> = {};

  for (const [accessor, def] of Object.entries(flatFlowResources)) {
    const scope = def.scope;
    if (scope === "session") sessionResourceConfigs[accessor] = def;
    else if (scope === "user") userResourceConfigs[accessor] = def;
    else if (scope === "org") orgResourceConfigs[accessor] = def;
    else throw new Error(`Resource "${accessor}" has unknown scope ${JSON.stringify(scope)}`);
    accessorScope[accessor] = scope;
  }

  if (!options.userId || options.userId.trim().length === 0) {
    throw new Error(`Flow "${flow.kind}" requires a userId`);
  }

  const userId = options.userId;
  const sessionId = options.sessionId ?? `ephemeral_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const requestId = options.requestId;

  // Storage keys — namespaced by flowKind when the flow opts into per-flow
  // isolation for user/org scope. Bare identity ids otherwise. See
  // `packages/server/src/stores/scope-keys.ts` and FIX-431.
  const userKey = resolveUserStorageKey(userId, flow);
  const optionsOrgId = options.orgId;
  const optionsOrgKey =
    optionsOrgId !== undefined
      ? resolveOrgStorageKey(optionsOrgId, flow)
      : undefined;

  // Window the cross-turn history load to the most recent N completed
  // requests (FIX-685). This bounds the store read and the default
  // generator's in-prompt history regardless of session length; the full
  // session stays retrievable via the state endpoint. Per-call
  // history({ limit }) refines within this window — it cannot widen it.
  const historyWindowTurns = flow.session?.historyWindow?.turns ?? 50;

  // Parallelize independent store lookups — user, session, org, and request
  // records don't depend on each other for the initial load.
  const [loadedUser, loadedSession, loadedOrg, loadedRequest, priorRequests] = await Promise.all([
    stores.user.get(userKey),
    stores.session.get(sessionId),
    optionsOrgKey !== undefined ? stores.org.get(optionsOrgKey) : undefined,
    stores.request.get(requestId),
    // The N most-recently-started completed requests — `status:"completed"`
    // excludes the current (in-progress) request and any in-flight siblings;
    // `orderBy:"startedAtMs"` makes the windowed selection robust to
    // out-of-order metadata writes. `items` reconstruct cross-turn history.
    stores.request.list({
      sessionId,
      status: "completed",
      limit: historyWindowTurns,
      orderBy: "startedAtMs",
      withItems: true
    })
  ]);

  // The windowed list already filters to completed requests at the store;
  // exclude only the current request (defends a retry that reuses an id),
  // then sort ascending for stable history ordering. Reused by all()/client()
  // (via priorItems) and history() (via loadLLMHistory).
  const completedPriorRequests = priorRequests
    .filter((r) => r.id !== requestId)
    .sort((a, b) => a.startedAtMs - b.startedAtMs);

  // Build prior items from completed request records. This replaces the
  // deprecated SessionRecord.items field — items are canonical on request records.
  const priorItems: SessionItem[] = [];
  for (const req of completedPriorRequests) {
    if (req.items === undefined) {
      continue;
    }
    for (const item of req.items) {
      priorItems.push(outputItemToSessionItem(item));
    }
  }
  // Sort by timestamp then index for stable ordering
  priorItems.sort((a, b) => {
    const tsDiff = (a.ts ?? 0) - (b.ts ?? 0);
    return tsDiff !== 0 ? tsDiff : a.itemIndex - b.itemIndex;
  });

  let userRecord = loadedUser;
  if (userRecord === undefined) {
    // `id` is the storage key (namespaced when isolated); `userId` stays as
    // the bare identity so listing and cross-reference by userId work across
    // isolated and shared records alike.
    userRecord = {
      id: userKey,
      userId,
      state: (options.userState ?? {}) as TUserState,
      resources: normalizeScopeResources(userResourceConfigs, undefined),
      version: 0,
      createdAt: now,
      updatedAt: now
    };
    await stores.user.set(userRecord.id, userRecord, "any");
  }

  let sessionRecord = loadedSession;
  if (sessionRecord === undefined) {
    sessionRecord = {
      id: sessionId,
      flowKind: flow.kind,
      userId,
      orgId: options.orgId,
      state: (options.sessionState ?? {}) as TSessionState,
      resources: normalizeScopeResources(sessionResourceConfigs, undefined),
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: []
    };
    await stores.session.set(sessionRecord.id, sessionRecord, "any");
  } else {
    ensureJournalDefaults(sessionRecord);

    // userId mismatch — closes a long-standing gap. The loaded session record's
    // userId is authoritative; a request claiming a different identity would
    // route this user's actions against another user's data.
    if (sessionRecord.userId !== userId) {
      throw new UserBindingMismatchError(sessionId, sessionRecord.userId, userId);
    }
  }

  // orgId immutability. Org binding is fixed for the lifetime of a session;
  // a request that claims a different orgId — including binding an
  // unbound session — is rejected. Apps that need to "move" a session
  // create a new one. The previous code (`optionsOrgId ?? sessionRecord?.orgId`)
  // silently let the request override the session's stored value, vacating
  // the immutability guarantee FIX-428 promises.
  const sessionOrgId = sessionRecord.orgId;
  if (optionsOrgId !== undefined && optionsOrgId !== sessionOrgId) {
    throw new OrgBindingMismatchError(sessionId, sessionOrgId ?? "<unbound>", optionsOrgId);
  }

  const resolvedOrgId = sessionOrgId;
  const resolvedOrgKey =
    resolvedOrgId !== undefined
      ? resolveOrgStorageKey(resolvedOrgId, flow)
      : undefined;
  let orgRecord: OrgRecord | undefined = loadedOrg;
  if (
    orgRecord === undefined &&
    resolvedOrgKey !== undefined &&
    resolvedOrgKey !== optionsOrgKey
  ) {
    orgRecord = await stores.org.get(resolvedOrgKey);
  }
  if (resolvedOrgId !== undefined && resolvedOrgKey !== undefined && orgRecord === undefined) {
    orgRecord = {
      id: resolvedOrgKey,
      orgId: resolvedOrgId,
      userId,
      state: (options.orgState ?? {}) as TOrgState,
      resources: normalizeScopeResources(orgResourceConfigs, undefined),
      version: 0,
      createdAt: now,
      updatedAt: now
    };
    await stores.org.set(orgRecord.id, orgRecord, "any");
  }

  // Content lives in ContentStore exclusively (FIX-347). Load only the
  // content this flow declares (FIX-685) — fixed resources by key,
  // collections by pattern prefix — so reads during the run are synchronous
  // against the in-memory cache without over-fetching the whole scope. The
  // full-scope view stays available via the state endpoint.
  // FIX-688 Wave 1: load only the flow-level eager resources at request start.
  // Action-tree and lazy resources load later (Waves 2 & 3) via
  // `_loadDeclaredResources`. `flowLevelResourceKeys` is the set of accessors
  // declared in the flow's own `resources` map (pre bubble-up); a flow without
  // it falls back to "every accessor", reproducing the prior behaviour.
  const flowLevelResourceKeys: ReadonlySet<string> =
    flow.flowLevelResourceKeys ?? new Set(Object.keys(flatFlowResources));
  const sessionFlowLevelConfigs = filterFlowLevelEager(sessionResourceConfigs, flowLevelResourceKeys);
  const userFlowLevelConfigs = filterFlowLevelEager(userResourceConfigs, flowLevelResourceKeys);
  const orgFlowLevelConfigs = filterFlowLevelEager(orgResourceConfigs, flowLevelResourceKeys);

  const [sessionContentFromStore, userContentFromStore, orgContentFromStore] = await Promise.all([
    loadDeclaredScopeContent(stores.content, "session", sessionId, sessionFlowLevelConfigs),
    loadDeclaredScopeContent(stores.content, "user", userKey, userFlowLevelConfigs),
    resolvedOrgKey !== undefined
      ? loadDeclaredScopeContent(stores.content, "org", resolvedOrgKey, orgFlowLevelConfigs)
      : Promise.resolve<Record<string, string>>({})
  ]);

  const initialSessionContent = normalizeScopeResourceContent(
    sessionFlowLevelConfigs,
    sessionContentFromStore
  );
  const initialUserContent = normalizeScopeResourceContent(
    userFlowLevelConfigs,
    userContentFromStore
  );
  const initialOrgContent = normalizeScopeResourceContent(
    orgFlowLevelConfigs,
    resolvedOrgId !== undefined ? orgContentFromStore : undefined
  );

  // Resource state lives in ResourceStateStore exclusively (FIX-689), the
  // state-layer twin of the content load above. Load only the state this flow
  // declares — single resources by key, collections by pattern prefix — into
  // per-scope caches; in-execution reads/writes hit the cache and persist
  // per-key, never rewriting the whole scope record.
  const [sessionStateFromStore, userStateFromStore, orgStateFromStore] = await Promise.all([
    loadDeclaredResourceState(stores.resourceState, "session", sessionId, sessionFlowLevelConfigs),
    loadDeclaredResourceState(stores.resourceState, "user", userKey, userFlowLevelConfigs),
    resolvedOrgKey !== undefined
      ? loadDeclaredResourceState(stores.resourceState, "org", resolvedOrgKey, orgFlowLevelConfigs)
      : Promise.resolve<Record<string, JsonObject>>({})
  ]);

  const initialSessionState = normalizeScopeResources(sessionFlowLevelConfigs, sessionStateFromStore);
  const initialUserState = normalizeScopeResources(userFlowLevelConfigs, userStateFromStore);
  const initialOrgState = normalizeScopeResources(
    orgFlowLevelConfigs,
    resolvedOrgId !== undefined ? orgStateFromStore : undefined
  );

  let requestRecord = loadedRequest;
  if (requestRecord === undefined) {
    requestRecord = {
      id: requestId,
      flowKind: flow.kind,
      actionName: options.actionName,
      userId,
      sessionId: sessionRecord?.id,
      orgId: orgRecord?.orgId,
      source: options.source ?? "http",
      status: "in_progress",
      startedAtMs: now,
      metadata: options.metadata,
      input: options.input,
      state: (options.requestState ?? {}) as TRequestState,
      version: 0,
      createdAt: now,
      updatedAt: now
    };
    await stores.request.set(requestRecord.id, requestRecord, "any");
  } else if (requestRecord.source === undefined) {
    // Pre-FIX-438 records read from a store that hasn't been migrated
    // default to the HTTP source. New writes always carry the field.
    requestRecord = { ...requestRecord, source: "http" };
  }

  if (requestRecord === undefined) {
    throw new Error(`Request "${requestId}" could not be initialized`);
  }

  const requestRef: { current: RequestRecord } = {
    current: requestRecord
  };
  const userRef: { current: UserRecord } = {
    current: userRecord
  };
  const sessionRef: { current: SessionRecord } = {
    current: sessionRecord
  };
  const orgRef: { current: OrgRecord | undefined } = {
    current: orgRecord
  };

  // State refs: eagerly loaded from ResourceStateStore at initialization
  // (FIX-689), mirroring the content refs below. All reads during execution
  // use the in-memory cache (synchronous); writes update the cache and persist
  // to ResourceStateStore (async, per-key). The scope record's `.resources`
  // field is no longer read or written by this path.
  const sessionStateRef = { current: initialSessionState };
  const userStateRef = { current: initialUserState };
  const orgStateRef = { current: initialOrgState };

  const readSessionResources = (): Record<string, JsonObject> =>
    sessionStateRef.current;

  // Content refs: eagerly loaded from ContentStore at initialization.
  // All reads during execution use the in-memory cache (synchronous).
  // Writes update the cache and persist to ContentStore (async, per-key).
  const sessionContentRef = { current: initialSessionContent };
  const userContentRef = { current: initialUserContent };
  const orgContentRef = { current: initialOrgContent };

  // FIX-688 Waves 2 & 3: top up the per-scope caches above with resources
  // declared inside the dispatched action's block tree, on demand. Wave 1
  // (request start) already loaded the flow-level eager subset; everything
  // else loads at action dispatch (`runAction`) and per-block dispatch (the
  // block runtime's `run`) through `_loadDeclaredResources` below.
  //
  // `loadedCollectionPrefixes` records which collection pattern-prefixes have
  // been bulk-loaded so a re-dispatch never re-scans; it is seeded with the
  // flow-level collections Wave 1 already loaded. Single resources are tracked
  // implicitly by presence in the state cache. `inflightLoads` single-flights
  // concurrent loads of the same key/prefix across parallel block dispatch
  // (e.g. a sequencer's `.work()` fan-out), and clears entries in `finally`
  // so a failed load retries on the next attempt instead of poisoning the map.
  const loadedCollectionPrefixes: Record<ContentScopeType, Set<string>> = {
    session: new Set<string>(),
    user: new Set<string>(),
    org: new Set<string>()
  };
  // Negative cache for lazy single-row reads: a key confirmed absent by a
  // `resourceState.get` returning undefined. Caps each missing key at one store
  // round-trip per request instead of re-reading on every `get`/`getOptional`.
  // The existence check (`storageKey in stateRef.current`) is always consulted
  // first, so a later create/upsert that writes the key wins over a stale entry
  // here — no active invalidation needed.
  const missingResourceKeys: Record<ContentScopeType, Set<string>> = {
    session: new Set<string>(),
    user: new Set<string>(),
    org: new Set<string>()
  };
  // A cache miss is *authoritative* (no store read needed) when the key falls
  // under a prefix already bulk-loaded via `getByPrefix` — the whole prefix is
  // materialized, so an absent key is definitively absent. Prefixes end in `/`
  // (or are `""`, the whole-scope load), so `startsWith` is the coverage test.
  const isMissAuthoritative = (scope: ContentScopeType, storageKey: string): boolean => {
    for (const prefix of loadedCollectionPrefixes[scope]) {
      if (storageKey.startsWith(prefix)) return true;
    }
    return false;
  };
  const seedLoadedPrefixes = (
    scope: ContentScopeType,
    configs: Record<string, ResourceConfig | ResourceCollectionConfig>
  ): void => {
    for (const config of Object.values(configs)) {
      if (!isCollectionConfig(config)) continue;
      const prefix = getPatternPrefix(config.pattern);
      loadedCollectionPrefixes[scope].add(prefix === "" ? "" : `${prefix}/`);
    }
  };
  seedLoadedPrefixes("session", sessionFlowLevelConfigs);
  seedLoadedPrefixes("user", userFlowLevelConfigs);
  seedLoadedPrefixes("org", orgFlowLevelConfigs);

  const inflightLoads = new Map<string, Promise<void>>();
  const runSingleFlight = (token: string, fn: () => Promise<void>): Promise<void> => {
    const existing = inflightLoads.get(token);
    if (existing !== undefined) return existing;
    const promise = (async () => {
      try {
        await fn();
      } finally {
        inflightLoads.delete(token);
      }
    })();
    inflightLoads.set(token, promise);
    return promise;
  };

  const scopeStateRef = (scope: ContentScopeType): { current: Record<string, JsonObject> } =>
    scope === "session" ? sessionStateRef : scope === "user" ? userStateRef : orgStateRef;
  const scopeContentRef = (scope: ContentScopeType): { current: Record<string, string> } =>
    scope === "session" ? sessionContentRef : scope === "user" ? userContentRef : orgContentRef;
  const scopeIdForScope = (scope: ContentScopeType): string | undefined =>
    scope === "session" ? sessionId : scope === "user" ? userKey : resolvedOrgKey;

  // Canonical storage keys resolved from each scope's FULL config map. A
  // resource without an explicit `ref` canonicalizes to the first accessor in
  // the full map (FIX-591 alias sharing), so a per-load subset must resolve
  // keys against the whole map — not the single entry being loaded — or an
  // aliased resource would load under the wrong key and miss the registry's
  // canonical slot.
  const scopeStorageKeyMaps: Record<ContentScopeType, Record<string, string>> = {
    session: resourceStorageKeys(sessionResourceConfigs),
    user: resourceStorageKeys(userResourceConfigs),
    org: resourceStorageKeys(orgResourceConfigs)
  };

  // FIX-688 Slice 3: per-scope on-demand loaders backing lazy collection
  // accessors. Reuses the same single-flight map and `loadedCollectionPrefixes`
  // as the eager waves, so a key fetched here and one fetched by a wave dedupe.
  const makeLazyLoad = (scope: ContentScopeType): ScopeLazyLoad | undefined => {
    const scopeId = scopeIdForScope(scope);
    if (scopeId === undefined) return undefined; // scope absent this request (org)
    const stateRef = scopeStateRef(scope);
    const contentRef = scopeContentRef(scope);
    return {
      async getInstance(storageKey: string): Promise<void> {
        if (storageKey in stateRef.current) return; // already loaded
        // A miss under an already-bulk-loaded prefix is authoritative, and a
        // key confirmed absent earlier this request stays absent — skip the
        // store round-trip in both cases.
        if (isMissAuthoritative(scope, storageKey)) return;
        if (missingResourceKeys[scope].has(storageKey)) return;
        await runSingleFlight(`${scope}:key:${storageKey}`, async () => {
          if (storageKey in stateRef.current) return;
          const [state, content] = await Promise.all([
            stores.resourceState.get(scope, scopeId, storageKey),
            stores.content.get(scope, scopeId, storageKey)
          ]);
          if (state !== undefined) {
            stateRef.current = { [storageKey]: state, ...stateRef.current };
          } else {
            // Negatively cache: one round-trip caps repeated reads of an absent key.
            missingResourceKeys[scope].add(storageKey);
          }
          if (typeof content === "string") {
            contentRef.current = { [storageKey]: content, ...contentRef.current };
          }
        });
      },
      async getByPrefix(keyPrefix: string): Promise<void> {
        if (loadedCollectionPrefixes[scope].has(keyPrefix)) return;
        await runSingleFlight(`${scope}:prefix:${keyPrefix}`, async () => {
          if (loadedCollectionPrefixes[scope].has(keyPrefix)) return;
          const [state, content] = await Promise.all([
            stores.resourceState.getByPrefix(scope, scopeId, keyPrefix),
            stores.content.getByPrefix(scope, scopeId, keyPrefix)
          ]);
          stateRef.current = { ...state, ...stateRef.current };
          contentRef.current = { ...content, ...contentRef.current };
          loadedCollectionPrefixes[scope].add(keyPrefix);
        });
      }
    };
  };
  const sessionLazyLoad = makeLazyLoad("session");
  const userLazyLoad = makeLazyLoad("user");
  const orgLazyLoad = makeLazyLoad("org");

  /**
   * FIX-688 Waves 2 & 3 loader. Loads the eager, not-yet-cached entries from a
   * declared-resources map into the per-scope caches. With `loadLazySingles`
   * it also loads `prefetchMode: 'lazy'` single resources (block dispatch).
   * Lazy collections are always skipped — the async accessor fetches them.
   * Cache wins over the store snapshot on conflict, so a concurrent mutation
   * is never clobbered by an in-flight read.
   */
  const loadDeclaredResourcesIntoCache = async (
    declared: Record<string, ResourceConfig | ResourceCollectionConfig> | undefined,
    loadOptions: { loadLazySingles: boolean }
  ): Promise<void> => {
    if (declared === undefined) return;
    const tasks: Array<Promise<void>> = [];

    for (const [accessor, config] of Object.entries(declared)) {
      const scope = (config as { scope?: ContentScopeType }).scope;
      if (scope !== "session" && scope !== "user" && scope !== "org") continue;
      const scopeId = scopeIdForScope(scope);
      if (scopeId === undefined) continue; // org scope not present this request
      const mode = (config as { prefetchMode?: string }).prefetchMode ?? "eager";
      const stateRef = scopeStateRef(scope);
      const contentRef = scopeContentRef(scope);
      // Key the load by the canonical storage key (from the full-map resolution
      // above), so aliased single resources load under the same slot the
      // registry reads. Collections canonicalize to their accessor, so this is
      // a no-op for them.
      const storageKey = scopeStorageKeyMaps[scope][accessor] ?? accessor;
      const subConfig = { [storageKey]: config };

      const applyLoad = async (): Promise<void> => {
        const [stateSeed, contentSeed] = await Promise.all([
          loadDeclaredResourceState(stores.resourceState, scope, scopeId, subConfig),
          loadDeclaredScopeContent(stores.content, scope, scopeId, subConfig)
        ]);
        stateRef.current = {
          ...normalizeScopeResources(subConfig, stateSeed),
          ...stateRef.current
        };
        contentRef.current = {
          ...normalizeScopeResourceContent(subConfig, contentSeed),
          ...contentRef.current
        };
      };

      if (isCollectionConfig(config)) {
        if (mode === "lazy") continue; // lazy collections fetch via async accessor
        const prefix = getPatternPrefix(config.pattern);
        const keyPrefix = prefix === "" ? "" : `${prefix}/`;
        if (loadedCollectionPrefixes[scope].has(keyPrefix)) continue;
        tasks.push(
          runSingleFlight(`${scope}:prefix:${keyPrefix}`, async () => {
            if (loadedCollectionPrefixes[scope].has(keyPrefix)) return;
            await applyLoad();
            loadedCollectionPrefixes[scope].add(keyPrefix);
          })
        );
      } else {
        if (mode === "lazy" && !loadOptions.loadLazySingles) continue; // deferred to block dispatch
        if (storageKey in stateRef.current) continue; // already loaded
        tasks.push(
          runSingleFlight(`${scope}:key:${storageKey}`, async () => {
            if (storageKey in stateRef.current) return;
            await applyLoad();
          })
        );
      }
    }

    await Promise.all(tasks);
  };

  // FIX-688 Wave 2: a context is bound to exactly one action, so load that
  // action's eager resource footprint — its block tree's bubble-up
  // (`action.block.declaredResources`) — now, in one parallel burst. Only the
  // dispatched action's resources load; sibling actions' declarations stay
  // unloaded until their own request. Lazy single resources defer to per-block
  // dispatch (Wave 3); lazy collections fetch on demand via their async
  // accessor. The flow-level subset loaded at Wave 1 is skipped here (already
  // cached / prefix-seeded).
  const dispatchedActionBlock = (
    flow.actions as Record<string, { block?: { declaredResources?: Record<string, ResourceConfig | ResourceCollectionConfig> } }> | undefined
  )?.[options.actionName]?.block;
  if (dispatchedActionBlock?.declaredResources !== undefined) {
    await loadDeclaredResourcesIntoCache(dispatchedActionBlock.declaredResources, {
      loadLazySingles: false
    });
  }

  const readSessionResourceContent = (): Record<string, string> =>
    sessionContentRef.current;

  const readUserResources = (): Record<string, JsonObject> =>
    userStateRef.current;

  const readUserResourceContent = (): Record<string, string> =>
    userContentRef.current;

  const readProjectResources = (): Record<string, JsonObject> =>
    orgStateRef.current;

  const readProjectResourceContent = (): Record<string, string> =>
    orgContentRef.current;

  const persistSessionResources = async (
    next: Record<string, JsonObject>
  ): Promise<void> => {
    const normalized = normalizeScopeResources(sessionResourceConfigs, next);
    const previous = sessionStateRef.current;

    for (const [key, value] of Object.entries(normalized)) {
      if (!deepEqual(previous[key], value)) {
        await stores.resourceState.set("session", sessionId, key, value);
      }
    }
    for (const key of Object.keys(previous)) {
      if (!(key in normalized)) {
        await stores.resourceState.delete("session", sessionId, key);
      }
    }

    sessionStateRef.current = normalized;
  };

  const persistSessionResourceContent = async (
    next: Record<string, string>
  ): Promise<void> => {
    const normalized = normalizeScopeResourceContent(sessionResourceConfigs, next);
    const previous = sessionContentRef.current;

    for (const [key, value] of Object.entries(normalized)) {
      if (previous[key] !== value) {
        await stores.content.set("session", sessionId, key, value);
      }
    }
    for (const key of Object.keys(previous)) {
      if (!(key in normalized)) {
        await stores.content.delete("session", sessionId, key);
      }
    }

    sessionContentRef.current = normalized;
  };

  const persistUserResources = async (
    next: Record<string, JsonObject>
  ): Promise<void> => {
    const normalized = normalizeScopeResources(userResourceConfigs, next);
    const previous = userStateRef.current;

    for (const [key, value] of Object.entries(normalized)) {
      if (!deepEqual(previous[key], value)) {
        await stores.resourceState.set("user", userKey, key, value);
      }
    }
    for (const key of Object.keys(previous)) {
      if (!(key in normalized)) {
        await stores.resourceState.delete("user", userKey, key);
      }
    }

    userStateRef.current = normalized;
  };

  const persistUserResourceContent = async (
    next: Record<string, string>
  ): Promise<void> => {
    const normalized = normalizeScopeResourceContent(userResourceConfigs, next);
    const previous = userContentRef.current;

    for (const [key, value] of Object.entries(normalized)) {
      if (previous[key] !== value) {
        await stores.content.set("user", userKey, key, value);
      }
    }
    for (const key of Object.keys(previous)) {
      if (!(key in normalized)) {
        await stores.content.delete("user", userKey, key);
      }
    }

    userContentRef.current = normalized;
  };

  const persistProjectResources = async (
    next: Record<string, JsonObject>
  ): Promise<void> => {
    if (resolvedOrgKey === undefined) {
      return;
    }

    const normalized = normalizeScopeResources(orgResourceConfigs, next);
    const previous = orgStateRef.current;

    for (const [key, value] of Object.entries(normalized)) {
      if (!deepEqual(previous[key], value)) {
        await stores.resourceState.set("org", resolvedOrgKey, key, value);
      }
    }
    for (const key of Object.keys(previous)) {
      if (!(key in normalized)) {
        await stores.resourceState.delete("org", resolvedOrgKey, key);
      }
    }

    orgStateRef.current = normalized;
  };

  const persistProjectResourceContent = async (
    next: Record<string, string>
  ): Promise<void> => {
    if (resolvedOrgKey === undefined) {
      return;
    }

    const normalized = normalizeScopeResourceContent(orgResourceConfigs, next);
    const previous = orgContentRef.current;

    for (const [key, value] of Object.entries(normalized)) {
      if (previous[key] !== value) {
        await stores.content.set("org", resolvedOrgKey, key, value);
      }
    }
    for (const key of Object.keys(previous)) {
      if (!(key in normalized)) {
        await stores.content.delete("org", resolvedOrgKey, key);
      }
    }

    orgContentRef.current = normalized;
  };

  const requestContainer = createStateContainer<TRequestState>(
    requestRef.current.state as TRequestState,
    requestRef.current.version
  );
  const userContainer = createStateContainer<TUserState>(
    userRef.current.state as TUserState,
    userRef.current.version
  );
  const sessionContainer = createStateContainer<TSessionState>(
    sessionRef.current.state as TSessionState,
    sessionRef.current.version
  );
  const orgContainer =
    orgRef.current === undefined
      ? undefined
      : createStateContainer<TOrgState>(
          orgRef.current.state as TOrgState,
          orgRef.current.version
        );

  // Hoisted so scope-handle ops can close over these refs and emit
  // `state_change` items on mutation (FIX-576). `responseRef.current` is
  // assigned once `response` is constructed below; until then no scope op
  // can run.
  const responseRef: { current: unknown } = { current: undefined };
  let emittedItemCount = 0;

  const requestOps = createScopeStateOps(requestContainer, {
    persist: createScopePersist<TRequestState, RequestRecord>(
      requestRef,
      stores.request,
      (expectedVersion, state) => ({
        ...requestRef.current,
        state: state as TRequestState,
        version: expectedVersion + 1,
        updatedAt: Date.now()
      })
    )
  });

  const userOps = createScopeStateOps(userContainer, {
    persist: createScopePersist<TUserState, UserRecord>(
      userRef,
      stores.user,
      (expectedVersion, state) => ({
        ...userRef.current,
        state: state as TUserState,
        version: expectedVersion + 1,
        updatedAt: Date.now()
      })
    )
  });

  const sessionOps = createScopeStateOps(sessionContainer, {
    persist: createScopePersist<TSessionState, SessionRecord>(
      sessionRef,
      stores.session,
      (expectedVersion, state) => ({
        ...sessionRef.current,
        state: state as TSessionState,
        version: expectedVersion + 1,
        updatedAt: Date.now()
      })
    )
  });

  const orgOps = (():
    | ReturnType<typeof createScopeStateOps<TOrgState>>
    | undefined => {
    if (orgRef.current === undefined || orgContainer === undefined) {
      return undefined;
    }
    // Build the standard persist callback once, then wrap it with an
    // "Org removed mid-execution" guard. The guard short-circuits before the
    // inner callback touches `orgRef.current.id`, which would throw if the
    // org went away mid-request.
    const inner = createScopePersist<TOrgState, OrgRecord>(
      orgRef as { current: OrgRecord },
      stores.org,
      (ev, st) => ({
        ...(orgRef.current as OrgRecord),
        state: st as TOrgState,
        version: ev + 1,
        updatedAt: Date.now()
      })
    );
    return createScopeStateOps(orgContainer, {
      persist: async (state, expectedVersion, hint) => {
        if (orgRef.current === undefined) {
          return { ok: true, version: expectedVersion + 1 };
        }
        return inner(state, expectedVersion, hint);
      }
    });
  })();

  // Resource change emitter — pushes transient resource_change items via SSE
  // so clients can refresh clientData without waiting for request completion.
  const rawResponse = options.response as unknown as Record<string, unknown> | undefined;
  const emitter = rawResponse && typeof rawResponse.emitResourceChange === "function"
    ? (rawResponse as unknown as { emitResourceChange: (opts: { scope: string; resourcePath: string; changeType: string; transient?: boolean }) => Promise<unknown> })
    : undefined;

  function makeResourceChangeHandler(scope: "session" | "user" | "org") {
    if (!emitter) return undefined;
    return (resourcePath: string, changeType: "created" | "updated" | "deleted") => {
      void emitter.emitResourceChange({ scope, resourcePath, changeType, transient: true });
    };
  }

  const userResources = createScopeResourceRegistry({
    scope: "user",
    scopeId: userId,
    configs: userResourceConfigs,
    readResources: readUserResources,
    persistResources: persistUserResources,
    readResourceContent: readUserResourceContent,
    persistResourceContent: persistUserResourceContent,
    onResourceChanged: makeResourceChangeHandler("user"),
    lazyLoad: userLazyLoad,
  });

  const sessionResources = createScopeResourceRegistry({
    scope: "session",
    scopeId: sessionId,
    configs: sessionResourceConfigs,
    readResources: readSessionResources,
    persistResources: persistSessionResources,
    readResourceContent: readSessionResourceContent,
    persistResourceContent: persistSessionResourceContent,
    onResourceChanged: makeResourceChangeHandler("session"),
    lazyLoad: sessionLazyLoad,
  });

  const orgResources =
    orgRef.current === undefined
      ? undefined
      : createScopeResourceRegistry({
          scope: "org",
          scopeId: orgRef.current!.orgId,
          configs: orgResourceConfigs,
          readResources: readProjectResources,
          persistResources: persistProjectResources,
          readResourceContent: readProjectResourceContent,
          persistResourceContent: persistProjectResourceContent,
          onResourceChanged: makeResourceChangeHandler("org"),
          lazyLoad: orgLazyLoad,
        });



  const modelResolver = options.modelResolver ?? createModelResolver();
  const tokenCounter: TokenCounter = flow.tokenCounter ?? {
    async count(text: string): Promise<number> {
      return Math.ceil(text.length / 4);
    },
    async countMessages(messages: LLMMessage[]): Promise<number> {
      const total = messages.reduce((acc, message) => acc + JSON.stringify(message.content).length, 0);
      return Math.ceil(total / 4);
    }
  };
  const resolvedModelStorage = new AsyncLocalStorage<string>();
  const resolveModel = ((modelId: string, blockName?: string) => {
    resolvedModelStorage.enterWith(modelId);
    return modelResolver(modelId, blockName);
  }) as ModelResolver;
  resolveModel.resolveId = (modelId: string) => modelResolver.resolveId(modelId);

  const readLiveItems = (): Array<OutputItem | BlockTraceItem> => {
    const typedResponse = responseRef.current as { getItems?: () => Array<OutputItem | BlockTraceItem> };
    if (typeof typedResponse.getItems === "function") {
      return typedResponse.getItems();
    }
    return requestRef.current.items ?? [];
  };

  const computeTokenUsage = () => {
    const byModel: Record<string, { prompt: number; completion: number; total: number; cacheReadTokens: number; cacheCreationTokens: number }> = {};
    for (const item of readLiveItems()) {
      if (item.type !== "block_trace") {
        continue;
      }
      const modelUsage = item.modelUsage;
      if (modelUsage === undefined) {
        continue;
      }
      const existing = byModel[modelUsage.model] ?? {
        prompt: 0,
        completion: 0,
        total: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0
      };
      existing.prompt += Number(modelUsage.promptTokens ?? 0);
      existing.completion += Number(modelUsage.completionTokens ?? 0);
      existing.total += Number(modelUsage.totalTokens ?? 0);
      existing.cacheReadTokens += Number(modelUsage.cacheReadTokens ?? 0);
      existing.cacheCreationTokens += Number(modelUsage.cacheCreationTokens ?? 0);
      byModel[modelUsage.model] = existing;
    }

    const totalConsumed = Object.values(byModel).reduce((acc, model) => acc + model.total, 0);
    const maxBudget = flow.actions[options.actionName]?.tokenBudget?.maxTotalTokens;

    return {
      totalConsumed,
      byModel,
      remaining: typeof maxBudget === "number" ? Math.max(0, maxBudget - totalConsumed) : Number.POSITIVE_INFINITY
    };
  };

  const computeCostEstimate = () => {
    const estimator = flow.costEstimator;
    const usage = computeTokenUsage();
    const byModel: Record<string, number> = {};

    for (const [model, entry] of Object.entries(usage.byModel)) {
      byModel[model] = estimator?.estimate(entry, model) ?? 0;
    }

    const totalUSD = Object.values(byModel).reduce((acc, value) => acc + value, 0);
    return { totalUSD, byModel };
  };

  function emitWrap<TState extends JsonObject>(
    scope: "request" | "session" | "user" | "org",
    baseOps: Pick<StateRef<TState>, "patchState" | "setState" | "incState" | "pushState" | "setStateRecord" | "deleteStateRecord" | "atomicState">,
    container: ReturnType<typeof createStateContainer<TState>>
  ) {
    return wrapScopeOpsWithEmit({
      scope,
      baseOps,
      container,
      getResponse: () => responseRef.current,
      requestId: requestRef.current.id,
      nextItemIndex: () => emittedItemCount++,
      transient: transientStateChanges
    });
  }

  const requestOpsEmitting = emitWrap("request", requestOps, requestContainer);
  const requestHandle = defineStateProperty(
    {
      identity: {
        type: "request" as const,
        id: requestRef.current.id,
        userId,
        orgId: orgRef.current?.orgId,
        tenantId: options.tenantId
      },
      get tokenUsage() {
        return computeTokenUsage();
      },
      get costEstimate() {
        return computeCostEstimate();
      },
      ...requestOpsEmitting
    },
    () => requestContainer.read()
  ) as RequestScopeHandle<TRequestState>;

  const userOpsEmitting = emitWrap("user", userOps, userContainer);
  const userHandle = defineStateProperty(
    {
      identity: {
        type: "user" as const,
        id: userRef.current.id,
        userId: userRef.current.userId,
        tenantId: options.tenantId
      },
      ...userOpsEmitting
    },
    () => userContainer.read()
  ) as UserScopeHandle<TUserState>;

  const sessionOpsEmitting = emitWrap("session", sessionOps, sessionContainer);
  const sessionHandle = defineStateProperty(
    {
      identity: {
        type: "session" as const,
        id: sessionRef.current.id,
        userId: sessionRef.current.userId,
        orgId: sessionRef.current.orgId,
        tenantId: options.tenantId
      },
      get metadata() {
        const s = sessionRef.current;
        return {
          ...(s.title !== undefined ? { title: s.title } : {}),
          ...(s.description !== undefined ? { description: s.description } : {}),
          ...(s.tags !== undefined ? { tags: s.tags } : {})
        };
      },
      items: createSessionItemViews(priorItems, completedPriorRequests, {
        tokenCounter,
        readLiveItems,
        resolveModelId: () => {
          const active = resolvedModelStorage.getStore();
          if (typeof active === "string") {
            return active;
          }

          const items = readLiveItems();
          for (let index = items.length - 1; index >= 0; index -= 1) {
            const item = items[index];
            if (item?.type === "block_trace" && item.modelUsage !== undefined) {
              return item.modelUsage.model;
            }
          }

          return "gpt-4o-mini";
        }
      }),
      appendJournal: async (entry: JournalEntryInput): Promise<void> => {
        const journalEntry = buildJournalEntry(entry);
        sessionRef.current = {
          ...sessionRef.current,
          journal: [...sessionRef.current.journal, journalEntry],
          updatedAt: Date.now()
        };
        // Journal is append-only and not part of the state CAS path.
        await stores.session.set(
          sessionRef.current.id,
          sessionRef.current,
          "any"
        );
      },
      getJournal: async (query?: {
        limit?: number;
        offset?: number;
      }): Promise<JournalEntry[]> => {
        const offset = Math.max(0, query?.offset ?? 0);
        const start = offset;
        const list = sessionRef.current.journal.slice(start);

        if (query?.limit === undefined) {
          return [...list];
        }

        return list.slice(0, Math.max(0, query.limit));
      },
      setMetadata: async (input: SessionMetadataInput): Promise<void> => {
        const now = Date.now();
        sessionRef.current = {
          ...sessionRef.current,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.metadata !== undefined
            ? { metadata: { ...sessionRef.current.metadata, ...input.metadata } }
            : {}),
          updatedAt: now
        };
        // Session metadata (title/description/tags/metadata) is non-CAS today.
        await stores.session.set(
          sessionRef.current.id,
          sessionRef.current,
          "any"
        );

        await response.emit({
          type: "session.metadata.changed",
          sessionId: sessionRef.current.id,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {})
        });
      },
      ...sessionOpsEmitting
    },
    () => sessionContainer.read()
  ) as SessionScopeHandle<TSessionState>;

  const orgOpsEmitting =
    orgOps === undefined || orgContainer === undefined
      ? undefined
      : emitWrap("org", orgOps, orgContainer);
  const orgHandle =
    orgRef.current === undefined || orgOpsEmitting === undefined || orgContainer === undefined
      ? undefined
      : (defineStateProperty(
          {
            identity: {
              type: "org" as const,
              id: orgRef.current.id,
              userId: orgRef.current.userId,
              orgId: orgRef.current.orgId,
              tenantId: options.tenantId
            },
            ...orgOpsEmitting
          },
          () => orgContainer.read()
        ) as OrgScopeHandle<TOrgState>);

  // FIX-435: build the flat ctx.resources registry by merging the per-scope
  // registries. A resource's accessor key routes to the registry that owns
  // its intrinsic scope. `get()` and `list()` mirror the merged surface.
  const flatResourcesHandles: Record<string, AnyResourceRef> = {};
  for (const [accessor, scope] of Object.entries(accessorScope)) {
    let registry: ResourceRegistry<Record<string, AnyResourceRef>> | undefined;
    if (scope === "session") registry = sessionResources as ResourceRegistry<Record<string, AnyResourceRef>>;
    else if (scope === "user") registry = userResources as ResourceRegistry<Record<string, AnyResourceRef>>;
    else registry = orgResources as ResourceRegistry<Record<string, AnyResourceRef>> | undefined;
    if (registry === undefined) continue;
    const handle = (registry as Record<string, AnyResourceRef>)[accessor];
    if (handle !== undefined) flatResourcesHandles[accessor] = handle;
  }
  const flatResourcesRegistry: ResourceRegistry<Record<string, AnyResourceRef>> = {
    ...flatResourcesHandles,
    get(name: string) {
      const handle = flatResourcesHandles[String(name)];
      if (handle === undefined) {
        throw new Error(`Resource "${String(name)}" is not registered`);
      }
      return handle;
    },
    list() {
      return Object.values(flatResourcesHandles);
    }
  } as ResourceRegistry<Record<string, AnyResourceRef>>;

  // FIX-573: per-block lifecycle trace items are now driven by
  // `onBlockTraceCapture` phases (added → input → generator → output).
  // The unified hook constructs/patches the row in the per-request
  // blockTraceMap; this section previously held a fire-and-forget
  // single-emission helper that's no longer needed.

  type ExecutionParentNode = {
    parent: ExecutionParent;
    parentStateContainer?: ReturnType<typeof createStateContainer<JsonObject>>;
    result: { status: "not_started" | "running" | "completed" | "failed"; output?: unknown; error?: Error };
    previous?: ExecutionParentNode;
    /**
     * Task id marked on this scope via `ctx._markTaskScope`. Descendant scopes
     * walk `previous` to find the nearest marked ancestor and inherit it as
     * `emCtx.taskId` / `_blockIdentity.taskId`, which emit sites stamp onto
     * items. Mutable: a worker body marks its enclosing sequencer node at
     * runtime, before constructing the child scopes that do the work.
     */
    scopeTaskId?: string;
  };
  type SiblingRegistryEntry = {
    parent: ExecutionParent;
    parentStateContainer?: ReturnType<typeof createStateContainer<JsonObject>>;
    result: {
      status: "not_started" | "running" | "completed" | "failed";
      output?: unknown;
      error?: Error;
      /**
       * Set true when this block threw and a `.rescue()` handler recovered the
       * error during its run. Stamped from the child context's `_didRescue` in
       * `_withExecutionScope`'s success branch; read by `wasRescued`.
       */
      rescued?: boolean;
    };
  };
  const response = options.response ?? {
    emit: async () => undefined
  };
  responseRef.current = response;

  // Emission context used by emitMessage/emitComponent/emitStatus.
  // Duck-type the response: if it has emitItemAdded/emitItemDone, use those;
  // otherwise fall back to the generic emit() method via a thin adapter.

  // Per-request background work pool. Sequencer DSL pushes `.work()` /
  // `.workIf()` / `.forEachBackground()` tasks here; runActionInternal
  // drains the pool exactly once on the success path. Replaces the legacy
  // per-sequencer auto-await scoping.
  const requestWorkPool = createRequestWorkPool();

  // Request-scoped status slot — shared across every scope's createEmitStatus.
  // Terminates naturally when this context is discarded at request end.
  const statusSlot: StatusSlot = { message: "" };
  const typedResponse = response as unknown as Record<string, unknown>;
  const hasTypedEmitter =
    typeof typedResponse.emitItemAdded === "function" &&
    typeof typedResponse.emitItemDone === "function";

  const emissionResponse: EmissionContext["response"] = hasTypedEmitter
    ? (response as unknown as EmissionContext["response"])
    : {
        async emitItemAdded(item: OutputItem) {
          await response.emit({ type: "item.added", item });
        },
        async emitItemDone(item: OutputItem) {
          await response.emit({ type: "item.done", item });
        },
        async emitItemUpdated(itemId: string, patch: Record<string, unknown>) {
          await response.emit({ type: "item.updated", id: itemId, patch });
        }
      };

  const emCtx: EmissionContext = {
    requestId: requestRef.current.id,
    response: emissionResponse,
    provenance: () => ({
      blockName: "runtime",
      blockInstanceId: "runtime",
      phase: "main" as const
    }),
    nextItemIndex: () => emittedItemCount++,
  };

  // Request-level trace emitters used by `_runtimeHooks` (router decisions,
  // etc.) where there's no per-block ctx to delegate to. Per-context trace
  // emitters with provenance overrides are built inside `createContext`.
  const requestTraceEmitters = buildTraceEmitters(emCtx, stores.traces);

  const logger = options.logger;
  const baseLogContext = {
    requestId: requestRef.current.id,
    actionName: options.actionName,
    flowKind: flow.kind
  };

  const _runtimeHooks: ExecutionContext["_runtimeHooks"] = {
    onBlockStart: logger
      ? (blockName, blockKind, input, transient) => {
          // Transient blocks (e.g. task-board's poll loop) fire hundreds
          // of times per second; the runtime debug log floods stderr
          // without adding operator value. The block_trace lifecycle is
          // still emitted; this only suppresses the human-readable line.
          if (transient === true) return;
          logRuntimeEvent(logger, "debug", "[flow-state] nested block started", {
            ...baseLogContext,
            blockName,
            blockKind,
            input: summarizeForLog(input)
          });
        }
      : undefined,
    onBlockComplete: logger
      ? (blockName, blockKind, output, durationMs, transient) => {
          if (transient === true) return;
          logRuntimeEvent(logger, "debug", "[flow-state] nested block completed", {
            ...baseLogContext,
            blockName,
            blockKind,
            durationMs,
            output: summarizeForLog(output)
          });
        }
      : undefined,
    onBlockError: logger
      ? (blockName, blockKind, error, durationMs, transient) => {
          // Errors keep logging even for transient blocks — a failing
          // poll loop is exactly the kind of thing operators need to see.
          void transient;
          logRuntimeEvent(logger, "error", "[flow-state] nested block failed", {
            ...baseLogContext,
            blockName,
            blockKind,
            durationMs,
            error: summarizeForLog(error)
          });
        }
      : undefined,
    onRouteSelected: (routerName, selectedBlockName, routerInstanceId) => {
      if (logger) {
        logRuntimeEvent(logger, "debug", "[flow-state] router selected route", {
          ...baseLogContext,
          routerName,
          selectedRoute: selectedBlockName
        });
      }

      // Emit router_decision trace item — fire-and-forget to avoid blocking routing.
      const itemIndex = emittedItemCount++;
      const decisionItem: RouterDecisionItem = {
        id: `item_router_${itemIndex}_${Math.random().toString(16).slice(2)}`,
        type: "router_decision",
        status: "completed",
        requestId: requestRef.current.id,
        itemIndex,
        provenance: {
          blockName: routerName,
          blockInstanceId: routerInstanceId ?? `${routerName}_${requestRef.current.id}`,
          phase: "main"
        },
        ts: Date.now(),
        routerName,
        selectedRoute: selectedBlockName
      };
      requestTraceEmitters.routerDecision(decisionItem);
    },
    // FIX-573: unified block-trace lifecycle hook. Maintains one
    // block_trace item per block instance, stamped on `added` and patched
    // in place on `input` / `generator` / `output` phases. Item.added fires
    // immediately at `added`; subsequent phases emit item.updated; the
    // `output` phase additionally emits item.done.
    onBlockTraceCapture: isTraceObservabilityEnabled()
      ? (payload, firingCtx) => {
          const identity = firingCtx._blockIdentity;
          if (identity === undefined) return;
          const instanceId = identity.blockInstanceId;
          if (payload.phase === "added") {
            // Construct + emit. Store on the per-request trace map so later
            // phases can find and patch the row.
            const startedAt = payload.data.startedAt ?? Date.now();
            const itemIndex = emittedItemCount++;
            // FIX-586 restores the FIX-478 contract: auto-emitted block_trace
            // items inherit the originating block's `transient` flag. Traces
            // from `transient: true` blocks (e.g. Task Board's `claim-task` /
            // `check-board` poll loops) stream live to active SSE consumers
            // but are not retained in the persisted items log. Non-transient
            // blocks (the default) keep the canonical retained-trace behavior.
            const item: BlockTraceItem = {
              id: `item_block_trace_${itemIndex}_${Math.random().toString(16).slice(2)}`,
              type: "block_trace",
              status: payload.data.status ?? "in_progress",
              transient: identity.transient === true ? true : undefined,
              requestId: requestRef.current.id,
              itemIndex,
              provenance: {
                blockName: identity.blockName,
                blockInstanceId: instanceId,
                parentBlockInstanceId: identity.parentBlockInstanceId,
                phase: identity.phase ?? "main",
              },
              ts: startedAt,
              ownedBy: identity.ownedBy,
              agentType: "trace",
              blockName: identity.blockName,
              blockKind: (identity.blockKind ?? "handler") as BlockTraceItem["blockKind"],
              blockInstanceId: instanceId,
              input: payload.data.input,
              startedAt,
            };
            blockTraceMap.set(instanceId, item);
            void emissionResponse.emitItemAdded(item).catch(() => { /* best-effort */ });
            return;
          }
          const existing = blockTraceMap.get(instanceId);
          if (existing === undefined) return;
          // Apply phase patch in-place. Last-write-wins on chained calls
          // (multi-step tool loops): the most recent `generator` capture
          // overwrites prior model/prompt fields, matching how the model
          // re-resolves between turns. The wire patch mirrors the in-memory
          // mutation so subscribers don't have to diff the whole row.
          const patch: Record<string, unknown> = {};
          const data = payload.data as Record<string, unknown>;
          const target = existing as Record<string, unknown>;
          for (const key of Object.keys(data)) {
            const value = data[key];
            if (value === undefined) continue;
            target[key] = value;
            patch[key] = value;
          }
          // Emit item.updated for in-flight phases. The FIX-572 dedicated
          // channel is used when available; the duck-typed fallback adapter
          // synthesizes an `item.updated` event via the generic `emit()`.
          if (emissionResponse.emitItemUpdated !== undefined) {
            void emissionResponse
              .emitItemUpdated(existing.id, patch)
              .catch(() => { /* best-effort */ });
          }
          if (payload.phase === "output") {
            // Final emission: emit done so consumers know the row is settled.
            void emissionResponse
              .emitItemDone(existing)
              .catch(() => { /* best-effort */ });
            blockTraceMap.delete(instanceId);
          }
        }
      : undefined,
  };

  // Per-request trace map. Keyed by blockInstanceId; entries are removed
  // when the `output` phase fires. Lives in createExecutionContext closure
  // because every nested ctx shares the same `_runtimeHooks` reference.
  const blockTraceMap = new Map<string, BlockTraceItem>();

  // FIX-402: in-process inflight map for ctx.runOnce. Two concurrent calls
  // with the same key share a single fn() invocation. Sits in front of the
  // RequestStore so the wrapped side effect cannot fire twice in a race
  // (the store is the durable backstop across retries).
  // In-process memo of completed runOnce results. Populated synchronously
  // the instant `fn()` resolves — before the store write — so a store
  // failure cannot cause `fn()` to re-execute on a subsequent retry within
  // the same request process. Store persistence is treated as best-effort
  // bookkeeping for cross-process durability.
  const runOnceMemo = new Map<string, unknown>();
  const runOnceInflight = new Map<string, Promise<unknown>>();
  const runOnce = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    if (typeof key !== "string" || key.length === 0) {
      return Promise.reject(
        new Error("ctx.runOnce(key, fn): `key` must be a non-empty string")
      );
    }
    // Fast path: memo hit (a prior call in this process already completed).
    if (runOnceMemo.has(key)) {
      return Promise.resolve(runOnceMemo.get(key) as T);
    }
    // Claim the inflight slot synchronously before awaiting the store —
    // otherwise concurrent calls with the same key all see an empty
    // inflight map and each spawn their own fn() invocation.
    const existing = runOnceInflight.get(key);
    if (existing !== undefined) return existing as Promise<T>;

    const requestId = requestRef.current.id;
    const promise = (async (): Promise<T> => {
      // Durable lookup. Catches block-retry resumes that lost the
      // in-process memo (none today; future-proofs for durable execution).
      const stored = await stores.request.getRunOnceResult(requestId, key);
      if (stored.found) {
        runOnceMemo.set(key, stored.value);
        return stored.value as T;
      }
      const value = await fn();
      // Memoize BEFORE the store write so a store failure cannot cause
      // re-execution on the next retry within this process.
      runOnceMemo.set(key, value);
      try {
        await stores.request.setRunOnceResult(requestId, key, value);
      } catch (err) {
        // Persistence failure is non-fatal: the side effect already fired
        // and the in-process memo carries de-dup for the rest of this
        // request. Cross-process durability is degraded but we do not
        // amplify a store outage into a double-charge by re-running fn().
        console.warn(
          `[flow-state] runOnce persistence failed for key "${key}" (request ${requestId}); ` +
            `in-process dedup remains in effect`,
          err
        );
      }
      return value;
    })();
    runOnceInflight.set(key, promise as Promise<unknown>);
    promise.finally(() => {
      runOnceInflight.delete(key);
    });
    return promise;
  };

  const createContext = (
    parentChain: ExecutionParentNode | undefined,
    siblingRegistry: SiblingRegistryEntry[] | undefined,
    siblingSearchLimit: number | undefined,
    scopeEmCtx?: EmissionContext,
    // FIX-663: when provided, sets this scope's `ctx.signal` instead of the
    // closure-captured `options.signal`. `_withExecutionScope` threads the
    // current parent ctx's signal here so child scopes inherit the parent's
    // signal (which may be the background signal inside a `.work()` tree)
    // rather than the root request signal via closure capture.
    signalOverride?: AbortSignal
  ): ExecutionContext<TRequestState, TSessionState, TUserState, TOrgState> => {
    const activeEmCtx = scopeEmCtx ?? emCtx;
    const childSiblingRegistry: SiblingRegistryEntry[] = [];
    const context: ExecutionContext<TRequestState, TSessionState, TUserState, TOrgState> = {
      flow,
      actionName: options.actionName,
      requestRuntime: {
        requestId: requestRef.current.id,
        actionName: requestRef.current.actionName,
        status: requestRef.current.status,
        startedAtMs: requestRef.current.startedAtMs,
        completedAtMs: requestRef.current.completedAtMs,
        failedAtMs: requestRef.current.failedAtMs,
        metadata: requestRef.current.metadata
      },
      stores,
      settings: options.settings ?? {},
      request: requestHandle,
      session: sessionHandle,
      user: userHandle,
      org: orgHandle,
      resources: flatResourcesRegistry,
      response: responseRef.current as ExecutionContext["response"],
      signal: signalOverride ?? options.signal ?? new AbortController().signal,
      resolveModel,
      targets: new Proxy({}, {
        get(_target, prop) {
          if (typeof prop !== "string") {
            return undefined;
          }

          return context.getTarget(prop);
        },
        ownKeys() {
          return [];
        },
        getOwnPropertyDescriptor() {
          return { enumerable: true, configurable: true };
        }
      }) as BlockContext["targets"],
      getTarget: <TState extends object = Record<string, unknown>>(name: string): StateRef<TState> | undefined => {
        const toTargetRef = (
          matched: Pick<SiblingRegistryEntry, "parent" | "parentStateContainer">
        ): StateRef<TState> => {
          const container = matched.parentStateContainer;
          const noState = async (): Promise<never> => {
            throw new Error(
              `Target "${matched.parent.name}" does not expose instance state operations.`
            );
          };
          const ops: Pick<StateRef<TState>, "patchState" | "setState" | "incState" | "pushState" | "setStateRecord" | "deleteStateRecord" | "atomicState"> =
            container === undefined
              ? {
                  patchState: noState,
                  setState: noState,
                  incState: noState,
                  pushState: noState,
                  setStateRecord: noState,
                  deleteStateRecord: noState,
                  atomicState: noState
                }
              : (createTargetStateOps({
                  container,
                  response: responseRef.current,
                  requestId: requestRef.current.id,
                  nextItemIndex: () => emittedItemCount++,
                  provenance: () => ({
                    blockName: matched.parent.name,
                    blockInstanceId: matched.parent.instanceId,
                    phase: matched.parent.phase ?? "main"
                  }),
                  blockInstanceId: matched.parent.instanceId,
                  transientStateChanges,
                  mutationTimeoutMs: resolvedMutationTimeoutMs,
                  transientKeys: getTransientKeys(matched.parent.stateSchema)
                }) as unknown as Pick<StateRef<TState>, "patchState" | "setState" | "incState" | "pushState" | "setStateRecord" | "deleteStateRecord" | "atomicState">);

          return defineStateProperty(
            {
              name: matched.parent.name,
              instanceId: matched.parent.instanceId,
              input: matched.parent.input,
              ...ops
            },
            () => (container?.read() ?? {}) as TState
          ) as unknown as StateRef<TState>;
        };

        if (siblingRegistry !== undefined && siblingRegistry.length > 0) {
          const searchFrom = Math.min(
            siblingSearchLimit ?? siblingRegistry.length - 1,
            siblingRegistry.length - 1
          );
          for (let index = searchFrom; index >= 0; index -= 1) {
            const sibling = siblingRegistry[index];
            if (sibling?.parent.name === name) {
              return toTargetRef(sibling);
            }
          }
        }

        const matches: ExecutionParentNode[] = [];
        for (let cursor = parentChain; cursor !== undefined; cursor = cursor.previous) {
          if (cursor.parent.name === name) {
            matches.push(cursor);
          }
        }

        if (matches.length === 0) {
          return undefined;
        }

        if (matches.length > 1) {
          const nearest = matches[0]!.parent;
          const ambiguous = matches.map((entry) => entry.parent.instanceId).join(", ");
          throw new AmbiguousBlockNameError(
            `getTarget("${name}") is ambiguous from block instance "${nearest.instanceId}". Matching instances: ${ambiguous}`
          );
        }

        return toTargetRef(matches[0]!);
      },

      getBlockOutput: (block) => {
        const name = block.name;

        if (siblingRegistry !== undefined && siblingRegistry.length > 0) {
          const searchFrom = Math.min(
            siblingSearchLimit ?? siblingRegistry.length - 1,
            siblingRegistry.length - 1
          );
          for (let index = searchFrom; index >= 0; index -= 1) {
            const sibling = siblingRegistry[index];
            if (sibling?.parent.name === name && sibling.result.status === "completed") {
              return sibling.result.output as never;
            }
          }
        }

        return undefined;
      },
      getBlockResult: (block): BlockResult<never> => {
        const name = block.name;

        if (siblingRegistry !== undefined && siblingRegistry.length > 0) {
          const searchFrom = Math.min(
            siblingSearchLimit ?? siblingRegistry.length - 1,
            siblingRegistry.length - 1
          );
          for (let index = searchFrom; index >= 0; index -= 1) {
            const sibling = siblingRegistry[index];
            if (sibling?.parent.name !== name) {
              continue;
            }

            if (sibling.result.status === "completed") {
              return { status: "completed", output: sibling.result.output } as BlockResult<never>;
            }

            if (sibling.result.status === "failed") {
              return {
                status: "failed",
                error: sibling.result.error ?? new Error(`Block "${name}" failed.`)
              } as BlockResult<never>;
            }

            return { status: sibling.result.status } as BlockResult<never>;
          }
        }

        return { status: "not_started" } as BlockResult<never>;
      },
      wasRescued: (target) => {
        const name = typeof target === "string" ? target : target.name;

        if (siblingRegistry !== undefined && siblingRegistry.length > 0) {
          const searchFrom = Math.min(
            siblingSearchLimit ?? siblingRegistry.length - 1,
            siblingRegistry.length - 1
          );
          for (let index = searchFrom; index >= 0; index -= 1) {
            const sibling = siblingRegistry[index];
            if (sibling?.parent.name !== name) {
              continue;
            }
            // Most-recent matching sibling wins (per-iteration correct under
            // `.loopBack`), mirroring `getBlockResult`'s resolution.
            return sibling.result.rescued === true;
          }
        }

        return false;
      },
      // Populated immediately after this object literal closes so the
      // deprecated aliases share the underlying impls with `ctx.emit.*`
      // and the trace.blockDebug emitter can read this context's
      // `_blockIdentity` (set later by `_withExecutionScope`).
      emitMessage: undefined as unknown as BlockContext["emitMessage"],
      emitComponent: undefined as unknown as BlockContext["emitComponent"],
      emitStatus: undefined as unknown as BlockContext["emitStatus"],
      emit: undefined as unknown as BlockContext["emit"],
      _peekStatus: undefined as unknown as BlockContext["_peekStatus"],
      // ctx.cap is populated per-block in executeBlock (see buildCapObject below).
      cap: {} as any,
      // FIX-402: idempotency primitives. `idempotencyKey` is populated per
      // block by executeBlock (it depends on the current blockPath, which is
      // only known at execution time); `runOnce` closes over the request's
      // store ref so it works across every scoped child context.
      idempotencyKey: undefined,
      runOnce,
      // Task attribution (FIX-658): mark the nearest enclosing sequencer scope
      // as running `taskId`. The task-board worker body calls this once per
      // claimed task; child scopes constructed afterward inherit it (see the
      // `scopeTaskId` walk in `_withExecutionScope`). Writing to the shared
      // node object means a later sibling step sees the mark even though the
      // marking step has already returned. Each `.loopBack` turn runs in a
      // fresh node, so sequential tasks of one worker stay separated even when
      // their execution paths are identical.
      _markTaskScope: (taskId: string | null): void => {
        for (
          let node: ExecutionParentNode | undefined = parentChain;
          node !== undefined;
          node = node.previous
        ) {
          if (node.parent.kind === "sequencer") {
            node.scopeTaskId = taskId ?? undefined;
            return;
          }
        }
      },
      // Defined below via Object.defineProperty to close over parentChain.
      parent: undefined,
      _runtimeHooks,
      _loadDeclaredResources: loadDeclaredResourcesIntoCache,
      _withExecutionScope: async <TValue>(parent: ExecutionParent, execute: (ctx: BlockContext) => Promise<TValue>, signalOverride?: AbortSignal) => {
        const resolvedParent: ExecutionParent = {
          ...parent,
          parentInstanceId: parent.parentInstanceId ?? parentChain?.parent.instanceId,
          phase: parent.phase ?? parentChain?.parent.phase,
          path: parent.path ?? parentChain?.parent.path
        };

        const parentStateContainer =
          resolvedParent.kind === "sequencer" && resolvedParent.stateSchema !== undefined
            ? createStateContainer<JsonObject>(
                normalizeStateDefault(resolvedParent.stateSchema)
              )
            : undefined;

        // Container lifecycle (FIX-574): emit `item.added` with
        // `status: "in_progress"` on scope entry; defer the terminal patch +
        // `item.done` until the child execute resolves or throws (see the
        // try/catch below). Captured here so both lifecycle branches reach it.
        let containerItem: ContainerItem | undefined;
        let containerResponse:
          | {
              emitItemAdded: (item: OutputItem) => Promise<unknown>;
              emitItemDone: (item: OutputItem) => Promise<unknown>;
              emitItemUpdated?: (itemId: string, patch: Record<string, unknown>) => Promise<unknown>;
            }
          | undefined;
        let containerStartedAt = 0;
        if (resolvedParent.container !== undefined) {
          const typed = responseRef.current as {
            emitItemAdded?: (item: OutputItem) => Promise<unknown>;
            emitItemDone?: (item: OutputItem) => Promise<unknown>;
            emitItemUpdated?: (itemId: string, patch: Record<string, unknown>) => Promise<unknown>;
          };
          if (
            typeof typed.emitItemAdded === "function" &&
            typeof typed.emitItemDone === "function"
          ) {
            const itemIndex = emittedItemCount++;
            containerStartedAt = Date.now();
            containerItem = {
              id: `item_container_${itemIndex}_${Math.random().toString(16).slice(2)}`,
              type: "container",
              status: "in_progress",
              transient: resolvedParent.transient || undefined,
              requestId: requestRef.current.id,
              itemIndex,
              provenance: {
                blockName: resolvedParent.name,
                blockInstanceId: resolvedParent.instanceId,
                parentBlockInstanceId: resolvedParent.parentInstanceId,
                phase: resolvedParent.phase ?? "main"
              },
              ts: containerStartedAt,
              ownedBy: activeEmCtx.ownedBy,
              taskId: activeEmCtx.taskId,
              blockName: resolvedParent.name,
              component: resolvedParent.container.component,
              label: resolvedParent.container.label,
              metadata: resolvedParent.container.metadata,
              startedAt: containerStartedAt
            };
            // Hold the response itself so method calls preserve `this`
            // binding when we close out the lifecycle below.
            containerResponse = typed as Required<typeof typed>;
            await typed.emitItemAdded(containerItem);
          }
        }

        const siblingEntry: SiblingRegistryEntry = {
          parent: resolvedParent,
          parentStateContainer,
          result: { status: "running" }
        };
        childSiblingRegistry.push(siblingEntry);

        const childChain: ExecutionParentNode = {
          parent: resolvedParent,
          parentStateContainer,
          result: siblingEntry.result,
          previous: parentChain
        };
        // Task attribution (FIX-658): inherit the nearest enclosing scope's
        // marked task id. Resolved at construction — a worker body marks its
        // enclosing sequencer node before constructing the steps that emit, so
        // those steps' chains see the mark here. Re-resolved per scope (not
        // copied from the parent emCtx) because the mark lands after the
        // parent scope's emCtx was built.
        let resolvedTaskId: string | undefined;
        for (let node: ExecutionParentNode | undefined = childChain; node !== undefined; node = node.previous) {
          if (node.scopeTaskId !== undefined) {
            resolvedTaskId = node.scopeTaskId;
            break;
          }
        }
        const childPhase = resolvedParent.phase ?? "main";
        // Each scope starts with no identity. Generators that declare an
        // `agentType` stamp it directly on the items they emit; other
        // blocks inherit nothing — they emit structural items (status,
        // component, container) whose visibility comes from the type
        // defaults in `resolveItemVisibility()`.
        const childEmCtx: EmissionContext = {
          requestId: requestRef.current.id,
          response: emissionResponse,
          provenance: () => ({
            blockName: resolvedParent.name,
            blockInstanceId: resolvedParent.instanceId,
            parentBlockInstanceId: resolvedParent.parentInstanceId,
            phase: childPhase
          }),
          nextItemIndex: () => emittedItemCount++,
          ownedBy: resolvedParent.container !== undefined
            ? resolvedParent.instanceId
            : activeEmCtx.ownedBy,
          taskId: resolvedTaskId,
        };
        // FIX-663: propagate the signal down the scope chain. An explicit
        // `signalOverride` (threaded by `.work()` dispatch) wins; otherwise
        // inherit the *current* parent ctx's signal so descendant scopes of
        // a `.work()` task tree keep seeing the background signal. Reading
        // `context.signal` (not the closure-captured `options.signal`) is
        // what makes the override propagate beyond one level.
        const childSignal = signalOverride ?? context.signal;
        const childContext = createContext(
          childChain,
          childSiblingRegistry,
          childSiblingRegistry.length - 1,
          childEmCtx,
          childSignal
        );

        (childContext as { _blockIdentity?: unknown })._blockIdentity = {
          blockName: resolvedParent.name,
          blockKind: resolvedParent.kind,
          blockInstanceId: resolvedParent.instanceId,
          parentBlockInstanceId: resolvedParent.parentInstanceId,
          ownedBy: childEmCtx.ownedBy,
          taskId: childEmCtx.taskId,
          phase: resolvedParent.phase ?? "main",
          blockPath: resolvedParent.path,
          transient: resolvedParent.transient
        };

        // Propagate the request-scoped work pool through every nested scope
        // so `.work()` calls in inner sequencers reach the same pool the
        // request executor drains. See `request-work-pool.ts`.
        (childContext as { _requestWorkPool?: unknown })._requestWorkPool = requestWorkPool;
        // FIX-663: re-attach the background signal on every scope so nested
        // `.work()` dispatches can read it (the dispatch site reads
        // `ctx._requestBackgroundSignal`, not `ctx.signal`).
        (childContext as { _requestBackgroundSignal?: AbortSignal })._requestBackgroundSignal = options.backgroundSignal;
        // FIX-406 6H: propagate the request's tracing level so sequencers in
        // any nested scope gate observability snapshots consistently.
        (childContext as { _tracingLevel?: TracingLevel })._tracingLevel = options.tracingLevel;

        // Capture start time before execution — this is the only trace cost paid
        // unconditionally. Item construction and emission happen post-execution.
        const traceStartedAt = Date.now();

        try {
          const output = await execute(childContext);
          siblingEntry.result.status = "completed";
          siblingEntry.result.output = output;
          siblingEntry.result.error = undefined;
          // Carry the child's out-of-band rescue flag onto its sibling entry so
          // a downstream sibling can read it via `ctx.wasRescued(...)`. Written
          // by the sequencer runtime's rescue catch (see `_didRescue`).
          siblingEntry.result.rescued =
            (childContext as { _didRescue?: boolean })._didRescue === true;

          // Harvest the BlockValue hint set by the child's execute (if any)
          // so the block_trace `output` patch carries a ref/structure rather
          // than duplicating content (FIX-413).
          const capturedHint = (childContext as { _blockOutputHint?: BlockOutputHint })._blockOutputHint;
          if (capturedHint !== undefined) {
            (childContext as { _blockOutputHint?: BlockOutputHint })._blockOutputHint = undefined;
          }

          // FIX-573: fire the `output` phase trace capture. The block_trace
          // is emitted for every block — even tool calls — because Path A
          // emits `tool_output` separately and the called block's trace
          // refs it via `_blockOutputHint` (see generator.ts).
          {
            const completedAt = Date.now();
            // Flatten-at-emit (FIX-413): if the hint refs an item whose own
            // output is itself a ref, take the inner sourceItemId so emitted
            // refs always point one hop to a content-bearing item.
            let flattenedHint = capturedHint;
            if (capturedHint !== undefined && capturedHint.kind === "ref") {
              const typed = responseRef.current as unknown as { getItems?: () => Array<OutputItem | BlockTraceItem> };
              if (typeof typed.getItems === "function") {
                const allItems = typed.getItems();
                for (let i = allItems.length - 1; i >= 0; i -= 1) {
                  const it = allItems[i] as BlockTraceItem;
                  if (it.id === capturedHint.sourceItemId && it.output !== undefined && it.output.kind === "ref") {
                    flattenedHint = { kind: "ref", sourceItemId: it.output.sourceItemId };
                    break;
                  }
                }
              }
            }
            const blockValue: BlockValueInternal<unknown> =
              flattenedHint === undefined || flattenedHint.kind === "inline"
                ? { kind: "inline", value: output }
                : flattenedHint.kind === "structure"
                  ? { kind: "structure", shape: flattenedHint.shape }
                  : { kind: "ref", sourceItemId: flattenedHint.sourceItemId };
            const generatorModelUsage = (childContext as { _generatorModelUsage?: BlockTraceItem["modelUsage"] })._generatorModelUsage;
            if (generatorModelUsage !== undefined) {
              (childContext as { _generatorModelUsage?: unknown })._generatorModelUsage = undefined;
            }
            const generatorModelIdentity = (childContext as { _generatorModelIdentity?: BlockTraceItem["model"] })._generatorModelIdentity;
            if (generatorModelIdentity !== undefined) {
              (childContext as { _generatorModelIdentity?: unknown })._generatorModelIdentity = undefined;
            }
            childContext._runtimeHooks?.onBlockTraceCapture?.(
              {
                phase: "output",
                data: {
                  status: "completed",
                  output: blockValue,
                  completedAt,
                  duration: completedAt - traceStartedAt,
                  modelUsage: generatorModelUsage,
                  model: generatorModelIdentity,
                },
              },
              childContext
            );
            if (parentChain === undefined && capturedHint !== undefined) {
              // Root block case: server's executeBlock reads the hint off
              // the outer (non-scoped) ctx. Forward the child's hint so the
              // root's block_trace can be emitted as ref/structure (FIX-413).
              (context as { _blockOutputHint?: BlockOutputHint })._blockOutputHint = capturedHint;
            }
          }

          if (containerItem !== undefined && containerResponse !== undefined) {
            const completedAt = Date.now();
            const duration = completedAt - containerStartedAt;
            const patch = {
              status: "completed" as const,
              completedAt,
              duration
            };
            // Clear the handle before emitting so a throw from emitItemUpdated
            // or emitItemDone can't re-enter the failure-path close in the
            // catch and produce a contradictory `completed → failed` sequence.
            const closing = containerItem;
            containerItem = undefined;
            if (containerResponse.emitItemUpdated !== undefined) {
              await containerResponse.emitItemUpdated(closing.id, patch);
            }
            const finalItem: ContainerItem = { ...closing, ...patch };
            await containerResponse.emitItemDone(finalItem);
          }

          return output;
        } catch (error) {
          siblingEntry.result.status = "failed";
          siblingEntry.result.error = error instanceof Error ? error : new Error(String(error));
          siblingEntry.result.output = undefined;
          const normalized = normalizeError(error, {
            blockName: resolvedParent.name,
            scope: "block"
          });

          {
            const completedAt = Date.now();
            const generatorModelUsage = (childContext as { _generatorModelUsage?: BlockTraceItem["modelUsage"] })._generatorModelUsage;
            if (generatorModelUsage !== undefined) {
              (childContext as { _generatorModelUsage?: unknown })._generatorModelUsage = undefined;
            }
            const generatorModelIdentity = (childContext as { _generatorModelIdentity?: BlockTraceItem["model"] })._generatorModelIdentity;
            if (generatorModelIdentity !== undefined) {
              (childContext as { _generatorModelIdentity?: unknown })._generatorModelIdentity = undefined;
            }
            childContext._runtimeHooks?.onBlockTraceCapture?.(
              {
                phase: "output",
                data: {
                  status: "failed",
                  output: { kind: "inline", value: undefined },
                  completedAt,
                  duration: completedAt - traceStartedAt,
                  error: {
                    message: normalized.message,
                    code: normalized.code,
                    ...(normalized.details ? { details: normalized.details } : {}),
                  },
                  modelUsage: generatorModelUsage,
                  model: generatorModelIdentity,
                },
              },
              childContext
            );
          }

          if (containerItem !== undefined && containerResponse !== undefined) {
            const completedAt = Date.now();
            const duration = completedAt - containerStartedAt;
            const patch = {
              status: "failed" as const,
              completedAt,
              duration,
              error: { message: normalized.message }
            };
            if (containerResponse.emitItemUpdated !== undefined) {
              await containerResponse.emitItemUpdated(containerItem.id, patch);
            }
            const finalItem: ContainerItem = { ...containerItem, ...patch };
            await containerResponse.emitItemDone(finalItem);
          }

          throw error;
        }
      }
    };

    // Wire emission methods. The flat `emitMessage`/`emitComponent`/
    // `emitStatus` are deprecated aliases that warn once per process;
    // both the aliases and `ctx.emit.{message,component,status}` share
    // the same underlying impls. `ctx.emit.trace.*` uses the active
    // emission context plus this context's `_blockIdentity` (set by
    // `_withExecutionScope` on child scopes) so trace items carry the
    // firing block's identity.
    const emitMessageImpl = createEmitMessage(activeEmCtx);
    const emitComponentImpl = createEmitComponent(activeEmCtx);
    const emitStatusImpl = createEmitStatus(activeEmCtx, statusSlot);
    const traceEmitters = buildTraceEmitters(
      activeEmCtx,
      stores.traces,
      () => (context as { _blockIdentity?: {
        blockName?: string;
        blockKind?: "handler" | "generator" | "sequencer" | "router";
        blockInstanceId?: string;
        parentBlockInstanceId?: string;
        phase?: "main" | "work";
      } })._blockIdentity
    );
    context.emitMessage = createDeprecatedAlias("emitMessage", emitMessageImpl) as BlockContext["emitMessage"];
    context.emitComponent = createDeprecatedAlias("emitComponent", emitComponentImpl) as BlockContext["emitComponent"];
    context.emitStatus = createDeprecatedAlias("emitStatus", emitStatusImpl) as BlockContext["emitStatus"];
    context.emit = {
      message: emitMessageImpl,
      component: emitComponentImpl,
      status: emitStatusImpl,
      trace: traceEmitters,
    };
    // Read the request-scoped status slot. Internal — used by the generator's
    // tool-call dispatch to snapshot/restore the slot around a parallel tool
    // round so a tool's `activeStatusMessage` does not linger past the
    // tool's lifetime.
    context._peekStatus = (): string => statusSlot.message;

    Object.defineProperty(context, "sequencer", {
      enumerable: true,
      get() {
        let cursor = parentChain;
        while (cursor !== undefined) {
          if (
            cursor.parent.kind === "sequencer" &&
            cursor.parentStateContainer !== undefined
          ) {
            return context.getTarget(cursor.parent.name);
          }

          cursor = cursor.previous;
        }

        return undefined;
      }
    });

    Object.defineProperty(context, "parent", {
      enumerable: true,
      get() {
        if (parentChain?.previous === undefined) {
          return undefined;
        }

        const p = parentChain.previous.parent;
        return { name: p.name, kind: p.kind, input: p.input };
      }
    });

    Object.defineProperty(context, "response", {
      get() {
        return responseRef.current as ExecutionContext["response"];
      },
      set(value: unknown) {
        responseRef.current = value;
      },
      enumerable: true,
      configurable: true
    });

    return context;
  };

  const rootContext = createContext(undefined, undefined, undefined);
  // Attach the per-request background work pool so sequencer DSL can push
  // `.work()` / `.workIf()` / `.forEachBackground()` tasks. Each child
  // context constructed by `_withExecutionScope` re-attaches the same pool
  // explicitly (see the assignment alongside `_blockIdentity` there) — pool
  // identity is preserved across the entire request scope.
  (rootContext as { _requestWorkPool?: unknown })._requestWorkPool = requestWorkPool;
  // FIX-663: attach the background signal to the root context. Child scopes
  // re-attach it in `_withExecutionScope` (alongside the work pool).
  (rootContext as { _requestBackgroundSignal?: AbortSignal })._requestBackgroundSignal = options.backgroundSignal;
  // FIX-406 6H: stamp the tracing level on the root context too, for symmetry
  // with child scopes — keeps observability gating correct if a sequencer ever
  // executes directly on the root context.
  (rootContext as { _tracingLevel?: TracingLevel })._tracingLevel = options.tracingLevel;
  return rootContext;
}
