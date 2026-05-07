/**
 * Resource content and CRUD route handlers for client-visible resources.
 *
 * These routes implement the content fetch and mutation endpoints gated by
 * the `client` config declared on resource definitions. Only resources with
 * an explicit `client` configuration are accessible.
 */
import type {
  CollectionClientConfig,
  JsonObject,
  ResourceClientDataFn,
} from "@flow-state-dev/core/types";
import { matchesPattern, resolveCollectionKey } from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import {
  jsonResponse,
  normalizeResourceState,
  parseJsonBody,
} from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import { isJsonObject } from "../utils/json-helpers";
import {
  findResourceConfig,
  getPersistedData,
  isCollectionConfig,
  renderContent
} from "../resources/internal";

type ResourceRouteContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
};

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

/**
 * GET /sessions/:sessionId/resources/:ref/content
 * Fetches rendered content for a single resource.
 */
export async function handleGetResourceContent(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "get_resource_content" }>,
  ctx: ResourceRouteContext
): Promise<Response> {
  const session = await ctx.stores.session.get(route.sessionId);
  if (!session) return jsonResponse(404, { error: `Unknown session "${route.sessionId}"` });

  const flow = ctx.registry.get(session.flowKind);
  if (!flow) return jsonResponse(404, { error: `Unknown flow "${session.flowKind}"` });

  const found = findResourceConfig(flow, route.ref);
  if (!found) return jsonResponse(404, { error: `Unknown resource "${route.ref}"` });

  const { config, scope } = found;

  // Must be a single resource, not a collection
  if (isCollectionConfig(config)) {
    return jsonResponse(400, { error: `"${route.ref}" is a collection — use /:ref/:topic/content` });
  }

  // Check client.content.read permission
  if (!config.client?.content?.read) {
    return jsonResponse(403, { error: `Content read not permitted for "${route.ref}"` });
  }

  const data = await getPersistedData(ctx, flow, route.sessionId, scope);
  if (!data) return jsonResponse(404, { error: "Scope data not found" });

  const state = normalizeResourceState(config, data.resources[route.ref]);
  const rawContent = data.content[route.ref];
  const content = await renderContent(config, rawContent, state);

  return jsonResponse(200, { ref: route.ref, content });
}

/**
 * GET /sessions/:sessionId/resources/:ref/:topic/content
 * Fetches rendered content for a collection item.
 */
export async function handleGetCollectionItemContent(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "get_collection_item_content" }>,
  ctx: ResourceRouteContext
): Promise<Response> {
  const session = await ctx.stores.session.get(route.sessionId);
  if (!session) return jsonResponse(404, { error: `Unknown session "${route.sessionId}"` });

  const flow = ctx.registry.get(session.flowKind);
  if (!flow) return jsonResponse(404, { error: `Unknown flow "${session.flowKind}"` });

  const found = findResourceConfig(flow, route.ref);
  if (!found) return jsonResponse(404, { error: `Unknown resource "${route.ref}"` });

  const { config, scope } = found;
  if (!isCollectionConfig(config)) {
    return jsonResponse(400, { error: `"${route.ref}" is not a collection` });
  }

  if (!config.client?.content?.read) {
    return jsonResponse(403, { error: `Content read not permitted for "${route.ref}"` });
  }

  const data = await getPersistedData(ctx, flow, route.sessionId, scope);
  if (!data) return jsonResponse(404, { error: "Scope data not found" });

  // The topic arrives as either a bare key ("my-doc") or the full storage key
  // ("artifacts/my-doc"). Try the topic directly first; if it doesn't match
  // the collection pattern, resolve it as a bare key via the prefix.
  let storageKey = route.topic;
  if (!matchesPattern(config.pattern, storageKey)) {
    storageKey = resolveCollectionKey(config.pattern, route.topic);
    if (!matchesPattern(config.pattern, storageKey)) {
      return jsonResponse(400, { error: `Topic "${route.topic}" does not match collection pattern` });
    }
  }

  const instanceState = data.resources[storageKey];
  if (instanceState === undefined) {
    return jsonResponse(404, { error: `Item "${route.topic}" not found in "${route.ref}"` });
  }

  const state = isJsonObject(instanceState) ? instanceState : {};
  const rawContent = data.content[storageKey];
  const content = await renderContent(config, rawContent, state as JsonObject);

  return jsonResponse(200, { ref: route.ref, topic: route.topic, content });
}

