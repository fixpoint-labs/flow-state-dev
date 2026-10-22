/**
 * Dispatch + listing handlers for the scheduled transport. Order of
 * operations in `handleDispatch` is load-bearing: id check → flow →
 * body → gateway auth → static-then-dynamic resolve → dispatch-time
 * validation → overlap → effective principal → the scheduled time and
 * its claim → input → dispatch, acked once the host has accepted it.
 *
 * The claim is the one guarantee that a scheduled time fires at most once
 * (FIX-2085 D2): one stored record per schedule, its last fired time,
 * compare-and-set in the host's store, made after the schedule resolves
 * and before its handler runs. Every cron path POSTs here, so no index or
 * worker keeps a check of its own; an index's claim only finds due rows.
 * A fire that is not admitted gives its time back, unless a later time was
 * claimed in between. A body `idempotencyKey` is refused with 400.
 */
import {
  ConcurrencyRejectedError,
  PrincipalResolutionError,
  resolveUserStorageKey,
  type InboundRequestEnvelope,
  type InboundTransportHost,
  type ResolvedPrincipal
} from "@flow-state-dev/engine";
import {
  validateScheduleConfig,
  type ScheduleConfig,
  type ScheduleResolutionStores,
  type SchedulesConfig
} from "@flow-state-dev/core/types";
import { SCHEDULED_TRANSPORT_SOURCE } from "./createScheduledTransportAdapter";
import { findScheduledRequest } from "./findScheduledRequest";
import { claimScheduledTime, firedRecordAddress, scheduledTimeOf } from "./scheduledTime";

