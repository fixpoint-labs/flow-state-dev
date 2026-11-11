import type { ZodTypeAny } from "zod";
import { z } from "zod";
import { edgeListSchema, type EdgeSlotConfig, type ResourceEdgeApi, type Edge } from "../graph";
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
import type { ReactiveBindings } from "./resource-change";
import { validateReactTo } from "./resource-change";

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

// FIX-741.
/**
 * A compute function that derives client-visible data from a resource's state.
 * Analogous to scope-level clientData, but scoped to the resource.
 *
 * Note: `ClientDataOf` recovers the `data` branch's precise output type
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

/**
 * A file path carrying the declaring module's anchor. Pass `import.meta.url`
 * as `importerUrl`; the server resolves a relative `path` against the
 * module's directory first, falling back to the working directory when the
 * anchor is unusable (e.g. rewritten by a bundler) or the module-relative
 * file doesn't exist. Plain strings stay supported and resolve from the
 * working directory only. Isomorphic-safe: both fields are plain strings.
 */
export type AnchoredPath = {
  /** Relative or absolute file path. */
  path: string;
  /** The declaring module's `import.meta.url`, anchoring a relative `path`. */
  importerUrl: string;
};

// FIX-2624.
/**
 * Which flow writes a user or org resource when a client asks to write it.
 * `"default"` is the framework's default write flow: it checks the schema,
 * the owner and {@link ResourceConfig.canWrite}, and writes at the version the
 * client read. `{ flow }` names a flow the app hosts, whose actions write it
 * with their own rules. With no `runBy`, a client can't write the resource;
 * server flows still write it from inside their actions.
 */
export type ResourceRunBy = "default" | { flow: string };

/**
 * What {@link ResourceConfig.canWrite} decides on: the stored state, the state
 * the client asks for, and who asks, from the verified sign-in.
 */
export type ResourceWriteCheck<TState extends JsonObject = JsonObject> = {
  /** The stored state the write replaces: the schema's default when nothing is stored. */
  prev: Readonly<TState>;
  /** The state the write would store, already parsed by the schema. */
  next: Readonly<TState>;
  userId: string;
  orgId: string;
};

