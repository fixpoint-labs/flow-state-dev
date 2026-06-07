/**
 * Shared utilities for route handlers: response builders, parsing, and validation helpers.
 */
import type {
  JsonObject,
  ResourceConfig,
  ResourceCollectionConfig,
  ScopeType,
} from "@flow-state-dev/core/types";
import { getPatternPrefix, matchesPattern, resolveCollectionKey } from "@flow-state-dev/core/types";
import { cloneValue, resolveClientProjection, hasClientProjection } from "@flow-state-dev/core/helpers";
import type { OutputItem, RequestStatusEvent, RequestStreamEvent } from "@flow-state-dev/core/items";
import { ValidationError, FlowError } from "../errors/flow-error";
import type { RequestRecord, SessionRecord, SessionStore } from "../stores/types";
import { resolveSessionStorageKey } from "../stores/scope-keys";
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
 */
export function extractTenantId(
  request: Request,
  tenantIdHeader?: string
): string | undefined {
  const value = request.headers.get(tenantIdHeader ?? DEFAULT_TENANT_ID_HEADER);
  return value !== null && value.length > 0 ? value : undefined;
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
  if ((record.tenantId ?? undefined) !== (tenantId ?? undefined)) return undefined;
  return record;
}

/**
 * Strip the static pattern prefix from a full storage key, leaving the
 * "bare topic" — the identifying portion a collection author addresses
 * items by. Returns the full key unchanged when the prefix doesn't match
 * (defensive against caller mismatches).
 *
 * Example: extractBareTopic("memos/[topic]", "memos/abc") -> "abc".
 */
export function extractBareTopic(pattern: string, fullKey: string): string {
  const prefix = getPatternPrefix(pattern);
  if (prefix.length === 0) return fullKey;
  if (fullKey === prefix) return "";
  const sep = prefix + "/";
  if (fullKey.startsWith(sep)) return fullKey.slice(sep.length);
  return fullKey;
}

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
}): Record<string, Record<string, unknown>> {
  const handles: Record<string, Record<string, unknown>> = {};
  const contentMap = options.persistedContent ?? {};
  const storageKeys = resourceStorageKeys(options.configs);

  for (const [resourceName, maybeConfig] of Object.entries(options.configs ?? {})) {
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
    for (const item of record.items) {
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
