/**
 * Shared utilities for route handlers: response builders, parsing, and validation helpers.
 */
import type {
  ExternalResourceCollectionConfig,
  ExternalResourceContext,
  JsonObject,
  ResourceConfig,
  ResourceCollectionConfig,
  ResourceScope,
  ScopeType,
} from "@flow-state-dev/core/types";
import { buildExternalResourceRef } from "../resources/external-ref";
import {
  extractBareTopic,
  isExternalResourceCollection,
  matchesPattern,
  readExternalRecord,
  resolveCollectionKey,
} from "@flow-state-dev/core/types";
import { cloneValue, resolveClientProjection, hasClientProjection } from "@flow-state-dev/core/helpers";
import type { OutputItem, RequestStatusEvent, RequestStreamEvent } from "@flow-state-dev/core/items";
import { collapseToCanonicalLog } from "@flow-state-dev/core/items";
import { ValidationError, FlowError } from "../errors/flow-error";
import type { RequestRecord, SessionRecord, SessionStore } from "../stores/types";
import { resolveSessionStorageKey, tenantMatches } from "../stores/scope-keys";
import { isJsonObject } from "../utils/json-helpers";
import { resourceStorageKeys } from "../resources/storage-keys";
import { sortItemsChronologically } from "../utils/sort";

export const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

export const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache",
  connection: "keep-alive"
};

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}

export function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

/** Default HTTP header carrying the tenant id (FIX-406 6D). */
export const DEFAULT_TENANT_ID_HEADER = "x-tenant-id";

/**
 * Read the tenant id from the configurable HTTP header (FIX-682). Returns
 * `undefined` when the header is absent or empty — an empty header is treated
 * as single-tenant (bare keys), matching `resolveSessionStorageKey`. The
 * canonical extraction point so action dispatch and every session-touching
 * route namespace consistently.
 *
 * Rejects a tenant id containing `:` (400). The session storage key is
 * `${tenantId}:${sessionId}` and session ids legitimately contain `:`, so a
 * tenant id with a `:` would make the key ambiguous (tenant `a` + session
 * `b:c` collides with tenant `a:b` + session `c`). Tenant ids are
 * deployment-controlled, so this is a cheap config guard that removes the
 * ambiguity class outright — the binding check still prevents any data leak.
 */
export function extractTenantId(
  request: Request,
  tenantIdHeader?: string
): string | undefined {
  const value = request.headers.get(tenantIdHeader ?? DEFAULT_TENANT_ID_HEADER);
  if (value === null || value.length === 0) return undefined;
  if (value.includes(":")) {
    throw new ValidationError(
      `Tenant id must not contain ":" (received "${value}"). The session storage key reserves ":" as a separator.`
    );
  }
  return value;
}

/**
 * Load a session for the calling tenant, returning `undefined` unless the
 * stored record's tenant matches the request's (FIX-682). The
 * `${tenantId}:${sessionId}` storage key is ambiguous when the caller controls
 * `sessionId` — omitting the header while passing `sessionId =
 * "${otherTenant}:${id}"` collides on another tenant's key. Verifying the
 * stored `tenantId` closes that bypass; callers treat `undefined` as
 * not-found, so a cross-tenant probe gets a 404, never another tenant's data.
 */
export async function loadTenantSession(
  store: SessionStore,
  sessionId: string,
  tenantId: string | undefined
): Promise<SessionRecord | undefined> {
  const record = await store.get(resolveSessionStorageKey(sessionId, tenantId));
  if (record === undefined) return undefined;
  if (!tenantMatches(record.tenantId, tenantId)) return undefined;
  return record;
}

// `extractBareTopic` now lives in core alongside `getPatternPrefix` /
// `resolveCollectionKey` (its inverse). Re-exported here so existing route
// importers keep resolving it from this module.
export { extractBareTopic } from "@flow-state-dev/core/types";

export function asObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function getString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function getPositiveInteger(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    return undefined;
  }

  return parsed;
}

export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((item): item is string => typeof item === "string");
}

