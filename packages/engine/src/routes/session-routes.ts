/**
 * Session CRUD route handlers: create, get, list, delete.
 */
import type { JsonObject, RequestStatus } from "@flow-state-dev/core/types";
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
  loadTenantSession,
  parseJsonBody
} from "./route-utils";
import {
  resolveSessionStorageKey,
  toBareSessionId
} from "../stores/scope-keys";
import type { ParsedFlowRoute } from "./parseFlowRoute";

type SessionRouteContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
  /**
   * Tenant id from the request header (FIX-682). Namespaces every session
   * storage key so a route resolves only the calling tenant's session.
   * Undefined for single-tenant requests.
   */
  tenantId?: string;
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
    // Always pass the tenant (present, possibly undefined) so listing isolates
    // to the calling tenant's sessions (FIX-682).
    tenantId: ctx.tenantId,
    limit: getPositiveInteger(url.searchParams.get("limit")),
    offset: getPositiveInteger(url.searchParams.get("offset"))
  });

  return jsonResponse(200, {
    // Surface bare session ids — the stored `id` is the namespaced storage key.
    sessions: sessions.map((s) => ({
      ...s,
      id: toBareSessionId(s.id, ctx.tenantId)
    }))
  });
}

export async function handleGetSession(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "get_session" }>,
  ctx: SessionRouteContext
): Promise<Response> {
  const session = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
  if (session === undefined) {
    return jsonResponse(404, {
      error: `Unknown session "${route.sessionId}"`
    });
  }

  return jsonResponse(200, {
    // Surface the bare session id, not the namespaced storage key (FIX-682).
    session: { ...session, id: route.sessionId }
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
  const sessionKey = resolveSessionStorageKey(sessionId, ctx.tenantId);
  const existing = await ctx.stores.session.get(sessionKey);
  if (existing !== undefined) {
    return jsonResponse(409, {
      error: `Session "${sessionId}" already exists`
    });
  }

  // Pre-apply the session state schema's defaults (`z.string().default("...")`,
  // `z.record(...).default({})`, etc.) so a brand-new session's `state`
  // contains every declared key with its initial value. Without this the
  // initial state is `{}`, which causes two downstream bugs:
  //  1. `expose`-projected `clientData[scope]` keys are `undefined`, which
  //     JSON.stringify drops on the wire — clients receive no key at all,
  //     so `mergeStateChangeIntoSnapshot`'s `hasOwn(prev, field)` guard
  //     bails on every mid-stream `state_change` for those keys until the
  //     terminal-status snapshot refresh.
  //  2. Block code that reads `ctx.session.state.foo` before any patch
  //     would observe `undefined` rather than the schema's default.
  // Caller-supplied `body.state` overrides the defaults.
  const callerState = asObject(body.state);
  const stateSchema = flow.session?.stateSchema;
  let initialState: JsonObject = (callerState ?? {}) as JsonObject;
  if (stateSchema !== undefined) {
    const parseResult = stateSchema.safeParse(callerState ?? {});
    if (parseResult.success) {
      initialState = parseResult.data as JsonObject;
    }
    // On schema-parse failure (caller supplied an invalid override), fall
    // back to the caller's raw state — preserves prior behavior. Validation
    // happens at action-execution time, not session-create time.
  }

  const record: SessionRecord = {
    // `id` is the tenant-namespaced storage key (FIX-682), consistent with the
    // session record created in `createExecutionContext`. The response surfaces
    // the bare id below.
    id: sessionKey,
    flowKind: flow.kind,
    userId,
    orgId: getString(body.orgId),
    tenantId: ctx.tenantId,
    title: getString(body.title),
    description: getString(body.description),
    tags: asStringArray(body.tags),
    metadata: asObject(body.metadata),
    state: initialState,
    version: 0,
    createdAt: now,
    updatedAt: now,
    journal: []
  };

  await ctx.stores.session.set(record.id, record, "any");
  return jsonResponse(201, {
    session: { ...record, id: sessionId }
  });
}

export async function handleDeleteSession(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "delete_session" }>,
  ctx: SessionRouteContext
): Promise<Response> {
  const sessionKey = resolveSessionStorageKey(route.sessionId, ctx.tenantId);
  const existing = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
  if (existing === undefined) {
    return jsonResponse(404, {
      error: `Unknown session "${route.sessionId}"`
    });
  }

  // Delete per-resource content and state first — if either fails, the session
  // record still exists and the operation can be retried. The reverse (orphaned
  // content/state) is a leak. All keyed by the namespaced session key (FIX-682).
  await Promise.all([
    ctx.stores.content.deleteAll("session", sessionKey),
    ctx.stores.resourceState.deleteAll("session", sessionKey)
  ]);
  await ctx.stores.session.delete(sessionKey);
  return emptyResponse(204);
}

export async function handlePatchSessionMetadata(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "patch_session_metadata" }>,
  ctx: SessionRouteContext
): Promise<Response> {
  const session = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
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
    // Surface the bare session id, not the namespaced storage key (FIX-682).
    session: { ...updated, id: route.sessionId }
  });
}

export async function handleListSessionRequests(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "list_session_requests" }>,
  ctx: SessionRouteContext
): Promise<Response> {
  const session = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
  if (session === undefined) {
    return jsonResponse(404, {
      error: `Unknown session "${route.sessionId}"`
    });
  }

  const url = new URL(request.url);
  // Summary listing omits full item logs by default (FIX-685). Inspection
  // surfaces (the DevTool) opt in with `include_items=true` to back-fill the
  // item tree for requests that completed before the view was opened (FIX-733).
  const includeItems = getBooleanFlag(url.searchParams.get("include_items"));
  const requests = await ctx.stores.request.list({
    // Request records keep a bare sessionId; isolate by the tenant filter
    // (always present, possibly undefined) so history never crosses tenants.
    sessionId: route.sessionId,
    tenantId: ctx.tenantId,
    status: getString(url.searchParams.get("status")) as
      | RequestStatus
      | undefined,
    limit: getPositiveInteger(url.searchParams.get("limit")),
    offset: getPositiveInteger(url.searchParams.get("offset")),
    withItems: includeItems
  });

  return jsonResponse(200, {
    requests
  });
}
