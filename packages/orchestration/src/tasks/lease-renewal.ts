/**
 * Lease renewal — the worker half of durable-job recovery (FIX-1005).
 *
 * A worker that is running keeps its own task's lease alive. It is the only
 * party that can, and it is extending a row it already proved it owns. Once
 * that is true an expired lease stops being ambiguous: it means no live worker
 * is holding this task, so the claim path can simply hand it out again.
 *
 * **One driver, every seam.** Three ticket-mint sites drive workers — the task
 * board's worker body, the shared `dispatchAndExecute` helper, and the
 * `routedSpecialists` pattern. Three hand-written drivers would each carry a
 * cadence, a single-flight guard and a decline-to-abort rule, and they would
 * drift. Every rule lives in {@link startLeaseRenewal}.
 *
 * **The span is claim → the write that records the result**, not claim → the
 * worker returning. Those look interchangeable and are not: `complete()` and
 * `fail()` are fenced on the claim, and the fence refuses a write on a lapsed
 * lease, so a driver stopped at the worker's return leaves the settlement
 * itself unprotected — and a healthy worker whose result is refused has its
 * task recovered and its side effects repeated. {@link withLeaseRenewalScope}
 * is the seam for a worker composed as several steps; each seam's recorder
 * stops the driver after its own write.
 *
 * **What renewal does not do.** It does not make the lease correct — the
 * substrate's write fence does that, by refusing any ticket-fenced write on a
 * row whose lease has already lapsed. So a renewal that stalls past its
 * deadline and then commits installs nothing, and a worker whose store stops
 * answering can record nothing even though it keeps running. The abort below
 * exists to stop that worker *paying* for work it can no longer record; it is
 * not a correctness step, which is why a store outage is not one.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { TaskClaimTicket } from "./claim-ticket";
import type { Task } from "./schema/task";
import type { TaskCollectionRef } from "./collection/types";

/**
 * How many renewals fit inside one lease.
 *
 * Three, and the tolerance that buys is **one** missed renewal, not two — as
 * arithmetic rather than a claim to trust. Ticks fall at `T/3`, `2T/3` and `T`;
 * the fence refuses a write at `leaseUntil <= now`, so the tick landing *on*
 * the deadline is already too late and only the first two can extend anything.
 * Generally `RENEWAL_DIVISOR - 1` attempts land strictly inside the lease and
 * `RENEWAL_DIVISOR - 2` consecutive failures are survived.
 *
 * The engine's own heartbeat discipline is the precedent for the ratio: a
 * staleness threshold below twice the heartbeat interval fights healthy
 * heartbeats. Raising this is the lever if one missed renewal is too thin, and
 * it costs one more write per lease.
 */
export const RENEWAL_DIVISOR = 3;

/**
 * Floor on the **first** delay only (FIX-1005), below which the helper sets no
 * timer and renews inline as it starts.
 *
 * A helper that starts late phases its first tick against the lease that is
 * actually left, which puts it `2R/3` ahead of the deadline — so it commits
 * inside the lease only while `2R/3` covers the timer's own lateness *plus* the
 * store's round trip. Under that, a timer cannot be promised to land at all,
 * and on an already-dead lease waiting `2R/3` only delays the moment the worker
 * finds out it lost the row.
 *
 * **Not a cadence floor.** The rejected cadence floor clamped the *repeating*
 * interval, which the lease minimum already subsumes in the caller's own units.
 * This clamps the first delay, and it clamps it to zero — below the floor there
 * is no timer, so it can produce no extra ticks. At 50 ms the timer path is
 * taken whenever more than 150 ms of lease remains, and a lease cannot be
 * shorter than a second, so a helper that starts on time pays nothing.
 */
export const MIN_RENEWAL_DELAY_MS = 50;

/** Schedule `fn` after `ms`; returns a cancel. Injected in tests. */
export type RenewalTimer = (fn: () => void, ms: number) => () => void;

