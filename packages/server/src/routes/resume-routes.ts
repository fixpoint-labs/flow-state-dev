/**
 * Resume endpoint handler for durable action suspension resolution.
 */
import type { ResumeContext } from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import type { InboundTransportHost } from "../transports/types";
import type { DurabilityProvider } from "../durability/types";
import { generateId } from "../utils/generate-id";
import {
  jsonResponse,
  parseJsonBody,
  getString,
  SSE_HEADERS
} from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import type { InternalRouteSeams, RequestContext } from "./http-handlers";

type ResumeRouteContext = {
  host: InboundTransportHost;
  registry: FlowRegistry;
  stores: StoreRegistry;
  durabilityProvider?: DurabilityProvider;
  seams: InternalRouteSeams;
  requestContext: RequestContext;
};

export async function handleResumeSuspension(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "resume_suspension" }>,
  ctx: ResumeRouteContext
): Promise<Response> {
  const flow = ctx.registry.get(route.flowKind);
  if (flow === undefined) {
    return jsonResponse(404, { error: `Unknown flow "${route.flowKind}"` });
  }

  const provider = ctx.durabilityProvider;
  if (provider === undefined) {
    return jsonResponse(400, {
      error: "No DurabilityProvider configured. Resume requires durable execution."
    });
  }

  const body = await parseJsonBody(request);
  const suspensionId = getString(body.suspensionId);
  const action = getString(body.action);
  const resumeData = body.data;
  const resumedBy = getString(body.resumedBy);

  if (suspensionId === undefined) {
    return jsonResponse(400, { error: "Missing required field: suspensionId" });
  }

  if (action !== "approve" && action !== "reject") {
    return jsonResponse(400, {
      error: 'Field "action" must be "approve" or "reject"'
    });
  }

  const originalRequest = await ctx.stores.request.get(route.requestId);
  if (originalRequest === undefined) {
    return jsonResponse(404, { error: `Request "${route.requestId}" not found` });
  }

  if (originalRequest.status !== "suspended") {
    return jsonResponse(409, {
      error: `Request is "${originalRequest.status}", not "suspended"`
    });
  }

  const suspension = await provider.loadSuspension(route.requestId, suspensionId);
  if (suspension === null) {
    return jsonResponse(404, {
      error: `Suspension "${suspensionId}" not found`
    });
  }
  if (suspension.status !== "pending") {
    return jsonResponse(409, {
      error: `Suspension "${suspensionId}" has already been resolved (status: "${suspension.status}")`
    });
  }

  if (
    suspension.resumeSchema !== undefined &&
    action === "approve" &&
    resumeData !== undefined
  ) {
    // Schema validation is deferred to the runtime for now — the resume
    // endpoint validates shape presence; the sequencer validates content.
  }

  const lease = await provider.acquireLease(route.requestId, {
    holder: generateId("resume"),
    durationMs: 60_000
  });

  if (lease === null) {
    return jsonResponse(409, {
      error: "Concurrent resume in progress. Try again later."
    });
  }

  const now = Date.now();
  await provider.suspend({
    ...suspension,
    status: action === "approve" ? "approved" : "rejected",
    resolvedAt: now,
    resolvedBy: resumedBy,
    resumeData
  });

  const resumeContext: ResumeContext = {
    suspensionId,
    action,
    data: resumeData,
    resumedBy
  };

  const newRequestId = generateId("req");

  try {
    const handle = ctx.host.dispatch({
      source: "http",
      flowKind: route.flowKind,
      action: suspension.actionName,
      input: originalRequest.input,
      sessionId: suspension.sessionId,
      requestId: newRequestId,
      principal: { userId: suspension.userId },
      metadata: {
        resumeOf: route.requestId,
        resumeContext
      }
    });

    const accept = request.headers.get("accept") ?? "";
    if (accept.includes("text/event-stream") && handle.liveStream !== null) {
      return new Response(handle.liveStream.readable, {
        status: 200,
        headers: {
          ...SSE_HEADERS,
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no",
          "x-request-id": handle.requestId,
          "x-original-request-id": route.requestId
        }
      });
    }

    return jsonResponse(202, {
      requestId: newRequestId,
      originalRequestId: route.requestId
    });
  } catch (error) {
    await provider.releaseLease(route.requestId, lease.leaseId);
    throw error;
  }
}
