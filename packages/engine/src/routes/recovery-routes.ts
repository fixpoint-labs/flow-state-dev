/**
 * HTTP route handlers for request recovery (retry + active request listing).
 */
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import type { InboundTransportHost, ResolvedPrincipal } from "../transports/types";
import { detectInterruptedRequests, retryRequest } from "../execution/request-recovery";
import { jsonResponse, parseJsonBody, SSE_HEADERS } from "./route-utils";
import { generateId } from "../utils/generate-id";
import { tenantMatches } from "../stores/scope-keys";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import type { RuntimeConfig } from "../runtime-config";

type RecoveryRouteContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
  /** Instance-level runtime options (resolvers, voice provider, logger, …). */
  runtimeConfig: RuntimeConfig;
  /** Caller's tenant (FIX-682), extracted the same way as every other session-touching route. */
  tenantId?: string;
  /**
   * The authenticated caller, when route-level authentication is active
   * (see `route-auth.ts`). Undefined for an app on the framework default
   * resolver.
   */
  principal?: ResolvedPrincipal;
  /**
   * For an anonymous cross-flow listing in a mixed app: the flow kinds that
   * may be listed without a principal. Undefined means unrestricted. See
   * `route-auth.ts`.
   */
  anonymousFlowKinds?: Set<string>;
};

type ContinueRouteContext = RecoveryRouteContext & {
  host: InboundTransportHost;
};

/**
 * Webhook-originated requests are event-addressed and transport-authenticated:
 * their handler is reached only through a verified webhook, never the public
 * action endpoint. The retry/continue routes are public re-dispatch surfaces
 * (retry even accepts an `inputOverride`), so re-running a webhook request from
 * here would bypass signature verification. Both routes reject such records,
 * matching the FIX-439 v1 "detached completion only" scope.
 */
const WEBHOOK_SOURCE = "webhook";

/** Transport source stamped by the scheduled-dispatch adapter (`@flow-state-dev/scheduled`). */
const SCHEDULED_SOURCE = "scheduled";

/**
 * Whether a request record is a dynamic (resolver-produced) scheduled
 * dispatch, per its `metadata.schedule.origin` (falling back to the legacy
 * flat `metadata.origin` for in-flight records enqueued before namespacing —
 * see `request-separator.tsx`'s matching fallback).
 */
