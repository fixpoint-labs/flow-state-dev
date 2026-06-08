import type { ZodTypeAny } from "zod";
import type { JsonObject, JsonValue } from "../schema/common";
import type { ScopeType } from "./scope";
import type { ResourceRef, CollectionClientConfig, StateOf } from "./resource";
import type { ResourceTemplate } from "../resource-template/resource-template";
import type { ProjectedClient } from "../helpers/client-projection";

// Re-export pattern utilities for consumers
export {
  extractPatternParams,
  getPatternPrefix,
  isDeepWildcard,
  isParameterizedPattern,
  isSingleWildcard,
  matchesPattern,
  normalizeResourcePath,
  resolveCollectionKey,
  resolveNamespaceKey,
  validatePattern,
} from "./collection-patterns";

// ---------------------------------------------------------------------------
// Config & Definition
// ---------------------------------------------------------------------------

export type EvictionPolicy = "none" | "lru" | "oldest";

/** Context provided to per-instance lifecycle hooks. */
export type CollectionHookContext = {
  /** Log a message associated with this hook invocation. */
  log: (message: string) => void;
  /** The scope type this collection belongs to (session, user, org). */
  scopeType: ScopeType;
  /**
   * The identifier of the concrete scope instance the hook fired in:
   * `userId` for `scope:"user"`, `orgId` for `scope:"org"`,
   * `sessionId` for `scope:"session"`. Lets hooks correlate collection
   * mutations back to the entity that owns them (e.g. mirroring a row
   * into a per-user schedule index).
   */
  scopeId: string;
};

export type ResourceCollectionConfig<TState extends JsonObject = JsonObject> = {
  /** Glob-style pattern: `files/*`, `files/**`, or `[topic]/observations`. */
  pattern: string;
  /**
   * Intrinsic scope this collection lives in. Required for new collections —
   * mirrors `defineResource({ scope })`.
   */
  scope: ScopeType;
  /**
   * Cross-flow sharing intent. Default `false`. Same semantics as
   * `ResourceConfig.flowIsolation`. Rejected at session scope.
   */
  flowIsolation?: boolean;
  stateSchema: ZodTypeAny;
  maxInstances?: number;
  eviction?: EvictionPolicy;
  /**
   * When this collection's instances are loaded relative to a request
   * (FIX-688). `'eager'` (default when omitted) loads the full instance set
   * when the scope's resource registry is constructed, giving the collection
   * ref synchronous `get`/`list`/`count`. `'lazy'` defers loading: the ref's
   * read methods become async and the collection holds only a partial cache.
   * Because a lazy collection never sees its full set, it cannot support a
   * non-`'none'` eviction policy — `defineResourceCollection` throws on that
   * combination.
   */
  prefetchMode?: "eager" | "lazy";

  /** A role-tagged Markdown template applied to each instance. Accepts a parsed `ResourceTemplate` or a file path resolved at server startup. */
  contentTemplate?: ResourceTemplate | string;
  /** Path of another resource whose raw content is a template for each instance. */
  contentTemplateRef?: string;

  /** Client visibility configuration. Omit to keep the collection invisible to clients. */
  client?: CollectionClientConfig<TState>;

  /**
   * Number of items to inline in the snapshot's `prefetched` window for this
   * collection. Default `0` (lazy — clients fetch items via the list endpoint
   * or `useResourceCollectionList`). Items are selected in lexicographic
   * storage-key order, not by recency. Per-item `clientData` is included only
   * when `client.state.read` is also `true`; otherwise prefetched entries
   * carry just the `topic`.
   */
  prefetchWindow?: number;

  /** Fires when a specific instance is created (e.g., files/utils.ts). */
  onInstanceCreated?: (key: string, state: JsonObject, ctx: CollectionHookContext) => void | Promise<void>;
  /** Fires when a specific instance's state is updated. */
  onInstanceUpdated?: (
    key: string,
    state: JsonObject,
    prevState: JsonObject,
    ctx: CollectionHookContext
  ) => void | Promise<void>;
  /** Fires when a specific instance is deleted (including eviction). */
  onInstanceDeleted?: (key: string, ctx: CollectionHookContext) => void | Promise<void>;
};

