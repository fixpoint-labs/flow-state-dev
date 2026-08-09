/**
 * Resource content and CRUD route handlers for client-visible resources.
 *
 * These routes implement the content fetch and mutation endpoints gated by
 * the `client` config declared on resource definitions. Only resources with
 * an explicit `client` configuration are accessible.
 */
import type {
  CollectionClientConfig,
  ExternalResourceCollectionConfig,
  JsonObject,
  ResourceQuery,
} from "@flow-state-dev/core/types";
import { getPatternPrefix, matchesPattern, resolveCollectionKey, searchExternalRecords } from "@flow-state-dev/core/types";
import { resolveClientProjection } from "@flow-state-dev/core/helpers";
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import { toBareState, toBareStates } from "../stores/resource-state-views";
import { resolveSessionResourceScopeId } from "../stores/scope-keys";
import {
  extractBareTopic,
  jsonResponse,
  loadTenantSession,
  normalizeResourceState,
  parseJsonBody,
} from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import { isJsonObject } from "../utils/json-helpers";
import {
  buildExternalResourceContextFromSession,
  findResourceConfig,
  getPersistedData,
  isCollectionConfig,
  isExternalResourceCollection,
  readExternalCollectionState,
  renderContent,
  type ResourceFlowLike,
} from "../resources/internal";

type ResourceRouteContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
  /**
   * Tenant id from the request header (FIX-682). Namespaces the session lookup
   * so resource reads/writes land in the calling tenant's session scope.
   */
  tenantId?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveTemplateRaw(
  ctx: ResourceRouteContext,
  flow: ResourceFlowLike,
  sessionId: string,
  config: { contentTemplateRef?: string }
): Promise<string | undefined> {
  if (!config.contentTemplateRef) return undefined;
  const templateFound = findResourceConfig(flow, config.contentTemplateRef);
  if (!templateFound) return undefined;
  const templateData = await getPersistedData(ctx, flow, sessionId, templateFound.scope, ctx.tenantId);
  return templateData?.content[templateFound.storageKey];
}

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
  const session = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
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

  const data = await getPersistedData(ctx, flow, route.sessionId, scope, ctx.tenantId);
  if (!data) return jsonResponse(404, { error: "Scope data not found" });

  const state = normalizeResourceState(config, data.resources[found.storageKey]);
  const rawContent = data.content[found.storageKey];
  const templateRaw = await resolveTemplateRaw(ctx, flow, route.sessionId, config);
  const content = await renderContent(config, rawContent, state, templateRaw);

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
  const session = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
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

  // FIX-858: external collections have no stored content — the state is read
  // through the app store and the content is template-rendered from it.
  if (isExternalResourceCollection(config)) {
    const extCtx = buildExternalResourceContextFromSession(session, scope, route.sessionId, _request.signal);
    const extState = await readExternalCollectionState(
      config,
      extractBareTopic(config.pattern, storageKey),
      extCtx
    );
    if (extState === undefined) {
      return jsonResponse(404, { error: `Item "${route.topic}" not found in "${route.ref}"` });
    }
    const templateRaw = await resolveTemplateRaw(ctx, flow, route.sessionId, config);
    const content = await renderContent(config, undefined, extState, templateRaw);
    return jsonResponse(200, { ref: route.ref, topic: route.topic, content });
  }

  const data = await getPersistedData(ctx, flow, route.sessionId, scope, ctx.tenantId);
  if (!data) return jsonResponse(404, { error: "Scope data not found" });

  const instanceState = data.resources[storageKey];
  if (instanceState === undefined) {
    return jsonResponse(404, { error: `Item "${route.topic}" not found in "${route.ref}"` });
  }

  const state = isJsonObject(instanceState) ? instanceState : {};
  const rawContent = data.content[storageKey];
  const templateRaw = await resolveTemplateRaw(ctx, flow, route.sessionId, config);
  const content = await renderContent(config, rawContent, state as JsonObject, templateRaw);

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
  const session = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
  if (!session) return jsonResponse(404, { error: `Unknown session "${route.sessionId}"` });

  const flow = ctx.registry.get(session.flowKind);
  if (!flow) return jsonResponse(404, { error: `Unknown flow "${session.flowKind}"` });

  const found = findResourceConfig(flow, route.ref);
  if (!found) return jsonResponse(404, { error: `Unknown resource "${route.ref}"` });

  const { config, scope } = found;
  if (!isCollectionConfig(config)) {
    return jsonResponse(400, { error: `"${route.ref}" is not a collection` });
  }

  // FIX-858: external collections are read-only — no write reaches FSD storage.
  // The definer already forbids client.content.create, so this is defense in depth.
  if (isExternalResourceCollection(config)) {
    return jsonResponse(403, { error: `"${route.ref}" is a read-only external collection` });
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

  // Seed default state from schema
  const defaultState = config.stateSchema.safeParse({});
  const initialState: JsonObject =
    defaultState.success && isJsonObject(defaultState.data) ? defaultState.data : {};

  const content = typeof body.content === "string" ? body.content : undefined;

  // Win the key first, then write content. `expectedVersion: 0` is
  // create-if-absent, so a loser returns below without ever reaching
  // `ContentStore`, and its 409 is terminal — never retried into an overwrite.
  const inserted = await ctx.stores.resourceState.set(
    "session",
    session.id,
    storageKey,
    initialState,
    0
  );
  if (!inserted.ok) {
    return jsonResponse(409, { error: `Item "${topic}" already exists` });
  }

  // The item is live from here, but its content is not final until the write
  // below lands. Three accepted residuals follow, all of them cross-record
  // atomicity (FIX-854), a declared non-goal — stated rather than approximated,
  // because a version cannot tell this generation from its successor:
  //
  //   1. this write fails -> the await is bare, so the request fails, but the
  //      item exists anyway with no content row: live and listable, reading back
  //      as `content: null` (not ""), a retry gets an honest 409, and repair is
  //      the content PATCH route (which needs exactly the state row now
  //      committed, and the `content.update` grant). A template-backed
  //      collection loses only the repair half — `renderContent` checks the
  //      template branches before `rawContent`, so it reads fine either way —
  //      but this write is deliberately not guarded on the template config, so
  //      the half-commit is identical there;
  //   2. a DELETE lands in the window -> this body is orphaned behind the
  //      tombstone, and a later create with no content surfaces it as current;
  //   3. a PATCH lands in the window -> it is acknowledged 200 and then
  //      overwritten here.
  //
  // Only (1) surfaces as an error, and it understates what happened; (2) and
  // (3) are silent.
  //
  // All three are pinned by tests in `resource-collection-routes.test.ts`.
  // Client-facing guidance: `apps/docs` -> resources / client access.
  if (content !== undefined) {
    await ctx.stores.content.set("session", resolveSessionResourceScopeId(session), storageKey, content);
  }

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
  const session = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
  if (!session) return jsonResponse(404, { error: `Unknown session "${route.sessionId}"` });

  const flow = ctx.registry.get(session.flowKind);
  if (!flow) return jsonResponse(404, { error: `Unknown flow "${session.flowKind}"` });

  const found = findResourceConfig(flow, route.ref);
  if (!found) return jsonResponse(404, { error: `Unknown resource "${route.ref}"` });

  const { config, scope } = found;

  if (isCollectionConfig(config)) {
    // FIX-858: external collections are read-only (defense in depth).
    if (isExternalResourceCollection(config)) {
      return jsonResponse(403, { error: `"${route.ref}" is a read-only external collection` });
    }
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
  const existing = await ctx.stores.resourceState.get("session", resolveSessionResourceScopeId(session), storageKey);
  if (existing === undefined) {
    return jsonResponse(404, { error: `Item "${route.topic}" not found in "${route.ref}"` });
  }

  // Write to ContentStore (the canonical content location during execution).
  await ctx.stores.content.set("session", resolveSessionResourceScopeId(session), storageKey, content);

  return jsonResponse(200, { ref: route.ref, topic: route.topic });
}

// ---------------------------------------------------------------------------
// FIX-427 — list-state, get-state, manifest
// ---------------------------------------------------------------------------

const STATE_LIST_DEFAULT_LIMIT = 50;
const STATE_LIST_MAX_LIMIT = 200;

async function applyClientData(
  config: { client?: CollectionClientConfig },
  state: JsonObject
): Promise<unknown> {
  return await resolveClientProjection(config.client, state);
}

function hasTruthyFlag(record: Record<string, unknown> | undefined): boolean {
  if (!record) return false;
  for (const v of Object.values(record)) if (v === true) return true;
  return false;
}

/**
 * GET /sessions/:sessionId/resources/:ref?limit=&cursor=&topicPrefix=
 *
 * Returns one cursor-paged page of a collection's per-item state, plus an
 * opaque `nextCursor` when more rows remain (absent = last page). Gated by
 * `client.state.read`; works for session, user, and org scope.
 *
 * Store-backed collections page by keyset over lexicographically-sorted storage
 * keys (`cursor` = the last key returned). External collections (FIX-858) push
 * the page down to the app's `search` hook and pass its opaque cursor straight
 * through — the framework never enumerates the app store.
 */
export async function handleListCollectionState(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "list_collection_state" }>,
  ctx: ResourceRouteContext
): Promise<Response> {
  const session = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
  if (!session) return jsonResponse(404, { error: `Unknown session "${route.sessionId}"` });

  const flow = ctx.registry.get(session.flowKind);
  if (!flow) return jsonResponse(404, { error: `Unknown flow "${session.flowKind}"` });

  const found = findResourceConfig(flow, route.ref);
  if (!found) return jsonResponse(404, { error: `Unknown resource "${route.ref}"` });

  const { config, scope } = found;
  if (!isCollectionConfig(config)) {
    return jsonResponse(400, { error: `"${route.ref}" is not a collection` });
  }

  if (config.client?.state?.read !== true) {
    return jsonResponse(403, { error: `State read not permitted for "${route.ref}"` });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const topicPrefix = url.searchParams.get("topicPrefix") ?? undefined;

  const limit = limitParam !== null ? Number.parseInt(limitParam, 10) : STATE_LIST_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > STATE_LIST_MAX_LIMIT) {
    return jsonResponse(400, { error: `limit must be 1–${STATE_LIST_MAX_LIMIT}` });
  }

  // FIX-858: external collections read through their `search` hook — the app
  // engine runs the page. The opaque `nextCursor` is the app's, echoed back
  // verbatim on the next request. `topicPrefix` maps to the query's `prefix`.
  if (isExternalResourceCollection(config)) {
    const extCtx = buildExternalResourceContextFromSession(session, scope, route.sessionId, request.signal);
    const query: ResourceQuery = {
      limit,
      ...(cursor !== undefined ? { cursor } : {}),
      ...(topicPrefix !== undefined ? { prefix: topicPrefix } : {}),
    };
    const { hits, nextCursor } = await searchExternalRecords(
      config as unknown as ExternalResourceCollectionConfig,
      query,
      extCtx
    );
    const items = await Promise.all(
      hits.map(async (hit) => ({
        topic: extractBareTopic(config.pattern, hit.storageKey),
        storageKey: hit.storageKey,
        clientData: await applyClientData(config, hit.state as JsonObject),
      }))
    );
    return jsonResponse(200, { items, ...(nextCursor !== undefined ? { nextCursor } : {}) });
  }

  let persisted: Record<string, JsonObject>;
  if (scope === "session") {
    // Read only this collection's keys (its pattern prefix) instead of the
    // whole scope. An empty prefix (e.g. `[topic]/observations`) falls back to
    // getAll.
    const keyPrefix = getPatternPrefix(config.pattern);
    persisted = toBareStates(
      keyPrefix
        ? await ctx.stores.resourceState.getByPrefix("session", resolveSessionResourceScopeId(session), `${keyPrefix}/`)
        : await ctx.stores.resourceState.getAll("session", resolveSessionResourceScopeId(session))
    );
  } else {
    // User/org scope: resolve the persisted record via the shared scope
    // resolver (honors flowIsolation). A missing user/org record is a valid
    // empty collection — the user simply hasn't written anything yet — so it
    // reads as `{}`, never a 500. The pattern filter below applies identically.
    const data = await getPersistedData(ctx, flow, route.sessionId, scope, ctx.tenantId);
    persisted = data?.resources ?? {};
  }
  const matchedKeys = Object.keys(persisted)
    .filter((k) => matchesPattern(config.pattern, k))
    .filter((k) => topicPrefix === undefined || k.startsWith(topicPrefix))
    .sort();

  // Keyset pagination: `cursor` is the last storage key of the prior page, so
  // the next page is every matched key strictly after it. Stable under inserts
  // (unlike an offset) and needs no total.
  const startKeys = cursor !== undefined ? matchedKeys.filter((k) => k > cursor) : matchedKeys;
  const pageKeys = startKeys.slice(0, limit);
  const hasMore = startKeys.length > limit;
  const items: Array<{ topic: string; storageKey: string; clientData?: unknown }> = [];
  for (const key of pageKeys) {
    const state = isJsonObject(persisted[key]) ? (persisted[key] as JsonObject) : {};
    items.push({
      topic: extractBareTopic(config.pattern, key),
      storageKey: key,
      clientData: await applyClientData(config, state),
    });
  }

  const nextCursor = hasMore ? pageKeys[pageKeys.length - 1] : undefined;
  return jsonResponse(200, { items, ...(nextCursor !== undefined ? { nextCursor } : {}) });
}

