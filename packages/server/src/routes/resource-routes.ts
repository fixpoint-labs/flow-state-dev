/**
 * Resource content and CRUD route handlers for client-visible resources.
 *
 * These routes implement the content fetch and mutation endpoints gated by
 * the `client` config declared on resource definitions. Only resources with
 * an explicit `client` configuration are accessible.
 */
import type {
  JsonObject,
  ResourceConfig,
  ResourceCollectionConfig,
} from "@flow-state-dev/core/types";
import { matchesPattern, resolveCollectionKey } from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import {
  resolveProjectStorageKey,
  resolveUserStorageKey
} from "../stores/scope-keys";
import {
  isResourceConfig,
  jsonResponse,
  normalizeResourceState,
  parseJsonBody,
} from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import { isJsonObject } from "../utils/json-helpers";

type ResourceRouteContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCollectionConfig(value: unknown): value is ResourceCollectionConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "pattern" in value &&
    typeof (value as ResourceCollectionConfig).pattern === "string"
  );
}

function findResourceConfig(
  flow: { session?: { resources?: unknown }; user?: { resources?: unknown }; project?: { resources?: unknown } },
  ref: string
): { config: ResourceConfig | ResourceCollectionConfig; scope: "session" | "user" | "project" } | undefined {
  const scopes = [
    { key: "session" as const, resources: (flow.session as Record<string, unknown> | undefined)?.resources },
    { key: "user" as const, resources: (flow.user as Record<string, unknown> | undefined)?.resources },
    { key: "project" as const, resources: (flow.project as Record<string, unknown> | undefined)?.resources },
  ];

  for (const { key, resources } of scopes) {
    if (resources === undefined || typeof resources !== "object" || resources === null) continue;
    const config = (resources as Record<string, unknown>)[ref];
    if (config === undefined) continue;
    if (isResourceConfig(config) || isCollectionConfig(config)) {
      return { config, scope: key };
    }
  }

  return undefined;
}

async function getPersistedData(
  ctx: ResourceRouteContext,
  flow: {
    kind: string;
    isolateUserState: boolean;
    isolateProjectState: boolean;
  },
  sessionId: string,
  scope: "session" | "user" | "project"
): Promise<{ resources: Record<string, JsonObject>; content: Record<string, string> } | undefined> {
  // Content is stored in the ContentStore during execution, not on the record's
  // resourceContent field. Merge both sources for backward compatibility.
  if (scope === "session") {
    const session = await ctx.stores.session.get(sessionId);
    if (!session) return undefined;
    const contentFromStore = await ctx.stores.content.getAll("session", session.id);
    return {
      resources: (session.resources ?? {}) as Record<string, JsonObject>,
      content: {
        ...(session.resourceContent ?? {}) as Record<string, string>,
        ...contentFromStore,
      },
    };
  }

  if (scope === "user") {
    const session = await ctx.stores.session.get(sessionId);
    if (!session) return undefined;
    const user = await ctx.stores.user.get(
      resolveUserStorageKey(session.userId, flow)
    );
    if (!user) return undefined;
    const contentFromStore = await ctx.stores.content.getAll("user", user.id);
    return {
      resources: (user.resources ?? {}) as Record<string, JsonObject>,
      content: {
        ...(user.resourceContent ?? {}) as Record<string, string>,
        ...contentFromStore,
      },
    };
  }

  // project
  const session = await ctx.stores.session.get(sessionId);
  if (!session || !session.projectId) return undefined;
  const project = await ctx.stores.project.get(
    resolveProjectStorageKey(session.projectId, flow)
  );
  if (!project) return undefined;
  const contentFromStore = await ctx.stores.content.getAll("project", project.id);
  return {
    resources: (project.resources ?? {}) as Record<string, JsonObject>,
    content: {
      ...(project.resourceContent ?? {}) as Record<string, string>,
      ...contentFromStore,
    },
  };
}

/**
 * Renders resource content using the config's render function if available,
 * falling back to the raw content string.
 */
async function renderContent(
  config: ResourceConfig | ResourceCollectionConfig,
  rawContent: string | undefined,
  state: JsonObject
): Promise<string | null> {
  if (rawContent === undefined) return null;
  if ("render" in config && typeof config.render === "function") {
    return config.render(rawContent, state);
  }
  return rawContent;
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
  const resourceContent = { ...(session.resourceContent ?? {}) } as Record<string, string>;
  if (content !== undefined) {
    resourceContent[storageKey] = content;
  }

  await ctx.stores.session.set(
    route.sessionId,
    {
      ...session,
      resources: resources as Record<string, JsonObject>,
      resourceContent,
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

  // Remove from both the session record and the ContentStore.
  const resourceContent = { ...(session.resourceContent ?? {}) } as Record<string, string>;
  delete resourceContent[storageKey];

  await Promise.all([
    ctx.stores.session.set(
      route.sessionId,
      {
        ...session,
        resources: resources as Record<string, JsonObject>,
        resourceContent,
        updatedAt: Date.now()
      },
      "any"
    ),
    ctx.stores.content.delete("session", route.sessionId, storageKey),
  ]);

  return jsonResponse(200, { ref: route.ref, topic: route.topic });
}
