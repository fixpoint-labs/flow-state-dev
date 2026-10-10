/**
 * The concurrency arbiter (FIX-837) — the one owner of concurrency policy,
 * layered over an ordered-lease backend. One instance is shared by every host
 * in a process, so a session-scoped concurrency policy is enforced once at the
 * shared seam rather than re-implemented per transport adapter.
 *
 * The arbiter decides; the backend only keeps the line (`lease-backend.ts`).
 * Policy — key resolution, `reject` / `queue` / `hold` / `defer` / `allow`, the wait budget,
 * naming the holder, `ConcurrencyRejectedError` — lives here and nowhere else,
 * whichever backend is underneath.
 *
 *   - `resolve` derives the effective policy + key for a dispatch (pure).
 *   - `admit` takes the dispatch's place before any request record or live
 *     stream is created: for `reject` it claims the key only if it is free and
 *     refuses with `ConcurrencyRejectedError` otherwise (so the dropped caller
 *     never materializes a run); for `queue` it joins the key's line; for
 *     `hold` it joins the line but runs at once, so the key reads as held
 *     without the run ever waiting; for `defer` it takes nothing yet, and the
 *     run claims the key only once it is free (no place held or waiting); for
 *     `allow` it takes nothing. The admission then runs the kickoff in its turn
 *     and gives the place back when the run settles, gives it back unrun, or
 *     hands it to a job another process runs. While this process holds a
 *     place on a shared backend it renews it, so a place outlives the
 *     backend's lease for as long as this process holds it. A waiter whose
 *     place the backend dropped takes a new one at the back of the line; a
 *     running holder whose place cannot be kept is told to stop (`lost`).
 *
 * Over the in-memory default backend all of this is synchronous where it was
 * before backends existed: a `reject` throws from `dispatch`, and a queued run
 * is woken when the run ahead of it settles. Over an adapter-supplied backend
 * (FIX-1634) admission is asynchronous — a `reject` refusal arrives through the
 * dispatch's `accepted` — and a queued run re-checks its turn on the schedule
 * `planQueueWait` sets. An unreachable backend refuses the dispatch; nothing
 * runs unarbitrated.
 *
 * Without a supplied backend the arbiter holds keys in this process only, so a
 * host whose dispatcher hands work to another process skips arbitration there
 * (`arbitratesAcrossProcesses` is false) and the dispatch operation keeps
 * refusing a delivery into an existing session by name.
 */

import type {
  ConcurrencyConfig,
  ConcurrencyKey,
  ConcurrencyKeyContext,
  ConcurrencyPolicyName
} from "@flow-state-dev/core";
import { resolveEntry } from "../../execution/resolve-entry";
import { DEFAULT_RUNTIME_LOGGER, logRuntimeEvent, type RuntimeLogger } from "../../execution/logging";
import { ConcurrencyDeferLimitError, ConcurrencyRejectedError } from "../errors";
import type { DispatchEnvelope } from "../dispatcher";
import {
  DEFER_PATIENCE_MS,
  QUEUE_WAIT_TIMEOUT_MS,
  createInMemoryLeaseBackend,
  holdLeasePlace,
  inMemoryInternalsOf,
  planDeferWait,
  planQueueWait,
  type ConcurrencyLeaseBackend,
  type LeasePlace,
  type LeasePlaceHold,
  type LeaseTakeResult
} from "./lease-backend";

/** The one field the arbiter reads off an entry. */
type EntryPolicyView = { concurrency?: ConcurrencyConfig } | undefined;

/**
 * Minimal view of a flow the arbiter reads to resolve a policy: the typed
 * entry maps, narrowed to `concurrency`, plus the flow-level default. Every
 * dispatch type gets the same ladder — default → per-entry — because the entry
 * is found through the same keyed lookup a dispatch resolves its handler with.
 */
export interface ConcurrencyFlowView {
  actions: Record<string, EntryPolicyView>;
  internal?: { actions?: Record<string, EntryPolicyView> };
  task?: { actions?: Record<string, EntryPolicyView> };
  webhooks?: Record<string, { on?: Record<string, EntryPolicyView> } | undefined>;
  schedules?: { static?: Record<string, EntryPolicyView> };
  request?: { concurrency?: ConcurrencyConfig };
}