/** The default write flow's own rule for one resource: `true` admits the write. */
export type ResourceCanWrite<TState extends JsonObject = JsonObject> = (
  check: ResourceWriteCheck<TState>
) => boolean | Promise<boolean>;

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
  // FIX-1323; FIX-435.
  /**
   * Cross-flow sharing intent. Default `false`:
   *   - `user` / `org` scope: stored at `(scopeId, ref)` — shared across
   *     every flow the same `userId` / `orgId` touches. Exception: on an
   *     instance registered with an owner pin, a user-scoped resource is
   *     stored in a per-(org, user) cell, shared only with that user's other
   *     owner-pinned instances in the same organization.
   *   - `session` scope: sessions are intrinsically flow-bound; the field
   *     has no semantic meaning and `true` is rejected at build time.
   *
   * Set `true` to opt user/org-scoped resources into per-flow isolation —
   * stored at `(scopeId, flowInstanceId, ref)`. The coordinate is the
   * resolved **instance** id, not the kind: two registered copies
   * of one `collection` definition each get their own cell. An instance
   * registered at runtime is one instance too, so this keys per instance.
   *
   * A singleton's instance id is its kind, so its keys are normally unchanged
   * — with one exception: each key component is escaped before joining, so an
   * id containing `:` or `\` (in the kind, or in the `userId` / `orgId`) keys
   * differently than it did before instance-keyed storage and needs the offline cutover in
   * `apps/docs/docs/persistence/overview.md`. Such a deployment already had
   * ambiguous keys. See `scope-keys.ts` for the encoding.
   *
   * Registration refuses two flow kinds that declare the same shared ref with
   * conflicting settings. It does not catch overlapping collection patterns
   * (`files/*` beside `files/a`), or two instances of one kind whose resource
   * overrides differ; the engine's `validateScope` documents both gaps.
   */
  flowIsolation?: boolean;
  // FIX-1068.
  /**
   * Give this session-scoped resource ONE identity across the whole session
   * lineage, so a session and every background child session it
   * dispatches — and every child those children dispatch — read and write
   * the same resource through the ordinary resource API.
   *
   * Default `false`: a session-scoped resource resolves against the running
   * session, so a child session hydrates its own empty copy. Set `true` and it
   * resolves against the **lineage root** instead — the top-most session in the
   * chain — which every session in that lineage agrees on.
   *
   * Session-scope only. `true` at `user` / `org` scope is rejected at build
   * time: those scopes already span every session the same principal touches,
   * so the flag would mean nothing there.
   *
   * **Sharing is not serialization.** Two children writing one shared resource
   * is ordinary same-resource contention, fenced by the store's
   * `expectedVersion` check like any other concurrent write. Nothing here
   * queues, locks, or orders those writes.
   *
   * Session **state** is never shared — this flag reaches resources only.
   */
  sharedToLineage?: boolean;
  stateSchema: ZodTypeAny;
  default?: JsonValue;
  content?: string;
  /**
   * Path to a file on disk to load as the content body template. A bare
   * string resolves from the working directory; an {@link AnchoredPath}
   * resolves relative to the declaring module first (pass `import.meta.url`).
   * Mutually exclusive with `content`.
   */
  contentFile?: string | AnchoredPath;
  render?: (content: string, state: JsonObject) => string | Promise<string>;
  /**
   * A role-tagged Markdown template for this resource's content. Accepts a
   * pre-parsed `ResourceTemplate` (from `parseResourceTemplate` /
   * `loadResourceTemplate`), or a file path that the server resolves at
   * startup — a bare string resolves from the working directory; an
   * {@link AnchoredPath} resolves relative to the declaring module first
   * (pass `import.meta.url`). The resource's content is rendered against its
   * `state` via deterministic LiquidJS. Mutually exclusive with `content` /
   * `contentFile` / `contentTemplateRef`.
   */
  contentTemplate?: ResourceTemplate | string | AnchoredPath;
  /**
   * Path of another resource whose RAW content is a role-tagged Markdown
   * template. Resolved at read-time: editing the template resource or this
   * resource's state changes `readContent()` output on next read.
   * Mutually exclusive with `content` / `contentFile` / `contentTemplate`.
   */
  contentTemplateRef?: string;
  llmReadable?: boolean;
  llmWritable?: boolean;
  /**
   * State fields that never leave the server. Every read the engine serves
   * omits them: the client snapshot, the list and get-state routes, live
   * deltas, and the debug routes, which otherwise return full state. A
   * `client.data` function sees the full state, but a secret field in what it
   * returns is dropped. Blocks on the server read them through the handle.
   * A field named here cannot also be named in `client.expose`.
   */
  secret?: ReadonlyArray<keyof TState & string>;
  /**
   * Removed. `dynamic` never had an effect — collections are declared with
   * `defineResourceCollection`. Typed `never` rather than deleted because
   * `defineResource` takes its config as a naked generic parameter, so
   * excess-property checking does not fire on the call-site literal: simply
   * deleting the field would leave `dynamic: true` silently accepted and
   * spread onto the returned definition.
   *
   * @deprecated Remove the option; it does nothing.
   */
  dynamic?: never;
  writable?: boolean;
  allowedExtensions?: string[];
  metadata?: Record<string, unknown>;
  // FIX-688.
  /**
   * When this resource's state/content is loaded relative to a request.
   * `'eager'` (default when omitted) loads it up front when the
   * scope's resource registry is constructed. `'lazy'` defers loading until
   * first access. Lazy single resources are only valid when declared on the
   * specific block that needs them — a per-block load trigger; declaring a
   * lazy single at flow level throws at `defineFlow` build time.
   */
  prefetchMode?: "eager" | "lazy";
  /** Client visibility configuration. Omit to keep the resource invisible to clients. */
  client?: ResourceClientConfig<TState>;
  // FIX-751, FIX-843.
  /**
   * Bind blocks to this resource's mutations. Each present
   * entry names a block — bare, or `{ block, when }` with an optional gate —
   * that the server dispatcher runs when that mutation fires. The state kinds
   * (`created` / `stateUpdated` / `deleted`) get a `ResourceChange` payload;
   * `contentUpdated` (a content-body write) gets a `ResourceContentChange`.
   */
  reactTo?: ReactiveBindings<TState>;
  // FIX-2624.
  /**
   * The flow a client's write of this user or org resource runs through:
   * `"default"` (the framework's default write flow) or `{ flow }`. Omit it and
   * a client can't write the resource. User or org scope only, and not with
   * `flowIsolation: true`, and with a `client` config the client reads it
   * through. With `"default"`, no computed `client.data`.
   */
  runBy?: ResourceRunBy;
  /**
   * The default write flow's rule for this resource, run after the schema and
   * owner checks; `false` refuses the write. Requires `runBy: "default"`.
   * Required for an org resource on the default write flow: without it every
   * member of the org could write it. Declare `canWrite: () => true` when that
   * is what you want.
   */
  canWrite?: ResourceCanWrite<TState>;
  /** Declare a typed-edge graph on this resource. `true` = defaults; object = curated vocabulary / size cap. The framework injects an `edges: Edge[]` state field (if absent) and attaches an `.edges` API to the live ref. */
  edges?: boolean | EdgeSlotConfig;
};

