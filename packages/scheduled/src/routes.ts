/**
 * Dispatch + listing handlers for the scheduled transport. Order of
 * operations in `handleDispatch` is load-bearing: id check → flow →
 * body → idempotency → gateway auth → static-then-dynamic resolve →
 * dispatch-time validation → overlap → effective principal → input →
 * fire-and-forget dispatch.
 */
import {
  PrincipalResolutionError,
  type InboundRequestEnvelope,
  type InboundTransportHost,
  type ResolvedPrincipal
} from "@flow-state-dev/server";
import {
  validateScheduleConfig,
  type ScheduleConfig,
  type ScheduleResolutionStores,
  type SchedulesConfig
} from "@flow-state-dev/core/types";
import { SCHEDULED_TRANSPORT_SOURCE } from "./createScheduledTransportAdapter";
import { findScheduledRequest } from "./findScheduledRequest";
import type { IdempotencyCache } from "./idempotency";

// Wider than the static-id pattern in core: dynamic ids can carry `/`
// and `:` so composite keys like `user/abc/weekly-digest` round-trip.
// URL-encoded segments are not supported in v1.
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

  if (!DYNAMIC_SCHEDULE_ID_RE.test(scheduleId)) {
    return jsonResponse(400, { error: "invalid_schedule_id" });
  }

  const flow = host.registry.get(flowKind);
  if (!flow) {
    return jsonResponse(404, { error: "flow_not_found" });
  }

  const rawBody = new Uint8Array(await req.arrayBuffer());
  const body = parseDispatchBody(rawBody);

  // Auth before idempotency so an unauthenticated caller can't probe
  // dispatch history via the duplicate-vs-401 response oracle.
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

  const dedupeKey = body.idempotencyKey ?? `${scheduleId}:${body.nominalFireTime ?? ""}`;
  if (idempotency.seen(flowKind, dedupeKey)) {
    return jsonResponse(200, { status: "duplicate", scheduleId });
  }

  const schedules = (flow as { schedules?: SchedulesConfig }).schedules;
  let schedule: ScheduleConfig | null = schedules?.static?.[scheduleId] ?? null;
  let origin: "static" | "dynamic" = "static";

  if (!schedule && schedules?.resolve) {
    try {
      const resolved = await schedules.resolve(scheduleId, {
        flowKind,
        gatewayPrincipal,
        request: req,
        stores: host.stores as ScheduleResolutionStores
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

  try {
    validateScheduleConfig({
      kind: flowKind,
      id: scheduleId,
      schedule,
      origin
    });
  } catch (err) {
    return jsonResponse(400, {
      error: "invalid_schedule",
      message: err instanceof Error ? err.message : String(err)
    });
  }

  // Best-effort overlap skip — TOCTOU race is documented; two near-
  // simultaneous ticks may both pass before either calls dispatch. The
  // idempotency cache catches the duplicate when nominalFireTime matches.
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

  // schedule.principal is the action's *target*; gateway is the *caller*.
  // Static framework cron jobs typically rely on the gateway fallback;
  // dynamic schedules almost always carry an explicit principal.
  const effectivePrincipal: ResolvedPrincipal = schedule.principal ?? gatewayPrincipal;

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

  const envelope: InboundRequestEnvelope = {
    source: SCHEDULED_TRANSPORT_SOURCE,
    flowKind,
    // Provenance only — the runtime resolves the inline handler from
    // `flow.schedules.static[scheduleId]` via the metadata coordinate (static)
    // or from the carried core below (dynamic), never this name.
    action: schedule.block.name,
    input,
    principal: effectivePrincipal,
    metadata: {
      schedule: {
        scheduleId,
        origin,
        cron: schedule.cron,
        nominalFireTime,
        dispatchedAt: new Date().toISOString(),
        timezone: schedule.timezone ?? "UTC"
      }
    },
    // A dynamic schedule's core is produced by the resolver at dispatch time
    // and is not reachable from any static coordinate, so carry it inline for
    // the runtime to run directly. Static schedules resolve by their
    // `metadata.schedule.scheduleId` coordinate and recover across crashes;
    // dynamic schedules carry the core and do not recover (documented non-goal).
    ...(origin === "dynamic" ? { resolvedActionCore: schedule } : {}),
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
  /** Handler block name — provenance for the listing, not a resolver key. */
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
  // strings and descriptions are operationally sensitive.
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
        action: schedule.block.name,
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