// Wider than the static-id pattern in core. A dynamic id is
// `<orgId>/<userId>/<key>` with each part URL-encoded (`formatScheduleId`),
// so after the router's one decode it holds `encodeURIComponent`'s output
// alphabet, `%` included, plus the `/` separators and the `:` a hand-built id
// may carry. That admits every org id `isValidOrgId` admits — uppercase, `.`,
// `/`, `DEFAULT_ORG_ID`'s underscores. No length cap: org, user and key ids
// have none, so a fixed one here would refuse a valid long id and its
// schedule would never fire.
const DYNAMIC_SCHEDULE_ID_RE = /^[A-Za-z0-9\-_.!~*'()%:/]+$/;

interface DispatchBody {
  nominalFireTime?: string;
  /** Set when the caller sent the removed key: refused, never read. */
  idempotencyKey?: unknown;
}

export async function handleDispatch(
  req: Request,
  ctx: { params: Record<string, string> },
  host: InboundTransportHost
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

  // Auth before anything reads the fire record, so an unauthenticated caller
  // can't probe dispatch history via the duplicate-vs-401 response oracle.
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

  // Refused, not ignored (BP-030): a host that relied on its own key learns
  // at upgrade that the scheduled time is the key now.
  if (body.idempotencyKey !== undefined) {
    return jsonResponse(400, {
      error: "idempotency_key_removed",
      message:
        "The dispatch body no longer takes `idempotencyKey`: each scheduled time fires at most once, " +
        "recorded in the host's store. Send `nominalFireTime`, or nothing for the latest scheduled time already due."
    });
  }

  // The cell a collection that isolates nothing keeps a user's rows in,
  // derived the way every other user-scoped read derives it. One derivation
  // for the resolver's read and the fired record, so the record sits beside
  // the row it guards.
  const userStorageKey = (userId: string, orgId: string) =>
    resolveUserStorageKey(userId, orgId, { id: flowKind, isolateUserState: false });

  const schedules = (flow as { schedules?: SchedulesConfig }).schedules;
  let schedule: ScheduleConfig | null = schedules?.static?.[scheduleId] ?? null;
  let origin: "static" | "dynamic" = "static";

  if (!schedule && schedules?.resolve) {
    try {
      const resolved = await schedules.resolve(scheduleId, {
        flowKind,
        gatewayPrincipal,
        request: req,
        stores: host.stores as ScheduleResolutionStores,
        userStorageKey,
        // The registered instance's pin, so a hired worker resolves only
        // schedules in its own org, and a private one only its user's. From
        // the registry, never the request.
        ownerPin: flow.ownerPin
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
  // scheduled-time claim below catches two fires of one time.
  if (schedule.onOverlap !== "allow") {
    const inFlight = await findScheduledRequest(
      host.stores.activeRequests,
      flow.id,
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
  //
  // The organization falls back separately from the user (FIX-1442), and the
  // two schedule kinds land on different sides of that on purpose:
  //
  //  - A STATIC schedule's principal is written in the flow definition. It is
  //    the author's own trusted config, so naming a target user while leaving
  //    the organization to the gateway that fires it is a complete statement,
  //    not an omission.
  //  - A DYNAMIC schedule's principal comes from stored data, and
  //    `createResourceCollectionScheduleResolver` refuses to build one without
  //    the organization the row was created under. So it never reaches this
  //    fallback — which is the point of BR-19: a stored schedule must not pick
  //    up whichever organization happens to be firing the beat.
  const effectivePrincipal: ResolvedPrincipal =
    schedule.principal === undefined
      ? gatewayPrincipal
      : {
          ...schedule.principal,
          orgId: schedule.principal.orgId ?? gatewayPrincipal.orgId
        };

  // The scheduled time this fire counts against, claimed once in the store.
  const timezone = schedule.timezone ?? "UTC";
  const time = scheduledTimeOf(schedule.cron, timezone, body.nominalFireTime, Date.now());
  if (!time.ok) {
    return jsonResponse(400, { error: time.error, message: time.message });
  }
  const nominalFireTime = new Date(time.at).toISOString();
  // More than one period behind the latest due time: a fixed time in the
  // scheduler's body, or a host that stalled. Nothing runs, and the host's
  // log says why, so a schedule that stopped firing can be found.
  if (time.stale) {
    // eslint-disable-next-line no-console
    console.warn(
      `[flow-state/scheduled] ${flowKind} schedule ${scheduleId}: nominalFireTime ${body.nominalFireTime} is more than one ` +
        `period behind its latest due time, so nothing runs. A scheduler that sends a fixed time should send no body.`
    );
    return jsonResponse(200, { status: "duplicate", reason: "stale", scheduleId, nominalFireTime });
  }
  const claim = await claimScheduledTime(
    host.stores.resourceState,
    firedRecordAddress(flowKind, scheduleId, effectivePrincipal, userStorageKey),
    { at: time.at }
  );
  if (claim.outcome === "duplicate") {
    return jsonResponse(200, { status: "duplicate", scheduleId, nominalFireTime });
  }
  // Not admitted: nothing ran, so the time is given back and a retry of it
  // still runs.
  const notAdmitted = async (status: number, payload: unknown): Promise<Response> => {
    await claim.release();
    return jsonResponse(status, payload);
  };

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
    return notAdmitted(500, {
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
        timezone
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
    // Concurrency `reject` (only reachable when a flow's default policy keys on
    // something a scheduled dispatch carries, e.g. `user` — scheduled envelopes
    // have no session): a competing run holds the key. Ack 200 skipped, the same
    // shape as the schedule's own overlap skip, so the caller does not retry.
    if (err instanceof ConcurrencyRejectedError) {
      return notAdmitted(200, {
        status: "skipped",
        reason: "in_flight",
        requestId: err.inFlightRequestId
      });
    }
    return notAdmitted(503, {
      error: "flow_unregistered",
      message: err instanceof Error ? err.message : String(err)
    });
  }

  // A `reject` refusal arrives here, through `accepted`. The fire was not
  // admitted, so its time is given back: a retry of it must still run.
  try {
    await handle.accepted;
  } catch (err) {
    if (err instanceof ConcurrencyRejectedError) {
      return notAdmitted(200, {
        status: "skipped",
        reason: "in_flight",
        requestId: err.inFlightRequestId
      });
    }
    return notAdmitted(503, {
      error: "dispatch_failed",
      message: err instanceof Error ? err.message : String(err)
    });
  }

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
    if (parsed.idempotencyKey !== undefined) {
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