/**
 * POST /sessions/:sessionId/resources/:ref
 * Creates a new item in a collection resource.
 */
export async function handleCreateCollectionItem(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "create_collection_item" }>,
  ctx: ResourceRouteContext
): Promise<Response> {
  const session = await ctx.stores.session.get(route.sessionId);
  if (!session) return jsonResponse(404, { error: `Unknown session "${route.sessionId}"` });

  const flow = ctx.registry.get(session.flowKind);
  if (!flow) return jsonResponse(404, { error: `Unknown flow "${session.flowKind}"` });

  const found = findResourceConfig(flow, route.ref);
  if (!found) return jsonResponse(404, { error: `Unknown resource "${route.ref}"` });

  const { config, scope } = found;
  if (!isCollectionConfig(config)) {
    return jsonResponse(400, { error: `"${route.ref}" is not a collection` });
  }

  if (!config.client?.content?.create) {
    return jsonResponse(403, { error: `Create not permitted for "${route.ref}"` });
  }

  const body = await parseJsonBody(request);
  const topic = body.topic;
  if (typeof topic !== "string" || topic.trim().length === 0) {
    return jsonResponse(400, { error: "Missing or invalid topic" });
  }

  const storageKey = resolveCollectionKey(config.pattern, topic.trim());

  // Only session-scoped for now (Phase 1 simplification)
  if (scope !== "session") {
    return jsonResponse(501, { error: "Collection mutations only supported for session scope" });
  }

  const existing = (session.resources as Record<string, unknown> | undefined)?.[storageKey];
  if (existing !== undefined) {
    return jsonResponse(409, { error: `Item "${topic}" already exists` });
  }

  // Seed default state from schema
  const defaultState = config.stateSchema.safeParse({});
  const initialState = defaultState.success && isJsonObject(defaultState.data) ? defaultState.data : {};

  const resources = { ...(session.resources ?? {}) } as Record<string, unknown>;
  resources[storageKey] = initialState;

  const content = typeof body.content === "string" ? body.content : undefined;

  // Write content before the session record. A failed session.set then leaves
  // orphaned content under a key that doesn't yet exist in `resources`, so a
  // client retry can re-create the item (the same content key is harmlessly
  // overwritten). Writing the record first would commit the resource entry
  // and let a content failure trip the 409 guard on retry, with no recovery.
  if (content !== undefined) {
    await ctx.stores.content.set("session", route.sessionId, storageKey, content);
  }

  await ctx.stores.session.set(
    route.sessionId,
    {
      ...session,
      resources: resources as Record<string, JsonObject>,
      updatedAt: Date.now()
    },
    "any"
  );

  return jsonResponse(201, { topic: topic.trim() });
}

/**
 * PATCH /sessions/:sessionId/resources/:ref/:topic/content
 * Updates the content of a resource or collection item.
 */
