// FIX-2752; FIX-2536.
/**
 * The schedule tick: the one place an app's schedules are fired from.
 *
 * One tick fires every schedule of every registered flow:
 *
 * - **Static** (`schedules.static`): each enabled schedule whose latest
 *   scheduled time, in its time zone, falls after the last tick and at or
 *   before now.
 * - **Dynamic** (`schedules.index`): `claimDue` on each flow's index, one index
 *   once (its entries name no flow, so it serves the first flow that names it).
 *   Each entry is fired for its latest due time from the cron and zone it
 *   carries, not the first time it missed.
 *
 * So after downtime each schedule fires once, late, for the latest time it
 * missed; earlier missed times are dropped (no burst after an outage).
 *
 * "The last tick" is one record in the app's resource state, written only
 * here; with none, a first tick counts from one interval ago, so a schedule
 * added today never fires a time long past on deploy.
 *
 * Each fire is a POST to the scheduled transport's dispatch endpoint
 * (`<base>/api/flows/<kind>/schedules/<id>/dispatch`, its body naming the
 * scheduled time). The endpoint's once-per-scheduled-time record is the
 * guarantee; this only finds what is due. A dispatch that fails is dropped,
 * not retried: at-most-once is the scheduled-actions contract.
 */
import type { FlowInstance, ScheduleDueSource } from "@flow-state-dev/core/types";
import { formatScheduleId } from "@flow-state-dev/core/types";
import { latestScheduledTime } from "@flow-state-dev/core/internal";
import type { ResourceStateStore } from "../stores/types";
import { DEFAULT_RUNTIME_LOGGER, logRuntimeEvent, type RuntimeLogger } from "./logging";

/** How often the local cron ticks, and how far back a first tick looks: a minute, the finest cadence a cron names. */
export const SCHEDULE_TICK_INTERVAL_MS = 60_000;

/**
 * Where the last-tick record is kept: an org cell no organization is given
 * (the id is the engine's own), under one key.
 */
const LAST_TICK_SCOPE_ID = "__fsd_system__";
const LAST_TICK_KEY = "schedule-tick/last";

/**
 * Where the router mounts its built-in scheduled endpoint: the framework's own
 * namespace. The endpoint registers its routes under it and the tick sends to
 * it, so the two can't drift apart.
 */
export const DISPATCH_BASE_PATH = "/api/flows";

/** One fire the tick sends: which schedule of which flow, for which scheduled time. */
export type ScheduleDispatch = {
  /** The flow instance the schedule is dispatched on (its `id`). */
  readonly flowKind: string;
  /** The schedule's dispatch id: a static schedule's name, or a dynamic one's `<orgId>/<userId>/<key>`. */
  readonly scheduleId: string;
  /** The scheduled time it fires for, ms since epoch. */
  readonly nominalFireTime: number;
  readonly origin: "static" | "dynamic";
};

/** What one tick did: each fire it sent and the endpoint's answer (`0` when the dispatch threw). */
export type ScheduleTickReport = {
  readonly dispatched: ReadonlyArray<ScheduleDispatch & { readonly status: number }>;
};

/** What {@link runScheduleTick} is run with. */
export interface RunScheduleTickOptions {
  /** The registered flows. */
  readonly flows: readonly FlowInstance[];
  /** Where the last-tick record lives. */
  readonly resourceState: ResourceStateStore;
  /** Send one fire; resolve to the endpoint's HTTP status. */
  readonly dispatch: (fire: ScheduleDispatch) => Promise<number>;
  /** The time due schedules are found against. Default `Date.now()`. */
  readonly now?: number;
  /** How far back a first tick looks. Default {@link SCHEDULE_TICK_INTERVAL_MS}. */
  readonly intervalMs?: number;
  /** The most entries claimed per index per tick. Default `100`. */
  readonly maxPerTick?: number;
  /** The most dispatches in flight at once. Default `10`. */
  readonly concurrency?: number;
  /** Stop dispatching: checked before the claims and before each dispatch. A dispatch already sent finishes. */
  readonly signal?: AbortSignal;
  readonly logger?: RuntimeLogger;
}