/**
 * The shape `incState` accepts: the number-valued fields of `TState`, each
 * optional, each taking a delta.
 *
 * Keyed by remap rather than as `Partial<Record<...>>` so a declared field of
 * another type (`name: string`) is dropped from the accepted shape instead of
 * being silently allowed. Note the ceiling: on a state type inferred from a
 * `passthrough()` schema the JSON index signature makes every string a
 * candidate. That is the same latitude `patchState`'s `Partial<TState>` already
 * has — these verbs sit at parity with the existing mutators, not stricter
 * than them — and the checking is exact on a hand-written state type.
 */
export type ResourceIncrements<TState> = {
  [K in keyof TState as [Extract<NonNullable<TState[K]>, number>] extends [never]
    ? never
    : K]?: number;
};

/** The field names of `TState` that can hold an array — what `pushState` accepts. */
export type ResourceArrayKeys<TState> = {
  [K in keyof TState]-?: [Extract<NonNullable<TState[K]>, readonly unknown[]>] extends [never]
    ? never
    : K;
}[keyof TState] &
  string;

/** The element type of an array-valued state field — what `pushState` appends to it. */
export type ResourceArrayElement<T> =
  Extract<NonNullable<T>, readonly unknown[]> extends readonly (infer E)[] ? E : never;

export type ResourceContext<TState extends JsonObject = JsonObject> = {
  state: Readonly<TState>;
  patchState(updates: Partial<TState>): Promise<void>;
  setState(nextState: TState): Promise<void>;
  updateState(updater: (state: TState) => TState | Promise<TState>): Promise<void>;
  /**
   * Add to number-valued state fields in one guarded write.
   * @see ResourceRef.incState for the atomicity and refusal contract.
   */
  incState(increments: ResourceIncrements<TState>): Promise<void>;
  /**
   * Append one value to an array-valued state field in one guarded write.
   * @see ResourceRef.pushState for the atomicity and refusal contract.
   */
  pushState<K extends ResourceArrayKeys<TState>>(
    field: K,
    value: ResourceArrayElement<TState[K]>
  ): Promise<void>;
  /** Typed-edge graph API — present at runtime only when the resource declared `edges`. Consumers that declared edges access it via `ctx.edges!`. */
  edges?: ResourceEdgeApi;
};

