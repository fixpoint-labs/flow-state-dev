/**
 * The read route (FIX-2286): `POST /:flowKind/:sessionId/reads/:readName`.
 *
 * Runs one of the flow's reads on the session for its caller and answers
 * `200 { output }`. Nothing is stored (`execution/runRead.ts`). The caller is
 * resolved and fenced the way the session's action route does it: the same
 * principal resolution, the same answer for a session the caller may not run
 * in (as an id with no session behind it), and the same refusals for a
 * session another flow instance owns.
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
import { FlowError } from "../errors/flow-error";
import { runRead, UnknownReadError } from "../execution/runRead";
import { asObject, extractTenantId, jsonResponse, loadTenantSession, parseJsonBody, unknownSessionResponse } from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";

type ReadRouteContext = {
  host: InboundTransportHost;
  registry: FlowRegistry;
  stores: StoreRegistry;
  runtimeConfig: RuntimeConfig;
  /** Header carrying the tenant id; defaults to `x-tenant-id` (FIX-406 6D). */
  tenantIdHeader?: string;
};

export async function handleRunRead(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "run_read" }>,
  ctx: ReadRouteContext
): Promise<Response> {
  const flow = ctx.registry.get(route.flowKind);
  if (flow === undefined) return jsonResponse(404, { error: `Unknown flow "${route.flowKind}"` });

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
        action: route.readName,
        sessionId: route.sessionId,
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

  // A read runs in a session that exists: it can't create one. Another
  // user's session answers as an unknown one, as the action route answers it.
  const session = await loadTenantSession(ctx.stores.session, route.sessionId, tenantId);
  if (session === undefined) return unknownSessionResponse(route.sessionId);

  try {
    assertSessionAdmitted(flow, session, { sessionId: route.sessionId, userId: principal.userId, tenantId });
    const output = await runRead({
      flow,
      readName: route.readName,
      input: body.input,
      userId: principal.userId,
      orgId: principal.orgId,
      sessionId: route.sessionId,
      tenantId,
      stores: ctx.stores,
      runtimeConfig: ctx.runtimeConfig,
      signal: request.signal
    });
    return jsonResponse(200, { output: output ?? null });
  } catch (error) {
    return readFailureResponse(error, route);
  }
}

/** What a failed read answers: the action route's answer for a binding refusal, the error's own for the rest. */
function readFailureResponse(error: unknown, route: Extract<ParsedFlowRoute, { kind: "run_read" }>): Response {
  if (error instanceof UnknownReadError) return jsonResponse(404, { error: error.message });
  if (
    error instanceof UserBindingMismatchError ||
    error instanceof OrgBindingMismatchError ||
    error instanceof TenantBindingMismatchError
  ) {
    return unknownSessionResponse(route.sessionId);
  }
  if (error instanceof FlowInstanceBindingMismatchError) {
    return jsonResponse(409, {
      error: error.reason === "migration-required" ? "migration-required" : "wrong-instance-session",
      message: `Session "${error.recordId}" is not owned by flow instance "${error.addressedFlowId}"`
    });
  }
  if (FlowError.isInstance(error)) {
    const status = error.code === "validation_error" ? 400 : error.code === "read_only" ? 409 : error.retryable ? 503 : 422;
    return jsonResponse(status, { error: error.code ?? "read_failed", message: error.message });
  }
  const message = error instanceof Error ? error.message : String(error);
  return jsonResponse(500, { error: "read_failed", message });
}