export function getBooleanFlag(value: string | null): boolean {
  if (value === null) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

export type ClientDataScope = "session" | "user" | "org";
export type ClientDataFilter = Partial<Record<ClientDataScope, Set<string>>>;

export function parseClientDataFilter(value: string | null): ClientDataFilter | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const parsed: ClientDataFilter = {};
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of entries) {
    const [scopeCandidate, dataName] = entry.split(".", 2);
    const isScoped =
      scopeCandidate === "session" ||
      scopeCandidate === "user" ||
      scopeCandidate === "org";
    const scope: ClientDataScope = isScoped ? scopeCandidate : "session";
    const name = isScoped ? dataName : scopeCandidate;

    if (name === undefined || name.trim().length === 0) {
      continue;
    }

    if (parsed[scope] === undefined) {
      parsed[scope] = new Set<string>();
    }

    parsed[scope]!.add(name.trim());
  }

  if (Object.keys(parsed).length === 0) {
    return undefined;
  }

  return parsed;
}

export function shouldIncludeClientData(
  filter: ClientDataFilter | undefined,
  scope: ClientDataScope,
  name: string
): boolean {
  if (filter === undefined) {
    return true;
  }

  const values = filter[scope];
  if (values === undefined) {
    return false;
  }

  return values.has(name);
}

export function isResourceConfig(value: unknown): value is ResourceConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { stateSchema?: { safeParse?: unknown } };
  return (
    typeof candidate.stateSchema === "object" &&
    candidate.stateSchema !== null &&
    typeof candidate.stateSchema.safeParse === "function"
  );
}

export function normalizeResourceDefault(config: ResourceConfig): JsonObject {
  if (config.default !== undefined && isJsonObject(config.default)) {
    return cloneValue(config.default);
  }

  const parsedUndefined = config.stateSchema.safeParse(undefined);
  if (parsedUndefined.success && isJsonObject(parsedUndefined.data)) {
    return parsedUndefined.data;
  }

  const parsedEmpty = config.stateSchema.safeParse({});
  if (parsedEmpty.success && isJsonObject(parsedEmpty.data)) {
    return parsedEmpty.data;
  }

  return {};
}

export function normalizeResourceState(config: ResourceConfig, value: unknown): JsonObject {
  const parsed = config.stateSchema.safeParse(value);
  if (parsed.success && isJsonObject(parsed.data)) {
    return parsed.data;
  }

  return normalizeResourceDefault(config);
}

function isCollectionConfig(value: unknown): value is ResourceCollectionConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "pattern" in value &&
    typeof (value as ResourceCollectionConfig).pattern === "string"
  );
}

