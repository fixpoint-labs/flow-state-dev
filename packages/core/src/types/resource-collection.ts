import type { ZodTypeAny } from "zod";
import type { JsonObject } from "../schema/common";
import type { ScopeType } from "./scope";
import type { ResourceRef } from "./resource";

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
  /** The scope type this collection belongs to (session, user, project). */
  scopeType: ScopeType;
};

export type ResourceCollectionConfig = {
  /** Glob-style pattern: `files/*`, `files/**`, or `[topic]/observations`. */
  pattern: string;
  stateSchema: ZodTypeAny;
  maxInstances?: number;
  eviction?: EvictionPolicy;

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

export function defineResourceCollection<
  const TStateSchema extends ZodTypeAny,
  const TConfig extends ResourceCollectionConfig & { stateSchema: TStateSchema }
>(
  config: TConfig
): TConfig & DefinedResourceCollection<AsStateObject<TStateSchema["_output"]>> {
  validatePattern(config.pattern);

  if (config.maxInstances !== undefined && config.maxInstances < 1) {
    throw new Error("defineResourceCollection() maxInstances must be >= 1");
  }

  if (config.eviction !== undefined && config.eviction !== "none" && config.maxInstances === undefined) {
    throw new Error("defineResourceCollection() eviction requires maxInstances");
  }

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

// ---------------------------------------------------------------------------
// Deprecated aliases — backward compatibility
// ---------------------------------------------------------------------------

/** @deprecated Use CollectionHookContext instead. */
export type NamespaceHookContext = CollectionHookContext;

/** @deprecated Use ResourceCollectionConfig instead. */
export type ResourceNamespaceConfig = ResourceCollectionConfig;

/** @deprecated Use DefinedResourceCollection instead. */
export type DefinedResourceNamespace<TState extends JsonObject = JsonObject> = DefinedResourceCollection<TState>;

/** @deprecated Use ResourceCollectionRef instead. */
export type ResourceNamespaceRef<TState extends JsonObject = JsonObject> = ResourceCollectionRef<TState>;

/** @deprecated Use ResourceCollectionRef instead. */
export type ResourceNamespaceHandle<TState extends JsonObject = JsonObject> = ResourceCollectionRef<TState>;

/** @deprecated Use ResourceCollectionHandle instead. */
export type ResourceCollectionHandle<TState extends JsonObject = JsonObject> = ResourceCollectionRef<TState>;

/** @deprecated Use defineResourceCollection instead. */
export const defineResourceNamespace = defineResourceCollection;

/** @deprecated Use isDefinedResourceCollection instead. */
export const isDefinedResourceNamespace = isDefinedResourceCollection;
