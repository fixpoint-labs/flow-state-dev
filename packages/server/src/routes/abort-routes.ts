/**
 * Abort route handler for cancelling in-flight requests.
 */
import type { StoreRegistry } from "../stores/types";
import {
  abortRequest,
  hasActiveAbortController
} from "../execution/abort-registry";
import { jsonResponse } from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";

type AbortRouteContext = {
  stores: StoreRegistry;
};

/**
 * POST /api/flows/:flowKind/requests/:requestId/abort
 *
 * Signals the AbortController for an in-progress request. The actual
 * status transition happens inside runAction's catch path.
 *
 * Returns 204 on success, 404 if the request is not in progress,
 * 409 if the request is already in a terminal state.
 */
export async function handleAbortRequest(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "abort_request" }>,
  ctx: AbortRouteContext
): Promise<Response> {
  const { requestId } = route;

  // Check if the request has an active abort controller (i.e., runAction is running)
  if (hasActiveAbortController(requestId)) {
    abortRequest(requestId);
    return new Response(null, { status: 204 });
  }

  // No active controller — check if the request exists but is already terminal
  const record = await ctx.stores.request.get(requestId);
  if (record !== undefined && record.status !== "in_progress") {
    return jsonResponse(409, {
      error: `Request "${requestId}" is already in terminal state "${record.status}"`
    });
  }

  return jsonResponse(404, {
    error: `Request "${requestId}" is not in progress`
  });
}