export function createScopeResources(options: {
  scope: ScopeType;
  configs: Record<string, unknown> | undefined;
  persisted: Record<string, unknown> | undefined;
  persistedContent?: Record<string, string> | undefined;
  /**
   * FIX-858: trusted context for reading external collections through their
   * `read` backing when a scope-level `client.data` function references one.
   * Omitted when the scope has no external collections.
   */
  externalContext?: ExternalResourceContext;
}): Record<string, Record<string, unknown>> {
  const handles: Record<string, Record<string, unknown>> = {};
  const contentMap = options.persistedContent ?? {};
  const storageKeys = resourceStorageKeys(options.configs);

  for (const [resourceName, maybeConfig] of Object.entries(options.configs ?? {})) {
    if (isExternalResourceCollection(maybeConfig)) {
      // FIX-858: read-through handle for a scope `client.data` reading an
      // external collection. `get`/`getOptional` route through `read`; `list`
      // does not enumerate the app source (discovery is via the list/search
      // route), so it returns empty here.
      const extConfig = maybeConfig as unknown as ExternalResourceCollectionConfig &
        ResourceCollectionConfig;
      const pattern = extConfig.pattern;
      const readThrough = async (
        key: string | Record<string, string>
      ): Promise<Record<string, unknown> | undefined> => {
        if (options.externalContext === undefined) return undefined;
        const storageKey = resolveCollectionKey(pattern, key);
        // Reject out-of-pattern keys before the app hook, matching the item
        // route and the execution-context handle — a single-level `positions/*`
        // must not resolve `positions/AAPL/history` through `read`.
        if (!matchesPattern(pattern, storageKey)) return undefined;
        const state = await readExternalRecord<JsonObject>(
          extConfig,
          extractBareTopic(pattern, storageKey),
          options.externalContext
        );
        if (state === undefined) return undefined;
        // Same read-only ref shape (and template rendering) as the execution
        // context's handle — built by the shared helper so the two can't drift.
        return buildExternalResourceRef({
          scope: options.scope as ResourceScope,
          storageKey,
          readState: () => (isJsonObject(state) ? state : {}),
          contentTemplate: extConfig.contentTemplate,
          contentTemplateRef: extConfig.contentTemplateRef,
          resolveTemplateRef: (ref) => (typeof contentMap[ref] === "string" ? contentMap[ref]! : null),
        }) as unknown as Record<string, unknown>;
      };
      // `list`/`count` DON'T enumerate the app source (discovery is the cursor-
      // paged list/search route — a follow-up). Throw rather than return a false
      // empty `[]`/`0` — the same "never lie about cardinality" stance as the
      // 501 list-state route and the snapshot's absent count.
      const unsupportedEnumeration = (method: string): never => {
        throw new Error(
          `${method}() is not supported for external collection "${pattern}" in a client.data projection — read instances by key; listing/search pushdown is a follow-up`
        );
      };
      handles[resourceName] = {
        pattern,
        config: extConfig,
        external: true,
        async list() {
          return unsupportedEnumeration("list");
        },
        async count() {
          return unsupportedEnumeration("count");
        },
        async get(key: string | Record<string, string>) {
          const ref = await readThrough(key);
          if (ref === undefined) {
            throw new Error(
              `Resource instance "${resolveCollectionKey(pattern, key)}" not found in external collection "${pattern}"`
            );
          }
          return ref;
        },
        async getOptional(key: string | Record<string, string>) {
          return readThrough(key);
        },
      };
      continue;
    }
    if (isCollectionConfig(maybeConfig)) {
      // Build a lightweight read-only collection ref for clientData computation.
      // Instances are stored as path-keyed entries in the persisted resources map.
      const pattern = maybeConfig.pattern;
      const persisted = options.persisted ?? {};

      function makeInstanceRef(key: string, value: unknown) {
        return {
          path: key,
          scope: options.scope,
          uri: `${options.scope}/${key}`,
          get state() { return isJsonObject(value) ? value : {}; },
          async readContent() { return contentMap[key] ?? null; },
          async readContentRaw() { return contentMap[key] ?? null; }
        };
      }

      handles[resourceName] = {
        pattern,
        config: maybeConfig,
        list() {
          return Object.entries(persisted)
            .filter(([key]) => matchesPattern(pattern, key))
            .map(([key, value]) => makeInstanceRef(key, value));
        },
        count() {
          return Object.keys(persisted).filter((key) => matchesPattern(pattern, key)).length;
        },
        get(key: string | Record<string, string>) {
          const storageKey = resolveCollectionKey(pattern, key);
          const value = persisted[storageKey];
          if (value === undefined) {
            throw new Error(`Resource instance "${storageKey}" not found in collection "${pattern}"`);
          }
          return makeInstanceRef(storageKey, value);
        },
        getOptional(key: string | Record<string, string>) {
          const storageKey = resolveCollectionKey(pattern, key);
          const value = persisted[storageKey];
          if (value === undefined) return undefined;
          return makeInstanceRef(storageKey, value);
        }
      };
      continue;
    }

    if (!isResourceConfig(maybeConfig)) {
      continue;
    }

    const storageKey = storageKeys[resourceName] ?? resourceName;
    const readState = (): JsonObject =>
      cloneValue(
        normalizeResourceState(
          maybeConfig,
          options.persisted?.[storageKey]
        )
      );

    handles[resourceName] = {
      path: storageKey,
      scope: options.scope,
      uri: `${options.scope}/${storageKey}`,
      config: maybeConfig,
      get state() {
        return readState();
      }
    };
  }

  return handles;
}