const defaultTimer: RenewalTimer = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  // Never hold the process open for a renewal. A worker whose sequencer parked
  // or whose request tree was abandoned should not keep a runtime alive to say
  // "still here" about work nobody is waiting on.
  (handle as unknown as { unref?: () => void }).unref?.();
  return () => clearTimeout(handle);
};

export interface LeaseRenewalOptions {
  /** The board holding the claimed row. */
  collection: TaskCollectionRef;
  /** The ticket minted from this claim — renewal's ownership assertion. */
  ticket: TaskClaimTicket;
  /**
   * The task **as `claim()` committed it**. The renewal span is read off this
   * row rather than passed in, which is what makes the driver correct by
   * construction: a dispatcher that claimed with a five-second lease and a
   * driver that assumed two minutes cannot disagree, because there is nothing
   * to agree about.
   */
  claimedTask: Task;
  /**
   * The ambient signal renewal rides — normally `ctx.signal`. When it aborts,
   * renewal stops: a cancelled request is not a live worker.
   */
  signal?: AbortSignal;
  /**
   * The clock renewal reasons against. **Defaults to the collection's own**,
   * never to `Date.now` — the deadlines this driver writes are compared
   * against `leaseUntil`, which the claim write stamped on that clock, so a
   * driver reading a different one writes on a different timeline than the row
   * it is extending. Override only to drive the driver itself in a test.
   */
  now?: () => number;
  /** Timer injection for tests. Default: an unref'd `setTimeout`. */
  timer?: RenewalTimer;
}

/**
 * A running renewal driver. Run the work under {@link signal} and
 * {@link stop} it when the work returns, on every path.
 */
export interface LeaseRenewalDriver {
  /**
   * Aborted when the claim is lost — the substrate refused a renewal because
   * the row is no longer this worker's (taken back, cancelled, recreated, or
   * its lease already gone).
   *
   * Compose it with the request's signal rather than substituting it; a step
   * dispatched with `.step(block, { abortSignal })` gets that composition for
   * free.
   */
  readonly signal: AbortSignal;
  /** Stop renewing. Idempotent, and safe to call before the first tick. */
  stop(): void;
}

/**
 * Start renewing `claimedTask`'s lease until {@link LeaseRenewalDriver.stop}.
 *
 * **The span is the one the claim committed, not the one that is left.**
 * `leaseUntil - updatedAt` — both stamped from a single clock read inside the
 * claim write, so the subtraction is exact. Deriving it from `leaseUntil - now`
 * instead would let a driver that starts late shrink its own cadence: a valid
 * one-second claim reached 990 ms late would read a 10 ms span and derive a
 * 3.33 ms cadence from it, which is the write storm the lease minimum exists to
 * prevent, rebuilt out of a perfectly valid claim.
 *
 * **The span sets the cadence; the lease that is left sets the phase.** Those
 * are two different numbers and conflating them breaks a healthy worker. A
 * driver that starts late and then waits a full `span / RENEWAL_DIVISOR`
 * schedules its first renewal *after* the lease it is extending — the same
 * 1,000 ms claim reached 990 ms late would first write at ~1,323 ms against a
 * lease that died at 1,000 — so the fence would decline it and a *healthy*
 * worker would lose its row. So the first tick is phased against the remaining
 * lease and every tick after it uses the committed span: one early write, then
 * the normal cadence.
 *
 * **And the promise it makes carries its condition.** Renewal keeps a healthy
 * worker's claim when the driver starts with more lease left than one store
 * write takes to commit. Below that it does not, and nothing can — no timer and
 * no inline call beats a deadline that arrives sooner than the store answers,
 * and the substrate cannot know a custom store's latency to name the constant
 * that would. Under that window the worker loses the row and its work is
 * re-run, which is inside the mechanism's stated bound rather than beside it.
 */
