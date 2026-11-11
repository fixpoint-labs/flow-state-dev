// FIX-2623.
/**
 * The view routes:
 *
 * - `POST /:flowKind/views/:viewName` — a user or org view, with no session.
 * - `POST /:flowKind/:sessionId/views/:viewName` — a session view, on that session.
 *
 * Each runs the view for its caller and answers `200 { output, topics }`:
 * the answer, and the change topics what it read falls under, deduped and
 * sorted. Nothing is stored (`execution/runView.ts`).
 *
 * The caller is resolved on the `:flowKind` path through the flow's own
 * resolver (`pickPrincipalResolver`, through `host.resolvePrincipal`), as an
 * action and a read are, never from the body, query or headers. A
 * user or org view takes user and org from that principal and runs on no
 * session; a session view is fenced the way the session's action route is:
 * a session the caller may not run in answers as an id with no session
 * behind it, and a view can't make one.
 */
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import type { InboundTransportHost } from "../transports/types";
import type { RuntimeConfig } from "../runtime-config";
import { PrincipalResolutionError } from "../transports/errors";
import {
  assertSessionAdmitted,
  FlowInstanceBindingMismatchError,
  OrgBindingMismatchError,
  TenantBindingMismatchError,
  UserBindingMismatchError
} from "../context/binding-errors";
import { NoSessionError } from "../context/no-session";
import { UnrecordedReadError, ViewModelCallError } from "../context/view-reads";
import { FlowError } from "../errors/flow-error";
import { runView, UnknownViewError } from "../execution/runView";
import { asObject, extractTenantId, jsonResponse, loadTenantSession, parseJsonBody, unknownSessionResponse } from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";

type ViewRoute = Extract<ParsedFlowRoute, { kind: "run_view" }>;

type ViewRouteContext = {
  host: InboundTransportHost;
  registry: FlowRegistry;
  stores: StoreRegistry;
  runtimeConfig: RuntimeConfig;
  /** Header carrying the tenant id; defaults to `x-tenant-id`. */
  tenantIdHeader?: string;
};

/** Run one view for its caller. See the file header. */
export async function handleRunView(request: Request, route: ViewRoute, ctx: ViewRouteContext): Promise<Response> {
  const flow = ctx.registry.get(route.flowKind);
  if (flow === undefined) return jsonResponse(404, { error: `Unknown flow "${route.flowKind}"` });
  const view = Object.hasOwn(flow.views ?? {}, route.viewName) ? flow.views![route.viewName]! : undefined;
  if (view === undefined) return jsonResponse(404, { error: new UnknownViewError(flow.id, route.viewName).message });

  // The address must match the view's scope: a session view names its
  // session, and a user or org view names none.
  if (view.scope === "session" && route.sessionId === undefined) {
    return jsonResponse(400, {
      error: "view_needs_session",
      message: `View "${route.viewName}" runs on a session: call it at /${route.flowKind}/<sessionId>/views/${route.viewName}`
    });
  }
  if (view.scope !== "session" && route.sessionId !== undefined) {
    return jsonResponse(400, {
      error: "view_takes_no_session",
      message: `View "${route.viewName}" runs at ${view.scope} scope, with no session: call it at /${route.flowKind}/views/${route.viewName}`
    });
  }

  const body = await parseJsonBody(request);
  const metadata = asObject(body.metadata);
  const tenantId = extractTenantId(request, ctx.tenantIdHeader);

  let principal;
  try {
    principal = await ctx.host.resolvePrincipal({
      source: "http",
      request,
      envelope: {
        flowKind: flow.id,
        action: route.viewName,
        ...(route.sessionId !== undefined ? { sessionId: route.sessionId } : {}),
        metadata: { ...(metadata ?? {}), body },
        input: body.input
      }
    });
  } catch (error) {
    if (error instanceof PrincipalResolutionError) {
      // As the action route: a missing body.userId is the legacy 400.
      const status = error.status === 401 && error.message.includes("userId") ? 400 : error.status;
      return jsonResponse(status, { error: error.message });
    }
    throw error;
  }

  try {
    if (route.sessionId !== undefined) {
      // A session view runs in a session that exists: it can't create one.
      // Another user's session answers as an unknown one, as the action route answers it.
      const session = await loadTenantSession(ctx.stores.session, route.sessionId, tenantId);
      if (session === undefined) return unknownSessionResponse(route.sessionId);
      assertSessionAdmitted(flow, session, { sessionId: route.sessionId, userId: principal.userId, tenantId });
    }
    const answer = await runView({
      flow,
      viewName: route.viewName,
      input: body.input,
      userId: principal.userId,
      orgId: principal.orgId,
      ...(route.sessionId !== undefined ? { sessionId: route.sessionId } : {}),
      ...(tenantId !== undefined ? { tenantId } : {}),
      stores: ctx.stores,
      runtimeConfig: ctx.runtimeConfig,
      signal: request.signal
    });
    return jsonResponse(200, { output: answer.output ?? null, topics: answer.topics });
  } catch (error) {
    return viewFailureResponse(error, route);
  }
}

/** What a failed view answers: the action route's answer for a binding refusal, a named code for the rest. */
function viewFailureResponse(error: unknown, route: ViewRoute): Response {
  if (error instanceof UnknownViewError) return jsonResponse(404, { error: error.message });
  if (
    route.sessionId !== undefined &&
    (error instanceof UserBindingMismatchError ||
      error instanceof OrgBindingMismatchError ||
      error instanceof TenantBindingMismatchError)
  ) {
    return unknownSessionResponse(route.sessionId);
  }
  if (error instanceof FlowInstanceBindingMismatchError) {
    return jsonResponse(409, {
      error: error.reason === "migration-required" ? "migration-required" : "wrong-instance-session",
      message: `Record "${error.recordId}" is not owned by flow instance "${error.addressedFlowId}"`
    });
  }
  // The view's own code is wrong, not the call: 422, named.
  if (error instanceof ViewModelCallError) return jsonResponse(422, { error: "view_model_call", message: error.message });
  if (error instanceof NoSessionError) return jsonResponse(422, { error: "view_no_session", message: error.message });
  if (error instanceof UnrecordedReadError) return jsonResponse(422, { error: "view_unrecorded_read", message: error.message });
  if (FlowError.isInstance(error)) {
    const status = error.code === "validation_error" ? 400 : error.code === "read_only" ? 409 : error.retryable ? 503 : 422;
    return jsonResponse(status, { error: error.code ?? "view_failed", message: error.message });
  }
  const message = error instanceof Error ? error.message : String(error);
  return jsonResponse(500, { error: "view_failed", message });
}
