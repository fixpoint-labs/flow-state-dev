import type { ZodTypeAny } from "zod";
import type {
  OrgScopeHandle,
  RequestScopeHandle,
  ScopeType,
  SessionScopeHandle,
  UserScopeHandle
} from "./scope";
import type { JsonObject, JsonValue } from "../schema/common";
import type { ResourceCollectionRef } from "./resource-collection";

/**
 * The scope a resource is intrinsically bound to. Determines which storage
 * layer holds its state and content (session/user/org records and content
 * stores). Set via `defineResource({ scope })`.
 */
export type ResourceScope = "session" | "user" | "org";

/**
 * Client-side content access permissions for a single resource.
 * Only `read` and `prefetch` are valid on single resources.
 */
export type ResourceClientContentConfig = {
  /** Allow clients to fetch the rendered content body via the content endpoint. */
  read?: boolean;
  /** When true, content is included inline in the snapshot response (for small, always-needed resources). */
  prefetch?: boolean;
};

/**
 * Client-side content access permissions for a collection resource.
 * Extends single-resource permissions with CRUD mutation flags.
 */
export type CollectionClientContentConfig = ResourceClientContentConfig & {
  /** Allow clients to create new collection items via POST. */
  create?: boolean;
  /** Allow clients to update existing collection item content via PATCH. */
  update?: boolean;
  /** Allow clients to delete collection items via DELETE. */
  delete?: boolean;
};

/**
 * A compute function that derives client-visible data from a resource's state.
 * Analogous to scope-level clientData, but scoped to the resource.
 */
export type ResourceClientDataFn<TState extends JsonObject = JsonObject> =
  (state: Readonly<TState>) => JsonValue | Promise<JsonValue>;

/**
 * Client visibility configuration for a single resource.
 * Controls what data is exposed to the client and how.
 */
export type ResourceClientConfig = {
  /** Content access permissions — governs access to the rendered content body. */
  content?: ResourceClientContentConfig;
  /** Derives client-visible metadata from the resource's state. Appears under `resources[ref].clientData` in the snapshot. */
  data?: ResourceClientDataFn;
};

/**
 * Client visibility configuration for a collection resource.
 * Controls what data is exposed to the client and how.
 */
export type CollectionClientConfig = {
  /** Content access permissions — governs access to rendered content bodies and CRUD operations. */
  content?: CollectionClientContentConfig;
  /** Derives client-visible metadata from each instance's state. Appears under `resources[ref].items[topic].clientData` in the snapshot. */
  data?: ResourceClientDataFn;
};

export type ResourceConfig = {
  /**
   * Logical reference name. Used as the storage namespace identifier
   * (combined with `scope` and `flowIsolation` to form the storage key).
   * Independent of the accessor name on `ctx.resources.<key>`.
   */
  ref?: string;
  /**
   * Intrinsic scope this resource lives in. Determines which storage layer
   * (session/user/org) holds its state and content. Required for new
   * resources; the framework treats omission as a validation error in
   * `defineResource`.
   */
  scope: ResourceScope;
  /**
   * Cross-flow sharing intent. Default `false`:
   *   - `user` / `org` scope: stored at `(scopeId, ref)` — shared across
   *     every flow the same `userId` / `orgId` touches.
   *   - `session` scope: sessions are intrinsically flow-bound; the field
   *     has no semantic meaning and `true` is rejected at build time.
   *
   * Set `true` to opt user/org-scoped resources into per-flow isolation —
   * stored at `(scopeId, flowKind, ref)`. See FIX-435 conflict-detection
   * rules for collisions across flows.
   */
  flowIsolation?: boolean;
  stateSchema: ZodTypeAny;
  default?: JsonValue;
  content?: string;
  /** Path to a file on disk to load as the content body template. Mutually exclusive with `content`.
   * Resolved relative to `process.cwd()` — use absolute paths for predictable behavior. */
  contentFile?: string;
  render?: (content: string, state: JsonObject) => string | Promise<string>;
  llmReadable?: boolean;
  llmWritable?: boolean;
  dynamic?: boolean;
  writable?: boolean;
  allowedExtensions?: string[];
  metadata?: Record<string, unknown>;
  /** Client visibility configuration. Omit to keep the resource invisible to clients. */
  client?: ResourceClientConfig;
};

export type ResourceContext<TState extends JsonObject = JsonObject> = {
  state: Readonly<TState>;
  patchState(updates: Partial<TState>): Promise<void>;
  setState(nextState: TState): Promise<void>;
  updateState(updater: (state: TState) => TState | Promise<TState>): Promise<void>;
};

