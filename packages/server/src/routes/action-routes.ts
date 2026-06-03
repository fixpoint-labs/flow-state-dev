/**
 * Action execution route handler.
 *
 * Builds an `InboundRequestEnvelope` from an HTTP request and dispatches it
 * through the `InboundTransportHost`. The host owns the `runAction`
 * machinery — this file is the HTTP-specific glue (body parsing, principal
 * resolution context, SSE response shaping) only.
 */
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import type { InboundTransportHost } from "../transports/types";
import { OrgRequiredError, PrincipalResolutionError } from "../transports/errors";
import { generateId } from "../utils/generate-id";
import {
  asObject,
  getString,
  jsonResponse,
  parseJsonBody,
  SSE_HEADERS
} from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import type { InternalRouteSeams, RequestContext } from "./http-handlers";

type ActionRunInput = {
  flowKind: string;
  actionName: string;
  input: unknown;
  userId: string;
  sessionId?: string;
  requestId: string;
  orgId?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
};

/** Default HTTP header carrying the tenant id (FIX-406 6D). */
const DEFAULT_TENANT_ID_HEADER = "x-tenant-id";

type ActionRouteContext = {
  host: InboundTransportHost;
  /** Convenience aliases — same instances the host holds. */
  registry: FlowRegistry;
  stores: StoreRegistry;
  seams: InternalRouteSeams;
  bootstrapMetadata: Record<string, unknown>;
  requestContext: RequestContext;
  /** Header carrying the tenant id; defaults to `x-tenant-id` (FIX-406 6D). */
  tenantIdHeader?: string;
};

export async function handleExecuteAction(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "execute_action" }>,
  ctx: ActionRouteContext
): Promise<Response> {
  const flow = ctx.registry.get(route.flowKind);
  if (flow === undefined) {
    return jsonResponse(404, {
      error: `Unknown flow "${route.flowKind}"`
    });
  }

  const body = await parseJsonBody(request);
  const sessionId = route.sessionId ?? getString(body.sessionId);
  const metadata = asObject(body.metadata);
  // FIX-406 6D: optional tenant id from a configurable header.
  const tenantId =
    request.headers.get(ctx.tenantIdHeader ?? DEFAULT_TENANT_ID_HEADER) ?? undefined;

  // Build principal-resolution context. The body is exposed under
  // `metadata.body` so the default body-userId resolver can read it
  // without re-parsing the request.
  let principal;
  try {
    principal = await ctx.host.resolvePrincipal({
      source: "http",
      request,
      envelope: {
        flowKind: flow.kind,
        action: route.actionName,
        sessionId,
        metadata: { ...(metadata ?? {}), body },
        input: body.input
      }
    });
  } catch (error) {
    if (error instanceof PrincipalResolutionError) {
      // Preserve the legacy 400 status for missing body.userId so existing
      // tests and clients keep working. Other PrincipalResolutionErrors map
      // to whatever status the resolver chose (typically 401).
      const status =
        error.status === 401 && error.message.includes("userId")
          ? 400
          : error.status;
      return jsonResponse(status, { error: error.message });
    }
    throw error;
  }

  const actionInput: ActionRunInput = {
    flowKind: flow.kind,
    actionName: route.actionName,
    input: body.input,
    userId: principal.userId,
    sessionId,
    requestId: getString(body.requestId) ?? generateId("req"),
    orgId: getString(body.orgId) ?? principal.orgId,
    tenantId,
    metadata: {
      ...ctx.bootstrapMetadata,
      ...(metadata ?? {})
    }
    // Intentionally no `signal: request.signal`. The HTTP request signal
    // is a wire-level concern (closes the SSE readable on disconnect);
    // propagating it into runAction would tie execution durability to
    // the originating connection and kill the run on a tab refresh,
    // breaking resume-via-GET-stream. Explicit cancellation flows
    // through `runAction`'s registered abort controller (the abort
    // endpoint), not through this signal.
  };

  const actionOverrides =
    (await ctx.seams.enrichActionRunInput?.(actionInput, {
      ...ctx.requestContext,
      body
    })) ?? {};

  const resolvedActionInput: ActionRunInput = {
    ...actionInput,
    ...actionOverrides,
    metadata: {
      ...(actionInput.metadata ?? {}),
      ...(actionOverrides.metadata ?? {})
    }
  };

  const dispatchEnvelope = {
    source: "http" as const,
    flowKind: resolvedActionInput.flowKind,
    action: resolvedActionInput.actionName,
    input: resolvedActionInput.input,
    sessionId: resolvedActionInput.sessionId,
    requestId: resolvedActionInput.requestId,
    orgId: resolvedActionInput.orgId,
    tenantId: resolvedActionInput.tenantId,
    principal: { userId: resolvedActionInput.userId, orgId: resolvedActionInput.orgId },
    metadata: resolvedActionInput.metadata,
    signal: resolvedActionInput.signal
  };

  try {
    await ctx.host.validateDispatch(dispatchEnvelope);
  } catch (e) {
    if (e instanceof OrgRequiredError) {
      return jsonResponse(400, {
        error: "OrgRequired",
        message: e.message
      });
    }
    throw e;
  }

  let handle;
  try {
    handle = ctx.host.dispatch(dispatchEnvelope);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("active stream capacity")) {
      return jsonResponse(503, { error: message });
    }
    if (message.startsWith("Unknown flow")) {
      return jsonResponse(404, { error: message });
    }
    throw error;
  }

  // Inline streaming: when the client sends Accept: text/event-stream, return
  // the SSE stream directly from the POST response. This keeps the action
  // execution and stream delivery on the same function instance — essential
  // for serverless platforms where POST and GET may hit different instances.
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream") && handle.liveStream !== null) {
    return new Response(handle.liveStream.readable, {
      status: 200,
      headers: {
        ...SSE_HEADERS,
        // Vercel/Nginx proxy anti-buffering headers — needed here because
        // the Vercel adapter skips heartbeat wrapping for POST responses.
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
        "x-request-id": handle.requestId,
        "x-session-id": resolvedActionInput.sessionId ?? ""
      }
    });
  }

  return jsonResponse(202, {
    status: "in_progress",
    request: {
      id: handle.requestId,
      flowKind: flow.kind,
      actionName: resolvedActionInput.actionName,
      status: "in_progress"
    },
    session:
      resolvedActionInput.sessionId === undefined
        ? undefined
        : {
            id: resolvedActionInput.sessionId
          }
  });
}