type AsStateObject<T> = T extends JsonObject ? T : JsonObject;

/**
 * Branded type returned by `defineResourceCollection()`.
 * Carries phantom `StateType` for downstream type inference, and `ClientType`
 * (FIX-741) — the projected client-data shape derived from the `client` config
 * (`expose`/`exclude`/`data`/identity). `ClientType` is a pure type-level brand;
 * the runtime `clientData` payload stays `JsonValue`. Extract it with
 * `ClientDataOf<typeof collection>`. The `prefetchMode` config field still exists
 * (it controls server-side loading behaviour), but it no longer affects the
 * ref's read-method signatures — both eager and lazy collections expose the same
 * async `ResourceCollectionRef` interface (FIX-700).
 */
export type DefinedResourceCollection<
  TState extends JsonObject = JsonObject,
  TClient = JsonValue,
> =
  ResourceCollectionConfig & {
    readonly __brand: "ResourceCollection";
    StateType: TState;
    ClientType: TClient;
  };

// ---------------------------------------------------------------------------
// Runtime Ref
// ---------------------------------------------------------------------------

/**
 * Runtime ref for accessing a collection's dynamic resource instances.
 *
 * All read methods (`get`/`getOptional`/`list`/`count`) are async regardless
 * of `prefetchMode` — the server implementation resolves immediately for eager
 * collections and performs a load for lazy ones, but callers always `await`
 * (FIX-700). Mutation methods (`create`/`getOrCreate`/`upsert`/`delete`) were
 * already async and are unchanged.
 *
 * `ResourceRef.state` is a synchronous getter on the ref itself — do NOT await it.
 */
export interface ResourceCollectionRef<TState extends JsonObject = JsonObject> {
  /** The collection's declared pattern. */
  pattern: string;
  /** Scope this collection is registered in. */
  scope: ScopeType;

  /** Get an existing instance. Rejects if not found. */
  get(key: string | Record<string, string>): Promise<ResourceRef<TState>>;

  /** Get an existing instance, or `undefined` if not found. */
  getOptional(key: string | Record<string, string>): Promise<ResourceRef<TState> | undefined>;

  /**
   * Create a new instance.
   *
   * Default behavior: throws if already exists, or if creating would exceed
   * `maxInstances` (subject to the configured `eviction` policy).
   *
   * With `{ replace: true }`: overwrites the instance if it exists
   * (`setState` semantics — Zod `.default(null)` fills nullable fields the
   * caller doesn't supply); creates it if missing. Use for setup/reset
   * paths that want a known initial state regardless of whether the
   * instance was present before.
   */
  create(
    key: string | Record<string, string>,
    initial?: Partial<TState>,
    options?: { replace?: boolean }
  ): Promise<ResourceRef<TState>>;

  /** Get or create — returns existing if present, creates if not. */
  getOrCreate(
    key: string | Record<string, string>,
    initial?: Partial<TState>
  ): Promise<ResourceRef<TState>>;

  /**
   * Upsert — patch the existing instance with `update` if it exists,
   * otherwise create with `{ ...createOnly, ...update }` (the create-only
   * extras provide the fields you only need to supply at creation time
   * — `update` wins on overlapping keys).
   *
   * Fires `onInstanceUpdated` on the patch branch, `onInstanceCreated`
   * on the create branch. The create branch honors `maxInstances` +
   * `eviction` like `create()`.
   *
   * Use for incremental-update paths that need to handle the
   * first-touch case in a single call.
   */
  upsert(
    key: string | Record<string, string>,
    update: Partial<TState>,
    createOnly?: Partial<TState>
  ): Promise<ResourceRef<TState>>;

