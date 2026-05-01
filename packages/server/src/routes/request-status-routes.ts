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
import { jsonResponse } from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";

type RequestStatusRouteContext = {
  stores: StoreRegistry;
};

/**
 * GET /api/flows/:flowKind/requests/:requestId/status
 *
 * - 200 with `RequestStatusSnapshot` when the request exists.
 * - 404 with `{ error }` when no record is found.
 *
 * `lastHeartbeatAt` is best-effort: the registry entry may have already
 * been deregistered (terminal status), in which case the field is omitted.
 */
export async function handleGetRequestStatus(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "request_status" }>,
  ctx: RequestStatusRouteContext
): Promise<Response> {
  const { requestId } = route;

  const record = await ctx.stores.request.get(requestId);
  if (record === undefined) {
    return jsonResponse(404, {
      error: `Request "${requestId}" not found`
    });
  }

  if (record.flowKind !== route.flowKind) {
    return jsonResponse(404, {
      error: `Request "${requestId}" not found`
    });
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
      : {})
  };

  return jsonResponse(200, snapshot);
}
