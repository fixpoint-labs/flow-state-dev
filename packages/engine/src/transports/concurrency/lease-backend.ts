/**
 * The ordered-lease backend under the concurrency arbiter, and its in-memory
 * default.
 *
 * A backend stores places in a line per key and nothing else. It knows nothing
 * about `queue` or `reject`, wait budgets or errors: that policy lives once, in
 * the arbiter (`arbiter.ts`), over whichever backend is present. A queue
 * adapter whose runs land in several processes supplies a backend those
 * processes share (the `WorkerAdapter.leaseBackend` member), so the one arbiter
 * in each process lines up behind the same keys.
 *
 * The in-memory backend is the default: one process, one line per key, and a
 * give-back that hands the turn straight to the next waiter. The arbiter reaches
 * it through a synchronous side door (see `inMemoryInternals`) so a `reject` is
 * still refused synchronously from `dispatch` and a queued run is woken rather
 * than polled — the behaviour every in-process host had before backends existed.
 * The four public calls are the same line, answered asynchronously.
 *
 * The side door is deliberately not extensible: it is keyed to backends this
 * module built, and no other backend can join it. A supplied backend is reached
 * only through the four calls, waits by re-checking its turn, and refuses a
 * `reject` asynchronously. Don't imitate the side door in another backend; if a
 * pushed wake is worth having there, it belongs on the public contract.
 *
 * `planQueueWait` is the arbiter's answer to "not my turn, now what?" for a
 * backend with no in-process wake, and `holdLeasePlace` is how a process keeps
 * a place it holds. Both are exported for an adapter's worker, which waits by
 * requeueing its job rather than holding a slot and renews the place of the
 * job it runs, and must reach the same decisions the engine would.
 */

import { ConcurrencyLeaseLostError, ConcurrencyQueueTimeoutError } from "../errors";

/** A run's place in one key's line, as the backend issued it. Opaque to callers. */
export interface LeasePlace {
  /** The tenant-namespaced concurrency key the engine resolved. */
  readonly key: string;
  /** The backend's id for this place on the key. */
  readonly ticket: string;
}

/** What `take` is asked for. */
export interface LeaseTakeInput {
  /** The tenant-namespaced concurrency key. */
  key: string;
  /** The request that will hold the place, named to a refused `reject` caller. */
  requestId: string;
  /**
   * Claim the key only if nobody holds or waits on it (the `reject` policy).
   * When the key is taken, `take` answers `{ heldBy }` instead of a place.
   */
  ifEmpty?: boolean;
}

/** `take`'s answer: a place in the line, or (with `ifEmpty`) who holds the key. */
export type LeaseTakeResult = { place: LeasePlace } | { heldBy: string };

/**
 * Ordered leases on a key, shared by every process of a deployment.
 *
 * Holds no policy. Every call may throw when the backend cannot be reached;
 * the arbiter then refuses the dispatch rather than running it unarbitrated.
 */
export interface ConcurrencyLeaseBackend {
  /**
   * Append a place to the key's line, or with `ifEmpty` claim only a free key.
   * Returns the current holder's request id instead when `ifEmpty` finds the
   * key held.
   *
   * Not idempotent: each call appends a new place, even for a request id
   * already on the line. The engine takes once per dispatch.
   */
  take(input: LeaseTakeInput): Promise<LeaseTakeResult>;
  /**
   * True when this place is the first live place on its key. `"missing"` when
   * the key's line no longer has the place at all: a backend whose places
   * expire dropped it. The request behind it did not go away, so the engine
   * takes a new place for it, at the back of the line. A backend that answers
   * only `true` / `false` never re-admits a waiter.
   */
  isMyTurn(place: LeasePlace): Promise<boolean | "missing">;
  /** Remove the place. Idempotent. Wakes the next waiter on the key. */
  giveBack(place: LeasePlace): Promise<void>;
  /**
   * Extend the place's lease, for a backend whose places expire. The engine's
   * arbiter calls it every 2 seconds (more often under a short `leaseMs`) for
   * as long as its process holds the place: from `take`, through the
   * dispatch's writes, its wait for a turn and its run, until it gives the
   * place back or hands it to a job (whose worker then renews it). A lease a
   * few times longer than 2 seconds survives one missed renewal.
   *
   * Answers `false` when the place is gone, so it can no longer be kept; a
   * running holder is then stopped. Any other answer, `undefined` included,
   * means the place was kept.
   */
  renew(place: LeasePlace): Promise<boolean | void>;
  /**
   * How long a place lives past its last renewal, for a backend whose places
   * expire. With it, a running holder that cannot renew is stopped at half
   * the lease, so it has ended before another process can take the key.
   * Without it, only a renewal that answers `false` stops a holder.
   */
  readonly leaseMs?: number;
}