  /** List all instances, optionally filtered by prefix. */
  list(prefix?: string): Promise<ResourceRef<TState>[]>;

  /** Delete an instance. No-op if the instance does not exist. */
  delete(key: string | Record<string, string>): Promise<void>;

  /** Current instance count. */
  count(): Promise<number>;

  /** The collection's config. */
  config: Readonly<ResourceCollectionConfig>;
}

// ---------------------------------------------------------------------------
// defineResourceCollection()
// ---------------------------------------------------------------------------

import { validatePattern } from "./collection-patterns";
import { validateClientProjection } from "../helpers/client-projection";

export function defineResourceCollection<
  const TStateSchema extends ZodTypeAny,
  const TConfig extends ResourceCollectionConfig<AsStateObject<TStateSchema["_output"]>> & { stateSchema: TStateSchema }
>(
  config: TConfig
): TConfig & DefinedResourceCollection<
  AsStateObject<TStateSchema["_output"]>,
  ProjectedClient<AsStateObject<StateOf<TConfig>>, TConfig["client"]>
> {
  validatePattern(config.pattern);

  if (config.contentTemplate !== undefined && config.contentTemplateRef !== undefined) {
    throw new Error(
      "defineResourceCollection() accepts at most one template source: contentTemplate or contentTemplateRef, not both"
    );
  }

  if (config.scope !== "session" && config.scope !== "user" && config.scope !== "org") {
    throw new Error(
      `defineResourceCollection() requires an explicit scope of "session", "user", or "org" (got ${JSON.stringify(config.scope)})`
    );
  }

  if (config.flowIsolation === true && config.scope === "session") {
    throw new Error(
      `defineResourceCollection() rejects flowIsolation:true on session-scoped collections — sessions are intrinsically flow-bound`
    );
  }

  if (config.maxInstances !== undefined && config.maxInstances < 1) {
    throw new Error("defineResourceCollection() maxInstances must be >= 1");
  }

  if (config.eviction !== undefined && config.eviction !== "none" && config.maxInstances === undefined) {
    throw new Error("defineResourceCollection() eviction requires maxInstances");
  }

  if (
    config.prefetchMode === "lazy" &&
    config.eviction !== undefined &&
    config.eviction !== "none"
  ) {
    throw new Error(
      `defineResourceCollection() does not support prefetchMode: 'lazy' with eviction '${config.eviction}' — lazy collections only hold a partial cache, so eviction cannot see the full set. Use eviction: 'none' with lazy.`
    );
  }

  if (config.prefetchWindow !== undefined) {
    if (!Number.isInteger(config.prefetchWindow) || config.prefetchWindow < 0) {
      throw new Error(
        `defineResourceCollection() prefetchWindow must be a non-negative integer (got ${JSON.stringify(config.prefetchWindow)})`
      );
    }
    if (config.prefetchWindow > 100) {
      // eslint-disable-next-line no-console
      console.warn(
        `defineResourceCollection(): prefetchWindow=${config.prefetchWindow} is large; prefetched items inflate every snapshot. Consider lazy reads via the list endpoint instead.`
      );
    }
  }

  validateClientProjection({
    definer: "defineResourceCollection()",
    ref: config.pattern,
    kind: "collection",
    stateSchema: config.stateSchema,
    client: config.client as Parameters<typeof validateClientProjection>[0]["client"]
  });

  return Object.assign({}, config, {
    __brand: "ResourceCollection" as const,
  }) as unknown as TConfig & DefinedResourceCollection<
    AsStateObject<TStateSchema["_output"]>,
    ProjectedClient<AsStateObject<StateOf<TConfig>>, TConfig["client"]>
  >;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isDefinedResourceCollection(
  value: unknown
): value is DefinedResourceCollection {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as DefinedResourceCollection).__brand === "ResourceCollection"
  );
}