/**
 * Branded definition returned by `defineResource()`. Carries the resolved
 * state type and intrinsic scope/flowIsolation stamps used by the framework
 * to derive storage keys and detect cross-flow collisions.
 */
export type DefinedResource<TState extends JsonObject = JsonObject> = ResourceConfig & {
  StateType: TState;
  ContextType: ResourceContext<TState>;
};

export type MessageLike = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | JsonObject | JsonObject[];
};

export interface ResourceRef<TState extends JsonObject = JsonObject> {
  name: string;
  scope: ScopeType;
  state: Readonly<TState>;
  patchState(updates: Partial<TState>): Promise<void>;
  setState(nextState: TState): Promise<void>;
  updateState(updater: (state: TState) => TState | Promise<TState>): Promise<void>;
  readContent(): Promise<string | null>;
  readContentRaw(): Promise<string | null>;
  writeContent(content: string): Promise<void>;
  contentType?: string;
  extension?: string;
  config: Readonly<ResourceConfig>;
}



/** @deprecated Use ResourceRef instead. */
export type ResourceHandle<TState extends JsonObject = JsonObject> = ResourceRef<TState>;

/** Union of handle types that can appear in a resource registry. */
export type AnyResourceRef = ResourceRef<any> | ResourceCollectionRef<any>;

export type ResourceRegistry<
  TResources extends Record<string, AnyResourceRef> = Record<string, AnyResourceRef>
> = TResources & {
  get<TKey extends keyof TResources>(name: TKey): TResources[TKey];
  list(): Array<TResources[keyof TResources]>;
};

export type StateOf<T> = T extends { stateSchema: infer S extends ZodTypeAny }
  ? S["_output"]
  : T extends ZodTypeAny
    ? T["_output"]
    : never;

type AsStateObject<T> = T extends JsonObject ? T : JsonObject;

export type ContextOf<
  T,
  TKind extends "resource" | "request" | "session" | "user" | "org" = "resource",
  // Retained for back-compat — resources now live on `ctx.resources` (FIX-435).
  _TResources extends Record<string, ResourceRef<any>> = Record<string, ResourceRef<any>>
> = TKind extends "resource"
  ? ResourceContext<AsStateObject<StateOf<T>>>
  : TKind extends "session"
    ? SessionScopeHandle<AsStateObject<StateOf<T>>>
    : TKind extends "request"
      ? RequestScopeHandle<AsStateObject<StateOf<T>>>
      : TKind extends "user"
        ? UserScopeHandle<AsStateObject<StateOf<T>>>
        : OrgScopeHandle<AsStateObject<StateOf<T>>>;

export type ResourceRefOptions = {
  optional?: boolean;
  as?: string;
};

export function defineResource<
  const TStateSchema extends ZodTypeAny,
  const TConfig extends ResourceConfig & { stateSchema: TStateSchema }
>(
  config: TConfig
): TConfig & DefinedResource<AsStateObject<TStateSchema["_output"]>> {
  if (config.content !== undefined && config.contentFile !== undefined) {
    throw new Error("defineResource() accepts either content or contentFile, not both");
  }

  if (config.scope !== "session" && config.scope !== "user" && config.scope !== "org") {
    throw new Error(
      `defineResource() requires an explicit scope of "session", "user", or "org" (got ${JSON.stringify(config.scope)})`
    );
  }

  if (config.flowIsolation === true && config.scope === "session") {
    throw new Error(
      `defineResource() rejects flowIsolation:true on session-scoped resources — sessions are intrinsically flow-bound`
    );
  }

  return config as unknown as TConfig & DefinedResource<AsStateObject<TStateSchema["_output"]>>;
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  const out: JsonObject = {};

  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      continue;
    }

    out[key] = entry as JsonValue;
  }

  return out;
}

/**
 * Slot helper for declaring resource dependencies in generator context slots.
 * Returns a function compatible with `GeneratorSlotReference` that resolves a
 * resource reference at execution time.
 */
export function resource(uri: string, options?: ResourceRefOptions): (input: JsonObject, ctx: unknown) => MessageLike {
  return (_input, _ctx) => {
    const content = toJsonObject({
      ref: uri,
      options: options === undefined ? undefined : toJsonObject(options as Record<string, unknown>)
    });

    return {
      role: "system",
      content
    };
  };
}