export function startLeaseRenewal(options: LeaseRenewalOptions): LeaseRenewalDriver {
  const { collection, ticket, claimedTask } = options;
  const now = options.now ?? collection.now;
  const timer = options.timer ?? defaultTimer;

  const lost = new AbortController();
  let stopped = false;
  let cancelTimer: (() => void) | undefined;
  /** Single-flight: a tick whose predecessor is still in flight is skipped. */
  let inFlight = false;

  const leaseUntil = claimedTask.leaseUntil;
  const span =
    leaseUntil == null ? undefined : leaseUntil - claimedTask.updatedAt;

  function stop(): void {
    if (stopped) return;
    stopped = true;
    cancelTimer?.();
    cancelTimer = undefined;
    options.signal?.removeEventListener("abort", stop);
  }

  // A cancelled request is not a live worker, so stop renewing rather than
  // keeping a lease open for work that will never be recorded.
  if (options.signal?.aborted === true) stopped = true;
  else options.signal?.addEventListener("abort", stop, { once: true });

  // Nothing to renew: a row with no lease is not one this driver can keep, and
  // a non-positive span means the claim wrote something this driver cannot
  // reason about. Both are inert rather than fatal — the caller's work runs,
  // and an unrenewed lease is exactly today's behaviour.
  if (span === undefined || span <= 0 || stopped) {
    return { signal: lost.signal, stop };
  }

  const cadence = Math.max(1, Math.floor(span / RENEWAL_DIVISOR));

  async function renew(): Promise<void> {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const outcome = await collection.renewLease(
        claimedTask.id,
        now() + span!,
        { ifAllowed: true, claim: ticket }
      );
      if (stopped) return;
      if (outcome.outcome !== "declined") return;
      // A decline is the only stop condition — a throw below is the unknown
      // case, not the dead case. But there are two kinds of decline and they
      // mean different things to the worker.
      if (outcome.reason === "disallowed") {
        // The task moved to a status the lease does not govern, which today
        // means the worker parked it for review. It has NOT been displaced:
        // review is an explicit park, and the substrate's write fence is
        // scoped to `in_progress` for exactly this reason. So stop asserting
        // liveness on a row the lease no longer speaks for, and leave the
        // worker alone — aborting it here would contradict the same rule one
        // layer down.
        stop();
        return;
      }
      // Every other decline means the row is not ours any more. Stop paying
      // for work we can no longer record.
      stop();
      lost.abort(
        new Error(
          `[tasks] lost the claim on task "${claimedTask.id}" (${outcome.reason}) — ` +
            `its lease was not renewed in time, or it was settled by someone else.`
        )
      );
    } catch {
      // A store that threw tells us nothing about who holds the row, and the
      // fence refuses whatever this worker writes if it turns out to be gone.
      // So: do not extend, do not abort, try again next tick.
    } finally {
      inFlight = false;
    }
  }

  /**
   * When the tick that is currently scheduled was DUE, on the collection's
   * clock. The next one is phased against this rather than against the moment
   * the previous write happened to finish.
   *
   * A renewal is a network write, and a slow one eats the interval that was
   * supposed to carry the retry. Scheduling `cadence` from *settle* time pushes
   * every subsequent tick out by however long the failure took, so the
   * tolerance this driver advertises — `RENEWAL_DIVISOR - 2` consecutive
   * failures survived — silently does not hold for the failure mode most likely
   * to need it. Worked through: a 3 s lease renews every 1 s; a write issued at
   * 1 s that rejects at 2.5 s schedules the retry for 3.5 s, half a second
   * after the lease it was meant to save has already gone. Phased against the
   * due time instead, the retry goes out immediately with 500 ms of lease left.
   */
  let dueAt = now();

  function schedule(delayMs: number): void {
    if (stopped) return;
    dueAt = now() + delayMs;
    cancelTimer = timer(() => {
      cancelTimer = undefined;
      void renew().then(() => {
        // The grid position this tick's successor should land on, then the wait
        // that gets there. Floored rather than clamped at zero: a driver that
        // is already past due should retry at once, but a store failing
        // instantly would otherwise spin, and `MIN_RENEWAL_DELAY_MS` is exactly
        // the interval below which a timer cannot be trusted to mean anything.
        const nextDueAt = dueAt + cadence;
        schedule(Math.max(nextDueAt - now(), MIN_RENEWAL_DELAY_MS));
      });
    }, delayMs);
  }

  const remaining = leaseUntil! - now();
  const firstDelay = Math.floor(remaining / RENEWAL_DIVISOR);
  if (firstDelay < MIN_RENEWAL_DELAY_MS) {
    // Below the floor a timer's own jitter is thicker than the margin it is
    // trying to beat, so set none: renew now. On a lease that is already gone
    // this is what makes the loss prompt — the write is declined on the
    // driver's first instruction and the worker stops at once, instead of
    // running another two-thirds of what was left before finding out.
    void renew().then(() =>
      schedule(Math.max(dueAt + cadence - now(), MIN_RENEWAL_DELAY_MS))
    );
  } else {
    schedule(firstDelay);
  }

  return { signal: lost.signal, stop };
}