/**
 * Build the client-visible state object for a single scope.
 *
 * Consumes a normalized `ScopeClientConfig` (as produced by `defineFlow`):
 *   - `expose` keys copy `state[name]` verbatim into the output.
 *   - `derived` keys call the compute fn with `{ state, resources }`.
 *
 * The query-param filter (`?clientData=session.foo,user.bar`) is applied
 * uniformly to both kinds — `expose` and `derived` share the same
 * `clientData.<scope>` namespace on the wire. Name-collision guarding
 * happens at definition time, not here.
 */
export async function computeClientData(options: {
  config: { expose?: ReadonlyArray<string>; derived?: Record<string, unknown> } | undefined;
  scope: ClientDataScope;
  filter: ClientDataFilter | undefined;
  state: JsonObject;
  resources: Record<string, Record<string, unknown>>;
}): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const config = options.config;
  if (config === undefined) return out;

  for (const name of config.expose ?? []) {
    if (!shouldIncludeClientData(options.filter, options.scope, name)) {
      continue;
    }
    out[name] = (options.state as Record<string, unknown>)[name];
  }

  for (const [name, compute] of Object.entries(config.derived ?? {})) {
    if (typeof compute !== "function") {
      continue;
    }

    if (!shouldIncludeClientData(options.filter, options.scope, name)) {
      continue;
    }

    out[name] = await (
      compute as (ctx: { state: JsonObject; resources: Record<string, unknown> }) => unknown
    )({
      state: options.state,
      resources: options.resources
    });
  }

  return out;
}

/**
 * Builds the client-visible `resources` snapshot for one scope.
 *
 * Collections (FIX-427): emit `count` always, plus a `prefetched` window when
 * the collection declares `prefetchWindow > 0`. Per-item `clientData` in the
 * window is included only when `client.state.read === true`.
 *
 * Single resources retain their existing shape (clientData + optional
 * prefetched content).
 *
 * Strictly client-shaped: resources without a `client` config are omitted.
 * The DevTool's previous `includeInternal` escape hatch was removed in
 * FIX-579 — use `/api/flows/sessions/:id/debug/resources*` for full
 * server-side inspection.
 */
export async function buildResourceSnapshot(options: {
  configs: Record<string, unknown> | undefined;
  persisted: Record<string, unknown> | undefined;
  persistedContent?: Record<string, string> | undefined;
}): Promise<Record<string, unknown> | undefined> {
  const out: Record<string, unknown> = {};
  const contentMap = options.persistedContent ?? {};
  let hasAny = false;
  const storageKeys = resourceStorageKeys(options.configs);

  for (const [resourceName, maybeConfig] of Object.entries(options.configs ?? {})) {
    if (isCollectionConfig(maybeConfig)) {
      if (maybeConfig.client === undefined) continue;

      // FIX-858: external collections are read-through — the snapshot does NOT
      // enumerate the app source (it holds only instances loaded this request,
      // typically none). Emit an empty anchor keyed on a serializable
      // `prefetched: []` — NOT `count: undefined`, which `JSON.stringify` drops
      // to `{}` and the client's `useResource` then misclassifies as a single
      // resource (it discriminates a collection by a present `count`/`prefetched`
      // key). `count` stays absent (honest unknown cardinality — never a false 0);
      // the client discovers instances via the list/search route + per-URI reads.
      if (isExternalResourceCollection(maybeConfig)) {
        out[resourceName] = { prefetched: [] };
        hasAny = true;
        continue;
      }

      const pattern = maybeConfig.pattern;
      const persisted = options.persisted ?? {};
      const collectionClient = maybeConfig.client;
      const prefetchContent = maybeConfig.client?.content?.prefetch === true;
      const stateReadable = maybeConfig.client?.state?.read === true;
      const prefetchWindow = typeof maybeConfig.prefetchWindow === "number" && maybeConfig.prefetchWindow > 0
        ? maybeConfig.prefetchWindow
        : 0;

      const matchedKeys = Object.keys(persisted)
        .filter((k) => matchesPattern(pattern, k))
        .sort();
      const count = matchedKeys.length;

      const collectionEntry: Record<string, unknown> = { count };

      if (prefetchWindow > 0) {
        const window = matchedKeys.slice(0, prefetchWindow);
        const prefetched: Array<Record<string, unknown>> = [];
        for (const key of window) {
          const state = isJsonObject(persisted[key]) ? persisted[key] as JsonObject : {};
          const item: Record<string, unknown> = {
            topic: extractBareTopic(pattern, key),
            storageKey: key
          };
          if (stateReadable) {
            item.clientData = await resolveClientProjection(collectionClient, state);
          }
          if (prefetchContent && contentMap[key] !== undefined) {
            item.content = contentMap[key];
          }
          prefetched.push(item);
        }
        collectionEntry.prefetched = prefetched;
      }

      out[resourceName] = collectionEntry;
      hasAny = true;
      continue;
    }

    if (!isResourceConfig(maybeConfig)) continue;
    const config = maybeConfig as ResourceConfig;
    if (config.client === undefined) continue;

    const storageKey = storageKeys[resourceName] ?? resourceName;
    const state = normalizeResourceState(config, options.persisted?.[storageKey]);
    const prefetch = config.client?.content?.prefetch === true;

    const entry: Record<string, unknown> = {};
    if (hasClientProjection(config.client)) {
      entry.clientData = await resolveClientProjection(config.client, state);
    }
    if (prefetch && contentMap[storageKey] !== undefined) {
      entry.content = contentMap[storageKey];
    }
    out[resourceName] = entry;
    hasAny = true;
  }

  return hasAny ? out : undefined;
}

