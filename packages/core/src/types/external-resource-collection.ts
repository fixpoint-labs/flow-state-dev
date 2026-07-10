/**
 * External resource collections (FIX-858).
 *
 * A read-only collection whose instances are resolved from an app-owned store
 * (a SQL table, an HTTP API) instead of the framework's `ResourceStateStore`.
 * It shares the collection runtime core — `ResourceCollectionRef` addressing,
 * agent tools, client projection, template-rendered content, `reactTo` — but is
 * **read-only and lazy by construction**: the caveats are typed into the config
 * (the fields that would be invalid simply don't exist), not policed with
 * build-time guards.
 *
 * `defineExternalResourceCollection` returns a {@link DefinedResourceCollection}
 * branded `external: true`, so the existing flow-merge / addressing / tool /
 * projection machinery treats it as a collection, while the resource-inference
 * conditionals resolve it to the read-only {@link ExternalResourceCollectionRef}
 * (no mutators) rather than the mutable `ResourceCollectionRef`.
 *
 * Scope this slice (PR1): the definer, its types, and read projection through
 * `read`. `search` / `list` pushdown and the change-signal helper land in later
 * PRs; the config declares `read` / `search` as required members now so the
 * backing contract is stable.
 */

import type { ZodTypeAny } from "zod";
import { z } from "zod";
import type { JsonObject, JsonValue } from "../schema/common";
import type { ResourceScope } from "./resource";
import type { AnchoredPath, CollectionClientConfig } from "./resource";
import type { ResourceTemplate } from "../resource-template/resource-template";
import type { DefinedResourceCollection } from "./resource-collection";
import { isParameterizedPattern, validatePattern } from "./collection-patterns";
import { validateClientProjection } from "../helpers/client-projection";
import { validateReactTo, type ReactiveBinding } from "./resource-change";

// ---------------------------------------------------------------------------
// Query / hit / result shapes
// ---------------------------------------------------------------------------

/**
 * Minimal portable query pushed down to an external collection's `search`. The
 * app engine runs it (never enumerate-in-memory). Deliberately closed this
 * slice; a richer filter AST and semantic search extend this type via
 * FIX-833 / FIX-142.
 */
export type ResourceQuery = {
  /** Free-text relevance (lexical now; semantic later). Maps to `searchResources`' query. */
  search?: string;
  /** Path-boundary prefix — same semantics as the store-backed search tools. */
  prefix?: string;
  /** Equality map — the only structured predicate this slice. */
  filter?: Record<string, JsonValue>;
  /** Page size hint. */
  limit?: number;
  /** Opaque pagination cursor, echoed back by the app from a prior page. */
  cursor?: string;
};

/**
 * One hit returned by an external collection's `search`. `key` is the within-scope
 * row key/path — the framework normalizes it through the collection pattern
 * (`resolveCollectionKey`) to the canonical storage path before building URIs or
 * emitting change events.
 */
export type ExternalRecordHit<TState extends JsonObject = JsonObject> = {
  /** Within-scope key/path; normalized through the pattern → instance path/uri. */
  key: string;
  /** The record state (validated through `stateSchema` before any consumer sees it). */
  state: TState;
  /** Optional app relevance score; when omitted, rank = the hook's return order. */
  score?: number;
  /** Optional app-supplied snippet; when omitted, the framework derives one from rendered content. */
  snippet?: string;
};

/** A page of hits plus the app's opaque cursor for the next page. */
export type ResourceSearchResult<TState extends JsonObject = JsonObject> = {
  hits: ExternalRecordHit<TState>[];
  /** Omit when the result set is exhausted. */
  nextCursor?: string;
};

/**
 * Trusted, server-derived context handed to `read` / `search` (BP-031: never
 * caller-controllable). The framework populates every field from a trusted
 * source (the loaded session / scope identity), so the hook can safely scope its
 * own query to the same owner/tenant namespace the framework uses.
 */
