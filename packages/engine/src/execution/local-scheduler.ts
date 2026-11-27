// FIX-2752.
/**
 * The built-in local cron: `createFlowState`'s default scheduler. Each minute
 * it runs the app's schedule tick, but only while this process holds the
 * schedule-tick lease, so one process ticks across a deployment that shares
 * its store however many serve it.
 *
 * The lease is the durability sweeper's pattern on its own sentinel key in
 * `stores.leases`, with one difference: it is held, not taken per tick. A
 * holder renews it on its own timer every half lease (every `LeaseStore`
 * renews for the same holder), so a tick longer than the lease can't lapse
 * it, and a holder that fails to renew stops dispatching. Released on stop, so
 * a clean restart hands over at once; a crash hands over when the lease runs
 * out (two intervals), and a contender takes it within the next interval. An
 * acquire that throws (SQLite's `SQLITE_BUSY` under contention) counts as not
 * holding: idle this minute.
 *
 * Timers are unref'd: the cron never keeps a process alive on its own.
 */
import type { LeaseStore } from "../stores/types";
import { DEFAULT_RUNTIME_LOGGER, logRuntimeEvent, type RuntimeLogger } from "./logging";
import { SCHEDULE_TICK_INTERVAL_MS } from "./schedule-tick";

/**
 * How long `stop()` waits for a running tick and a pending renewal to settle,
 * and then for the lease's release.
 * Bounded: a store that stopped answering (a claim that never returns) must
 * not hold shutdown open. The tick was told to stop dispatching.
 */
const STOP_GRACE_MS = 5_000;

/** Sentinel key the local cron's single-holder lease is taken under. */
const SCHEDULE_TICK_LEASE_KEY = "__schedule_tick__";

/** The local cron. */
export interface LocalScheduler {
  /** Start ticking against `leases`. Idempotent; a no-op once stopped. */
  arm(leases: LeaseStore): void;
  /** Stop ticking, tell a running tick to stop dispatching, let it settle, and release the lease. Idempotent. */
  stop(): Promise<void>;
}

export interface CreateLocalSchedulerOptions {
  /** Run one tick; stop dispatching when `signal` aborts. */
  tick(signal: AbortSignal): Promise<unknown>;
  /** How often it ticks, in ms. Default a minute. The lease runs two intervals. */
  intervalMs?: number;
  /** The lease holder. Default a per-process id. */
  holder?: string;
  logger?: RuntimeLogger;
}

/** Build the local cron. Nothing runs until {@link LocalScheduler.arm}. */
export function createLocalScheduler(options: CreateLocalSchedulerOptions): LocalScheduler {
  const intervalMs = options.intervalMs ?? SCHEDULE_TICK_INTERVAL_MS;
  const leaseMs = 2 * intervalMs;
  const holder = options.holder ?? `schedule-tick-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  const logger = options.logger ?? DEFAULT_RUNTIME_LOGGER;

  let leases: LeaseStore | undefined;
  let stopped = false;
  let leaseId: string | undefined;
  /** When the lease held runs out, if no renewal answers: measured from when its acquire was sent. */
  let heldUntil = 0;
  let renewing: Promise<void> = Promise.resolve();
  let running: { done: Promise<void>; stop: AbortController } | undefined;
  const timers: Array<ReturnType<typeof setInterval>> = [];

  const renew = (): Promise<void> => {
    renewing = renewing.then(async () => {
      if (stopped || leases === undefined) return;
      let lease: { leaseId: string } | null = null;
      const sentAt = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Half a beat at most: an acquire that never answers must not hold every
        // later renewal behind it. A late answer is dropped; the lease it took
        // renews to this holder on the next beat, or runs out.
        lease = await Promise.race([
          leases.acquire(SCHEDULE_TICK_LEASE_KEY, { holder, durationMs: leaseMs }),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), intervalMs / 2);
            (timer as { unref?: () => void }).unref?.();
          })
        ]);
      } catch (err) {
        // Contention or a store hiccup: not holding, idle this minute. Said, so
        // a store that keeps failing doesn't idle the cron unnoticed.
        logRuntimeEvent(logger, "warn", "[flow-state] schedule-tick lease renewal failed; not ticking until it succeeds", {
          error: err instanceof Error ? err.message : String(err)
        });
      } finally {
        clearTimeout(timer);
      }
      if (lease !== null) {
        // Stopped while acquiring: give it straight back.
        if (stopped) await leases.release(SCHEDULE_TICK_LEASE_KEY, lease.leaseId).catch(() => undefined);
        else {
          leaseId = lease.leaseId;
          heldUntil = sentAt + leaseMs;
        }
        return;
      }
      if (leaseId !== undefined) lose();
    });
    return renewing;
  };

  // Lost: another process may hold it now, so stop sending what this one claimed.
  const lose = (): void => {
    leaseId = undefined;
    running?.stop.abort();
  };

  const runTick = (): void => {
    if (stopped || leaseId === undefined || running !== undefined) return;
    const stop = new AbortController();
    const done = options
      .tick(stop.signal)
      .then(
        () => undefined,
        (err: unknown) => {
          logRuntimeEvent(logger, "error", "[flow-state] schedule tick failed; the next tick tries again", {
            error: err instanceof Error ? err.message : String(err)
          });
        }
      )
      .finally(() => {
        running = undefined;
      });
    running = { done, stop };
  };

  // Each beat's renewal timer fires just before its tick: tick on that
  // renewal's answer, so a contender ticks on the beat it takes the lease even
  // when the store answers over the network (a crash hands over within the
  // lease plus one beat, not one beat more).
  const tick = (): void => {
    // A renewal that never answers (a hung network store) can't say the lease
    // was lost: give it up on the clock, before the next beat would be too late.
    if (leaseId !== undefined && Date.now() >= heldUntil - intervalMs / 2) lose();
    void renewing.then(runTick);
  };

  const every = (ms: number, fn: () => unknown): void => {
    const timer = setInterval(() => void fn(), ms);
    (timer as { unref?: () => void }).unref?.();
    timers.push(timer);
  };

  return {
    arm(store) {
      if (stopped || leases !== undefined) return;
      leases = store;
      void renew();
      every(leaseMs / 2, renew);
      every(intervalMs, tick);
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      for (const timer of timers) clearInterval(timer);
      running?.stop.abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const grace = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, STOP_GRACE_MS);
        (timer as { unref?: () => void }).unref?.();
      });
      await Promise.race([Promise.all([running?.done, renewing]), grace]);
      clearTimeout(timer);
      const held = leaseId;
      leaseId = undefined;
      if (held !== undefined && leases !== undefined) {
        // Bounded too: a release the store never answers leaves the lease to run out.
        const released = leases.release(SCHEDULE_TICK_LEASE_KEY, held).catch((err: unknown) => {
          logRuntimeEvent(logger, "error", "[flow-state] schedule-tick lease release failed", {
            error: err instanceof Error ? err.message : String(err)
          });
        });
        const releaseGrace = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, STOP_GRACE_MS);
          (timer as { unref?: () => void }).unref?.();
        });
        await Promise.race([released, releaseGrace]);
        clearTimeout(timer);
      }
    }
  };
}