/**
 * How often a held place is renewed, for a backend whose places expire; see
 * `ConcurrencyLeaseBackend.renew`.
 */
const HOLD_RENEW_INTERVAL_MS = 2_000;

/** A place this process keeps renewed until it stops holding it. */
export interface LeasePlaceHold {
  /** Stop renewing. Idempotent. Does not give the place back. */
  stop(): void;
}

/**
 * Keep a place alive for as long as this process holds it, and say when it
 * cannot be kept.
 *
 * Renews every 2 seconds, or every quarter of the backend's `leaseMs` when
 * that is shorter. `onLost` is called once, with a `ConcurrencyLeaseLostError`,
 * when a renewal answers that the place is gone, or, on a backend that
 * declares `leaseMs`, when no renewal has landed for half the lease: the
 * other half is the holder's time to stop before another process can take
 * the key. A renewal that throws is otherwise ignored. Renewal stops after
 * `onLost`. The holder gives the place back itself.
 */
export function holdLeasePlace(
  backend: ConcurrencyLeaseBackend,
  place: LeasePlace,
  onLost: (error: ConcurrencyLeaseLostError) => void
): LeasePlaceHold {
  const leaseMs = backend.leaseMs;
  const intervalMs =
    leaseMs === undefined ? HOLD_RENEW_INTERVAL_MS : Math.min(HOLD_RENEW_INTERVAL_MS, leaseMs / 4);
  let stopped = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const unref = (timer: unknown): void => {
    // Don't keep the event loop alive solely to renew a lease.
    (timer as { unref?: () => void }).unref?.();
  };
  const lose = (): void => {
    if (stopped) return;
    hold.stop();
    onLost(new ConcurrencyLeaseLostError(place.key));
  };
  const armDeadline = (): void => {
    if (leaseMs === undefined || stopped) return;
    if (deadline !== undefined) clearTimeout(deadline);
    deadline = setTimeout(lose, leaseMs / 2);
    unref(deadline);
  };
  const renewal = setInterval(() => {
    let pending: Promise<boolean | void>;
    try {
      pending = backend.renew(place);
    } catch {
      return;
    }
    pending.then(
      (kept) => {
        if (stopped) return;
        if (kept === false) lose();
        else armDeadline();
      },
      () => undefined
    );
  }, intervalMs);
  unref(renewal);
  const hold: LeasePlaceHold = {
    stop() {
      stopped = true;
      clearInterval(renewal);
      if (deadline !== undefined) clearTimeout(deadline);
    }
  };
  armDeadline();
  return hold;
}

/** The default budget a `queue` run waits for its turn before timing out. */
export const QUEUE_WAIT_TIMEOUT_MS = 30_000;

/** First backoff ceiling for a waiter that re-checks its turn. */
const QUEUE_WAIT_BASE_MS = 50;
/** Largest single wait between turn checks. */
const QUEUE_WAIT_CAP_MS = 2_000;
/** Floor under a jittered wait, so a waiter never re-checks in a tight loop. */
const QUEUE_WAIT_MIN_MS = 10;

/** One step of a waiting `queue` run: wait this long and check again, or give up. */
export type QueueWaitStep =
  | { kind: "wait"; delayMs: number }
  | { kind: "timeout"; error: ConcurrencyQueueTimeoutError };

/**
 * Decide what a `queue` run whose turn has not come does next.
 *
 * Backs off exponentially from a short base to a cap of a few seconds, with
 * full jitter so waiters on one key spread out, and clamps the wait to what is
 * left of the budget so the last check lands at the budget's end and fails
 * there with the error an in-process wait fails with.
 *
 * `waitedMs` counts only time spent waiting on the key, from the run's first
 * turn check: time queued behind unrelated work never consumes the budget.
 * `attempt` counts turn checks made so far, from 0, and must grow by one per
 * check — a caller that restarts it keeps the backoff at its base. A worker
 * that waits by requeueing its job carries both on the job. `random` defaults
 * to `Math.random`.
 */
