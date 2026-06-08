import type { ZodTypeAny } from "zod";
import type {
  OrgScopeHandle,
  RequestScopeHandle,
  ScopeType,
  SessionScopeHandle,
  UserScopeHandle
} from "./scope";
import type { JsonObject, JsonValue } from "../schema/common";
import type { ResourceCollectionRef, DefinedResourceCollection } from "./resource-collection";
import type { ResourceTemplate } from "../resource-template/resource-template";
import { validateClientProjection } from "../helpers/client-projection";
import type { ProjectedClient } from "../helpers/client-projection";

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
 *
 * Note (FIX-741): `ClientDataOf` recovers the `data` branch's precise output type
 * from the function's *return type*. Declared here as `JsonValue`, so an inline
 * `data: (state): MyShape => ({...})` (return annotated, or a literal body)
 * threads `MyShape`, but a function pre-assigned to `ResourceClientDataFn<...>`
 * before being passed in erases its return to `JsonValue` — `ClientDataOf` then
 * widens to `JsonValue` with no error. Inline the projection (or annotate its
 * return) when you want the precise client type.
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
  /**
   * Stream this resource's projected `clientData` as an inline delta on every
   * state mutation, merged into the client's cached snapshot without a refetch
   * (the resource-side analog of `state_change` live merge). Requires a
   * projection (`expose` / `exclude` / `data`) — a single resource with no
   * projection keeps its state private and has nothing to stream. Default
   * `false`: mutations flag a batched snapshot refetch at request completion.
   */
  live?: boolean;
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
  /**
   * Stream each mutated instance's projected `clientData` as an inline delta
   * mid-stream, merged into the client's cached snapshot without a refetch
   * (the resource-side analog of `state_change` live merge). Requires the
   * item's `clientData` to be client-visible — set `state.read: true` (identity
   * projection) or a projection (`expose` / `exclude` / `data`). Default
   * `false`: mutations flag a batched snapshot refetch at request completion.
   */
  live?: boolean;
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
  /** Path to a file on disk to load as the content body template. Mutually exclusive with `content`. */
  contentFile?: string;
  render?: (content: string, state: JsonObject) => string | Promise<string>;
  /**
   * A role-tagged Markdown template for this resource's content. Accepts
   * either a pre-parsed `ResourceTemplate` (from `parseResourceTemplate` /
   * `loadResourceTemplate`) or a file path string that the server resolves
   * at startup. The resource's content is rendered against its `state` via
   * deterministic LiquidJS. Mutually exclusive with `content` /
   * `contentFile` / `contentTemplateRef`.
   */
  contentTemplate?: ResourceTemplate | string;
  /**
   * Path of another resource whose RAW content is a role-tagged Markdown
   * template. Resolved at read-time: editing the template resource or this
   * resource's state changes `readContent()` output on next read.
   * Mutually exclusive with `content` / `contentFile` / `contentTemplate`.
   */
  contentTemplateRef?: string;
  llmReadable?: boolean;
  llmWritable?: boolean;
  dynamic?: boolean;
  writable?: boolean;
  allowedExtensions?: string[];
  metadata?: Record<string, unknown>;
  /**
   * When this resource's state/content is loaded relative to a request
   * (FIX-688). `'eager'` (default when omitted) loads it up front when the
   * scope's resource registry is constructed. `'lazy'` defers loading until
   * first access. Lazy single resources are only valid when declared on the
   * specific block that needs them — a per-block load trigger; declaring a
   * lazy single at flow level throws at `defineFlow` build time.
   */
  prefetchMode?: "eager" | "lazy";
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
 * to derive storage keys and detect cross-flow collisions. `ClientType`
 * (FIX-741) is the projected client-data shape derived from the `client` config
 * — a pure type-level brand (runtime `clientData` stays `JsonValue`). Extract it
 * with `ClientDataOf<typeof resource>`.
 */
export type DefinedResource<
  TState extends JsonObject = JsonObject,
  TClient = JsonValue,
> = ResourceConfig & {
  StateType: TState;
  ContextType: ResourceContext<TState>;
  ClientType: TClient;
};

/**
 * Extracts the projected client-data output type from a defined resource or
 * collection (FIX-741). Resolves to the `client` projection's shape —
 * `Pick`/`Omit`/computed-return/identity — so consumers derive the client type
 * from the definition instead of hand-mirroring it. `never` for anything that
 * isn't a defined resource/collection.
 */
export type ClientDataOf<T> =
  T extends DefinedResourceCollection<any, infer C>
    ? C
    : T extends DefinedResource<any, infer C>
      ? C
      : never;

export type MessageLike = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | JsonObject | JsonObject[];
};

export interface ResourceRef<TState extends JsonObject = JsonObject> {
  /**
   * Canonical within-scope storage path for this resource — what state and
   * content are persisted under. Equal to the accessor key for normal single
   * resources, the path-derived key (e.g. `"memos/p1/foo"`) for collection
   * instances, and the canonicalized key for dual-registered aliases (FIX-591).
   * Not necessarily the accessor name used to look up the handle.
   */
  path: string;
  scope: ScopeType;
  /**
   * Fully qualified identifier — `${scope}/${path}`. Stable and unique across
   * scopes within a flow. Opaque: do not feed to `new URL()` — it is not an
   * RFC-3986 URI, just a debug/logging/cross-scope-addressing handle.
   */
  uri: string;
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
): TConfig & DefinedResource<
  AsStateObject<TStateSchema["_output"]>,
  ProjectedClient<AsStateObject<StateOf<TConfig>>, TConfig["client"]>
> {
  const contentSources = [
    config.content !== undefined && "content",
    config.contentFile !== undefined && "contentFile",
    config.contentTemplate !== undefined && "contentTemplate",
    config.contentTemplateRef !== undefined && "contentTemplateRef",
  ].filter(Boolean) as string[];
  if (contentSources.length > 1) {
    throw new Error(
      `defineResource() accepts at most one content source, got: ${contentSources.join(", ")}`
    );
  }
  if (config.render !== undefined && (config.contentTemplate !== undefined || config.contentTemplateRef !== undefined)) {
    throw new Error(
      "defineResource() rejects render with contentTemplate/contentTemplateRef — template fields use built-in LiquidJS rendering"
    );
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
    kind: "single",
    stateSchema: config.stateSchema,
    client: config.client as Parameters<typeof validateClientProjection>[0]["client"]
  });

  return config as unknown as TConfig & DefinedResource<
    AsStateObject<TStateSchema["_output"]>,
    ProjectedClient<AsStateObject<StateOf<TConfig>>, TConfig["client"]>
  >;
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