// FIX-741.
/**
 * Branded definition returned by `defineResource()`. Carries the resolved
 * state type and intrinsic scope/flowIsolation stamps used by the framework
 * to derive storage keys and detect cross-flow collisions. `ClientType`
 * is the projected client-data shape derived from the `client` config
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

// FIX-741.
/**
 * Extracts the projected client-data output type from a defined resource or
 * collection. Resolves to the `client` projection's shape —
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
  // FIX-591.
  /**
   * Canonical within-scope storage path for this resource — what state and
   * content are persisted under. Equal to the accessor key for normal single
   * resources, the path-derived key (e.g. `"memos/p1/foo"`) for collection
   * instances, and the canonicalized key for dual-registered aliases.
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
  /**
   * Add to number-valued state fields — `incState({ calls: 1 })` — without
   * reading, changing and writing the state back yourself.
   *
   * **Atomic per write, and no faster.** Each call is a single guarded
   * mutation: a write that loses a race re-runs against the winner's stored row
   * rather than committing a value computed from a snapshot that has since
   * moved, so two callers incrementing one counter both land. That holds on the
   * memory, SQLite and Postgres stores. The filesystem store guards a record's
   * read-check-write with a per-id **in-process** lock, so two processes over
   * one directory can still lose an increment. Concurrent writers still retry —
   * the gain is expressing the intent, not throughput.
   *
   * **Refuses rather than corrupts.** Incrementing a field that holds something
   * other than a number fails and leaves the stored value alone. An absent or
   * `null` field is that field's empty state, not a wrong kind of value: it
   * starts from `0`. A result that is not finite is also refused — two finite
   * operands can overflow to `Infinity`, which `z.number()` accepts but the
   * stores disagree about how to persist.
   *
   * Applies wholly or not at all: if one field of a multi-field call is
   * wrong-typed, nothing is written.
   */
  incState(increments: ResourceIncrements<TState>): Promise<void>;
  /**
   * Append one value to an array-valued state field —
   * `pushState("errors", "rate_limited")`.
   *
   * Same single-guarded-write atomicity and adapter scope as
   * {@link ResourceRef.incState}. Appending to a field that holds something
   * other than a list refuses and leaves the stored value alone; an absent or
   * `null` field starts from `[]`.
   */
  pushState<K extends ResourceArrayKeys<TState>>(
    field: K,
    value: ResourceArrayElement<TState[K]>
  ): Promise<void>;
  /**
   * Get-or-compute over this resource's state. Reads `state[key]`; if it is
   * absent (`undefined`), runs `compute`, patches the returned value under
   * `key`, and returns it. The callback runs only on a miss, so an expensive
   * fetch/compute happens at most once per stored key for this resource's
   * lifetime — and downstream readers get the same stored copy without
   * re-deriving it. A value already present (including `null`) is a hit and is
   * returned without invoking `compute`; a `compute` that resolves to
   * `undefined` stores nothing and the next call recomputes.
   *
   * No time-based freshness: this is a per-resource (e.g. per-session) data
   * spine, not a cache. The runtime ref single-flights concurrent misses on the
   * same key within a request — they share one `compute` call rather than each
   * firing its own — so a fanned-out read of the same key issues one upstream
   * fetch. (Distinct keys still compute in parallel; they never block each other.)
   */
  getOrPatchState<K extends keyof TState & string>(
    key: K,
    compute: () => TState[K] | Promise<TState[K]>
  ): Promise<TState[K]>;
  readContent(): Promise<string | null>;
  readContentRaw(): Promise<string | null>;
  writeContent(content: string): Promise<void>;
  contentType?: string;
  extension?: string;
  config: Readonly<ResourceConfig>;
  /** Typed-edge graph API — present at runtime only when the resource declared `edges`. Consumers that declared edges access it via `ref.edges!`. */
  edges?: ResourceEdgeApi;
}

/** Union of handle types that can appear in a resource registry. */
export type AnyResourceRef =
  | ResourceRef<any>
  | ResourceCollectionRef<any>
  | import("./projected-resource-collection").ProjectedResourceCollectionRef<any>;

/**
 * `ctx.resources`. A declared registry must assign to the open default, whose
 * `AnyResourceRef` string index covers every key, `get` and `list` included.
 * So `get` and `list` are also typed as a ref: that is what lets a declared
 * registry pass with no index signature of its own. Any index signature here
 * would have to read as a subtype of `AnyResourceRef`, and an undeclared name
 * would then compile wherever a ref is accepted. Without one, an undeclared
 * name is a missing-property error.
 */