export function sortItems(items: OutputItem[] | undefined): OutputItem[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return sortItemsChronologically(items);
}

export function requestStatusEventType(status: RequestRecord["status"]): RequestStatusEvent["type"] {
  if (status === "completed") {
    return "request.completed";
  }

  if (status === "failed") {
    return "request.failed";
  }

  if (status === "incomplete") {
    return "request.incomplete";
  }

  return "request.in_progress";
}

export function buildReplayEvents(record: RequestRecord, session?: SessionRecord): RequestStreamEvent[] {
  const createdAt = record.startedAtMs ?? record.createdAt;
  const statusTs =
    record.completedAtMs ??
    record.failedAtMs ??
    record.updatedAt ??
    createdAt;

  const events: RequestStreamEvent[] = [
    {
      stream: "request",
      type: "request.created",
      requestId: record.id,
      sequence_number: 1,
      status: "in_progress",
      ts: createdAt
    }
  ];

  let seq = 2;
  if (record.items !== undefined) {
    // Seed from the canonical view (FIX-811): this empty-cursor fallback
    // reconstructs the stream from the items record, so it must drop a resumed
    // request's superseded run-1 emissions just like the GET history does. The
    // append-only event log (the primary replay source) is never collapsed.
    for (const item of collapseToCanonicalLog(record.items)) {
      events.push({
        stream: "request",
        type: "item.added",
        requestId: record.id,
        sequence_number: seq++,
        ts: item.ts ?? createdAt,
        item
      });
      events.push({
        stream: "request",
        type: "item.done",
        requestId: record.id,
        sequence_number: seq++,
        ts: item.ts ?? createdAt,
        item
      });
    }
  }

  if (
    session !== undefined &&
    record.sessionId !== undefined &&
    (session.title !== undefined || session.description !== undefined || session.tags !== undefined)
  ) {
    events.push({
      stream: "request",
      type: "session.metadata.changed",
      requestId: record.id,
      sessionId: record.sessionId,
      sequence_number: seq++,
      ts: statusTs,
      ...(session.title !== undefined ? { title: session.title } : {}),
      ...(session.description !== undefined ? { description: session.description } : {}),
      ...(session.tags !== undefined ? { tags: session.tags } : {})
    });
  }

  events.push({
    stream: "request",
    type: requestStatusEventType(record.status),
    requestId: record.id,
    sequence_number: seq,
    status: record.status,
    ts: statusTs
  });

  return events;
}

export function errorStatus(error: Error): number {
  if (error instanceof ValidationError) {
    return 400;
  }

  if (error instanceof FlowError && error.code === "validation_error") {
    return 400;
  }

  return 500;
}

export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.trim().length === 0) {
    return {};
  }

  const parsed = JSON.parse(text);
  const object = asObject(parsed);
  if (object === undefined) {
    throw new ValidationError("Request body must be a JSON object", {
      scope: "request"
    });
  }

  return object;
}
