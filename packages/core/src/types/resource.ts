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
import { validateClientProjection } from "../helpers/client-projection";

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
 *
 * Field-projection fields (`expose`, `exclude`, `data`) are mutually
 * exclusive — set at most one per resource. With none set, the full state
 * is sent to the client (identity default).
 */
export type ResourceClientConfig<TState extends JsonObject = JsonObject> = {
  /** Content access permissions — governs access to the rendered content body. */
  content?: ResourceClientContentConfig;
  /** Whitelist: only these state fields reach the client. Mutually exclusive with `exclude` and `data`. */
  expose?: ReadonlyArray<keyof TState & string>;
  /** Blacklist: every state field reaches the client EXCEPT these. Mutually exclusive with `expose` and `data`. */
  exclude?: ReadonlyArray<keyof TState & string>;
  /** Escape hatch for computed / transformed projections. Mutually exclusive with `expose` and `exclude`. */
  data?: ResourceClientDataFn<TState>;
};

/**
 * Client-side state access permissions for a collection resource.
 * Collection-only — single resources gate state access via `clientData` directly.
 */
export type CollectionStateClientConfig = {
  /**
   * Allow clients to read per-item `clientData` via the list/get-state endpoints
   * and inline in the snapshot's `prefetched` window. The collection's `count`
   * is always emitted regardless of this flag — it's a cardinality affordance,
   * not state.
   */
  read?: boolean;
};

/**
 * Client visibility configuration for a collection resource.
 * Controls what data is exposed to the client and how.
 *
 * Field-projection fields (`expose`, `exclude`, `data`) are mutually
 * exclusive — set at most one per collection. With none set, each item's
 * full state is sent to the client (identity default).
 */
export type CollectionClientConfig<TState extends JsonObject = JsonObject> = {
  /** Content access permissions — governs access to rendered content bodies and CRUD operations. */
  content?: CollectionClientContentConfig;
  /**
   * State access permissions — governs the new list/get-state endpoints and
   * whether `prefetched` snapshot entries carry per-item `clientData`. Has no
   * effect on the always-emitted `count`.
   */
  state?: CollectionStateClientConfig;
  /** Whitelist: only these state fields reach the client. Mutually exclusive with `exclude` and `data`. */
  expose?: ReadonlyArray<keyof TState & string>;
  /** Blacklist: every state field reaches the client EXCEPT these. Mutually exclusive with `expose` and `data`. */
  exclude?: ReadonlyArray<keyof TState & string>;
  /**
   * Escape hatch for computed / transformed per-item projections. Mutually
   * exclusive with `expose` and `exclude`. Surfaces as `clientData` on items
   * returned by the list/get-state endpoints and on snapshot `prefetched`
   * entries (the latter only when `state.read: true`).
   */
  data?: ResourceClientDataFn<TState>;
};

export type ResourceConfig<TState extends JsonObject = JsonObject> = {
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
  client?: ResourceClientConfig<TState>;
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
  /**
   * Canonical storage key for this resource — what state and content are
   * persisted under. Equal to the accessor key for normal single resources,
   * the path-derived key (e.g. `"memos/p1/foo"`) for collection instances,
   * and the canonicalized key for dual-registered aliases (FIX-591). Not
   * necessarily the accessor name used to look up the handle.
   */
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
  const TConfig extends ResourceConfig<AsStateObject<TStateSchema["_output"]>> & { stateSchema: TStateSchema }
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

  validateClientProjection({
    definer: "defineResource()",
    ref: config.ref ?? "(unnamed)",
    stateSchema: config.stateSchema,
    client: config.client as Parameters<typeof validateClientProjection>[0]["client"]
  });

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
