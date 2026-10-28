/**
 * Read-only request-status route handler.
 *
 * Returns a `RequestStatusSnapshot` projection of the persisted request
 * record plus the registry's last heartbeat timestamp when available.
 * Callable when no SSE stream is connected — the client uses it after a
 * stuck-request banner is shown to confirm the actual server state before
 * dismissing.
 */
import type { RequestStatusSnapshot } from "@flow-state-dev/core/types";
import type { StoreRegistry } from "../stores/types";
import type { FlowRegistry } from "../registry/flow-registry";
import type { ResolvedPrincipal } from "../transports/types";
import { ownsRecord } from "../context/record-owner";
import { callerReachesRequest, jsonResponse, unknownRequestResponse } from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";

type RequestStatusRouteContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
  /** Caller's tenant, extracted the same way as every other request route. */
  tenantId?: string;
  /** The authenticated caller, when route-level authentication is active. */
  principal?: ResolvedPrincipal;
};

/**
 * GET /api/flows/:flowKind/requests/:requestId/status
 *
 * - 200 with `RequestStatusSnapshot` when the request exists and the caller
 *   reaches it (`callerReachesRequest`, the check the abort and recovery
 *   routes make).
 * - 404 with `{ error }` when no record is found, or it belongs to another
 *   tenant or principal: the two are indistinguishable here.
 *
 * `lastHeartbeatAt` is best-effort: the registry entry may have already
 * been deregistered (terminal status), in which case the field is omitted.
 * `sessionId` is omitted for a request that has no session.
 */
export async function handleGetRequestStatus(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "request_status" }>,
  ctx: RequestStatusRouteContext
): Promise<Response> {
  const { requestId } = route;

  const record = await ctx.stores.request.get(requestId);
  if (record === undefined || !callerReachesRequest(record, ctx.tenantId, ctx.principal)) {
    return unknownRequestResponse(requestId);
  }

  // The addressed instance must own the record; a same-kind peer's request
  // is not found here, same as another flow's.
  const flow = ctx.registry.get(route.flowKind);
  if (flow === undefined || !ownsRecord(flow, record)) {
    return unknownRequestResponse(requestId);
  }

  const active = await ctx.stores.activeRequests.get(requestId);
  const now = Date.now();

  const snapshot: RequestStatusSnapshot = {
    id: requestId,
    status: record.status,
    startedAtMs: record.startedAtMs,
    ageMs: Math.max(0, now - record.startedAtMs),
    ...(record.completedAtMs !== undefined
      ? { completedAtMs: record.completedAtMs }
      : {}),
    ...(active?.lastHeartbeatAt !== undefined
      ? { lastHeartbeatAt: active.lastHeartbeatAt }
      : {}),
    ...(record.sessionId != null ? { sessionId: record.sessionId } : {})
  };

  return jsonResponse(200, snapshot);
}