/**
 * Find what is due and fire each, with bounded concurrency. Throws only when an
 * index's claim does (after firing everything else), so a per-beat caller can
 * answer 500 and its cron retry with those schedules still pending.
 */
export async function runScheduleTick(options: RunScheduleTickOptions): Promise<ScheduleTickReport> {
  const logger = options.logger ?? DEFAULT_RUNTIME_LOGGER;
  if (options.signal?.aborted === true) return { dispatched: [] };
  const now = options.now ?? Date.now();
  const last = (await readLastTick(options.resourceState)) ?? now - (options.intervalMs ?? SCHEDULE_TICK_INTERVAL_MS);

  const fires: ScheduleDispatch[] = [];
  const indexes: Array<{ flowKind: string; index: ScheduleDueSource }> = [];
  const seen = new Set<ScheduleDueSource>();
  for (const flow of options.flows) {
    const schedules = flow.schedules;
    if (schedules === undefined) continue;
    for (const [scheduleId, schedule] of Object.entries(schedules.static ?? {})) {
      if (schedule.enabled === false) continue;
      const at = latestScheduledTime(schedule.cron, schedule.timezone ?? "UTC", now);
      if (at !== null && at > last) fires.push({ flowKind: flow.id, scheduleId, nominalFireTime: at, origin: "static" });
    }
    if (schedules.index !== undefined && !seen.has(schedules.index)) {
      seen.add(schedules.index);
      indexes.push({ flowKind: flow.id, index: schedules.index });
    }
  }

  // Each claim gets half a beat: one index whose store stopped answering must
  // not hold back every other schedule's fire (it counts as a failed claim).
  const claimWaitMs = (options.intervalMs ?? SCHEDULE_TICK_INTERVAL_MS) / 2;
  const claims = await Promise.allSettled(
    indexes.map(({ flowKind, index }) =>
      withinMs(index.claimDue(now, options.maxPerTick ?? 100), claimWaitMs, flowKind, "claim", (entries) => {
        // Answered after the tick moved on: the store advanced these, and none of them fires.
        if (entries.length === 0) return;
        logRuntimeEvent(logger, "error", `[flow-state] schedules claimed too late and not fired: ${flowKind}`, {
          flowKind,
          scheduleIds: entries.map((entry) => formatScheduleId(entry.orgId ?? "", entry.userId, entry.key))
        });
      })
    )
  );
  let claimError: unknown;
  claims.forEach((claim, i) => {
    if (claim.status === "rejected") {
      claimError ??= claim.reason;
      return;
    }
    const flowKind = indexes[i]!.flowKind;
    for (const entry of claim.value) {
      // A schedule with no org names no cell to fire from; the endpoint would refuse it.
      if (entry.orgId === undefined) {
        logRuntimeEvent(logger, "error", `[flow-state] schedule not dispatched: ${entry.userId}/${entry.key} has no organization`, { flowKind });
        continue;
      }
      fires.push({
        flowKind,
        scheduleId: formatScheduleId(entry.orgId, entry.userId, entry.key),
        nominalFireTime: latestScheduledTime(entry.cron, entry.timezone ?? "UTC", now) ?? entry.nextFireAt,
        origin: "dynamic"
      });
    }
  });

  // Written before the fires go out: a tick that dies part way leaves its times
  // claimed, not owed twice. The endpoint's record backs a write that failed.
  await writeLastTick(options.resourceState, now).catch((err) => {
    logRuntimeEvent(logger, "error", "[flow-state] schedule tick: the last-tick record was not written", {
      error: err instanceof Error ? err.message : String(err)
    });
  });

  const dispatched: Array<ScheduleDispatch & { status: number }> = [];
  await runWithConcurrency(fires, Math.max(1, options.concurrency ?? 10), async (fire) => {
    if (options.signal?.aborted === true) return;
    let status = 0;
    try {
      // A beat at most: an endpoint whose resolver or store stopped answering
      // must not keep the tick from settling (the local cron skips beats until it does).
      status = await withinMs(options.dispatch(fire), claimWaitMs * 2, `${fire.flowKind}/${fire.scheduleId}`, "fire");
      // 2xx is fired or queued; 200 also answers a duplicate. Anything else was not run, and is not retried.
      if (status < 200 || status >= 300) {
        logRuntimeEvent(logger, "error", `[flow-state] schedule not fired: ${fire.flowKind}/${fire.scheduleId} answered ${status}`, {
          flowKind: fire.flowKind,
          scheduleId: fire.scheduleId,
          status
        });
      }
    } catch (err) {
      logRuntimeEvent(logger, "error", `[flow-state] schedule dispatch failed for ${fire.flowKind}/${fire.scheduleId}`, {
        error: err instanceof Error ? err.message : String(err)
      });
    }
    dispatched.push({ ...fire, status });
  });
  if (claimError !== undefined) throw claimError;
  return { dispatched };
}

