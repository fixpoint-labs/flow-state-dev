/**
 * Dispatch + listing route handlers for the scheduled transport.
 *
 * `handleDispatch` orchestrates the full per-tick lifecycle:
 *   schedule-id format check → flow lookup → body parse →
 *   idempotency dedupe → gateway auth → static-then-dynamic resolution →
 *   dispatch-time validation → overlap check → effective principal →
 *   input resolution → fire-and-forget `host.dispatch`.
 *
 * `handleList` exposes static schedules plus a `dynamic.provided` flag
 * so operators can confirm a flow has scheduled-action wiring without
 * exposing per-user/dynamic data.
 */
import {
  PrincipalResolutionError,
  type InboundRequestEnvelope,
  type InboundTransportHost,
  type ResolvedPrincipal
} from "@flow-state-dev/server";
import {
  validateScheduleConfig,
  type ActionConfig,
  type ScheduleConfig,
  type SchedulesConfig
} from "@flow-state-dev/core/types";
import { SCHEDULED_TRANSPORT_SOURCE } from "./createScheduledTransportAdapter";
import { findScheduledRequest } from "./findScheduledRequest";
import type { IdempotencyCache } from "./idempotency";

/**
 * URL-encoded path segments are not supported in v1 — schedule ids are
 * required to be drawn from a simple URL-safe character set. The pattern
 * is wider than the static-id pattern in core (which forbids `/` and
 * `:`) so dynamic ids like `user/abc/weekly-digest` and
 * `agent-followup:lead-456` round-trip cleanly.
 */
const DYNAMIC_SCHEDULE_ID_RE = /^[a-z0-9][a-z0-9:/_-]{0,127}$/;

interface DispatchBody {
  nominalFireTime?: string;
  idempotencyKey?: string;
}

