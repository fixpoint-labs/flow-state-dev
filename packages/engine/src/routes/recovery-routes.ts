/**
 * HTTP route handlers for request recovery (retry + active request listing).
 */
import type { FlowRegistry } from "../registry/flow-registry";
import { ownsRecord, resolveRecordOwner } from "../context/record-owner";
import type { ActiveRequestEntry, StoreRegistry } from "../stores/types";
import type { InboundTransportHost, ResolvedPrincipal } from "../transports/types";
import {
  DEFAULT_DETECTION_STALE_THRESHOLD_MS,
  detectInterruptedRequests,
  retryRequest
} from "../execution/request-recovery";
import { jsonResponse, parseJsonBody, SSE_HEADERS } from "./route-utils";
import { generateId } from "../utils/generate-id";
import { tenantMatches } from "../stores/scope-keys";
import { isPublicReentryAllowed } from "./public-reentry";
import { SCHEDULED_SOURCE } from "../execution/transport-sources";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import type { RuntimeConfig } from "../runtime-config";
import { ownResolverVerdict, type InstanceCallerResolver } from "./instance-caller";

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
   * For an anonymous cross-flow listing in a mixed app: the flow instance ids
   * whose records may be listed without a principal. Undefined means
   * unrestricted. See `route-auth.ts`.
   */
  anonymousFlowIds?: Set<string>;
};