/** The effective policy + resolved key for a single dispatch. A `key` of
 *  `undefined` means no arbitration applies (the dispatch runs as `allow`). */
export interface ResolvedDecision {
  policy: ConcurrencyPolicyName;
  key: string | undefined;
}

/**
 * A dispatch's standing on its concurrency key, taken by `admit` before
 * anything is written.
 */
export interface ConcurrencyAdmission {
  /**
   * The place this dispatch holds or waits in; `undefined` when nothing is
   * arbitrated. On a shared backend it can change while the dispatch waits:
   * a place the backend dropped is replaced by a new one at the back.
   */
  readonly place: LeasePlace | undefined;
  /**
   * Fires, with a `ConcurrencyLeaseLostError`, when the run holds its turn on
   * a shared backend and the place can no longer be kept, so another process
   * may take the key. The run is to stop. Never fires over the in-memory
   * default, whose places do not expire, or once the place is given back or
   * handed off.
   */
  readonly lost: AbortSignal;
  /**
   * Run `start` in this place's turn and give the place back when it settles.
   * A `queue` place waits for its turn first, bounded by the wait budget, and
   * fails `ConcurrencyQueueTimeoutError` past it. Call at most once.
   *
   * `signal` withdraws a place still waiting on a supplied backend: the wait
   * rejects at once, `start` never runs, and the place is given back rather
   * than renewed until its turn. On the in-memory default the caller re-reads
   * the signal when the turn comes.
   */
  run<T>(start: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  /**
   * Give the place back without running, for a dispatch that failed after
   * admission. Idempotent, and a no-op once `run` has settled.
   */
  release(): Promise<void>;
  /**
   * Stop holding the place in this process without giving it back: it now
   * belongs to a job another process will run, which renews and gives it
   * back. Call once the job is enqueued, with the promise that settles when
   * the job ends.
   *
   * A `defer` admission holds no place: its job claims the key itself. It
   * keeps counting against the key's `maxDeferredPerKey` in this process until
   * `jobEnded` settles, since this process cannot see when the job starts.
   */
  handOff(jobEnded: Promise<unknown>): void;
}

export interface ConcurrencyArbiter {
  /** Resolve the effective policy + key for a dispatch. Pure. */
  resolve(
    flow: ConcurrencyFlowView,
    actionName: string,
    envelope: DispatchEnvelope
  ): ResolvedDecision;
  /**
   * Take a dispatch's place on its key. Call at the top of `dispatch`, before
   * any record/stream is created:
   *   - `reject` → claim the key only if it is free; if another request holds
   *     it, refuse with `ConcurrencyRejectedError(key, inFlightRequestId)` (so
   *     no record is created for the dropped caller).
   *   - `queue` → join the key's line, in the order admissions are taken.
   *   - `allow` / no key → take nothing (today's timing).
   *
   * Synchronous over the in-memory default backend — a refusal is thrown here.
   * Over a supplied backend it returns a promise, which rejects with the
   * refusal or with the backend's own error when the backend is unreachable.
   * `allow` is synchronous over any backend.
   */
  admit(
    decision: ResolvedDecision,
    requestId: string
  ): ConcurrencyAdmission | Promise<ConcurrencyAdmission>;
  /**
   * Whether this arbiter's keys are shared with other processes: true when a
   * backend was supplied rather than defaulted. A host whose dispatcher runs
   * work in another process arbitrates it only when this is true.
   */
  readonly arbitratesAcrossProcesses: boolean;
}

/** Tenant-namespace a raw id so identical ids in different tenants never
 *  collide on the same key (mirrors FIX-682 store-key isolation). */
function namespaced(tenantId: string | undefined, id: string): string {
  return tenantId == null ? id : `${tenantId}:${id}`;
}

/** Normalize the string-or-object config into a `(policy, key)` pair. */
function normalizeConfig(
  config: ConcurrencyConfig | undefined
): { policy: ConcurrencyPolicyName; key: ConcurrencyKey } {
  if (config === undefined) return { policy: "allow", key: "session" };
  if (typeof config === "string") return { policy: config, key: "session" };
  return { policy: config.policy, key: config.key ?? "session" };
}

/** Resolve a key spec against a dispatch envelope. Returns `undefined` to mean
 *  "no arbitration" (the action runs as `allow`). */
function resolveKey(key: ConcurrencyKey, envelope: DispatchEnvelope): string | undefined {
  if (key === "none") return undefined;
  if (key === "session") {
    return envelope.sessionId === undefined
      ? undefined
      : namespaced(envelope.tenantId, envelope.sessionId);
  }
  if (key === "user") {
    return namespaced(envelope.tenantId, envelope.userId);
  }
  // Custom function: build the minimal serializable context.
  const ctx: ConcurrencyKeyContext = {
    flowKind: envelope.flowKind,
    actionName: envelope.actionName,
    sessionId: envelope.sessionId,
    userId: envelope.userId,
    tenantId: envelope.tenantId,
    orgId: envelope.orgId,
    source: envelope.source,
    metadata: envelope.metadata
  };
  return key(ctx);
}


/** Whether a value returned by `admit` is still pending. */
export function isPendingAdmission(
  admission: ConcurrencyAdmission | Promise<ConcurrencyAdmission>
): admission is Promise<ConcurrencyAdmission> {
  return typeof (admission as { then?: unknown }).then === "function";
}

/** A signal that never fires, for an admission that cannot lose its place. */
const NEVER_LOST: AbortSignal = new AbortController().signal;

/**
 * The turn budget of a wait that never times out: a `defer` that ran out of
 * patience and lines up behind the runs on its key.
 */
const UNBOUNDED_TURN_BUDGET = Infinity;

/**
 * How a place reaches its turn. `has-turn`: it already has it (`reject` and a
 * `defer` claimed a free key; `hold` never waits). `waits`: it waits in line
 * for at most `budgetMs`, as `queue` does.
 */
type TurnRule = { kind: "has-turn" } | { kind: "waits"; budgetMs: number };

/** The turn rule `queue` and every other waiting policy uses. */
const QUEUE_TURN: TurnRule = { kind: "waits", budgetMs: QUEUE_WAIT_TIMEOUT_MS };

/**
 * Sleep `ms`, ending early when `signal` fires. Doesn't keep the event loop
 * alive on its own.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const wake = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", wake);
      resolve();
    };
    const timer = setTimeout(wake, Math.max(0, ms));
    (timer as { unref?: () => void }).unref?.();
    signal?.addEventListener("abort", wake, { once: true });
    // Re-read once the listener is in place, so a cancel that fired before it
    // was added still ends the sleep rather than waiting it out.
    if (signal?.aborted) wake();
  });
}

/** Nothing to hold: the run starts on the caller's own timing. */
const UNARBITRATED: ConcurrencyAdmission = {
  place: undefined,
  lost: NEVER_LOST,
  run: (start) => start(),
  release: async () => {},
  handOff: () => {}
};

/**
 * Call a backend method so that a synchronous throw (a closed connection, say)
 * rejects like an asynchronous failure instead of escaping the caller.
 */
function attempt(call: () => Promise<void>): Promise<void> {
  try {
    return call();
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * End a shared-backend wait whose requester withdrew. The admission's `run`
 * gives the place back on the way out.
 */
function throwIfWithdrawn(place: LeasePlace, signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error(`Place "${place.ticket}" was withdrawn while waiting its turn on "${place.key}"`);
  }
}

/**
 * Run `start`, then give the place back however it settles — including a
 * synchronous throw from `start`, so a failed kickoff never strands the key.
 * When the give-back is asynchronous (a shared backend) the run settles only
 * once it lands, so a caller that sees the run end finds its key free. The
 * give-back never rejects; the run's own outcome is what settles.
 */
function runThenGiveBack<T>(
  start: () => Promise<T>,
  giveBack: () => Promise<void> | undefined
): Promise<T> {
  let p: Promise<T>;
  try {
    p = start();
  } catch (e) {
    const pending = giveBack();
    if (pending === undefined) throw e;
    return pending.then(() => {
      throw e;
    });
  }
  return p.then(
    (v) => {
      const pending = giveBack();
      return pending === undefined ? v : pending.then(() => v);
    },
    (e) => {
      const pending = giveBack();
      if (pending === undefined) throw e;
      return pending.then(() => {
        throw e;
      });
    }
  );
}

export interface CreateConcurrencyArbiterOptions {
  /**
   * The ordered-lease backend to keep lines in. Supplied by a queue adapter
   * whose runs land in several processes (`WorkerAdapter.leaseBackend`), so
   * every process lines up on the same keys. Default: a fresh in-memory
   * backend, private to this arbiter.
   */
  backend?: ConcurrencyLeaseBackend;
  /**
   * Where a failed give-back on a supplied backend is reported. The run's own
   * outcome still settles; the place lapses with the backend's lease. Default:
   * the runtime's console logger.
   */
  logger?: RuntimeLogger;
  /**
   * How many `defer` requests may wait on one key in this process. One more
   * is refused with `ConcurrencyDeferLimitError`, before anything is written
   * for it. The wait has no time budget, so this is what bounds the memory,
   * timers and stub records a held key can collect. Default: 32.
   */
  maxDeferredPerKey?: number;
  /**
   * How long a waiting `defer` yields to `hold` runs that start after it.
   * Past this it lines up behind the runs on the key at that moment and runs
   * once they end, even while newer `hold` runs go on, so a caller who keeps
   * sending `hold` requests delays a deferred run by at most this plus the
   * runs it found. Default: 30 seconds, the `queue` wait budget.
   */
  deferPatienceMs?: number;
}

/** Default for `CreateConcurrencyArbiterOptions.maxDeferredPerKey`. */
export const MAX_DEFERRED_PER_KEY = 32;

export function createConcurrencyArbiter(
  options: CreateConcurrencyArbiterOptions = {}
): ConcurrencyArbiter {
  const backend = options.backend ?? createInMemoryLeaseBackend();
  const inMemory = inMemoryInternalsOf(backend);
  const logger = options.logger ?? DEFAULT_RUNTIME_LOGGER;
  const maxDeferredPerKey = options.maxDeferredPerKey ?? MAX_DEFERRED_PER_KEY;
  const deferPatienceMs = options.deferPatienceMs ?? DEFER_PATIENCE_MS;
  // `defer` requests admitted and not yet running, per key, in this process.
  const deferredWaiting = new Map<string, number>();

  /**
   * Wait for a place's turn on a backend with no in-process wake: re-check on
   * the schedule `planQueueWait` sets. The admission's renewal timer keeps the
   * place alive meanwhile. An abort ends the wait at once, between checks or
   * during the sleep, so a withdrawn place is not renewed until its turn.
   *
   * A place the backend reports missing was dropped, not given up: `retake`
   * lines the request up again at the back, and the wait goes on under the
   * same budget. `reclaim` confirms a turn for a place whose renewals failed
   * while it waited: `"missing"` when the backend no longer has it, `false`
   * when it cannot say yet.
   */
  const pollForTurn = async (
    current: () => LeasePlace,
    retake: () => Promise<void>,
    reclaim: () => Promise<true | false | "missing">,
    signal?: AbortSignal,
    budgetMs: number = QUEUE_WAIT_TIMEOUT_MS
  ): Promise<void> => {
    const since = Date.now();
    for (let attempt = 0; ; attempt += 1) {
      throwIfWithdrawn(current(), signal);
      let myTurn = await backend.isMyTurn(current());
      // Its turn, after a loss recorded while it waited: the run may start
      // only once the place is held again.
      if (myTurn === true) myTurn = await reclaim();
      throwIfWithdrawn(current(), signal);
      if (myTurn === "missing") {
        await retake();
        throwIfWithdrawn(current(), signal);
        myTurn = await backend.isMyTurn(current());
        throwIfWithdrawn(current(), signal);
      }
      const place = current();
      const waitedMs = Date.now() - since;
      // The first check is immediate and always honoured. A later one that
      // lands past the budget (the check itself may have taken it there)
      // times out rather than starting a run the budget no longer covers.
      if (myTurn === true && (attempt === 0 || waitedMs < budgetMs)) return;
      // A wait with no budget (a `defer` that ran out of patience) backs off
      // the same way and never times out.
      const step = planQueueWait({ key: place.key, waitedMs, attempt, budgetMs });
      if (step.kind === "timeout") throw step.error;
      await sleep(step.delayMs, signal);
    }
  };

  /** Build the admission for a place, once taken. Shared by both backends. */
  const admissionFor = (
    turn: TurnRule,
    requestId: string,
    taken: LeasePlace
  ): ConcurrencyAdmission => {
    let place = taken;
    let running = false;
    // Set once the run has its turn: from then on a lost place stops it.
    let holding = false;
    let placeLost: Error | undefined;
    const lost = new AbortController();
    // On a shared backend this process renews the place for as long as it
    // holds it: while the dispatch writes its records, while it waits its
    // turn, and while it runs, until it gives the place back or hands it to
    // a job. Nobody else renews it in that time, and a place whose lease
    // lapsed would let another process's run start alongside this one.
    // In-memory places never expire, so the default path starts no timer.
    let hold: LeasePlaceHold | undefined;
    const holdPlace = (): void => {
      if (inMemory !== undefined) return;
      placeLost = undefined;
      hold = holdLeasePlace(backend, place, (error) => {
        placeLost = error;
        if (holding) lost.abort(error);
      });
    };
    holdPlace();
    const stopRenewing = (): void => {
      hold?.stop();
      hold = undefined;
    };
    /** Line a request whose place was dropped up again, at the back. */
    const retake = async (): Promise<void> => {
      stopRenewing();
      const result = await backend.take({ key: place.key, requestId });
      if ("heldBy" in result) throw new ConcurrencyRejectedError(place.key, result.heldBy);
      place = result.place;
      holdPlace();
    };
    /**
     * A wait-time loss is a renewal outage, not proof the place is gone: renew
     * it once more, and hold it again if the backend still has it.
     */
    const reclaim = async (): Promise<true | false | "missing"> => {
      if (placeLost === undefined) return true;
      let kept: boolean | void;
      try {
        kept = await backend.renew(place);
      } catch {
        return false;
      }
      if (kept === false) return "missing";
      stopRenewing();
      holdPlace();
      return true;
    };
    /** The run has its turn: a place already lost stops it at once. */
    const startHolding = (): void => {
      holding = true;
      if (placeLost !== undefined) lost.abort(placeLost);
    };
    // Undefined until given back; then the give-back itself, which never
    // rejects, so `release()` and a settling run share one round trip.
    let givenBack: Promise<void> | undefined;
    /**
     * Give the place back. Synchronous in memory (returns `undefined`), so the
     * next waiter is woken before the run settles, as it always was. On a
     * supplied backend it is awaited; a failure is logged, not thrown: the
     * place lapses with the backend's lease, and the run's outcome is what the
     * caller needs.
     */
    const giveBack = (): Promise<void> | undefined => {
      if (inMemory !== undefined) {
        inMemory.giveBack(place);
        return undefined;
      }
      stopRenewing();
      givenBack ??= attempt(() => backend.giveBack(place)).catch((error: unknown) => {
        // Best effort, like the give-back itself: a logger that throws must
        // not turn this into a rejection the run or `release()` would carry.
        try {
          logRuntimeEvent(
            logger,
            "warn",
            "[flow-state] could not give a concurrency place back; it stays held until the lease backend expires it",
            {
              key: place.key,
              ticket: place.ticket,
              error: error instanceof Error ? error.message : String(error)
            }
          );
        } catch {
          // Nowhere left to report it.
        }
      });
      return givenBack;
    };

    const waitForTurn =
      turn.kind === "has-turn"
        ? undefined
        : inMemory !== undefined
          ? () => inMemory.waitForTurn(place, turn.budgetMs)
          : (signal?: AbortSignal) => pollForTurn(() => place, retake, reclaim, signal, turn.budgetMs);
    const startInTurn = <T>(start: () => Promise<T>): Promise<T> => {
      startHolding();
      return runThenGiveBack(start, giveBack);
    };

    return {
      get place() {
        return place;
      },
      lost: lost.signal,
      run(start, signal) {
        running = true;
        if (waitForTurn === undefined) return startInTurn(start);
        return waitForTurn(signal).then(
          () => startInTurn(start),
          async (error: unknown) => {
            await giveBack();
            throw error;
          }
        );
      },
      async release() {
        if (!running) await giveBack();
      },
      handOff() {
        stopRenewing();
      }
    };
  };

  /** Turn `take`'s answer into an admission, or the `reject` refusal. */
  const admitted = (
    policy: ConcurrencyPolicyName,
    key: string,
    requestId: string,
    result: LeaseTakeResult
  ): ConcurrencyAdmission => {
    if ("heldBy" in result) throw new ConcurrencyRejectedError(key, result.heldBy);
    // `reject` claimed a free key: it is this place's turn already. `hold`
    // never waits: its place only marks the key held. Every other arbitrated
    // policy waits in line as `queue` does.
    const turn: TurnRule = policy === "reject" || policy === "hold" ? { kind: "has-turn" } : QUEUE_TURN;
    return admissionFor(turn, requestId, result.place);
  };

  /**
   * Sleep until a `defer` wait should check the key again: in memory, until
   * the key's last place is given back; on a supplied backend, for the next
   * backoff step. Either ends early when `signal` fires.
   */
  const untilKeyMayBeFree = (
    key: string,
    step: { retryInMs: number; patienceLeftMs: number },
    signal?: AbortSignal
  ): Promise<void> => {
    if (inMemory === undefined) return sleep(step.retryInMs, signal);
    // Woken when the key empties, or when patience runs out, whichever is first.
    const patience = new AbortController();
    const timer = setTimeout(() => patience.abort(), Math.max(0, step.patienceLeftMs));
    (timer as { unref?: () => void }).unref?.();
    const stop = signal === undefined ? patience.signal : AbortSignal.any([signal, patience.signal]);
    return inMemory.whenFree(key, stop).finally(() => clearTimeout(timer));
  };

  /**
   * A `defer` dispatch's admission. It holds nothing until it runs: `run`
   * claims the key the way `reject` does, only when no place is held or
   * waiting, and otherwise waits and tries again. Once claimed, the run holds
   * the key like any other, so a later `defer` waits for it too, and a `hold`
   * still starts at once beside it.
   *
   * Two bounds. At most `maxDeferredPerKey` defers wait on a key in this
   * process; `admit` refuses the next one. And a defer yields to newer `hold`
   * runs only for `deferPatienceMs`: then it takes a place at the back of the
   * key's line and waits, with no budget, for the places ahead of it, so a
   * stream of `hold` requests cannot keep it waiting forever.
   *
   * The wait has no time budget otherwise. A held place always ends: the run
   * that holds it settles (its success, its error, or its abort gives the
   * place back), and on a supplied backend a place whose process died stops
   * being renewed and expires. That expiry is the crash path: nothing has to
   * give the place back for a deferred run to start.
   */
  const deferredAdmission = (key: string, requestId: string): ConcurrencyAdmission => {
    const waitingNow = deferredWaiting.get(key) ?? 0;
    if (waitingNow >= maxDeferredPerKey) throw new ConcurrencyDeferLimitError(key, maxDeferredPerKey);
    deferredWaiting.set(key, waitingNow + 1);
    let counted = true;
    /**
     * Leave the count, once. Called when the run starts (so a defer in line
     * after its patience still counts while it waits its turn) and when `run`
     * settles or the dispatch is released unrun; whichever comes first wins.
     */
    const leaveWaiting = (): void => {
      if (!counted) return;
      counted = false;
      const left = (deferredWaiting.get(key) ?? 1) - 1;
      if (left <= 0) deferredWaiting.delete(key);
      else deferredWaiting.set(key, left);
    };

    let claimed: ConcurrencyAdmission | undefined;
    let running = false;
    const claim = async (signal?: AbortSignal): Promise<ConcurrencyAdmission> => {
      const free = { key, requestId, ifEmpty: true };
      const since = Date.now();
      for (let attempt = 0; ; attempt += 1) {
        if (signal?.aborted) {
          throw new Error(`A deferred run on "${key}" was withdrawn before the key came free`);
        }
        const step = planDeferWait({ waitedMs: Date.now() - since, attempt, patienceMs: deferPatienceMs });
        if (step.kind === "line-up") {
          // Out of patience: line up behind what holds the key now. Newer
          // `hold` runs join behind this place, so they no longer delay it.
          const behind = inMemory !== undefined ? inMemory.take({ key, requestId }) : await backend.take({ key, requestId });
          if (!("place" in behind)) throw new ConcurrencyRejectedError(key, behind.heldBy);
          return admissionFor({ kind: "waits", budgetMs: UNBOUNDED_TURN_BUDGET }, requestId, behind.place);
        }
        const result = inMemory !== undefined ? inMemory.take(free) : await backend.take(free);
        // Claimed only because the key was free: it is this place's turn already.
        if ("place" in result) return admissionFor({ kind: "has-turn" }, requestId, result.place);
        await untilKeyMayBeFree(key, step, signal);
      }
    };
    return {
      get place() {
        return claimed?.place;
      },
      // Nothing can be lost before the key is claimed. The host reads this
      // when the run starts, which is inside the claimed admission's `run`.
      get lost() {
        return claimed?.lost ?? NEVER_LOST;
      },
      run(start, signal) {
        running = true;
        return claim(signal)
          .then((admission) => {
            claimed = admission;
            return admission.run(() => {
              leaveWaiting();
              return start();
            }, signal);
          })
          .finally(leaveWaiting);
      },
      // Nothing is taken before `run`, and `run` gives back what it claims.
      // A dispatch that fails before running leaves the count here.
      release: async () => {
        if (!running) leaveWaiting();
      },
      // Its job, in another process, claims the key. It counts here until
      // that job ends, however it ends.
      handOff: (jobEnded) => {
        jobEnded.then(leaveWaiting, leaveWaiting);
      }
    };
  };

  const admit: ConcurrencyArbiter["admit"] = (decision, requestId) => {
    const { policy, key } = decision;
    if (key === undefined || policy === "allow") return UNARBITRATED;
    if (policy === "defer") return deferredAdmission(key, requestId);
    const input = { key, requestId, ...(policy === "reject" ? { ifEmpty: true } : {}) };
    // In memory the take is synchronous, so two racing callers can't both win
    // and a refusal is thrown before `dispatch` returns.
    if (inMemory !== undefined) return admitted(policy, key, requestId, inMemory.take(input));
    return backend.take(input).then((result) => admitted(policy, key, requestId, result));
  };

  return {
    arbitratesAcrossProcesses: options.backend !== undefined,

    resolve(flow, actionName, view): ResolvedDecision {
      // Every dispatch resolves the entry's own policy through the same
      // keyed lookup the dispatch resolves its handler with: the trusted
      // `source` (set by the adapter or the dispatch seam, never the caller)
      // decides the type, and the type's own map is read — `flow.actions` by
      // name for a `public` dispatch, the adapter's namespaced coordinate for
      // webhook / schedule, the entry name for task / internal. A forged
      // `metadata.webhook` on an HTTP dispatch therefore still resolves the
      // named action's policy, and a task hand-off whose name collides with a
      // public action never inherits that action's `queue` / `reject` — each
      // reads only its own map.
      // A dynamic schedule has no static coordinate: its core is produced by
      // the resolver at dispatch time and carried on the envelope, so its
      // policy is read from there — the same core `runAction` will run.
      const carried = view.resolvedActionCore;
      const entryConfig =
        carried !== undefined
          ? carried.concurrency
          : resolveEntry(flow, actionName, view.source, view.metadata)?.concurrency;
      const effective = entryConfig ?? flow.request?.concurrency;
      const { policy, key } = normalizeConfig(effective);
      return { policy, key: resolveKey(key, view) };
    },

    admit
  };
}