/**
 * Run `run` while renewing the claim's lease, stopping on every path out.
 *
 * The convenience form of {@link startLeaseRenewal}, for a caller driving
 * `claim` by hand whose whole use of the claim fits in one callback.
 *
 * **Do not settle the task outside `run`.** Renewal stops the moment `run`
 * returns, so a `complete()` or `fail()` issued after it is a ticket-fenced
 * write on a lease nobody is holding open — one slow store round trip and the
 * fence refuses a healthy worker's result, the task is recovered, and its side
 * effects run twice. Either settle inside `run`, or use
 * {@link startLeaseRenewal} directly and `stop()` in a `finally` that closes
 * after the settlement, which is what every first-party seam does.
 *
 * `run` receives the lease-loss signal. Compose it with the request's rather
 * than substituting it, so a cancelled request still stops the work.
 */
export async function withLeaseRenewal<T>(
  options: LeaseRenewalOptions & { run: (leaseLost: AbortSignal) => Promise<T> }
): Promise<T> {
  const driver = startLeaseRenewal(options);
  try {
    return await options.run(driver.signal);
  } finally {
    driver.stop();
  }
}

/**
 * The running driver for the claim whose async chain this call is in
 * (FIX-1005) — the seam a *composed* worker reaches it through.
 *
 * A seam whose work is a statically composed step cannot be handed the driver
 * as an argument, and cannot stash it on sequencer state either: that state is
 * Zod-validated and persisted, and an `AbortController` is neither. It rides
 * `AsyncLocalStorage` instead, which is the mechanism the substrate already
 * uses to give each concurrent worker its own claim ticket — same per-iteration
 * isolation, no new machinery. A closure would be wrong here for a concrete
 * reason: a worker body is built **once** and shared by every worker on a
 * board, so one cell would serve `concurrency` workers at once.
 *
 * The mechanism is right; the way it is entered is easy to get wrong, and the
 * failure is silent. {@link openLeaseRenewalScope} carries that rule.
 */
const renewalScope = new AsyncLocalStorage<RenewalSlot>();

/**
 * The per-iteration cell the driver is published through.
 *
 * A **mutable slot** rather than the driver itself, and that indirection is
 * the whole point — see {@link openLeaseRenewalScope}.
 */
type RenewalSlot = { driver?: LeaseRenewalDriver };

/**
 * Open this worker iteration's renewal slot. **Call it before the first
 * `await` in the block that claims the task** — first statement, no
 * exceptions.
 *
 * `enterWith` mutates the *current* async resource. At the top of a block's
 * body you are still executing on the caller's resource, so the mutation is
 * visible to the sequencer's later steps. After an `await` you are on a
 * continuation resource that dies with the block, so the same call publishes
 * to nobody — silently, with every reader simply seeing `undefined`.
 *
 * That is exactly how this seam failed on arrival: the board's setup tap
 * stamped the driver after awaiting the collection and a `patchState`, so the
 * worker never ran under the lease-loss signal and neither recorder could stop
 * the driver. Nothing failed loudly, because a settled task makes renewal stop
 * itself (the write is declined `terminal`) — so only a task that is never
 * settled, which is precisely the suspension case, showed the leak.
 *
 * Splitting "open the slot" from "install the driver" is what makes the rule
 * followable: opening takes no arguments, so it can always be hoisted above
 * the awaits that produce the driver.
 */
