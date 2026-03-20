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
  resolveNamespaceKey,
  validatePattern,
} from "./namespace-patterns";

// ---------------------------------------------------------------------------
// Config & Definition
// ---------------------------------------------------------------------------

export type EvictionPolicy = "none" | "lru" | "oldest";

/** Context provided to per-instance lifecycle hooks. */
export type NamespaceHookContext = {
  /** Log a message associated with this hook invocation. */
  log: (message: string) => void;
  /** The scope type this namespace belongs to (session, user, project). */
  scopeType: ScopeType;
};

export type ResourceNamespaceConfig = {
  /** Glob-style pattern: `files/*`, `files/**`, or `[topic]/observations`. */
  pattern: string;
  stateSchema: ZodTypeAny;
  maxInstances?: number;
  eviction?: EvictionPolicy;

  /** Fires when a specific instance is created (e.g., files/utils.ts). */
  onInstanceCreated?: (key: string, state: JsonObject, ctx: NamespaceHookContext) => void | Promise<void>;
  /** Fires when a specific instance's state is updated. */
  onInstanceUpdated?: (
    key: string,
    state: JsonObject,
    prevState: JsonObject,
    ctx: NamespaceHookContext
  ) => void | Promise<void>;
  /** Fires when a specific instance is deleted (including eviction). */
  onInstanceDeleted?: (key: string, ctx: NamespaceHookContext) => void | Promise<void>;
};

type AsStateObject<T> = T extends JsonObject ? T : JsonObject;

/**
 * Branded type returned by `defineResourceNamespace()`.
 * Carries phantom `StateType` for downstream type inference.
 */
export type DefinedResourceNamespace<TState extends JsonObject = JsonObject> =
  ResourceNamespaceConfig & {
    readonly __brand: "ResourceNamespace";
    StateType: TState;
  };

// ---------------------------------------------------------------------------
// Runtime Handle
// ---------------------------------------------------------------------------

/** Runtime handle for accessing a namespace's dynamic resource instances. */
export interface ResourceNamespaceRef<TState extends JsonObject = JsonObject> {
  /** The namespace's declared pattern. */
  pattern: string;
  /** Scope this namespace is registered in. */
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

  /** The namespace's config. */
  config: Readonly<ResourceNamespaceConfig>;
}

/** @deprecated Use ResourceNamespaceRef instead. */
export type ResourceNamespaceHandle<TState extends JsonObject = JsonObject> =
  ResourceNamespaceRef<TState>;

// ---------------------------------------------------------------------------
// defineResourceNamespace()
// ---------------------------------------------------------------------------

import { validatePattern } from "./namespace-patterns";

export function defineResourceNamespace<
  const TStateSchema extends ZodTypeAny,
  const TConfig extends ResourceNamespaceConfig & { stateSchema: TStateSchema }
>(
  config: TConfig
): TConfig & DefinedResourceNamespace<AsStateObject<TStateSchema["_output"]>> {
  validatePattern(config.pattern);

  if (config.maxInstances !== undefined && config.maxInstances < 1) {
    throw new Error("defineResourceNamespace() maxInstances must be >= 1");
  }

  if (config.eviction !== undefined && config.eviction !== "none" && config.maxInstances === undefined) {
    throw new Error("defineResourceNamespace() eviction requires maxInstances");
  }

  return Object.assign({}, config, {
    __brand: "ResourceNamespace" as const,
  }) as unknown as TConfig & DefinedResourceNamespace<AsStateObject<TStateSchema["_output"]>>;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isDefinedResourceNamespace(
  value: unknown
): value is DefinedResourceNamespace {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as DefinedResourceNamespace).__brand === "ResourceNamespace"
  );
}