export async function handleUpdateResourceContent(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "update_resource_content" }>,
  ctx: ResourceRouteContext
): Promise<Response> {
  const session = await ctx.stores.session.get(route.sessionId);
  if (!session) return jsonResponse(404, { error: `Unknown session "${route.sessionId}"` });

  const flow = ctx.registry.get(session.flowKind);
  if (!flow) return jsonResponse(404, { error: `Unknown flow "${session.flowKind}"` });

  const found = findResourceConfig(flow, route.ref);
  if (!found) return jsonResponse(404, { error: `Unknown resource "${route.ref}"` });

  const { config, scope } = found;

  if (isCollectionConfig(config)) {
    if (!config.client?.content?.update) {
      return jsonResponse(403, { error: `Update not permitted for "${route.ref}"` });
    }
  } else {
    // Single resource update is not supported (per acceptance criteria — CRUD is collection-only)
    return jsonResponse(400, { error: "Content mutation is only available for collection resources" });
  }

  if (scope !== "session") {
    return jsonResponse(501, { error: "Collection mutations only supported for session scope" });
  }

  const body = await parseJsonBody(request);
  const content = body.content;
  if (typeof content !== "string") {
    return jsonResponse(400, { error: "Missing or invalid content" });
  }

  // Resolve topic: try as full storage key first, then as bare key.
  let storageKey = route.topic;
  if (!matchesPattern(config.pattern, storageKey)) {
    storageKey = resolveCollectionKey(config.pattern, route.topic);
  }
  const existing = (session.resources as Record<string, unknown> | undefined)?.[storageKey];
  if (existing === undefined) {
    return jsonResponse(404, { error: `Item "${route.topic}" not found in "${route.ref}"` });
  }

  // Write to ContentStore (the canonical content location during execution).
  await ctx.stores.content.set("session", route.sessionId, storageKey, content);

  return jsonResponse(200, { ref: route.ref, topic: route.topic });
}

// ---------------------------------------------------------------------------
// FIX-427 — list-state, get-state, manifest
// ---------------------------------------------------------------------------

const STATE_LIST_DEFAULT_LIMIT = 50;
const STATE_LIST_MAX_LIMIT = 200;

function applyClientData(
  config: { client?: Pick<CollectionClientConfig, "data"> },
  state: JsonObject
): unknown {
  const fn = config.client?.data as ResourceClientDataFn | undefined;
  return typeof fn === "function" ? fn(state) : undefined;
}

function hasTruthyFlag(record: Record<string, unknown> | undefined): boolean {
  if (!record) return false;
  for (const v of Object.values(record)) if (v === true) return true;
  return false;
}

/**
 * GET /sessions/:sessionId/resources/:ref?limit=&offset=&topicPrefix=
 *
 * Returns one paginated page of a collection's per-item state. Items are
 * sorted lexicographically by storage key. Gated by `client.state.read`.
 * Session scope only at v1; non-session collections must be read via the
 * snapshot's `prefetched` window.
 */