export async function handleDispatch(
  req: Request,
  ctx: { params: Record<string, string> },
  host: InboundTransportHost,
  idempotency: IdempotencyCache
): Promise<Response> {
  const flowKind = ctx.params.flowKind ?? "";
  const scheduleId = ctx.params.scheduleId ?? "";

  // 1. Validate the schedule id against the URL pattern. Cheap; happens
  //    before any I/O.
  if (!DYNAMIC_SCHEDULE_ID_RE.test(scheduleId)) {
    return jsonResponse(400, { error: "invalid_schedule_id" });
  }

  // 2. Resolve flow.
  const flow = host.registry.get(flowKind);
  if (!flow) {
    return jsonResponse(404, { error: "flow_not_found" });
  }

  // 3. Parse body (small, optional). Preserved as rawBody for resolvers
  //    that want to verify a body signature.
  const rawBody = new Uint8Array(await req.arrayBuffer());
  const body = parseDispatchBody(rawBody);

  // 4. Idempotency dedupe — short-circuits before any work.
  const dedupeKey = body.idempotencyKey ?? `${scheduleId}:${body.nominalFireTime ?? ""}`;
  if (idempotency.seen(flowKind, dedupeKey)) {
    return jsonResponse(200, { status: "duplicate", scheduleId });
  }

  // 5. Gateway auth: prove the dispatch caller is the trusted scheduler.
  //    For static schedules, this is the *only* auth. For dynamic
  //    schedules, this happens before the resolver runs so resolvers can
  //    trust they're being called by the framework gateway.
  let gatewayPrincipal: ResolvedPrincipal;
  try {
    gatewayPrincipal = await host.resolvePrincipal({
      source: SCHEDULED_TRANSPORT_SOURCE,
      request: req,
      envelope: {
        flowKind,
        action: "<unresolved>",
        sessionId: undefined,
        metadata: {
          scheduleId,
          nominalFireTime: body.nominalFireTime,
          phase: "gateway"
        },
        input: undefined
      },
      rawBody
    });
  } catch (err) {
    if (err instanceof PrincipalResolutionError) {
      return jsonResponse(err.status, {
        error: "unauthorized",
        message: err.message
      });
    }
    throw err;
  }

  // 6. Resolve schedule. Static lookup first, then dynamic resolver.
  const schedules = (flow as { schedules?: SchedulesConfig }).schedules;
  let schedule: ScheduleConfig | null = schedules?.static?.[scheduleId] ?? null;
  let origin: "static" | "dynamic" = "static";

  if (!schedule && schedules?.resolve) {
    try {
      const resolved = await schedules.resolve(scheduleId, {
        flowKind,
        gatewayPrincipal,
        request: req,
        // Pass the host's full StoreRegistry; the type narrows it to
        // `ScheduleResolutionStores` in the resolver signature.
        stores: host.stores as unknown as Parameters<NonNullable<SchedulesConfig["resolve"]>>[1]["stores"]
      });
      schedule = resolved ?? null;
      origin = "dynamic";
    } catch (err) {
      return jsonResponse(500, {
        error: "resolver_failed",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }

  if (!schedule || schedule.enabled === false) {
    return jsonResponse(404, { error: "schedule_not_found" });
  }

  // 7. Validate the (possibly dynamic) schedule. Static was already
  //    validated at registration; dynamic gets validated here.
  try {
    validateScheduleConfig({
      kind: flowKind,
      id: scheduleId,
      schedule,
      actions: (flow as { actions: Record<string, ActionConfig> }).actions,
      origin
    });
  } catch (err) {
    return jsonResponse(400, {
      error: "invalid_schedule",
      message: err instanceof Error ? err.message : String(err)
    });
  }

  // 8. Overlap policy: short-circuit if a request is already in flight
  //    for this schedule id. Best-effort — TOCTOU race documented.
  if (schedule.onOverlap !== "allow") {
    const inFlight = await findScheduledRequest(
      host.stores.activeRequests,
      flowKind,
      scheduleId
    );
    if (inFlight) {
      return jsonResponse(200, {
        status: "skipped",
        reason: "in_flight",
        requestId: inFlight.requestId
      });
    }
  }

  // 9. Effective principal: schedule.principal (the *target*) wins over
  //    the gateway principal (the *caller*). For static framework-level
  //    schedules without `schedule.principal`, fall back to the gateway.
  const effectivePrincipal: ResolvedPrincipal = schedule.principal ?? gatewayPrincipal;

  // 10. Resolve input.
  const nominalFireTime = body.nominalFireTime ?? new Date().toISOString();
  let input: unknown;
  try {
    input =
      typeof schedule.input === "function"
        ? await schedule.input({
            scheduleId,
            cron: schedule.cron,
            nominalFireTime,
            principal: effectivePrincipal,
            flowKind,
            origin
          })
        : (schedule.input ?? {});
  } catch (err) {
    return jsonResponse(500, {
      error: "dispatch_failed",
      message: err instanceof Error ? err.message : String(err)
    });
  }

  // 11. Build envelope and dispatch fire-and-forget.
  const envelope: InboundRequestEnvelope = {
    source: SCHEDULED_TRANSPORT_SOURCE,
    flowKind,
    action: schedule.action,
    input,
    principal: effectivePrincipal,
    metadata: {
      scheduleId,
      origin,
      cron: schedule.cron,
      nominalFireTime,
      dispatchedAt: new Date().toISOString(),
      timezone: schedule.timezone ?? "UTC"
    },
    responseEmitter: null
  };

  let handle;
  try {
    handle = host.dispatch(envelope);
  } catch (err) {
    return jsonResponse(503, {
      error: "flow_unregistered",
      message: err instanceof Error ? err.message : String(err)
    });
  }

  idempotency.record(flowKind, dedupeKey);

  return jsonResponse(202, {
    status: "accepted",
    scheduleId,
    origin,
    requestId: handle.requestId
  });
}

interface ListedStaticSchedule {
  id: string;
  cron: string;
  action: string;
  timezone: string;
  description?: string;
  enabled: boolean;
}

interface ListResponseBody {
  static: ListedStaticSchedule[];
  dynamic: { provided: boolean };
}

export async function handleList(
  req: Request,
  ctx: { params: Record<string, string> },
  host: InboundTransportHost
): Promise<Response> {
  const flowKind = ctx.params.flowKind ?? "";
  const flow = host.registry.get(flowKind);
  if (!flow) {
    return jsonResponse(404, { error: "flow_not_found" });
  }

  // Listing runs through the same principal resolver as dispatch — cron
  // strings and descriptions are operationally sensitive (Q7).
  try {
    await host.resolvePrincipal({
      source: SCHEDULED_TRANSPORT_SOURCE,
      request: req,
      envelope: {
        flowKind,
        action: "<list>",
        sessionId: undefined,
        metadata: { phase: "list" },
        input: undefined
      },
      rawBody: new Uint8Array(0)
    });
  } catch (err) {
    if (err instanceof PrincipalResolutionError) {
      return jsonResponse(err.status, {
        error: "unauthorized",
        message: err.message
      });
    }
    throw err;
  }

  const schedules = (flow as { schedules?: SchedulesConfig }).schedules;
  const staticEntries: ListedStaticSchedule[] = [];
  if (schedules?.static) {
    for (const [id, schedule] of Object.entries(schedules.static)) {
      staticEntries.push({
        id,
        cron: schedule.cron,
        action: schedule.action,
        timezone: schedule.timezone ?? "UTC",
        description: schedule.description,
        enabled: schedule.enabled !== false
      });
    }
  }

  const body: ListResponseBody = {
    static: staticEntries,
    dynamic: { provided: typeof schedules?.resolve === "function" }
  };

  return jsonResponse(200, body);
}

function parseDispatchBody(raw: Uint8Array): DispatchBody {
  if (raw.byteLength === 0) return {};
  try {
    const text = new TextDecoder().decode(raw);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const body: DispatchBody = {};
    if (typeof parsed.nominalFireTime === "string") {
      body.nominalFireTime = parsed.nominalFireTime;
    }
    if (typeof parsed.idempotencyKey === "string") {
      body.idempotencyKey = parsed.idempotencyKey;
    }
    return body;
  } catch {
    return {};
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