type ContinueRouteContext = RecoveryRouteContext & {
  host: InboundTransportHost;
};

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

  // The addressed instance must own the record. Retrying through another
  // instance — a same-kind peer included — cannot transfer the request.
  const retryFlow = ctx.registry.get(route.flowKind);
  if (retryFlow === undefined || !ownsRecord(retryFlow, originalRecord)) {
    return jsonResponse(400, {
      error: `Flow mismatch: request belongs to flow instance "${originalRecord.flowId ?? originalRecord.flowKind}", not "${route.flowKind}"`
    });
  }

  // Only a source that arrived on a caller-facing transport may be re-entered
  // here. This is an ALLOW-LIST (FIX-999): retry's `inputOverride` feeds the
  // handler caller-controlled input, so a source nobody thought to name must be
  // refused rather than admitted. Webhook stays refused for the original reason
  // — its handler is reachable only behind signature verification. Return the
  // same not-found shape as a missing record so they're indistinguishable here.
  if (!isPublicReentryAllowed(originalRecord.source, ctx.runtimeConfig.publicReentrySources)) {
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
            flowId: originalRecord.flowId,
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
        flowKind: originalRecord.flowKind,
        flowId: retryFlow.id,
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

  const continueFlow = ctx.registry.get(route.flowKind);
  if (continueFlow === undefined || !ownsRecord(continueFlow, originalRecord)) {
    return jsonResponse(400, {
      error: `Flow mismatch: request belongs to flow instance "${originalRecord.flowId ?? originalRecord.flowKind}", not "${route.flowKind}"`
    });
  }

  // Same allow-list as `handleRetryRequest` — see `public-reentry.ts`. Treat a
  // source that is not caller-facing as not found.
  if (!isPublicReentryAllowed(originalRecord.source, ctx.runtimeConfig.publicReentrySources)) {
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
  ctx: RecoveryRouteContext & {
    /**
     * The caller as each instance's own doors resolve it. An entry owned by
     * an instance with a resolver of its own is judged by that resolver, not
     * by `principal` or `anonymousFlowIds` (see `instance-caller.ts`).
     */
    callerFor: InstanceCallerResolver;
  }
): Promise<Response> {
  const all = await ctx.stores.activeRequests.listAll();
  // This listing spans every flow and user, so an authenticated caller sees
  // only their own in-flight requests — otherwise it enumerates other users'
  // request and session ids. Reached anonymously in a mixed app, it withholds
  // the entries of any instance that is not open instead.
  const callerId = ctx.principal?.userId;
  const callerOrgId = ctx.principal?.orgId;
  const allowed = ctx.anonymousFlowIds;
  const hostRuleAdmits = (entry: ActiveRequestEntry): boolean => {
    // Both axes, for the reason BR-8 gives on the addressed routes: one person
    // in two organizations passes the user check while looking at the other
    // organization's in-flight work. An entry with no organization at all is a
    // legacy row and is withheld here rather than attributed to the caller
    // (BR-14) — `entry.orgId === callerOrgId` does that by construction, since
    // an authenticated caller's org is never undefined.
    if (callerId !== undefined) {
      return entry.userId === callerId && entry.orgId === callerOrgId;
    }
    if (allowed === undefined) return true;
    // Each entry is judged under its own OWNER, not its kind: an open peer of
    // an authenticated instance must not make the latter's runs visible.
    const owner = resolveRecordOwner(ctx.registry, entry);
    return owner.ok && allowed.has(owner.flow.id);
  };
  // An entry owned by an instance with a resolver of its own is judged on that
  // resolver's word instead, the one its request routes take.
  //
  // Both verdicts judge the caller's identity, and one identity can hold rows
  // in several tenants, so the tenant is checked first and on its own
  // (FIX-682). `listAll` spans every tenant; nothing upstream narrows it.
  const entries: ActiveRequestEntry[] = [];
  for (const entry of all) {
    if (!tenantMatches(entry.tenantId, ctx.tenantId)) continue;
    const own = await ownResolverVerdict(ctx.registry, ctx.callerFor, entry);
    if (own ?? hostRuleAdmits(entry)) entries.push(entry);
  }
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
 * The framework runs `detectInterruptedRequests` itself in two places, under
 * **two independent controls** that are easy to read as one:
 *
 * - **Startup**, governed by `detectInterruptedOnStartup` alone —
 *   `createFlowState`'s `#detectInterruptedOnStartup`, which runs on every
 *   runtime init whether or not a router exists, plus the route handlers' own
 *   pass. Turning it off leaves periodic sweeping running exactly as before.
 * - **Periodic**, governed by `staleSweepIntervalMs` alone
 *   (`createStaleRequestSweeper`, built by `createFlowApiRouter`). At `<= 0`
 *   the factory returns a no-op handle and nothing sweeps on a timer, with
 *   startup detection unaffected. Default `30_000`.
 *
 * So "startup detection is off" does NOT mean nothing recovers — the usual
 * router deployment still sweeps every 30s — and a deployment is without
 * automatic detection only when it has disabled both.
 *
 * This endpoint covers what neither does: an answer *now* rather than at the
 * next tick, which is why the DevTool calls it on mount and on every
 * session-list refresh, and a router that has turned both controls off.
 *
 * Optional query: `staleThresholdMs`. The host's configured
 * `staleSweepThresholdMs` is both the default and the floor: a caller may widen
 * the heartbeat window past it, never tighten it. A value at or below the floor
 * (zero and negatives included) sweeps exactly as an unparameterised poke
 * does. A value that is not a number is a 400.
 *
 * Response: `{ interrupted: [{ requestId, sessionId, flowKind, actionName, interruptedAt }] }`,
 * limited to records that this call actually transitioned to `interrupted`.
 * Records whose status was already terminal (completed/failed/aborted) are
 * silently deregistered and excluded from the response.
 */
/**
 * Which entries this sweep may touch.
 *
 * The tenant is checked first and on its own (FIX-682), on every path. The
 * identity clauses below judge who the caller is, and one identity can hold
 * rows in several tenants, while `listStale` spans every tenant. Without it a
 * caller on one tenant who shares a user id with another tenant reads that
 * tenant's request and session ids and forces its live requests to
 * `interrupted`. Same rule `handleRetryRequest` / `handleContinueRequest`
 * apply to a single record: `tenantMatches`, so a caller with no tenant
 * reaches only rows with no tenant.
 *
 * The two identity clauses are mutually exclusive by construction:
 * `route-auth` hands back a principal or an anonymous flow allow-list, never
 * both. With neither, identity is unrestricted beyond the path's `userId`.
 *
 * The authenticated clause is the organization axis, and it matters more here
 * than on any read route. This route is user-addressed, so its `userId` comes
 * from the path and ownership is satisfied by one person belonging to two
 * organizations (BR-13) — and unlike every other management route, this one
 * MUTATES: it sweeps in-flight rows to `interrupted`. Without the org check a
 * caller acting for one organization takes down the other's running work.
 * `handleListActiveRequests` filters on the same pair for the read half.
 *
 * An entry with no organization is a legacy row and is left alone rather than
 * swept under a guess (BR-14) — `entry.orgId === callerOrgId` does that by
 * construction, since an authenticated caller's org is never undefined.
 */
function sweepAdmits(
  ctx: RecoveryRouteContext
): (entry: ActiveRequestEntry) => boolean {
  const callerOrgId = ctx.principal?.orgId;
  const allowed = ctx.anonymousFlowIds;
  return (entry) => {
    if (!tenantMatches(entry.tenantId, ctx.tenantId)) return false;
    if (callerOrgId !== undefined) return entry.orgId === callerOrgId;
    if (allowed === undefined) return true;
    const owner = resolveRecordOwner(ctx.registry, entry);
    return owner.ok && allowed.has(owner.flow.id);
  };
}

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
  const requestedThresholdMs =
    thresholdParam === null ? undefined : Number.parseInt(thresholdParam, 10);
  if (requestedThresholdMs !== undefined && !Number.isFinite(requestedThresholdMs)) {
    return jsonResponse(400, { error: "staleThresholdMs must be a number" });
  }

  // The HOST's resolved threshold is the floor, and the caller's value can only
  // raise it. Reaping on a tighter clock than the server's own sweeper marks
  // work `interrupted` that the deployment still considers healthy, and this
  // route is reachable by whoever can name a `userId` on an open flow: a
  // caller-chosen `0` would let a stranger interrupt another user's live runs.
  // A wider window is harmless, because it only spares entries the server would
  // have reaped. A value at or below the floor, zero and negatives included, is
  // held to the floor rather than refused: it asks for no more than the
  // server's own answer, which is what an unparameterised poke already gets.
  // With no host threshold at all (a direct `createFlowRouteHandlers` caller),
  // the floor is the sweep's own default.
  const hostThresholdMs =
    ctx.runtimeConfig.requestHost?.staleThresholdMs ?? DEFAULT_DETECTION_STALE_THRESHOLD_MS;
  const staleThresholdMs =
    requestedThresholdMs === undefined
      ? hostThresholdMs
      : Math.max(requestedThresholdMs, hostThresholdMs);

  // Reached anonymously in a mixed app, `ctx.anonymousFlowIds` carries only
  // the flows that nothing authenticates, so the sweep leaves an authenticated
  // flow's in-flight requests untouched. Undefined means unrestricted.
  const swept = await detectInterruptedRequests({
    stores: ctx.stores,
    userId,
    staleThresholdMs,
    // The host's configured grace, not the caller's: a client poking this
    // endpoint must not be able to reap a queued row the server's own sweeper
    // is still waiting on. Same rule as `staleThresholdMs` above, which the
    // caller can only widen.
    queuedGraceMs: ctx.runtimeConfig.queuedGraceMs,
    ownedBy: sweepAdmits(ctx),
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