export async function handleListCollectionState(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "list_collection_state" }>,
  ctx: ResourceRouteContext
): Promise<Response> {
  const session = await ctx.stores.session.get(route.sessionId);
  if (!session) return jsonResponse(404, { error: `Unknown session "${route.sessionId}"` });

  const flow = ctx.registry.get(session.flowKind);
  if (!flow) return jsonResponse(404, { error: `Unknown flow "${session.flowKind}"` });

  const found = findResourceConfig(flow, route.ref);
  if (!found) return jsonResponse(404, { error: `Unknown resource "${route.ref}"` });

  const { config, scope } = found;
  if (!isCollectionConfig(config)) {
    return jsonResponse(400, { error: `"${route.ref}" is not a collection` });
  }

  if (scope !== "session") {
    return jsonResponse(501, {
      error: `list endpoint not yet supported for ${scope} scope`
    });
  }

  if (config.client?.state?.read !== true) {
    return jsonResponse(403, { error: `State read not permitted for "${route.ref}"` });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");
  const topicPrefix = url.searchParams.get("topicPrefix") ?? undefined;

  const limit = limitParam !== null ? Number.parseInt(limitParam, 10) : STATE_LIST_DEFAULT_LIMIT;
  const offset = offsetParam !== null ? Number.parseInt(offsetParam, 10) : 0;

  if (!Number.isInteger(limit) || limit < 1 || limit > STATE_LIST_MAX_LIMIT) {
    return jsonResponse(400, {
      error: `limit must be 1–${STATE_LIST_MAX_LIMIT}`
    });
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return jsonResponse(400, { error: "offset must be >= 0" });
  }

  const persisted = (session.resources ?? {}) as Record<string, unknown>;
  const matchedKeys = Object.keys(persisted)
    .filter((k) => matchesPattern(config.pattern, k))
    .filter((k) => topicPrefix === undefined || k.startsWith(topicPrefix))
    .sort();
  const total = matchedKeys.length;

  const pageKeys = matchedKeys.slice(offset, offset + limit);
  const items: Array<{ topic: string; clientData?: unknown }> = [];
  for (const key of pageKeys) {
    const state = isJsonObject(persisted[key]) ? (persisted[key] as JsonObject) : {};
    const item: { topic: string; clientData?: unknown } = { topic: key };
    const data = applyClientData(config, state);
    if (data !== undefined) item.clientData = data;
    items.push(item);
  }

  return jsonResponse(200, {
    items,
    pagination: {
      offset,
      limit,
      total,
      hasMore: offset + limit < total,
      nextOffset: Math.min(offset + limit, total)
    }
  });
}

/**
 * GET /sessions/:sessionId/resources/:ref/:topic
 *
 * Returns a single collection item's state. 200 with `null` body if the topic
 * is not present in the collection. Gated by `client.state.read`.
 */
export async function handleGetCollectionItemState(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "get_collection_item_state" }>,
  ctx: ResourceRouteContext
): Promise<Response> {
  const session = await ctx.stores.session.get(route.sessionId);
  if (!session) return jsonResponse(404, { error: `Unknown session "${route.sessionId}"` });

  const flow = ctx.registry.get(session.flowKind);
  if (!flow) return jsonResponse(404, { error: `Unknown flow "${session.flowKind}"` });

  const found = findResourceConfig(flow, route.ref);
  if (!found) return jsonResponse(404, { error: `Unknown resource "${route.ref}"` });

  const { config, scope } = found;
  if (!isCollectionConfig(config)) {
    return jsonResponse(400, { error: `"${route.ref}" is not a collection` });
  }

  if (scope !== "session") {
    return jsonResponse(501, {
      error: `get-state endpoint not yet supported for ${scope} scope`
    });
  }

  if (config.client?.state?.read !== true) {
    return jsonResponse(403, { error: `State read not permitted for "${route.ref}"` });
  }

  // Topic may arrive as either a bare key or the full storage key (mirrors
  // the existing content endpoint conventions).
  let storageKey = route.topic;
  if (!matchesPattern(config.pattern, storageKey)) {
    storageKey = resolveCollectionKey(config.pattern, route.topic);
    if (!matchesPattern(config.pattern, storageKey)) {
      return jsonResponse(400, {
        error: `Topic "${route.topic}" does not match collection pattern`
      });
    }
  }

  const persisted = (session.resources ?? {}) as Record<string, unknown>;
  const value = persisted[storageKey];
  if (value === undefined) {
    // 200 + null body: the topic isn't present, but the collection itself is
    // readable. Distinguishes "no such item" from "no permission" or "no
    // collection" without forcing callers to special-case 404.
    return jsonResponse(200, null);
  }

  const state = isJsonObject(value) ? (value as JsonObject) : {};
  const out: { topic: string; clientData?: unknown } = { topic: storageKey };
  const data = applyClientData(config, state);
  if (data !== undefined) out.clientData = data;
  return jsonResponse(200, out);
}

/**
 * GET /sessions/:sessionId/manifest
 *
 * Returns the static set of public resources exposed by the session's flow,
 * along with each one's declared client capabilities. Pure metadata; no
 * permission gate beyond session existence — the manifest is the public
 * surface, by design.
 */
