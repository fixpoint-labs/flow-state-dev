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
 * Records the cancellation durably on the request record and, when the request
 * is running in this process, fires its in-memory AbortController immediately.
 *
 * When it is running somewhere else, the process that owns the run picks the
 * intent up on its next heartbeat tick and fires the same controller there, so
 * a cancel issued anywhere stops a run anywhere. Delivery is bounded by the
 * flow's `heartbeatIntervalMs` and needs a request store shared across
 * processes; with `heartbeatIntervalMs: 0` there is no tick and therefore no
 * delivery.
 *
 * Returns 204 when the in-memory controller was fired here, 202 when the
 * intent was recorded for the running process to pick up, 404 if the request
 * doesn't exist, 409 if it's already terminal.
 */
export async function handleAbortRequest(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "abort_request" }>,
  ctx: AbortRouteContext
): Promise<Response> {
  const { requestId } = route;

  // One atomic step: record the intent only while the request is still
  // running. A read-then-write cannot express this — the worker can commit a
  // terminal status between the two, and writing afterwards would restore an
  // `in_progress` record over a finished one.
  const result = await ctx.stores.request.setFieldsIfStatus(
    requestId,
    { abortRequested: true },
    ["in_progress"],
    Date.now()
  );

  if (result.status === undefined) {
    return jsonResponse(404, {
      error: `Request "${requestId}" is not in progress`
    });
  }

  if (!result.applied) {
    return jsonResponse(409, {
      error: `Request "${requestId}" is already in terminal state "${result.status}"`
    });
  }

  // Fire the in-memory controller if this is the same instance.
  if (hasActiveAbortController(requestId)) {
    abortRequest(requestId);
    return new Response(null, { status: 204 });
  }

  return new Response(null, { status: 202 });
}
