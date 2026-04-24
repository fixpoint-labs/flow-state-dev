/**
 * Session CRUD route handlers: create, get, list, delete.
 */
import type { JsonObject } from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import type { SessionRecord, StoreRegistry } from "../stores/types";
import { generateId } from "../utils/generate-id";
import {
  asObject,
  asStringArray,
  emptyResponse,
  getBooleanFlag,
  getPositiveInteger,
  getString,
  jsonResponse,
  parseJsonBody
} from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";

type SessionRouteContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
};

export async function handleListSessions(
  request: Request,
  _route: Extract<ParsedFlowRoute, { kind: "list_sessions" }>,
  ctx: SessionRouteContext
): Promise<Response> {
  const url = new URL(request.url);
  const sessions = await ctx.stores.session.list({
    flowKind: getString(url.searchParams.get("flowKind")),
    userId: getString(url.searchParams.get("userId")),
    limit: getPositiveInteger(url.searchParams.get("limit")),
    offset: getPositiveInteger(url.searchParams.get("offset"))
  });

  return jsonResponse(200, {
    sessions
  });
}

export async function handleGetSession(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "get_session" }>,
  ctx: SessionRouteContext
): Promise<Response> {
  const session = await ctx.stores.session.get(route.sessionId);
  if (session === undefined) {
    return jsonResponse(404, {
      error: `Unknown session "${route.sessionId}"`
    });
  }

  return jsonResponse(200, {
    session
  });
}

export async function handleCreateSession(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "create_session" }>,
  ctx: SessionRouteContext
): Promise<Response> {
  const flow = ctx.registry.get(route.flowKind);
  if (flow === undefined) {
    return jsonResponse(404, {
      error: `Unknown flow "${route.flowKind}"`
    });
  }

  const body = await parseJsonBody(request);
  const userId = getString(body.userId);
  if (userId === undefined) {
    return jsonResponse(400, {
      error: "Session creation requires non-empty userId"
    });
  }

  const now = Date.now();
  const sessionId = getString(body.sessionId) ?? generateId("sess");
  const existing = await ctx.stores.session.get(sessionId);
  if (existing !== undefined) {
    return jsonResponse(409, {
      error: `Session "${sessionId}" already exists`
    });
  }

  const record: SessionRecord = {
    id: sessionId,
    flowKind: flow.kind,
    userId,
    projectId: getString(body.projectId),
    title: getString(body.title),
    description: getString(body.description),
    tags: asStringArray(body.tags),
    metadata: asObject(body.metadata),
    state: (asObject(body.state) ?? {}) as JsonObject,
    version: 0,
    createdAt: now,
    updatedAt: now,
    journal: []
  };

  await ctx.stores.session.set(record.id, record, "any");
  return jsonResponse(201, {
    session: record
  });
}

export async function handleDeleteSession(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "delete_session" }>,
  ctx: SessionRouteContext
): Promise<Response> {
  const existing = await ctx.stores.session.get(route.sessionId);
  if (existing === undefined) {
    return jsonResponse(404, {
      error: `Unknown session "${route.sessionId}"`
    });
  }

  // Delete content first — if this fails, the session record still exists
  // and the operation can be retried. The reverse (orphaned content) is a leak.
  await ctx.stores.content.deleteAll("session", route.sessionId);
  await ctx.stores.session.delete(route.sessionId);
  return emptyResponse(204);
}

export async function handlePatchSessionMetadata(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "patch_session_metadata" }>,
  ctx: SessionRouteContext
): Promise<Response> {
  const session = await ctx.stores.session.get(route.sessionId);
  if (session === undefined) {
    return jsonResponse(404, {
      error: `Unknown session "${route.sessionId}"`
    });
  }

  const body = await parseJsonBody(request);
  const now = Date.now();

  const updated: SessionRecord = {
    ...session,
    ...(body.title !== undefined ? { title: getString(body.title) } : {}),
    ...(body.description !== undefined ? { description: getString(body.description) } : {}),
    ...(body.tags !== undefined ? { tags: asStringArray(body.tags) } : {}),
    ...(body.metadata !== undefined
      ? { metadata: { ...session.metadata, ...asObject(body.metadata) } }
      : {}),
    updatedAt: now
  };

  await ctx.stores.session.set(updated.id, updated, "any");

  return jsonResponse(200, {
    session: updated
  });
}

export async function handleListSessionRequests(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "list_session_requests" }>,
  ctx: SessionRouteContext
): Promise<Response> {
  const session = await ctx.stores.session.get(route.sessionId);
  if (session === undefined) {
    return jsonResponse(404, {
      error: `Unknown session "${route.sessionId}"`
    });
  }

  const url = new URL(request.url);
  const requests = await ctx.stores.request.list({
    sessionId: route.sessionId,
    status: getString(url.searchParams.get("status")) as
      | "in_progress" | "completed" | "failed" | "incomplete" | "aborted"
      | undefined,
    limit: getPositiveInteger(url.searchParams.get("limit")),
    offset: getPositiveInteger(url.searchParams.get("offset"))
  });

  return jsonResponse(200, {
    requests
  });
}
