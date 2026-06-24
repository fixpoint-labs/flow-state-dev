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
 * Marks a request as abort-requested in the persistent store and, when
 * available, fires the in-memory AbortController. On single-server
 * deployments the controller fires immediately. On serverless (where
 * this handler may run on a different instance), the persistent flag
 * tells the running instance to treat the next client disconnect as
 * an intentional abort rather than an accidental one.
 *
 * Returns 202 when the flag was set (abort will happen when the running
 * instance detects it), 204 when the in-memory controller was also
 * fired, 404 if the request doesn't exist, 409 if it's already terminal.
 */
export async function handleAbortRequest(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "abort_request" }>,
  ctx: AbortRouteContext
): Promise<Response> {
  const { requestId } = route;

  const record = await ctx.stores.request.get(requestId);

  if (record === undefined) {
    return jsonResponse(404, {
      error: `Request "${requestId}" is not in progress`
    });
  }

  if (record.status !== "in_progress") {
    return jsonResponse(409, {
      error: `Request "${requestId}" is already in terminal state "${record.status}"`
    });
  }

  // Persist intent so the running instance can distinguish intentional
  // abort from accidental disconnect (browser reload, network drop).
  await ctx.stores.request.set(
    requestId,
    { ...record, abortRequested: true },
    "any"
  );

  // Fire the in-memory controller if this is the same instance.
  if (hasActiveAbortController(requestId)) {
    abortRequest(requestId);
    return new Response(null, { status: 204 });
  }

  // Cross-instance: flag is set, abort will happen when the client
  // closes the SSE connection and request.signal fires.
  return new Response(null, { status: 202 });
}
