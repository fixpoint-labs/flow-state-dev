/**
 * HTTP route handler for the suspension resume endpoint.
 *
 * POST /api/flows/:flowKind/sessions/:sessionId/requests/:requestId/resume
 *
 * Resolves a pending suspension so that block execution continues.
 */
import type { ResumePayload } from "@flow-state-dev/core/types";
import type { StoreRegistry } from "../stores/types";
import { getSuspension } from "../suspension/suspension-registry";
import { jsonResponse, parseJsonBody } from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";

type ResumeRouteContext = {
  stores: StoreRegistry;
};

export async function handleResumeRequest(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "resume_request" }>,
  ctx: ResumeRouteContext
): Promise<Response> {
  const body = await parseJsonBody(request);

  const suspensionId = typeof body.suspensionId === "string" ? body.suspensionId : undefined;
  if (suspensionId === undefined || suspensionId.length === 0) {
    return jsonResponse(400, {
      error: "Request body requires non-empty suspensionId"
    });
  }

  const action = body.action;
  if (action !== "approve" && action !== "reject") {
    return jsonResponse(400, {
      error: 'Request body requires action of "approve" or "reject"'
    });
  }

  // Validate the request exists and is in progress.
  const requestRecord = await ctx.stores.request.get(route.requestId);
  if (requestRecord === undefined) {
    return jsonResponse(404, {
      error: `Request "${route.requestId}" not found`
    });
  }

  if (requestRecord.status !== "in_progress") {
    return jsonResponse(409, {
      error: `Request "${route.requestId}" has status "${requestRecord.status}" and cannot be resumed`
    });
  }

  // Look up the suspension.
  const suspension = getSuspension(suspensionId);
  if (suspension === undefined) {
    return jsonResponse(404, {
      error: `Suspension "${suspensionId}" not found or already resolved`
    });
  }

  if (suspension.requestId !== route.requestId) {
    return jsonResponse(400, {
      error: `Suspension "${suspensionId}" does not belong to request "${route.requestId}"`
    });
  }

  if (suspension.status !== "pending") {
    return jsonResponse(409, {
      error: `Suspension "${suspensionId}" has status "${suspension.status}" and cannot be resumed`
    });
  }

  // Settle the suspension — this resolves the promise inside ctx.suspend(),
  // allowing block execution to continue.
  const payload: ResumePayload = {
    action,
    data: body.data
  };

  suspension.status = action === "approve" ? "approved" : "rejected";
  suspension.resolve(payload);

  return jsonResponse(200, {
    suspensionId,
    status: suspension.status,
    requestId: route.requestId
  });
}
