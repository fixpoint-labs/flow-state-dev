// FIX-2536; epic FIX-2471 D10.
/**
 * The schedule tick: claim the rows a schedule index holds due and dispatch
 * each, with bounded concurrency. One body, run two ways:
 *
 * - **Per beat** ({@link runScheduleTick}): a host's own cron calls it once a
 *   beat (`@flow-state-dev/vercel/schedules`' `createScheduleTickHandler`).
 * - **On an interval** ({@link startScheduleTick}): a long-lived host runs it
 *   each minute (`@flow-state-dev/node`'s `serve()`, and so `fsdev dev`), like
 *   the engine's stale-request sweeper.
 *
 * `claimDue` advances each row as it returns it, so a row fires once per
 * scheduled time however many hosts tick (the dispatch endpoint's claim is the
 * guarantee; the index only finds due rows). A dispatch that fails is
 * dropped, not retried: at-most-once is the scheduled-actions contract.
 *
 * Engine-free: the caller supplies `dispatch`, which turns a due row and its
 * dispatch id into an HTTP status.
 */
import type { ScheduleDueEntry } from "@flow-state-dev/core/types";
import { formatScheduleId } from "./createResourceCollectionScheduleResolver";

/** What one tick is run with. */
export interface RunScheduleTickOptions<TRow extends ScheduleDueEntry = ScheduleDueEntry> {
  /** The index to claim due rows from. */
  readonly index: { claimDue(now: number, limit?: number): Promise<readonly TRow[]> };
  /** Dispatch one due row under its dispatch id (`<orgId>/<userId>/<key>`); resolve to the HTTP status, `0` when it threw. */
  readonly dispatch: (row: TRow, scheduleId: string) => Promise<number>;
  /** The time due rows are claimed against. Default `Date.now()`. */
  readonly now?: number;
  /** The most rows claimed per tick. Default `100`. */
  readonly maxPerTick?: number;
  /** The most dispatches in flight at once. Default `10`. */
  readonly concurrency?: number;
  /** Observe each dispatch: the row and its status (`0` when it threw, or the row names no org). Never throws back. */
  readonly onDispatch?: (row: TRow, status: number) => void;
}

/**
 * Claim the due rows and dispatch each. Resolves to the rows claimed. Throws
 * only when the claim does, so a per-beat caller can answer 500 and its cron
 * retry with the rows still pending.
 */
export async function runScheduleTick<TRow extends ScheduleDueEntry>(options: RunScheduleTickOptions<TRow>): Promise<readonly TRow[]> {
  const due = await options.index.claimDue(options.now ?? Date.now(), options.maxPerTick ?? 100);
  const notify = (row: TRow, status: number) => {
    try {
      options.onDispatch?.(row, status);
    } catch {
      /* an observer never stops the tick */
    }
  };
  await runWithConcurrency(due, Math.max(1, options.concurrency ?? 10), async (row) => {
    // A row with no org names no cell to fire from; the endpoint would refuse it.
    if (row.orgId === undefined) {
      // eslint-disable-next-line no-console
      console.error(`[flow-state/scheduled] not dispatched: ${row.userId}/${row.key} has no organization`);
      notify(row, 0);
      return;
    }
    let status = 0;
    try {
      status = await options.dispatch(row, formatScheduleId(row.orgId, row.userId, row.key));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[flow-state/scheduled] dispatch failed for ${row.userId}/${row.key}`, err);
    }
    notify(row, status);
  });
  return due;
}

/** What {@link startScheduleTick} is run with: a tick, and how often. */
export interface StartScheduleTickOptions<TRow extends ScheduleDueEntry = ScheduleDueEntry> extends Omit<RunScheduleTickOptions<TRow>, "now"> {
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
export function startScheduleTick<TRow extends ScheduleDueEntry>(options: StartScheduleTickOptions<TRow>): ScheduleTick {
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
 * The dispatch endpoint's request for one due row:
 * `POST <base>/api/flows/<kind>/schedules/<id>/dispatch`, its body naming the
 * scheduled time the row was claimed for (the endpoint fires each scheduled
 * time at most once, so a row claimed twice files once), with the bearer
 * secret when there is one. As `fetch`'s two arguments: `fetch(url, init)`,
 * or `new Request(url, init)`.
 */
export function scheduleDispatchRequest(options: {
  readonly baseUrl: string;
  readonly flowKind: string;
  readonly row: ScheduleDueEntry;
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
      body: JSON.stringify({ nominalFireTime: new Date(options.row.nextFireAt).toISOString() })
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