export type ResourceRegistry<
  TResources extends Record<string, AnyResourceRef> = Record<string, AnyResourceRef>
> = TResources & {
  get: (<TKey extends keyof TResources>(name: TKey) => TResources[TKey]) & ResourceRef<any>;
  list: (() => Array<TResources[keyof TResources]>) & ResourceRef<any>;
};

export type StateOf<T> = T extends { stateSchema: infer S extends ZodTypeAny }
  ? S["_output"]
  : T extends ZodTypeAny
    ? T["_output"]
    : never;

type AsStateObject<T> = T extends JsonObject ? T : JsonObject;

/**
 * Resolves to `{ edges: Edge[] }` when a config declares a (non-false) `edges`
 * slot, otherwise `{}`. Intersecting with `{}` is a no-op, so configs without
 * an `edges` slot keep their inferred state unchanged.
 *
 * Uses a required-key probe (`{ edges: infer E }`) rather than `infer E` over
 * the whole config, so an *unset* optional `edges` (which infers `E` including
 * `undefined`) does not falsely trigger injection.
 */
type EdgesField<TConfig> = TConfig extends { edges: true | EdgeSlotConfig }
  ? { edges: Edge[] }
  : {};

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
  AsStateObject<TStateSchema["_output"]> & EdgesField<TConfig>,
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

  if (config.sharedToLineage === true && config.scope !== "session") {
    throw new Error(
      `defineResource() rejects sharedToLineage:true on ${config.scope}-scoped resources — ` +
        `${config.scope} scope already spans every session in a lineage`
    );
  }

  validateRunBy("defineResource()", config);

  validateClientProjection({
    definer: "defineResource()",
    ref: config.ref ?? "(unnamed)",
    kind: "single",
    stateSchema: config.stateSchema,
    client: config.client as Parameters<typeof validateClientProjection>[0]["client"],
    secret: config.secret
  });

  // Single resources have no create/delete lifecycle — only state and content
  // updates fire.
  validateReactTo("defineResource()", config.reactTo, ["stateUpdated", "contentUpdated"]);

  // Edge-slot injection: when `edges` is declared, fold an `edges: Edge[]` field
  // into the resolved state schema + default unless the resource already declares
  // one. Build a fresh config object — never mutate the caller's `config`.
  let stateSchema: ZodTypeAny = config.stateSchema;
  let defaultValue = config.default;
  if (config.edges) {
    if (!(stateSchema instanceof z.ZodObject)) {
      throw new Error(
        `defineResource() with edges requires an object stateSchema (got ${stateSchema.constructor.name})`
      );
    }
    if (!("edges" in stateSchema.shape)) {
      stateSchema = stateSchema.extend({ edges: edgeListSchema.default([]) });
    }
    if (
      defaultValue !== undefined &&
      typeof defaultValue === "object" &&
      defaultValue !== null &&
      !Array.isArray(defaultValue) &&
      !("edges" in (defaultValue as object))
    ) {
      defaultValue = { ...(defaultValue as Record<string, unknown>), edges: [] } as typeof defaultValue;
    }
  }

  return { ...config, stateSchema, default: defaultValue } as unknown as
    TConfig & DefinedResource<
      AsStateObject<TStateSchema["_output"]> & EdgesField<TConfig>,
      ProjectedClient<AsStateObject<StateOf<TConfig>>, TConfig["client"]>
    >;
}

// FIX-2624.
/**
 * The definition errors of `runBy` and `canWrite`. An org resource on the
 * default write flow with no `canWrite` is refused here, so an app that forgets
 * the rule stops at start instead of giving every member of the org write access
 * (the owner's decision, 2026-11-11). A user resource is its owner's either way.
 */