export async function handleGetResourceManifest(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "get_resource_manifest" }>,
  ctx: ResourceRouteContext
): Promise<Response> {
  const session = await ctx.stores.session.get(route.sessionId);
  if (!session) return jsonResponse(404, { error: `Unknown session "${route.sessionId}"` });

  const flow = ctx.registry.get(session.flowKind);
  if (!flow) return jsonResponse(404, { error: `Unknown flow "${session.flowKind}"` });

  const flatResources = (flow.resources ?? {}) as Record<string, unknown>;
  const entries: Array<Record<string, unknown>> = [];

  for (const [ref, raw] of Object.entries(flatResources)) {
    const isCollection = isCollectionConfig(raw);
    if (!isCollection && typeof raw !== "object") continue;
    const cfg = raw as Record<string, unknown>;
    const client = cfg.client as Record<string, unknown> | undefined;
    if (!client) continue;

    const content = client.content as Record<string, unknown> | undefined;
    const state = client.state as Record<string, unknown> | undefined;
    const hasClientData = typeof client.data === "function";

    // Inclusion rule: presence of any client-visible affordance — a truthy
    // permission flag in `content`/`state`, or a `data` projection. Mirrors
    // the snapshot's inclusion rule (snapshot emits an entry whenever any
    // client surface exists). All-false / empty `client: {}` is treated as
    // private.
    const anyTruthy =
      hasClientData ||
      hasTruthyFlag(content) ||
      hasTruthyFlag(state);
    if (!anyTruthy) continue;

    const scope = cfg.scope as string;

    const entry: Record<string, unknown> = {
      ref,
      kind: isCollection ? "collection" : "single",
      scope,
      hasClientData,
      client: {
        ...(content ? { content: { ...content } } : {}),
        ...(state ? { state: { ...state } } : {})
      }
    };

    if (isCollection) {
      entry.pattern = (cfg.pattern as string | undefined) ?? "";
      entry.prefetchWindow = typeof cfg.prefetchWindow === "number"
        ? cfg.prefetchWindow
        : 0;
    }

    entries.push(entry);
  }

  return jsonResponse(200, {
    flowKind: session.flowKind,
    resources: entries
  });
}

/**
 * DELETE /sessions/:sessionId/resources/:ref/:topic
 * Deletes a collection item.
 */
export async function handleDeleteCollectionItem(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "delete_collection_item" }>,
  ctx: ResourceRouteContext
): Promise<Response> {
  const session = await ctx.stores.session.get(route.sessionId);
  if (!session) return jsonResponse(404, { error: `Unknown session "${route.sessionId}"` });

  const flow = ctx.registry.get(session.flowKind);
  if (!flow) return jsonResponse(404, { error: `Unknown flow "${session.flowKind}"` });

  const found = findResourceConfig(flow, route.ref);
  if (!found) return jsonResponse(404, { error: `Unknown resource "${route.ref}"` });

  const { config, scope } = found;
  if (!isCollectionConfig(config)) {
    return jsonResponse(400, { error: `"${route.ref}" is not a collection` });
  }

  if (!config.client?.content?.delete) {
    return jsonResponse(403, { error: `Delete not permitted for "${route.ref}"` });
  }

  if (scope !== "session") {
    return jsonResponse(501, { error: "Collection mutations only supported for session scope" });
  }

  // Resolve topic: try as full storage key first, then as bare key.
  let storageKey = route.topic;
  if (!matchesPattern(config.pattern, storageKey)) {
    storageKey = resolveCollectionKey(config.pattern, route.topic);
  }
  const resources = { ...(session.resources ?? {}) } as Record<string, unknown>;

  delete resources[storageKey];

  await Promise.all([
    ctx.stores.session.set(
      route.sessionId,
      {
        ...session,
        resources: resources as Record<string, JsonObject>,
        updatedAt: Date.now()
      },
      "any"
    ),
    ctx.stores.content.delete("session", route.sessionId, storageKey),
  ]);

  return jsonResponse(200, { ref: route.ref, topic: route.topic });
}
