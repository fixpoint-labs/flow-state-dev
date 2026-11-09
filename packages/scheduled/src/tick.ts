// FIX-2536; epic FIX-2471 D10.
/**
 * The schedule tick: claim the schedules a schedule index holds due and dispatch
 * each, with bounded concurrency. One body, run two ways:
 *
 * - **Per beat** ({@link runScheduleTick}): a host's own cron calls it once a
 *   beat (`@flow-state-dev/vercel/schedules`' `createScheduleTickHandler`).
 * - **On an interval** ({@link startScheduleTick}): a long-lived host runs it
 *   each minute (`@flow-state-dev/node`'s `serve()`, and so `fsdev dev`), like
 *   the engine's stale-request sweeper.
 *
 * `claimDue` advances each entry as it returns it, so an entry fires once per
 * scheduled time however many hosts tick (the dispatch endpoint's claim is the
 * guarantee; the index only finds due entries). A dispatch that fails is
 * dropped, not retried: at-most-once is the scheduled-actions contract.
 *
 * Engine-free: the caller supplies `dispatch`, which turns a due entry and its
 * dispatch id into an HTTP status.
 */
import type { ScheduleDueEntry } from "@flow-state-dev/core/types";
import { formatScheduleId } from "./createResourceCollectionScheduleResolver";

/** What one tick is run with. */
export interface RunScheduleTickOptions<TEntry extends ScheduleDueEntry = ScheduleDueEntry> {
  /** The index to claim due entries from. */
  readonly index: { claimDue(now: number, limit?: number): Promise<readonly TEntry[]> };
  /** Dispatch one due entry under its dispatch id (`<orgId>/<userId>/<key>`); resolve to the HTTP status, `0` when it threw. */
  readonly dispatch: (entry: TEntry, scheduleId: string) => Promise<number>;
  /** The time due entries are claimed against. Default `Date.now()`. */
  readonly now?: number;
  /** The most schedules claimed per tick. Default `100`. */
  readonly maxPerTick?: number;
  /** The most dispatches in flight at once. Default `10`. */
  readonly concurrency?: number;
  /** Observe each dispatch: the schedule and its status (`0` when it threw, or the schedule names no org). Never throws back. */
  readonly onDispatch?: (entry: TEntry, status: number) => void;
}

/**
 * Claim the due entries and dispatch each. Resolves to the entries claimed. Throws
 * only when the claim does, so a per-beat caller can answer 500 and its cron
 * retry with the schedules still pending.
 */
export async function runScheduleTick<TEntry extends ScheduleDueEntry>(options: RunScheduleTickOptions<TEntry>): Promise<readonly TEntry[]> {
  const due = await options.index.claimDue(options.now ?? Date.now(), options.maxPerTick ?? 100);
  const notify = (entry: TEntry, status: number) => {
    try {
      options.onDispatch?.(entry, status);
    } catch {
      /* an observer never stops the tick */
    }
  };
  await runWithConcurrency(due, Math.max(1, options.concurrency ?? 10), async (entry) => {
    // A schedule with no org names no cell to fire from; the endpoint would refuse it.
    if (entry.orgId === undefined) {
      // eslint-disable-next-line no-console
      console.error(`[flow-state/scheduled] not dispatched: ${entry.userId}/${entry.key} has no organization`);
      notify(entry, 0);
      return;
    }
    let status = 0;
    try {
      status = await options.dispatch(entry, formatScheduleId(entry.orgId, entry.userId, entry.key));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[flow-state/scheduled] dispatch failed for ${entry.userId}/${entry.key}`, err);
    }
    notify(entry, status);
  });
  return due;
}

/** What {@link startScheduleTick} is run with: a tick, and how often. */
export interface StartScheduleTickOptions<TEntry extends ScheduleDueEntry = ScheduleDueEntry> extends Omit<RunScheduleTickOptions<TEntry>, "now"> {
  /** How often it ticks, in ms. Default 60000 (a minute, the finest cadence a cron names). `0` or less: never. */
  readonly intervalMs?: number;
  /** The clock each tick claims against. Default `Date.now`. */
  readonly clock?: () => number;
}

/** A running tick. */
export interface ScheduleTick {
  /** Run one tick now, awaiting any already running first. */
  tick(): Promise<void>;
  /** Stop ticking. Idempotent; resolves once a tick already running has settled. */
  dispose(): Promise<void>;
}

/**
 * Tick on an interval. A tick still running when the next is due is not
 * overlapped: the next waits its turn. A claim that throws is logged and the
 * next tick tries again.
 */
export function startScheduleTick<TEntry extends ScheduleDueEntry>(options: StartScheduleTickOptions<TEntry>): ScheduleTick {
  const intervalMs = options.intervalMs ?? 60_000;
  const clock = options.clock ?? Date.now;
  let running: Promise<void> = Promise.resolve();
  let disposed = false;
  const tick = (): Promise<void> => {
    running = running.then(async () => {
      if (disposed) return;
      try {
        await runScheduleTick({ ...options, now: clock() });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[flow-state/scheduled] claimDue failed; the next tick tries again", err);
      }
    });
    return running;
  };
  const timer = intervalMs > 0 ? setInterval(() => void tick(), intervalMs) : undefined;
  // A tick never keeps the process alive on its own.
  (timer as { unref?: () => void } | undefined)?.unref?.();
  return {
    tick,
    async dispose() {
      disposed = true;
      if (timer !== undefined) clearInterval(timer);
      await running;
    }
  };
}

/**
 * The dispatch endpoint's request for one due entry:
 * `POST <base>/api/flows/<kind>/schedules/<id>/dispatch`, its body naming the
 * scheduled time the schedule was claimed for (the endpoint fires each scheduled
 * time at most once, so a schedule claimed twice files once), with the bearer
 * secret when there is one. As `fetch`'s two arguments: `fetch(url, init)`,
 * or `new Request(url, init)`.
 */
export function scheduleDispatchRequest(options: {
  readonly baseUrl: string;
  readonly flowKind: string;
  readonly entry: ScheduleDueEntry;
  readonly scheduleId: string;
  readonly secret?: string;
  /** The API mount prefix. Default `/api/flows`. */
  readonly basePath?: string;
}): { url: string; init: { method: "POST"; headers: Record<string, string>; body: string } } {
  const base = options.baseUrl.endsWith("/") ? options.baseUrl.slice(0, -1) : options.baseUrl;
  const mount = options.basePath ?? "/api/flows";
  return {
    url: `${base}${mount}/${encodeURIComponent(options.flowKind)}/schedules/${encodeURIComponent(options.scheduleId)}/dispatch`,
    init: {
      method: "POST",
      headers: {
        ...(options.secret === undefined || options.secret.length === 0 ? {} : { Authorization: `Bearer ${options.secret}` }),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ nominalFireTime: new Date(options.entry.nextFireAt).toISOString() })
    }
  };
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
