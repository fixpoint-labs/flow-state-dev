/**
 * Abort route handler for cancelling in-flight requests.
 */
import type { StoreRegistry } from "../stores/types";
import { resolveRequestIncarnation } from "../stores/scope-keys";
import type { ResolvedPrincipal } from "../transports/types";
import { abortRequest } from "../execution/abort-registry";
import { callerReachesRequest, jsonResponse, unknownRequestResponse } from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";

type AbortRouteContext = {
  stores: StoreRegistry;
  /** Caller's tenant (FIX-682), extracted as every other request route does. */
  tenantId?: string;
  /** The authenticated caller, when route-level authentication is active. */
  principal?: ResolvedPrincipal;
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
 * delivery to a running request, only the one check each run makes as it
 * starts.
 *
 * Returns 204 when the in-memory controller was fired here, 202 when the
 * intent was recorded for the running process to pick up, 404 if the request
 * doesn't exist or is not the caller's, 409 if it's already terminal.
 */
export async function handleAbortRequest(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "abort_request" }>,
  ctx: AbortRouteContext
): Promise<Response> {
  const { requestId } = route;

  const record = await ctx.stores.request.get(requestId);
  if (record === undefined || !callerReachesRequest(record, ctx.tenantId, ctx.principal)) {
    return unknownRequestResponse(requestId);
  }

  // The request the owner check above read. Everything below acts on it and
  // on nothing else that later takes the id.
  const incarnation = resolveRequestIncarnation(record);

  // One atomic step: record the intent only while the request is still
  // running. A read-then-write cannot express this — the worker can commit a
  // terminal status between the two, and writing afterwards would restore an
  // `in_progress` record over a finished one. Fenced to the checked request by
  // its incarnation: if the id was deleted and taken by someone else since,
  // the write misses and the caller gets the unused-id answer; if the owner's
  // own retry handed the record off, the incarnation held and the write lands.
  const result = await ctx.stores.request.setFieldsIfStatus(
    requestId,
    { abortRequested: true },
    ["in_progress"],
    Date.now(),
    incarnation
  );

  if (result.status === undefined) {
    return unknownRequestResponse(requestId);
  }

  if (!result.applied) {
    return jsonResponse(409, {
      error: `Request "${requestId}" is already in terminal state "${result.status}"`
    });
  }

  // Fire the in-memory controller if the checked request runs in this
  // process. A controller of a later request under the id is not it; that
  // request never received the intent, so it is left running.
  if (abortRequest(requestId, incarnation)) {
    return new Response(null, { status: 204 });
  }

  return new Response(null, { status: 202 });
}