function isDynamicScheduleRecord(record: { source: string; metadata?: Record<string, unknown> }): boolean {
  if (record.source !== SCHEDULED_SOURCE) return false;
  const scheduleMeta = (record.metadata?.schedule ?? record.metadata) as
    | { origin?: unknown }
    | undefined;
  return scheduleMeta?.origin === "dynamic";
}

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

  // A caller-supplied requestId must belong to the caller's own tenant (FIX-682) —
  // otherwise this public re-dispatch surface lets one tenant re-run another
  // tenant's request. Same not-found shape as a missing record, matching the
  // webhook-source check below.
  if (!tenantMatches(originalRecord.tenantId, ctx.tenantId)) {
    return jsonResponse(404, { error: `Request "${route.requestId}" not found` });
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

  // Webhook requests are reachable only through a verified webhook, never this
  // public re-dispatch surface — retry's `inputOverride` would otherwise feed
  // the handler attacker-controlled input without a signature check. Return the
  // same not-found shape as a missing record so they're indistinguishable here.
  if (originalRecord.source === WEBHOOK_SOURCE) {
    return jsonResponse(404, { error: `Request "${route.requestId}" not found` });
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
            source: originalRecord.source,
            input: inputOverride,
            metadata: originalRecord.metadata,
            startedAt: originalRecord.startedAtMs,
            lastHeartbeatAt: Date.now()
          }
        : undefined,
      runtimeConfig: ctx.runtimeConfig
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

/**
 * Continue an interrupted request under its OWN id (FIX-811 crash recovery).
 *
 * Where `retry` re-dispatches a fresh request from scratch (a new id; see
 * FIX-637's resume-vs-retry contract), `continue` re-enters the SAME request:
 * completed blocks are injected from the durable item log and the in-flight
 * block re-runs, transitioning `interrupted → in_progress → terminal` in place.
 * The stale sweeper still only *marks* records `interrupted`; continuing is this
 * explicit, client-driven action.
 *
 * Mirrors the resume route's response shaping: streams over SSE when the client
 * asks for it, otherwise returns 202 with the same request id.
 */
export async function handleContinueRequest(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "continue_request" }>,
  ctx: ContinueRouteContext
): Promise<Response> {
  const originalRecord = await ctx.stores.request.get(route.requestId);
  if (originalRecord === undefined) {
    return jsonResponse(404, { error: `Request "${route.requestId}" not found` });
  }

  // A caller-supplied requestId must belong to the caller's own tenant (FIX-682) —
  // otherwise the bare sessionId check below is cosmetic and a same-session-id
  // collision across tenants lets one tenant continue another tenant's
  // interrupted request. Same not-found shape as a missing record.
  if (!tenantMatches(originalRecord.tenantId, ctx.tenantId)) {
    return jsonResponse(404, { error: `Request "${route.requestId}" not found` });
  }

  if (originalRecord.flowKind !== route.flowKind) {
    return jsonResponse(400, {
      error: `Flow kind mismatch: request belongs to "${originalRecord.flowKind}", not "${route.flowKind}"`
    });
  }

  // Webhook requests must not be re-entered from a public HTTP surface — see
  // `handleRetryRequest`. Treat as not found.
  if (originalRecord.source === WEBHOOK_SOURCE) {
    return jsonResponse(404, { error: `Request "${route.requestId}" not found` });
  }

  // A dynamic schedule's action core is produced at dispatch time by a
  // resolver and carried only on that original dispatch envelope — unlike a
  // static schedule, it cannot be re-resolved from `flow.schedules.static`
  // (see `resolve-action-core.ts`), so `continueRequest` has no core to
  // re-enter with. The DevTool already hides Continue for these records
  // (`request-separator.tsx`); reject here too so a direct API client can't
  // reach the same dead end.
  if (isDynamicScheduleRecord(originalRecord)) {
    return jsonResponse(409, {
      error: `Request "${route.requestId}" is a dynamic scheduled dispatch and cannot be continued — its action core is not persisted for recovery.`
    });
  }

  // The route is session-scoped; continuing mutates an existing record's
  // lifecycle, so the path's sessionId must match the record's — otherwise the
  // scoping is cosmetic and a caller could continue any request by id under any
  // session path.
  if (originalRecord.sessionId !== route.sessionId) {
    return jsonResponse(400, {
      error: `Session mismatch: request "${route.requestId}" does not belong to session "${route.sessionId}"`
    });
  }

  // Continue is for crash-interrupted requests only. A `suspended` record is
  // resolved through the resume endpoint (it carries a pending gate); terminal
  // and still-running records have nothing to continue.
  if (originalRecord.status !== "interrupted") {
    return jsonResponse(409, {
      error: `Request "${route.requestId}" has status "${originalRecord.status}" and cannot be continued (only "interrupted" requests continue; use /resume for "suspended", /retry for a fresh run)`
    });
  }

  // Exclusive-continuation lease, mirroring the resume route (resume-routes.ts):
  // two callers that both pass the status check above must not both re-enter and
  // re-run the in-flight block twice under the same id. The lease is released by
  // runAction at its terminal / re-suspension (the same path the resume lease
  // takes); only a setup failure before that needs the explicit release below.
  const lease = await ctx.stores.leases.acquire(route.requestId, {
    holder: generateId("continue"),
    durationMs: 60_000
  });
  if (lease === null) {
    return jsonResponse(409, {
      error: "Concurrent continuation in progress. Try again later."
    });
  }

  try {
    // Same-id re-entry with no resumeContext — replay injects completed blocks
    // and re-runs the in-flight one. `?include=trace` (mirroring the GET stream
    // route) opts the caller's inline SSE response into trace-channel items —
    // the DevTool's per-row Continue needs `block_trace`/`router_decision`/
    // `state_snapshot` from the resumed portion for its Trace tab.
    const includeTrace = new URL(request.url).searchParams.get("include") === "trace";
    const handle = await ctx.host.continueRequest({ requestId: route.requestId, includeTrace });

    const accept = request.headers.get("accept") ?? "";
    if (accept.includes("text/event-stream") && handle.liveStream !== null) {
      return new Response(handle.liveStream.readable, {
        status: 200,
        headers: {
          ...SSE_HEADERS,
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no",
          "x-request-id": handle.requestId
        }
      });
    }

    return jsonResponse(202, { requestId: route.requestId });
  } catch (error) {
    // Setup failed before the detached run took ownership of the lease release;
    // free it so a retry isn't blocked until the TTL.
    await ctx.stores.leases.release(route.requestId, lease.leaseId).catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(500, { error: message });
  }
}

export async function handleListActiveRequests(
  _request: Request,
  ctx: RecoveryRouteContext
): Promise<Response> {
  const all = await ctx.stores.activeRequests.listAll();
  // This listing spans every flow and user, so an authenticated caller sees
  // only their own in-flight requests — otherwise it enumerates other users'
  // request and session ids. Reached anonymously in a mixed app, it withholds
  // the entries of any flow that authenticates instead.
  const callerId = ctx.principal?.userId;
  const allowed = ctx.anonymousFlowKinds;
  const entries = all.filter((entry) => {
    if (callerId !== undefined) return entry.userId === callerId;
    return allowed === undefined || allowed.has(entry.flowKind);
  });
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

  // Reached anonymously in a mixed app, `ctx.anonymousFlowKinds` carries only
  // the flows that nothing authenticates, so the sweep leaves an authenticated
  // flow's in-flight requests untouched. Undefined means unrestricted.
  const swept = await detectInterruptedRequests({
    stores: ctx.stores,
    userId,
    staleThresholdMs,
    anonymousFlowKinds: ctx.anonymousFlowKinds,
    logger: ctx.runtimeConfig.logger
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