/**
 * The dispatch endpoint's request for one fire:
 * `POST <base>/api/flows/<kind>/schedules/<id>/dispatch` (the router's built-in
 * scheduled endpoint), its body naming the
 * scheduled time, with the bearer secret when there is one.
 */
export function scheduleDispatchRequest(options: {
  readonly baseUrl: string;
  readonly fire: ScheduleDispatch;
  readonly secret?: string;
}): { url: string; path: string[]; init: { method: "POST"; headers: Record<string, string>; body: string } } {
  const base = options.baseUrl.endsWith("/") ? options.baseUrl.slice(0, -1) : options.baseUrl;
  const { flowKind, scheduleId, nominalFireTime } = options.fire;
  return {
    url: `${base}${DISPATCH_BASE_PATH}/${encodeURIComponent(flowKind)}/schedules/${encodeURIComponent(scheduleId)}/dispatch`,
    // The router's view of the same path: each segment decoded once.
    path: [flowKind, "schedules", scheduleId, "dispatch"],
    init: {
      method: "POST",
      headers: {
        ...(options.secret === undefined || options.secret.length === 0 ? {} : { Authorization: `Bearer ${options.secret}` }),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ nominalFireTime: new Date(nominalFireTime).toISOString() })
    }
  };
}

/** Whether a flow declares schedules a tick fires: a static one, or an index. */
export function declaresTickedSchedules(flow: FlowInstance): boolean {
  const schedules = flow.schedules;
  return schedules !== undefined && (Object.keys(schedules.static ?? {}).length > 0 || schedules.index !== undefined);
}

async function readLastTick(resourceState: ResourceStateStore): Promise<number | undefined> {
  const stored = await resourceState.get("org", LAST_TICK_SCOPE_ID, LAST_TICK_KEY);
  const at = (stored?.state as { at?: unknown } | undefined)?.at;
  return typeof at === "number" && Number.isFinite(at) ? at : undefined;
}

async function writeLastTick(resourceState: ResourceStateStore, at: number): Promise<void> {
  // Unconditional: the tick is the record's only writer.
  await resourceState.set("org", LAST_TICK_SCOPE_ID, LAST_TICK_KEY, { at }, "any");
}

/**
 * `promise`, or a rejection naming what was waited on once `ms` pass without an
 * answer. `onLate` gets an answer that arrives after that.
 */
function withinMs<T>(
  promise: Promise<T>,
  ms: number,
  subject: string,
  what: "claim" | "fire",
  onLate?: (value: T) => void
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`schedule tick: ${what} for "${subject}" did not answer within ${ms} ms`));
    }, ms);
  });
  if (onLate !== undefined) {
    promise.then((value) => (timedOut ? onLate(value) : undefined), () => undefined);
  }
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Run `task` over `items`, at most `concurrency` at once. The task catches its own failures. */

async function runWithConcurrency<T>(items: readonly T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i += 1) {
    workers.push(
      (async () => {
        for (;;) {
          const idx = cursor++;
          if (idx >= items.length) return;
          await task(items[idx]!);
        }
      })()
    );
  }
  await Promise.allSettled(workers);
}
