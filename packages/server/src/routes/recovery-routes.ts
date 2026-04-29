/**
 * HTTP route handlers for request recovery (retry + active request listing).
 */
import type { Middleware, ModelResolver, SpeechResolver } from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import { detectInterruptedRequests, retryRequest } from "../execution/request-recovery";
import { jsonResponse, parseJsonBody } from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import type { RuntimeLogger } from "../execution/logging";

type RecoveryRouteContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
  modelResolver?: ModelResolver;
  speechResolver?: SpeechResolver;
  middleware?: Middleware[];
  logger?: RuntimeLogger;
};

export async function handleRetryRequest(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "retry_request" }>,
  ctx: RecoveryRouteContext
): Promise<Response> {
  // Load the original request
  const originalRecord = await ctx.stores.request.get(route.requestId);
  if (originalRecord === undefined) {
    return jsonResponse(404, {
      error: `Request "${route.requestId}" not found`
    });
  }

  // Only allow retrying interrupted or failed requests
  if (originalRecord.status === "in_progress") {
    return jsonResponse(409, {
      error: `Request "${route.requestId}" is still in progress`
    });
  }

  if (
    originalRecord.status !== "interrupted" &&
    originalRecord.status !== "failed"
  ) {
    return jsonResponse(409, {
      error: `Request "${route.requestId}" has status "${originalRecord.status}" and cannot be retried`
    });
  }

  // Validate flow kind matches
  if (originalRecord.flowKind !== route.flowKind) {
    return jsonResponse(400, {
      error: `Flow kind mismatch: request belongs to "${originalRecord.flowKind}", not "${route.flowKind}"`
    });
  }

  // Parse optional input override
  let inputOverride: unknown;
  try {
    const body = await parseJsonBody(request);
    inputOverride = body.inputOverride;
  } catch {
    // No body or invalid JSON — proceed without override
  }

  try {
    const result = await retryRequest({
      originalRequestId: route.requestId,
      stores: ctx.stores,
      flowRegistry: ctx.registry,
      registryEntry: inputOverride !== undefined
        ? {
            requestId: route.requestId,
            flowKind: originalRecord.flowKind,
            actionName: originalRecord.actionName,
            sessionId: originalRecord.sessionId,
            userId: originalRecord.userId,
            orgId: originalRecord.orgId,
            input: inputOverride,
            metadata: originalRecord.metadata,
            startedAt: originalRecord.startedAtMs,
            lastHeartbeatAt: Date.now()
          }
        : undefined,
      modelResolver: ctx.modelResolver,
      speechResolver: ctx.speechResolver,
      middleware: ctx.middleware,
      logger: ctx.logger
    });

    return jsonResponse(202, {
      status: "in_progress",
      request: {
        id: result.newRequestId,
        flowKind: route.flowKind,
        actionName: originalRecord.actionName,
        status: "in_progress",
        retryOf: route.requestId
      },
      session: originalRecord.sessionId !== undefined
        ? { id: originalRecord.sessionId }
        : undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(500, { error: message });
  }
}

export async function handleListActiveRequests(
  _request: Request,
  ctx: RecoveryRouteContext
): Promise<Response> {
  const entries = await ctx.stores.activeRequests.listAll();
  const now = Date.now();

  return jsonResponse(200, {
    entries: entries.map((entry) => ({
      requestId: entry.requestId,
      flowKind: entry.flowKind,
      actionName: entry.actionName,
      sessionId: entry.sessionId,
      startedAt: entry.startedAt,
      lastHeartbeatAt: entry.lastHeartbeatAt,
      ageMs: now - entry.startedAt
    }))
  });
}

/**
 * Sweep stale active-request entries for a single user and mark their
 * `in_progress` request records as `interrupted`.
 *
 * The framework only auto-runs `detectInterruptedRequests` at server startup
 * (and many deployments disable that for serverless safety). This endpoint
 * lets a client poke detection on demand — typically the DevTool calls it
 * when it mounts and on every session-list refresh.
 *
 * Optional query: `staleThresholdMs` (default 30_000).
 *
 * Response: `{ interrupted: [{ requestId, sessionId, flowKind, actionName, interruptedAt }] }`,
 * limited to records that this call actually transitioned to `interrupted`.
 * Records whose status was already terminal (completed/failed/aborted) are
 * silently deregistered and excluded from the response.
 */
export async function handleCheckInterruptedRequests(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "check_interrupted_requests" }>,
  ctx: RecoveryRouteContext
): Promise<Response> {
  const userId = route.userId.trim();
  if (userId.length === 0) {
    return jsonResponse(400, { error: "userId is required" });
  }

  const url = new URL(request.url);
  const thresholdParam = url.searchParams.get("staleThresholdMs");
  const staleThresholdMs =
    thresholdParam === null ? undefined : Number.parseInt(thresholdParam, 10);
  if (staleThresholdMs !== undefined && !Number.isFinite(staleThresholdMs)) {
    return jsonResponse(400, { error: "staleThresholdMs must be a number" });
  }

  const swept = await detectInterruptedRequests({
    stores: ctx.stores,
    userId,
    staleThresholdMs,
    logger: ctx.logger
  });

  const interrupted = swept
    .filter(
      (info) =>
        info.requestRecord !== undefined &&
        info.requestRecord.status === "in_progress"
    )
    .map((info) => ({
      requestId: info.entry.requestId,
      sessionId: info.entry.sessionId,
      flowKind: info.entry.flowKind,
      actionName: info.entry.actionName,
      interruptedAt: Date.now()
    }));

  return jsonResponse(200, { interrupted });
}