export function planQueueWait(input: {
  key: string;
  waitedMs: number;
  attempt: number;
  random?: () => number;
}): QueueWaitStep {
  const remaining = QUEUE_WAIT_TIMEOUT_MS - input.waitedMs;
  if (remaining <= 0) {
    return {
      kind: "timeout",
      error: new ConcurrencyQueueTimeoutError(input.key, QUEUE_WAIT_TIMEOUT_MS)
    };
  }
  const ceiling = Math.min(QUEUE_WAIT_CAP_MS, QUEUE_WAIT_BASE_MS * 2 ** Math.min(input.attempt, 20));
  const jittered = Math.max(QUEUE_WAIT_MIN_MS, (input.random ?? Math.random)() * ceiling);
  return { kind: "wait", delayMs: Math.min(Math.round(jittered), remaining) };
}

/** A place in the in-memory line, with the waiter to wake when it reaches the front. */
interface InMemoryPlace {
  ticket: string;
  requestId: string;
  wake?: () => void;
}

/**
 * The synchronous side of the in-memory backend, reached only by the arbiter.
 *
 * Module-private through `inMemoryInternals`, so the public contract stays the
 * four asynchronous calls: another backend cannot opt into this, and a caller
 * cannot reach the line except through them.
 */
export interface InMemoryLeaseInternals {
  take(input: LeaseTakeInput): LeaseTakeResult;
  giveBack(place: LeasePlace): void;
  /**
   * Resolve once `place` is first on its key. Rejects with
   * `ConcurrencyQueueTimeoutError` after `timeoutMs`; the caller gives the
   * place back.
   */
  waitForTurn(place: LeasePlace, timeoutMs: number): Promise<void>;
}

const inMemoryInternals = new WeakMap<ConcurrencyLeaseBackend, InMemoryLeaseInternals>();

/** The synchronous side of `backend` when it is an in-memory backend, else `undefined`. */
export function inMemoryInternalsOf(
  backend: ConcurrencyLeaseBackend
): InMemoryLeaseInternals | undefined {
  return inMemoryInternals.get(backend);
}

/**
 * A backend whose lines live in this process's memory: the default under every
 * arbiter. Several arbiters built over one of these share its keys, which is
 * how a test stands two processes on one deployment's backend.
 *
 * Places never expire, so `renew` does nothing and a place is missing only
 * once it was given back. Idle keys are pruned.
 *
 * Not built on `createKeyedAsyncGate`, though the two look alike: the gate
 * holds anonymous leases, and a backend must name each place (a ticket another
 * process can hand back), say who holds the key, and answer "is it this
 * place's turn" for a place it did not wake.
 */
export function createInMemoryLeaseBackend(): ConcurrencyLeaseBackend {
  const lines = new Map<string, InMemoryPlace[]>();
  let nextTicket = 0;

  const internals: InMemoryLeaseInternals = {
    take({ key, requestId, ifEmpty }) {
      const line = lines.get(key);
      if (ifEmpty === true && line !== undefined && line.length > 0) {
        return { heldBy: line[0]!.requestId };
      }
      const ticket = String((nextTicket += 1));
      if (line === undefined) lines.set(key, [{ ticket, requestId }]);
      else line.push({ ticket, requestId });
      return { place: { key, ticket } };
    },

    giveBack({ key, ticket }) {
      const line = lines.get(key);
      if (line === undefined) return;
      const index = line.findIndex((p) => p.ticket === ticket);
      if (index === -1) return;
      line.splice(index, 1);
      if (line.length === 0) {
        lines.delete(key);
        return;
      }
      // The front changed: hand the turn straight to whoever now holds it.
      if (index === 0) line[0]!.wake?.();
    },

    waitForTurn({ key, ticket }, timeoutMs) {
      const line = lines.get(key);
      const entry = line?.find((p) => p.ticket === ticket);
      if (line === undefined || entry === undefined || line[0] === entry) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        entry.wake = () => {
          entry.wake = undefined;
          if (timer !== undefined) clearTimeout(timer);
          resolve();
        };
        if (timeoutMs !== Infinity && timeoutMs > 0) {
          timer = setTimeout(() => {
            entry.wake = undefined;
            reject(new ConcurrencyQueueTimeoutError(key, timeoutMs));
          }, timeoutMs);
          // Don't keep the event loop alive solely for a queued wait.
          (timer as { unref?: () => void }).unref?.();
        }
      });
    }
  };

  const backend: ConcurrencyLeaseBackend = {
    take: async (input) => internals.take(input),
    isMyTurn: async ({ key, ticket }) => {
      const line = lines.get(key);
      if (line?.[0]?.ticket === ticket) return true;
      return line?.some((p) => p.ticket === ticket) === true ? false : "missing";
    },
    giveBack: async (place) => internals.giveBack(place),
    renew: async () => {}
  };
  inMemoryInternals.set(backend, internals);
  return backend;
}