export type ExternalResourceContext = {
  /** session | user | org — never the transient "request" scope. */
  scope: ResourceScope;
  /** The resolved sessionId / userId / orgId for `scope`. */
  scopeId: string;
  /** Always populated — the server-derived owner. Never caller input. */
  userId: string;
  orgId?: string;
  /** Trusted tenant coordinate (ScopeIdentity) for multi-tenant queries. */
  tenantId?: string;
  /** The flow kind this read runs under. */
  flowKind: string;
  /** Request abort propagation — the hook should honor it. */
  signal?: AbortSignal;
};

// ---------------------------------------------------------------------------
// Reactive bindings (external — no content axis)
// ---------------------------------------------------------------------------

/**
 * Per-reactive-kind bindings for an external collection. Only the three state
 * kinds are available: a read-only external collection has no content-write
 * seam, so `contentUpdated` is omitted — it could be declared but would never
 * fire. Change-awareness itself (path B) lands in a later PR; the config field
 * is authored now so the backing contract is stable.
 */
export interface ExternalReactiveBindings<TState extends JsonObject = JsonObject> {
  /** Runs when the app reports a record was created. */
  created?: ReactiveBinding<TState>;
  /** Runs when the app reports a record's state was updated. */
  stateUpdated?: ReactiveBinding<TState>;
  /** Runs when the app reports a record was deleted. */
  deleted?: ReactiveBinding<TState>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Config for {@link defineExternalResourceCollection}. `read` / `search` are
 * first-class required members — the config *is* the backing. There is no
 * `writable` / `llmWritable` / `edges` / `prefetchMode` / `maxInstances` /
 * `eviction`: read-only, lazy, and unbounded are structural, not flags.
 */
export type ExternalResourceCollectionConfig<TStateSchema extends ZodTypeAny = ZodTypeAny> = {
  /**
   * WILDCARD-ONLY pattern: `"positions/*"` or `"positions/**"`. Parameterized
   * `[name]` patterns are rejected at build time — they need an object key,
   * incompatible with the string hit key an external `read` / `search` returns.
   */
  pattern: string;
  /** session | user | org — routes scopeId into the read/search context. */
  scope: ResourceScope;
  /** The shape of one record (every instance shares it). */
  stateSchema: TStateSchema;

  /** Resolve one record by its within-scope key. `null` = no such record. REQUIRED. */
  read(args: { key: string; ctx: ExternalResourceContext }): Promise<z.infer<TStateSchema> | null>;
  /**
   * Resolve a filtered/searched page, pushing the query DOWN to the app engine
   * (never enumerate-in-memory). REQUIRED. `list`, `searchResources`, and the
   * read tool's discovery route here; `globResources` / `grepResourceContent`
   * do NOT (they skip external collections — a lexical search can't honor their
   * deterministic contract).
   */
  search(args: { query: ResourceQuery; ctx: ExternalResourceContext }): Promise<ResourceSearchResult<z.infer<TStateSchema>>>;

  /** A role-tagged Markdown template rendered against each record's state. */
  contentTemplate?: ResourceTemplate | string | AnchoredPath;
  /** Path of another resource whose raw content is a template for each instance. */
  contentTemplateRef?: string;
  /** Gate the read/search tools (default off). */
  llmReadable?: boolean;
  /**
   * The COLLECTION client config (per-item state + content). Its
   * `content.create` / `update` / `delete` flags are rejected at build time —
   * an external collection is read-only.
   */
  client?: CollectionClientConfig<z.infer<TStateSchema>>;
  /** created / stateUpdated / deleted only — no content-write seam exists. */
  reactTo?: ExternalReactiveBindings<z.infer<TStateSchema>>;
  metadata?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Read-only runtime refs
// ---------------------------------------------------------------------------

/**
 * A read-only resource instance ref resolved from an external collection. The
 * read subset of `ResourceRef` only — `state` (synchronous, resolved against the
 * filled read-through cache), `readContent()` / `readContentRaw()`, and identity
 * fields. No `patchState` / `setState` / `updateState` / `writeContent`: an
 * external record is a read-through view, never written through the resource
 * surface.
 */
export interface ExternalResourceRef<TState extends JsonObject = JsonObject> {
  /** Canonical within-scope storage path (pattern-normalized), e.g. `"positions/AAPL"`. */
  readonly path: string;
  readonly scope: ResourceScope;
  /** Fully qualified identifier — `${scope}/${path}`. */
  readonly uri: string;
  /** The record state (validated through `stateSchema`). Synchronous. */
  readonly state: Readonly<TState>;
  /** Rendered content (template applied to state), or `null` when none. */
  readContent(): Promise<string | null>;
  /** Un-rendered content source, or `null` when none. */
  readContentRaw(): Promise<string | null>;
}

/**
 * Runtime ref for an external collection — the read subset of the collection API.
 * `defineExternalResourceCollection` resolves to this (not the mutable
 * `ResourceCollectionRef`) through the resource-inference conditionals.
 *
 * PR1 exposes `get` / `getOptional` and the identity/config fields. `list`
 * (search/list pushdown) lands in a later PR and is intentionally absent here,
 * so PR1 caller code cannot type-check a `list()` that has no runtime yet.
 */
export interface ExternalResourceCollectionRef<TState extends JsonObject = JsonObject> {
  /** The collection's declared pattern. */
  readonly pattern: string;
  /** Scope this collection is registered in. */
  readonly scope: ResourceScope;
  /** The brand the tool/inference layers classify on. */
  readonly external: true;
  /** The resolved external config (minus the backing hooks). */
  readonly config: Readonly<{ llmReadable?: boolean; pattern: string; scope: ResourceScope }>;

  /** Resolve one instance by its within-scope key. Rejects if the app has no such record. */
  get(key: string): Promise<ExternalResourceRef<TState>>;
  /** Resolve one instance, or `undefined` when the app has no such record. */
  getOptional(key: string): Promise<ExternalResourceRef<TState> | undefined>;
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

/**
 * The runtime + type brand a `defineExternalResourceCollection` result carries
 * ON TOP of the `DefinedResourceCollection` shape. `__brand: "ResourceCollection"`
 * is retained so flow-merge, addressing, and collision detection treat it as a
 * collection unchanged; `external: true` plus the `read` / `search` hooks let the
 * inference conditionals and the engine classify it as read-through.
 */
export type ExternalCollectionBrand<TStateSchema extends ZodTypeAny = ZodTypeAny> = {
  readonly external: true;
  read: ExternalResourceCollectionConfig<TStateSchema>["read"];
  search: ExternalResourceCollectionConfig<TStateSchema>["search"];
};

/**
 * The definition returned by {@link defineExternalResourceCollection} — a
 * `DefinedResourceCollection` intersected with the external brand, so the
 * inference conditionals (which test `& { external: true }` first) resolve it to
 * the read-only ref.
 */
export type DefinedExternalResourceCollection<
  TState extends JsonObject = JsonObject,
  TStateSchema extends ZodTypeAny = ZodTypeAny,
> = DefinedResourceCollection<TState> & ExternalCollectionBrand<TStateSchema>;

// ---------------------------------------------------------------------------
// defineExternalResourceCollection()
// ---------------------------------------------------------------------------

type AsStateObject<T> = T extends JsonObject ? T : JsonObject;

/**
 * Define a read-only collection whose instances are resolved from an app-owned
 * store. Shares the collection runtime core; read-only and lazy by type.
 */
export function defineExternalResourceCollection<const TStateSchema extends ZodTypeAny>(
  config: ExternalResourceCollectionConfig<TStateSchema>
): DefinedExternalResourceCollection<AsStateObject<TStateSchema["_output"]>, TStateSchema> {
  validatePattern(config.pattern);

  // Wildcard-only: a parameterized `[name]` pattern needs an object key, which
  // the string hit key an external read/search returns can't carry through
  // `resolveCollectionKey`. Reject at build time (§4.5).
  if (isParameterizedPattern(config.pattern)) {
    throw new Error(
      `defineExternalResourceCollection() requires a wildcard pattern ("positions/*" or "positions/**"); ` +
        `parameterized [name] patterns are not supported (got "${config.pattern}"). ` +
        `Encode the discriminator into a wildcard segment instead.`
    );
  }

  if (config.scope !== "session" && config.scope !== "user" && config.scope !== "org") {
    throw new Error(
      `defineExternalResourceCollection() requires an explicit scope of "session", "user", or "org" (got ${JSON.stringify(config.scope)})`
    );
  }

  if (typeof config.read !== "function" || typeof config.search !== "function") {
    throw new Error(
      "defineExternalResourceCollection() requires both `read` and `search` backing functions"
    );
  }

  if (config.contentTemplate !== undefined && config.contentTemplateRef !== undefined) {
    throw new Error(
      "defineExternalResourceCollection() accepts at most one template source: contentTemplate or contentTemplateRef, not both"
    );
  }

  // Read-only across every surface: client CRUD flags have no meaning on a
  // read-through view and would otherwise let a client write rows into FSD
  // storage. Reject them at build time (§4.2 read-only).
  const content = config.client?.content;
  if (content?.create === true || content?.update === true || content?.delete === true) {
    const set = [
      content?.create === true && "create",
      content?.update === true && "update",
      content?.delete === true && "delete",
    ].filter(Boolean);
    throw new Error(
      `defineExternalResourceCollection() rejects client.content.${set.join("/")} — ` +
        `external collections are read-only; writes go through handlers, not the resource surface.`
    );
  }

  validateClientProjection({
    definer: "defineExternalResourceCollection()",
    ref: config.pattern,
    kind: "collection",
    stateSchema: config.stateSchema,
    client: config.client as Parameters<typeof validateClientProjection>[0]["client"],
  });

  // Only the three state kinds are valid — a read-only external collection has
  // no content-write seam, so `contentUpdated` could be declared but never fire.
  validateReactTo(
    "defineExternalResourceCollection()",
    config.reactTo as Parameters<typeof validateReactTo>[1],
    ["created", "stateUpdated", "deleted"]
  );

  return Object.assign({}, config, {
    __brand: "ResourceCollection" as const,
    external: true as const,
  }) as unknown as DefinedExternalResourceCollection<AsStateObject<TStateSchema["_output"]>, TStateSchema>;
}

// ---------------------------------------------------------------------------
// Shared read-through resolution
// ---------------------------------------------------------------------------

/**
 * Invoke an external collection's `read` backing and validate the result through
 * its `stateSchema`. Returns the parsed record, or `undefined` when the app has
 * no such record (`read` resolved `null`). A record that fails `stateSchema`
 * throws — never feed unvalidated app data into projection/render (§4.5).
 *
 * The single source of truth for the read+validate contract, shared by the
 * engine's resource registry (which wraps it with a per-request cache +
 * single-flight) and the client route read helpers (which call it directly).
 * `key` is the within-scope row key the app resolves against.
 */
export async function readExternalRecord<TState extends JsonObject>(
  config: Pick<ExternalResourceCollectionConfig, "read" | "stateSchema" | "pattern">,
  key: string,
  ctx: ExternalResourceContext
): Promise<TState | undefined> {
  const raw = await config.read({ key, ctx });
  if (raw === null || raw === undefined) return undefined;
  const parsed = config.stateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `External collection "${config.pattern}" read for "${key}" returned a record that failed stateSchema: ${parsed.error.message}`
    );
  }
  return parsed.data as TState;
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/**
 * True when a value is an external resource collection definition (carries the
 * `external: true` brand alongside `__brand: "ResourceCollection"`). Used by the
 * engine to route reads through the backing hooks and by the tool layer to keep
 * external collections out of the CRUD / deterministic-match paths.
 */
export function isExternalResourceCollection(
  value: unknown
): value is DefinedExternalResourceCollection {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __brand?: unknown }).__brand === "ResourceCollection" &&
    (value as { external?: unknown }).external === true
  );
}
