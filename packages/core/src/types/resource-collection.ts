import type { ZodTypeAny } from "zod";
import type { JsonObject } from "../schema/common";
import type { ScopeType } from "./scope";
import type { ResourceRef, CollectionClientConfig } from "./resource";

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
 * Carries phantom `StateType` for downstream type inference.
 */
export type DefinedResourceCollection<TState extends JsonObject = JsonObject> =
  ResourceCollectionConfig & {
    readonly __brand: "ResourceCollection";
    StateType: TState;
  };

// ---------------------------------------------------------------------------
// Runtime Ref
// ---------------------------------------------------------------------------

/** Runtime ref for accessing a collection's dynamic resource instances. */
export interface ResourceCollectionRef<TState extends JsonObject = JsonObject> {
  /** The collection's declared pattern. */
  pattern: string;
  /** Scope this collection is registered in. */
  scope: ScopeType;

  /** Get an existing instance. Throws if not found. */
  get(key: string | Record<string, string>): ResourceRef<TState>;

  /** Get an existing instance, or undefined if not found. */
  getOptional(key: string | Record<string, string>): ResourceRef<TState> | undefined;

  /** Create a new instance. Throws if already exists or maxInstances exceeded. */
  create(
    key: string | Record<string, string>,
    initial?: Partial<TState>
  ): Promise<ResourceRef<TState>>;

  /** Get or create — returns existing if present, creates if not. */
  getOrCreate(
    key: string | Record<string, string>,
    initial?: Partial<TState>
  ): Promise<ResourceRef<TState>>;

  /** List all instances, optionally filtered by prefix. */
  list(prefix?: string): ResourceRef<TState>[];

  /** Delete an instance. No-op if the instance does not exist. */
  delete(key: string | Record<string, string>): Promise<void>;

  /** Current instance count. */
  count(): number;

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
): TConfig & DefinedResourceCollection<AsStateObject<TStateSchema["_output"]>> {
  validatePattern(config.pattern);

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
    stateSchema: config.stateSchema,
    client: config.client as Parameters<typeof validateClientProjection>[0]["client"]
  });

  return Object.assign({}, config, {
    __brand: "ResourceCollection" as const,
  }) as unknown as TConfig & DefinedResourceCollection<AsStateObject<TStateSchema["_output"]>>;
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

