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

  // Enforce expiry at the endpoint, not just in the sweeper. The sweeper flips
  // pending -> expired only every sweepIntervalMs (and only when retention is
  // configured), so without this check an expired gate stays approvable between
  // ticks — or forever if retention is off. Mark it expired now and reject.
  if (suspension.expiresAt != null && suspension.expiresAt <= Date.now()) {
    await provider.suspend({
      ...suspension,
      status: "expired",
      resolvedAt: Date.now()
    });
    return jsonResponse(410, {
      error: `Suspension "${suspensionId}" expired at ${suspension.expiresAt}`
    });
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

  const resumeContext: ResumeContext = {
    suspensionId,
    action,
    data: resumeData,
    resumedBy
  };

  const newRequestId = generateId("req");

  try {
    const now = Date.now();
    await provider.suspend({
      ...suspension,
      status: action === "approve" ? "approved" : "rejected",
      resolvedAt: now,
      resolvedBy: resumedBy,
      resumeData
    });

    const handle = ctx.host.dispatch({
      source: "http",
      flowKind: route.flowKind,
      action: suspension.actionName,
      input: originalRequest.input,
      sessionId: suspension.sessionId,
      requestId: newRequestId,
      // Resume in the original tenant so the run resolves the same
      // tenant-namespaced session key (FIX-682).
      tenantId: originalRequest.tenantId,
      principal: { userId: suspension.userId },
      metadata: {
        resumeOf: route.requestId,
        resumeContext
      }
    });

    // Hold the ack until the resumed request is accepted: writes committed AND
    // the dispatcher accepted the job (external dispatch only; no-op for
    // in-process). This keeps the enqueue inside the try, so an enqueue failure
    // reverts the suspension to pending via the catch below instead of leaving
    // it resolved with no worker job.
    if (handle.accepted !== undefined) {
      await handle.accepted;
    }

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
    // Revert suspension to pending so the operator can retry.
    await provider.suspend({ ...suspension, status: "pending" }).catch(() => {});
    await provider.releaseLease(route.requestId, lease.leaseId);
    throw error;
  }
}