/**
 * GET /sessions/:sessionId/resources/:ref/:topic
 *
 * Returns a single collection item's state. 200 with `null` body if the topic
 * is not present in the collection. Gated by `client.state.read`. Works for
 * session, user, and org scope; for user/org a missing scope record (no item
 * written yet) reads as a not-present topic (200 + null), never an error.
 */
export async function handleGetCollectionItemState(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "get_collection_item_state" }>,
  ctx: ResourceRouteContext
): Promise<Response> {
  const session = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
  if (!session) return jsonResponse(404, { error: `Unknown session "${route.sessionId}"` });

  const flow = ctx.registry.get(session.flowKind);
  if (!flow) return jsonResponse(404, { error: `Unknown flow "${session.flowKind}"` });

  const found = findResourceConfig(flow, route.ref);
  if (!found) return jsonResponse(404, { error: `Unknown resource "${route.ref}"` });

  const { config, scope } = found;
  if (!isCollectionConfig(config)) {
    return jsonResponse(400, { error: `"${route.ref}" is not a collection` });
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

  let value: JsonObject | undefined;
  if (isExternalResourceCollection(config)) {
    // FIX-858: read-through to the app store, not FSD storage. The bare topic is
    // the app's within-scope row key.
    const extCtx = buildExternalResourceContextFromSession(session, scope, route.sessionId, _request.signal);
    value = await readExternalCollectionState(
      config,
      extractBareTopic(config.pattern, storageKey),
      extCtx
    );
  } else if (scope === "session") {
    value = toBareState(await ctx.stores.resourceState.get("session", resolveSessionResourceScopeId(session), storageKey));
  } else {
    // User/org scope: resolve via the shared scope resolver (honors
    // flowIsolation). A missing user/org record means the topic isn't present
    // yet, which the not-present branch below already handles as 200 + null.
    const data = await getPersistedData(ctx, flow, route.sessionId, scope, ctx.tenantId);
    value = data?.resources[storageKey];
  }
  if (value === undefined) {
    // 200 + null body: the topic isn't present, but the collection itself is
    // readable. Distinguishes "no such item" from "no permission" or "no
    // collection" without forcing callers to special-case 404.
    return jsonResponse(200, null);
  }

  const state = isJsonObject(value) ? (value as JsonObject) : {};
  const clientData = await applyClientData(config, state);
  const bareTopic = extractBareTopic(config.pattern, storageKey);
  if (clientData === undefined) {
    // No client.data projection (and no expose/exclude). The production
    // surface intentionally returns metadata only, but app developers
    // calling this endpoint directly get little signal. Add a hint
    // pointing at the debug endpoint or the missing config (FIX-579 §3.6).
    return jsonResponse(200, {
      topic: bareTopic,
      storageKey,
      hint:
        "no client.data configured; declare client.data or use /debug/resources for full state"
    });
  }
  return jsonResponse(200, {
    topic: bareTopic,
    storageKey,
    clientData
  });
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
  const session = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
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
    // clientData ships whenever the resource actually delivers per-item
    // state. For collections that's `state.read === true` — the
    // list/get-state routes and snapshot prefetch both gate on it. For
    // single resources, a declared projection (`data` / `expose` /
    // `exclude`) is the opt-in; content-only resources stay state-private.
    const hasProjection =
      typeof client.data === "function" ||
      Array.isArray(client.expose) ||
      Array.isArray(client.exclude);
    const hasClientData = isCollection ? state?.read === true : hasProjection;

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
  const session = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
  if (!session) return jsonResponse(404, { error: `Unknown session "${route.sessionId}"` });

  const flow = ctx.registry.get(session.flowKind);
  if (!flow) return jsonResponse(404, { error: `Unknown flow "${session.flowKind}"` });

  const found = findResourceConfig(flow, route.ref);
  if (!found) return jsonResponse(404, { error: `Unknown resource "${route.ref}"` });

  const { config, scope } = found;
  if (!isCollectionConfig(config)) {
    return jsonResponse(400, { error: `"${route.ref}" is not a collection` });
  }

  // FIX-858: external collections are read-only (defense in depth).
  if (isExternalResourceCollection(config)) {
    return jsonResponse(403, { error: `"${route.ref}" is a read-only external collection` });
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
  // Conflict before anything is deleted — the create route's rule, mirrored.
  // `undefined` means no live row, i.e. `expectedVersion: 0`, so an absent key
  // stays an idempotent 200 while a create landing in the window makes this
  // request a loser rather than letting it remove what it never saw.
  //
  // The version is the one this read observed, not one the caller supplied, so
  // the window closed is this route's own: a DELETE issued from an already
  // stale client view still reads the live row here and removes it. A
  // caller-supplied precondition is separate surface (FIX-1006).
  const existing = await ctx.stores.resourceState.get("session", resolveSessionResourceScopeId(session), storageKey);
  const removed = await ctx.stores.resourceState.delete(
    "session",
    session.id,
    storageKey,
    existing?.version ?? 0
  );
  if (!removed.ok) {
    return jsonResponse(409, {
      error: `Item "${route.topic}" was modified concurrently; re-read it and retry`,
    });
  }

  // The residual sequencing does not close, stated rather than engineered
  // around: a recreation landing between these two statements loses its content
  // to this delete. `ContentStore` is last-write-wins by decision, so no state
  // predicate fences it, and closing it is cross-record atomicity (FIX-854).
  await ctx.stores.content.delete("session", resolveSessionResourceScopeId(session), storageKey);

  return jsonResponse(200, { ref: route.ref, topic: route.topic });
}