export function validateRunBy(
  definer: string,
  config: {
    ref?: string;
    pattern?: string;
    scope: string;
    runBy?: unknown;
    canWrite?: unknown;
    flowIsolation?: boolean;
    writable?: boolean;
    client?: { data?: unknown; expose?: unknown; exclude?: unknown };
  }
): void {
  const name = config.ref ?? config.pattern ?? "(unnamed)";
  const runBy = config.runBy;
  if (config.canWrite !== undefined && runBy !== "default") {
    throw new Error(
      `${definer} resource "${name}" declares canWrite without runBy: "default": only the default write flow runs it. ` +
        `Add runBy: "default", or check the write inside the flow that writes it.`
    );
  }
  if (runBy === undefined) return;
  const isFlow =
    typeof runBy === "object" && runBy !== null && typeof (runBy as { flow?: unknown }).flow === "string" &&
    (runBy as { flow: string }).flow.length > 0;
  if (runBy !== "default" && !isFlow) {
    throw new Error(`${definer} resource "${name}" has runBy ${JSON.stringify(runBy)}: use "default" or { flow: "<flow kind>" }`);
  }
  if (config.scope !== "user" && config.scope !== "org") {
    throw new Error(
      `${definer} resource "${name}" sets runBy at ${config.scope} scope: runBy is for user or org resources. ` +
        `A session's resources are written by the actions of that session's flow.`
    );
  }
  if (config.flowIsolation === true) {
    throw new Error(
      `${definer} resource "${name}" sets runBy with flowIsolation: true: an isolated resource lives per flow instance, ` +
        `so a scope and key don't name it. Drop one of the two.`
    );
  }
  // A client config is what exposes a resource to clients at all; runBy is how
  // a client writes one, at the version it read. One without the other is a
  // resource a client can be told about but never reach.
  if (config.client === undefined) {
    throw new Error(
      `${definer} resource "${name}" sets runBy with no client config: a client writes only what it can read. ` +
        `Add client: {} (or expose / exclude), or drop runBy and write it from a server flow.`
    );
  }
  // A client reads a single resource's state only through expose or exclude
  // (or a computed data) — the session snapshot carries none otherwise — and
  // a client writes it at what it read: with nothing to read, an update would
  // write back nothing. A collection reads its entries through
  // `client.state.read` instead, checked where it is defined.
  const projects =
    Array.isArray(config.client.expose) || Array.isArray(config.client.exclude) || config.client.data !== undefined;
  if (config.pattern === undefined && !projects) {
    throw new Error(
      `${definer} resource "${name}" sets runBy with a client config that projects no state: a client reads none ` +
        `of it, so it has nothing to write back. Add expose or exclude.`
    );
  }
  if (runBy !== "default") return;
  if (config.writable === false) {
    throw new Error(
      `${definer} resource "${name}" sets runBy: "default" with writable: false: the default write flow would write ` +
        `it anyway. Drop one of the two.`
    );
  }
  if (config.client.data !== undefined) {
    throw new Error(
      `${definer} resource "${name}" sets runBy: "default" with a computed client.data: the default write flow can't ` +
        `write back through a computed projection. Use expose or exclude, or write it through runBy: { flow }.`
    );
  }
  if (config.scope === "org" && config.canWrite === undefined) {
    throw new Error(
      `${definer} org resource "${name}" sets runBy: "default" with no canWrite: every member of the org could write it. ` +
        `Declare who may, even everyone: canWrite: () => true.`
    );
  }
}

/**
 * Shared implementation of {@link ResourceRef.getOrPatchState}. Reads the key
 * off the ref's live `state` getter; on a miss runs `compute` and persists the
 * value through the ref's own `patchState`, so the normal change / reactive /
 * client-projection seams fire exactly as a direct patch would. Factored out so
 * every `ResourceRef` builder wires identical get-or-compute semantics instead
 * of each re-deriving them. `undefined` from `compute` is left unstored.
 */
export async function applyGetOrPatchState<
  TState extends JsonObject,
  K extends keyof TState & string
>(
  ref: Pick<ResourceRef<TState>, "state" | "patchState">,
  key: K,
  compute: () => TState[K] | Promise<TState[K]>
): Promise<TState[K]> {
  const existing = ref.state[key];
  if (existing !== undefined) return existing as TState[K];
  const value = await compute();
  if (value !== undefined) {
    const updates: Partial<TState> = {};
    updates[key] = value;
    await ref.patchState(updates);
  }
  return value;
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