export function openLeaseRenewalScope(): void {
  renewalScope.enterWith({});
}

/**
 * Publish `driver` into the slot {@link openLeaseRenewalScope} opened, so the
 * steps that follow can run under its signal and stop it when they settle the
 * task.
 *
 * Throws when no slot is open rather than returning quietly: a driver nobody
 * can reach renews a lease forever, and that failure is invisible at runtime.
 * Better to fail at the call site than to ship a mechanism that does nothing.
 */
export function stampLeaseRenewal(driver: LeaseRenewalDriver): void {
  const slot = renewalScope.getStore();
  if (slot === undefined) {
    // Don't leave the caller's driver running when we are about to reject it.
    driver.stop();
    throw new Error(
      `[tasks] stampLeaseRenewal() was called with no renewal scope open. ` +
        `Call openLeaseRenewalScope() before the first await in the block that ` +
        `claims the task — after an await the scope is published to nobody.`
    );
  }
  slot.driver = driver;
}

/**
 * The renewal driver of the claim whose async chain this call is running in,
 * or `undefined` outside one.
 *
 * Read twice per iteration: by a step's `abortSignal` resolver, so the work
 * runs under the lease-loss signal, and by whichever recorder settles the
 * task, to stop renewing.
 */
export function currentLeaseRenewal(): LeaseRenewalDriver | undefined {
  return renewalScope.getStore()?.driver;
}

/**
 * Run the block body that claims a task inside a fresh renewal scope, and stop
 * whatever driver that body stamped if the body does not finish.
 *
 * **Call it before the first `await` in the claiming block** — it opens the
 * scope, so it inherits {@link openLeaseRenewalScope}'s rule unchanged. In
 * practice that means `execute: async (input, ctx) => withLeaseRenewalScope(…)`,
 * where the wrapper call *is* the first statement.
 *
 * **Why the guarantee has to live here rather than in the caller's ordering.**
 * Every way of *leaving the work* is already covered: the step that dispatches
 * the worker carries `onSettled`, which runs whether the worker returned, threw
 * or suspended, and a cancelled request stops the driver through the ambient
 * signal. What none of those cover is the hand-off — the window between the
 * claim committing and that step being reached. The claiming block still has to
 * write its state and emit its status, and if either fails the work step never
 * runs, so no recorder and no `onSettled` ever fires. A failed request does not
 * abort its own signal either. The timer would go on renewing a row nobody is
 * working for as long as the host lives, and because the lease is exactly the
 * signal `claim()` reads to decide a row is abandoned, no other worker could
 * ever recover it. That is the deadlock this whole mechanism exists to remove,
 * rebuilt out of a failed state write.
 *
 * The two seams that claim and work in *different* steps — the task board's
 * worker body and `routedSpecialists` — each hand-rolled that hand-off, and
 * only one of them happened to put the driver start last where nothing could
 * fail after it. Ordering is not a property a reader can check or a test can
 * pin, so it is not the thing to rely on: the `catch` here makes where the
 * driver starts irrelevant, which is what makes both seams correct for the same
 * stated reason rather than by accident.
 *
 * Stopping is deliberately *all* it does. It does not settle the task or
 * release the claim — the row's lease simply lapses and the substrate hands it
 * to the next worker, which is the ordinary recovery path rather than a special
 * one.
 */
export async function withLeaseRenewalScope<T>(setup: () => Promise<T>): Promise<T> {
  openLeaseRenewalScope();
  try {
    return await setup();
  } catch (err) {
    currentLeaseRenewal()?.stop();
    throw err;
  }
}
