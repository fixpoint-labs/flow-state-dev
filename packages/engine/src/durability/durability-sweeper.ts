/**
 * Server-internal retention sweeper for durable-execution artifacts.
 *
 * Runs on a re-armed timer and, on each tick, performs six independent
 * maintenance steps against the durability stores:
 *
 *   1. Acquire a single-holder sentinel lease so only one host sweeps at a
 *      time (reuses the existing LeaseStore to avoid a multi-host thundering
 *      herd against the same rows).
 *   2. Enforce suspension expiry: any `pending` suspension past its
 *      `expiresAt` is re-set to `expired` (closes the FIX-140 gap where
 *      expiry was recorded but never enforced, so the resume endpoint can
 *      reject stale gates). A **wait gate** parked before FIX-2082, whose
 *      deadline was its expiry, is the exception: it is resumed with
 *      `wait_timed_out` instead (FIX-1816), because an `expired` wait gate
 *      would strand its turn: nothing else may resume it. This branch goes
 *      once no gate parked before FIX-2082 is left: a wait's deadline is now a
 *      wake (2c).
 *   2b. Re-drive a request left `suspended` or `interrupted` behind a gate that
 *      is already resolved (a wait's answer, failure, timeout or stop, any
 *      gate stopped, an approval that expired, or a gate a person approved,
 *      rejected, submitted or skipped), under the request's lease,
 *      with the recorded outcome; and stop a parked request whose stop was
 *      recorded while it was still running (`abortRequested`), as a stop of a
 *      parked turn does. An approval step 2 just expired is continued here in
 *      the same tick (FIX-1846): the gated call does not run, it returns a
 *      result saying the approval is no longer valid, and the turn carries on.
 *      The `expired` record is the obligation, so a crash before the
 *      continuation runs is finished by the next sweep.
 *   2c. Fire every due wake (FIX-2078 D1): a debt's due time, kept by the
 *      engine until a pass in its session clears it. Each is moved one
 *      {@link WAKE_RETRY_MS} out FIRST, then dispatched as the owner it names
 *      (`fireWake`, the host's dispatch of the internal entry it names), so a
 *      fire that dies, or a pass that dies, leaves the wake to fire again.
 *      The pass it runs clears it, or moves it to its next due time. A
 *      `waitDeadline` wake (FIX-2082 D1) is the sweep's own: it resumes every
 *      wait in that session past its deadline, cancelling nothing, and moves
 *      the wake to the next one (`resumeDueWaits`). A `parkOwed:` wake
 *      (FIX-2269) is the sweep's own as well: a request that died after its
 *      wait started the work and before its gate was written is continued
 *      (`continueOwedPark`).
 *   3. Prune resolved (terminal) suspensions older than the retention window.
 *   4. Prune expired leases (finally wiring `LeaseStore.pruneExpired`).
 *   5. Prune orphaned checkpoints for terminal/interrupted requests whose
 *      cleanup never fired.
 *
 * Resume-safety invariant (step 5): checkpoints of `in_progress`, `suspended`,
 * and `created` requests are NEVER age-pruned — they are the resume points a
 * crashed/suspended request needs to continue. Only the backstop terminal
 * statuses (`completed`/`failed`/`aborted`) and aged-out `interrupted`
 * requests are eligible.
 *
 * Each step is wrapped in its own try/catch: a failure in one step must not
 * skip the others, and a tick failure is logged but NEVER thrown (it would
 * surface as an unhandled rejection from the interval callback).
 *
 * Scheduling is deadline-aware: one timer per host, re-armed after each tick
 * by `nextDelay` (the interval, the earliest wake, or the earliest pending
 * `expiresAt`), never sooner than `MIN_TICK_DELAY_MS`. A wake owed here, or a
 * suspension parked here, brings that tick forward. A host that starts with
 * either already in the store reads it at once.
 *
 * Otherwise mirrors `execution/stale-request-sweeper.ts`: `unref()` on the
 * timer, an `inFlight` re-entrancy guard (a tick due while one runs is pushed
 * back by the floor), an idempotent `dispose()` that also stops listening, and
 * a no-op handle when the interval is disabled.
 */

import type { RequestRecord, StoreRegistry, WakeRecord } from "../stores/types";
import type { RequestStatus, SuspensionRecord, WaitOutcome } from "@flow-state-dev/core/types";
import {
  DEFAULT_RUNTIME_LOGGER,
  logRuntimeEvent,
  type RuntimeLogger
} from "../execution/logging";
import type { DurabilityProvider } from "./types";
import { WAIT_DEADLINE_ENTRY, WAIT_DEADLINE_OUTCOME, isWaitGate, waitGateDataOf } from "@flow-state-dev/core/types";
import { resumeWaitGate } from "./resume-wait-gate";
import { registerWaitSweeper } from "./wait-deadlines";
import { outcomeOfRequest } from "./wait-chain";
import { onWakeOwed } from "./request-wakes";
import { onSuspensionDeadline } from "./suspension-deadlines";
import { owesRedrive, PARKED, redriveResolvedGate, stopSuspendedRequest } from "./stop-suspended";
import { continueUnderLease, expireUnderLease, latestGateIdOf } from "./resume-under-lease";
import { PARK_OWED_GIVE_UP_MS, owesPark, parkOwedRequestOf } from "./park-owed";
import type { ResumeDeps } from "./resume-under-lease";

/**
 * Retention policy for the durability sweeper. Every field is optional; the
 * sweeper resolves the documented defaults when a value is absent.
 */
export interface DurabilityRetentionConfig {
  /** Sweep cadence (ms). 0 or negative disables the sweeper. Default 600_000 (10min). */
  sweepIntervalMs?: number;
  /**
   * Backstop max-age (ms) for checkpoints of TERMINAL requests
   * (completed/failed/aborted) whose cleanup never fired. Default 86_400_000 (24h).
   * Checkpoints of in_progress/suspended requests are NEVER pruned by age.
   */
  checkpointMaxAgeMs?: number;
  /** Retention window (ms) for resolved suspensions, measured from resolvedAt. Default 604_800_000 (7d). */
  suspensionTerminalMaxAgeMs?: number;
  /**
   * Max-age (ms) past a non-terminal (interrupted) request's last activity before its
   * checkpoints are considered orphaned and eligible for pruning. Default 86_400_000 (24h).
   */
  orphanCheckpointThresholdMs?: number;
  /** Max records deleted per store per tick (batch budget). Default 1000. */
  batchLimit?: number;
}

/** Options for {@link createDurabilitySweeper}. */
export type CreateDurabilitySweeperOptions = {
  /** Durability provider for suspension/lease/checkpoint operations. */
  provider: DurabilityProvider;
  /** Store registry — used for `leases.pruneExpired()` and `request.list()`. */
  stores: StoreRegistry;
  /** Retention policy. Defaults applied per field when absent. */
  retention?: DurabilityRetentionConfig;
  /** Lease holder id for the sweeper's sentinel lease. Default: a per-process id. */
  holder?: string;
  logger?: RuntimeLogger;
  /**
   * Continues a suspended request, so an overdue wait can be resumed with
   * `wait_timed_out`, and the turn of an expired approval carries on.
   * Absent → overdue wait gates are left pending (never marked expired, which
   * would strand the turn), and expired approvals wait for a sweeper that has
   * one.
   */
  continueRequest?: ResumeDeps["continueRequest"];
  /**
   * Whether the retention steps (3 to 5: pruning) run. Default true. A host
   * with durable execution but no retention policy sweeps with this off: its
   * gates are still kept (expiry, wait timeouts, re-drive, stop carry), and
   * nothing is pruned.
   */
  prune?: boolean;
  /**
   * Fire a due wake (FIX-2078 D1): dispatch the internal entry it names, in
   * its session, as its owner. Resolves once the host accepted the dispatch.
   * Absent, or with stores that keep no wakes, the wake step is off.
   */
  fireWake?: (wake: WakeRecord) => Promise<void>;
};

/** Handle returned by {@link createDurabilitySweeper}. */
export type DurabilitySweeper = {
  /** Stop the periodic sweep. Idempotent. */
  dispose(): void;
  /**
   * Whether this sweeper times out overdue waits now: it runs (a positive
   * interval, not disposed) and can resume a turn (`continueRequest`). A host
   * that built it reads this as `RequestHost.hasWaitSweeper`.
   */
  timesOutWaits(): boolean;
};

const DEFAULT_SWEEP_INTERVAL_MS = 600_000;
const DEFAULT_CHECKPOINT_MAX_AGE_MS = 86_400_000;
const DEFAULT_SUSPENSION_TERMINAL_MAX_AGE_MS = 604_800_000;
const DEFAULT_ORPHAN_CHECKPOINT_THRESHOLD_MS = 86_400_000;
const DEFAULT_BATCH_LIMIT = 1000;

/** Sentinel requestId under which the sweeper takes its single-holder lease. */
const SWEEPER_LEASE_KEY = "__durability_sweeper__";

/**
 * Per-process default lease holder. A random suffix distinguishes multiple
 * processes on the same host so the sentinel lease genuinely serializes hosts.
 */
function defaultHolder(): string {
  return `durability-sweeper-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Request statuses a turn has ended in: nothing it parked on is waited on. */
const ENDED_STATUSES: RequestStatus[] = ["completed", "failed", "incomplete", "aborted"];

/** Terminal request statuses whose checkpoints are backstop-prunable by age. */
const PRUNABLE_TERMINAL_STATUSES: RequestStatus[] = ["completed", "failed", "aborted"];

/**
 * Safety bound on pages scanned per status per tick in the orphan-checkpoint
 * step. The request table is already bounded by session retention, so this is
 * a guard against pathological growth, not the normal stopping condition.
 */
const MAX_SCAN_PAGES = 1000;

/**
 * Build a durability retention sweeper. Returns a handle whose `dispose`
 * clears the underlying timer and its deadline listener — call it on router
 * teardown to avoid leaking a timer. When `sweepIntervalMs <= 0` (or non-finite) the returned
 * handle is a no-op with no timer.
 */
export function createDurabilitySweeper(
  options: CreateDurabilitySweeperOptions
): DurabilitySweeper {
  const {
    provider,
    stores,
    retention = {},
    holder = defaultHolder(),
    logger = DEFAULT_RUNTIME_LOGGER,
    continueRequest,
    prune = true,
    fireWake
  } = options;
  // The wake step runs with a store that keeps wakes and something to do
  // with one: fire its entry, or resume the waits whose deadline it carries.
  const wakes = fireWake !== undefined || continueRequest !== undefined ? stores.wakes : undefined;

  const sweepIntervalMs = retention.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const checkpointMaxAgeMs = retention.checkpointMaxAgeMs ?? DEFAULT_CHECKPOINT_MAX_AGE_MS;
  const suspensionTerminalMaxAgeMs =
    retention.suspensionTerminalMaxAgeMs ?? DEFAULT_SUSPENSION_TERMINAL_MAX_AGE_MS;
  const orphanCheckpointThresholdMs =
    retention.orphanCheckpointThresholdMs ?? DEFAULT_ORPHAN_CHECKPOINT_THRESHOLD_MS;
  const batchLimit = retention.batchLimit ?? DEFAULT_BATCH_LIMIT;

  if (!Number.isFinite(sweepIntervalMs) || sweepIntervalMs <= 0) {
    return { dispose: () => {}, timesOutWaits: () => false };
  }

  let disposed = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** When the armed timer fires (epoch ms); infinite while none is armed. */
  let nextAt = Number.POSITIVE_INFINITY;

  // The next tick is the earlier of the interval and the earliest pending wait
  // deadline, so a wait times out within about a second of its deadline on a
  // long-lived host rather than up to an interval late. Floored, never a busy
  // loop; an idle host keeps its interval.
  const arm = (delayMs: number): void => {
    if (disposed) return;
    const delay = Math.min(sweepIntervalMs, Math.max(MIN_TICK_DELAY_MS, delayMs));
    // Never push back a tick already armed sooner.
    if (Date.now() + delay >= nextAt) return;
    if (timer !== undefined) clearTimeout(timer);
    nextAt = Date.now() + delay;
    timer = setTimeout(tick, delay);
    // Don't keep a Node process alive solely for the sweeper.
    if (typeof (timer as unknown as { unref?: () => void }).unref === "function") {
      (timer as unknown as { unref: () => void }).unref();
    }
  };

  // When the next tick is due, from the pending gates with a deadline (the
  // tick's own, or read here when it has none): the earliest deadline, an
  // overdue one retried shortly, else the interval. A person's stop counts as
  // a wait's does (FIX-2063 D3): its `expiresAt` is the deadline this host's
  // sweeper fires, with no second loop.
  const nextDelay = async (tickPending: SuspensionRecord[] | undefined): Promise<number> => {
    if (continueRequest === undefined && wakes === undefined) return sweepIntervalMs;
    try {
      const now = Date.now();
      let due = Number.POSITIVE_INFINITY;
      // The earliest wake: one already due is fired at the floor.
      if (wakes !== undefined) {
        const wakeDue = await wakes.earliestDueAt();
        if (wakeDue !== null) due = Math.min(due, Math.max(wakeDue, now));
      }
      if (continueRequest === undefined) return due === Number.POSITIVE_INFINITY ? sweepIntervalMs : due - now;
      const pending = tickPending ?? (await provider.listSuspended({ status: "pending" }));
      for (const gate of pending) {
        if (gate.expiresAt == null) continue;
        if (gate.expiresAt > now) due = Math.min(due, gate.expiresAt);
        else if (now - gate.expiresAt < sweepIntervalMs) due = Math.min(due, now + OVERDUE_WAIT_RETRY_MS);
      }
      return due === Number.POSITIVE_INFINITY ? sweepIntervalMs : due - now;
    } catch (err) {
      logRuntimeEvent(logger, "error", "[flow-state] durability sweeper: next tick read failed", {
        error: err instanceof Error ? err.message : String(err)
      });
      return sweepIntervalMs;
    }
  };

  const tick = (): void => {
    if (disposed) return;
    timer = undefined;
    nextAt = Number.POSITIVE_INFINITY;
    if (inFlight) {
      arm(MIN_TICK_DELAY_MS);
      return;
    }
    inFlight = true;
    void runTick({
      provider,
      stores,
      logger,
      holder,
      sweepIntervalMs,
      checkpointMaxAgeMs,
      suspensionTerminalMaxAgeMs,
      orphanCheckpointThresholdMs,
      batchLimit,
      continueRequest,
      prune,
      ...(fireWake !== undefined ? { fireWake } : {})
    })
      .catch((err): undefined => {
        // A failure that escapes the per-step guards is still never thrown
        // out of the interval callback — log and continue next tick.
        logRuntimeEvent(
          logger,
          "error",
          "[flow-state] durability sweeper iteration failed",
          { error: err instanceof Error ? err.message : String(err) }
        );
        return undefined;
      })
      .then(nextDelay)
      .then((delay) => {
        inFlight = false;
        arm(delay);
      });
  };

  arm(sweepIntervalMs);
  // A host that starts with a debt or a deadline already in the store (a crash
  // left it, or a one-shot `fsdev run` parked a person's stop) is armed for it
  // now, not an interval later.
  if (wakes !== undefined || continueRequest !== undefined) void nextDelay(undefined).then(arm);

  // Only a sweeper that can resume a wait at its deadline registers: that is
  // how the host tells a request a wait is bounded here (`hasWaitSweeper`). A
  // wait's deadline is a wake (FIX-2082 D1), so owing it brings the armed tick
  // forward through the wake listener below.
  const stopListening =
    continueRequest === undefined || stores.wakes === undefined ? () => {} : registerWaitSweeper(provider);

  // A wake owed in this process brings the armed tick forward to its due time.
  const stopHearingWakes =
    wakes === undefined ? () => {} : onWakeOwed(wakes, (dueAt) => arm(dueAt - Date.now()));
  // So does a suspension's deadline parked in this process, which only a
  // sweeper that can continue a request acts on (as `nextDelay` reads them).
  const stopHearingDeadlines =
    continueRequest === undefined ? () => {} : onSuspensionDeadline(provider, (expiresAt) => arm(expiresAt - Date.now()));

  return {
    timesOutWaits: () => !disposed && continueRequest !== undefined && stores.wakes !== undefined,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopListening();
      stopHearingWakes();
      stopHearingDeadlines();
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}

/** The soonest a tick runs after the last one, or after a deadline is noted. */
const MIN_TICK_DELAY_MS = 1_000;

/** How soon a wait still pending past its deadline is tried again. */
const OVERDUE_WAIT_RETRY_MS = 5_000;

/**
 * How far a wake is moved out as it is fired (FIX-2078 D1): the pass it runs
 * settles it within that time, so it fires again only when the fire or the
 * pass died.
 */
export const WAKE_RETRY_MS = 30_000;

type RunTickArgs = {
  provider: DurabilityProvider;
  stores: StoreRegistry;
  /** Defaults to {@link DEFAULT_RUNTIME_LOGGER} when omitted. */
  logger?: RuntimeLogger;
  holder: string;
  sweepIntervalMs: number;
  checkpointMaxAgeMs: number;
  suspensionTerminalMaxAgeMs: number;
  orphanCheckpointThresholdMs: number;
  batchLimit: number;
  /** See {@link CreateDurabilitySweeperOptions.continueRequest}. */
  continueRequest?: ResumeDeps["continueRequest"];
  /** See {@link CreateDurabilitySweeperOptions.prune}. Default true. */
  prune?: boolean;
  /** See {@link CreateDurabilitySweeperOptions.fireWake}. */
  fireWake?: (wake: WakeRecord) => Promise<void>;
};

/** {@link RunTickArgs} with the logger resolved to a concrete sink. */
type ResolvedTickArgs = RunTickArgs & { logger: RuntimeLogger };

/**
 * Run one sweep. Acquires the sentinel lease; if another host holds it, the
 * tick is a no-op. Each maintenance step is independently guarded so one
 * failure does not skip the rest. The lease is released in a `finally`.
 *
 * Exported for direct invocation in tests (a single deterministic sweep
 * without driving the interval timer).
 */
export async function runTick(rawArgs: RunTickArgs): Promise<SuspensionRecord[] | undefined> {
  // Normalize the logger once so each step's defensive logging has a sink.
  const args: ResolvedTickArgs = {
    ...rawArgs,
    logger: rawArgs.logger ?? DEFAULT_RUNTIME_LOGGER
  };
  const { provider, holder, sweepIntervalMs, logger } = args;
  const now = Date.now();

  const lease = await provider.acquireLease(SWEEPER_LEASE_KEY, {
    holder,
    durationMs: sweepIntervalMs
  });
  // Another host holds the sweep lease — skip the entire tick.
  if (lease === null) return undefined;

  try {
    const pending = await enforceSuspensionExpiry(args, now);
    await redriveResolvedGates(args);
    await fireDueWakes(args, now);
    if (args.prune !== false) {
      await pruneTerminalSuspensions(args, now);
      await pruneExpiredLeases(args);
      await pruneOrphanCheckpoints(args, now);
    }
    return pending;
  } finally {
    await provider
      .releaseLease(SWEEPER_LEASE_KEY, lease.leaseId)
      .catch((err) => {
        logRuntimeEvent(logger, "error", "[flow-state] durability sweeper lease release failed", {
          error: err instanceof Error ? err.message : String(err)
        });
      });
  }
}

/**
 * Step 2: re-set every `pending` suspension past its `expiresAt` to `expired`.
 * Closes the gate so the resume endpoint rejects it; an approval's turn is
 * then continued by step 2b.
 */
async function enforceSuspensionExpiry(
  args: ResolvedTickArgs,
  now: number
): Promise<SuspensionRecord[] | undefined> {
  const { provider, logger } = args;
  try {
    // List ALL pending suspensions — deliberately unbounded. `listSuspended`
    // returns newest-first, so a `limit` would skip the OLDEST pending records,
    // which are exactly the ones most likely past `expiresAt`; they would stay
    // `pending` and remain resumable indefinitely. Pending suspensions are
    // bounded by the number of flows concurrently awaiting human input (a small
    // set), unlike the terminal records the other steps prune, so listing all
    // of them each tick is cheap. (A store-level `expiresBefore` predicate could
    // make this bounded-and-correct if pending volume ever grows.)
    const pending = await provider.listSuspended({ status: "pending" });
    // The wait gates still pending after this step, which the next tick is
    // scheduled from: those not yet due, and any overdue one its resume left
    // pending (re-read, so a resumed gate does not count).
    const stillPending: SuspensionRecord[] = [];
    let waitGatesSkipped = 0;
    for (const record of pending) {
      if (record.expiresAt == null) continue;
      if (record.expiresAt > now) {
        stillPending.push(record);
        continue;
      }
      if (isWaitGate(record)) {
        // Never `expired`: nothing else may resume a wait gate, so that would
        // strand its turn. Without a way to continue a request, leave it
        // pending for a sweeper that has one.
        if (args.continueRequest === undefined) {
          waitGatesSkipped += 1;
          continue;
        }
        await resumeOverdueWait(args, record);
        const after = await provider.loadSuspension(record.requestId, record.suspensionId);
        if (after?.status === "pending") stillPending.push(after);
        continue;
      }
      // Fenced: the gate is re-read under its request's lease, so a resume that
      // resolved it after the list above is never overwritten; a lease held
      // elsewhere leaves it pending and on the schedule, so the next tick
      // retries it shortly rather than an interval later. Step 2b continues
      // the turn of an approval expired here (FIX-1846).
      if ((await expireUnderLease(provider, record, "durability-sweeper")) === "busy") stillPending.push(record);
    }
    if (waitGatesSkipped > 0) {
      logRuntimeEvent(
        logger,
        "warn",
        "[flow-state] durability sweeper: overdue wait gates left pending, no way to continue a request",
        { count: waitGatesSkipped }
      );
    }
    return stillPending;
  } catch (err) {
    logRuntimeEvent(logger, "error", "[flow-state] durability sweeper: expiry enforcement failed", {
      error: err instanceof Error ? err.message : String(err)
    });
    return undefined;
  }
}

/**
 * Step 2b: re-drive a request left parked behind a gate that is already
 * resolved (FIX-1816, BR-11a, BR-16c). A wait gate answered, failed, timed out
 * or stopped, any gate stopped, an approval that expired, or any other gate a
 * person resolved (FIX-1850), whose request is still `suspended` or
 * `interrupted`: the process died after the gate's write and before the turn
 * moved on. It is driven on under its lease with the recorded outcome, never a
 * new one. A live resume holds that lease, so it is never raced.
 *
 * Read from the parked requests, not the resolved gates: each `suspended` or
 * `interrupted` request is read with its item log, and the last gate it parked
 * on is loaded by id. Only that gate can be owed, so an older gate of the
 * request never stands in for it, and the work is bounded by how many
 * requests are parked rather than by how many gates were resolved within
 * retention. The parked set is read in full before any is driven, since a
 * re-drive moves its request out of it; paged by start time, which a request
 * never changes, up to {@link MAX_SCAN_PAGES} pages.
 */
async function redriveResolvedGates(args: ResolvedTickArgs): Promise<void> {
  const { provider, stores, logger, continueRequest, batchLimit } = args;
  if (continueRequest === undefined) return;
  const redriveOne = async (requestId: string, suspensionId: string): Promise<void> => {
    try {
      const gate = await provider.loadSuspension(requestId, suspensionId);
      if (gate === null || !owesRedrive(gate)) return;
      const result = await redriveResolvedGate({ provider, stores, continueRequest }, gate);
      if (result === "redriven") {
        logRuntimeEvent(logger, "info", "[flow-state] durability sweeper: re-drove a parked request", {
          requestId: gate.requestId,
          suspensionId: gate.suspensionId,
          status: gate.status
        });
      }
    } catch (err) {
      logRuntimeEvent(logger, "error", "[flow-state] durability sweeper: re-drive failed", {
        requestId,
        suspensionId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  };
  try {
    const parked: { requestId: string; suspensionId: string }[] = [];
    // Parked with a stop recorded while the turn still ran (it was accepted
    // as the turn was being written parked, and the parking run did not carry
    // it onto the gate). Owed the stop.
    const stopOwed: RequestRecord[] = [];
    for (let page = 0; page < MAX_SCAN_PAGES; page++) {
      const batch = await stores.request.list({
        status: PARKED,
        orderBy: "startedAtMs",
        limit: batchLimit,
        offset: page * batchLimit,
        withItems: true
      });
      for (const record of batch) {
        if (record.abortRequested === true) {
          stopOwed.push(record);
          continue;
        }
        const suspensionId = latestGateIdOf(record);
        if (suspensionId !== undefined) parked.push({ requestId: record.id, suspensionId });
      }
      if (batch.length < batchLimit) break;
    }
    for (const record of stopOwed) {
      try {
        // Through the gate's single pending state: if the parking run's own
        // carry, or an answer, got there first, this finds no pending gate and
        // does nothing.
        if ((await stopSuspendedRequest({ provider, stores, continueRequest }, record)) === "stopped") continue;
      } catch (err) {
        logRuntimeEvent(logger, "error", "[flow-state] durability sweeper: carrying a recorded stop failed", {
          requestId: record.id,
          error: err instanceof Error ? err.message : String(err)
        });
        continue;
      }
      // Its gate was already resolved: a stop the carry recorded but did not
      // finish is re-driven like any other.
      const suspensionId = latestGateIdOf(record);
      if (suspensionId !== undefined) parked.push({ requestId: record.id, suspensionId });
    }
    for (const { requestId, suspensionId } of parked) await redriveOne(requestId, suspensionId);
  } catch (err) {
    logRuntimeEvent(logger, "error", "[flow-state] durability sweeper: re-drive listing failed", {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * Step 2c (FIX-2078 D1): fire every due wake. Each is moved one
 * {@link WAKE_RETRY_MS} out, conditional on the version listed, and only then
 * dispatched: a wake written since (an earlier debt) is left as written, and
 * a fire or a pass that dies leaves the wake to fire again. A fire that throws
 * is logged and the step moves on.
 */
async function fireDueWakes(args: ResolvedTickArgs, now: number): Promise<void> {
  const { stores, logger, fireWake, continueRequest, batchLimit } = args;
  const wakes = stores.wakes;
  if ((fireWake === undefined && continueRequest === undefined) || wakes === undefined) return;
  let due: WakeRecord[];
  try {
    due = await wakes.listDue(now, batchLimit);
  } catch (err) {
    logRuntimeEvent(logger, "error", "[flow-state] durability sweeper: due wakes read failed", {
      error: err instanceof Error ? err.message : String(err)
    });
    return;
  }
  for (const wake of due) {
    try {
      // A wait's deadline (FIX-2082 D1): the sweep resumes the waits itself.
      if (wake.entry === WAIT_DEADLINE_ENTRY) {
        await resumeDueWaits(args, wake, now);
        continue;
      }
      // A park a wait owed before it started its work (FIX-2269): the sweep's own too.
      const owing = parkOwedRequestOf(wake.entry);
      if (owing !== undefined) {
        await continueOwedPark(args, wake, owing, now);
        continue;
      }
      if (fireWake === undefined) continue;
      if (!(await wakes.move(wake, wake.version, now + WAKE_RETRY_MS))) continue;
      await fireWake(wake);
    } catch (err) {
      logRuntimeEvent(logger, "warn", "[flow-state] durability sweeper: a due wake was not fired", {
        sessionId: wake.sessionId,
        entry: wake.entry,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
}

/**
 * Step 2c's owed-park branch (FIX-2269): a request owed a park, and the time
 * until it would count as dead has passed. Still `interrupted` (its process
 * died after its wait started the work and before the gate was written), it
 * is continued under its lease as the continue route continues one, and its
 * replay parks on the work it already started. Still running (`in_progress`),
 * the wake moves on. Parked or ended, nothing is owed and
 * the wake is cleared. Owed past {@link PARK_OWED_GIVE_UP_MS} from the first
 * owe, the request is left `interrupted` and the wake let go, so a request
 * that dies at the same place on every replay can't spin the sweep.
 *
 * The wake moves one {@link WAKE_RETRY_MS} out before the continuation, so a
 * continuation that dies before it parks is continued again.
 */
async function continueOwedPark(args: ResolvedTickArgs, wake: WakeRecord, requestId: string, now: number): Promise<void> {
  const { provider, stores, logger, continueRequest } = args;
  const wakes = stores.wakes;
  // Left due for a sweeper that can continue a request.
  if (continueRequest === undefined || wakes === undefined) return;
  const record = await stores.request.get(requestId);
  if (record === undefined || !OWING_STATUSES.includes(record.status)) {
    await wakes.clear(wake, wake.version);
    return;
  }
  if (record.status !== "interrupted") {
    await wakes.move(wake, wake.version, now + WAKE_RETRY_MS);
    return;
  }
  if (now - wake.createdAt > PARK_OWED_GIVE_UP_MS) {
    logRuntimeEvent(logger, "warn", "[flow-state] durability sweeper: a request still owes its park past the give-up age; left interrupted", {
      requestId,
      sessionId: wake.sessionId,
      owedSince: wake.createdAt
    });
    await wakes.clear(wake, wake.version);
    return;
  }
  if (!(await wakes.move(wake, wake.version, now + WAKE_RETRY_MS))) return;
  const result = await continueUnderLease<"not-interrupted">({ provider, continueRequest }, {
    requestId,
    holder: "park-owed",
    admit: async () => {
      // Read again under the lease a stop lets the owe go under (`letOwedParkGo`).
      const current = await stores.request.get(requestId);
      return current?.status === "interrupted" && (await owesPark(wakes, current))
        ? { resumeContext: undefined }
        : { refusal: "not-interrupted" };
    }
  });
  if (result.ok) {
    logRuntimeEvent(logger, "info", "[flow-state] durability sweeper: continued a request that died before it parked", {
      requestId,
      sessionId: wake.sessionId
    });
  }
}

/** Statuses of a request that may still owe its park: running, or dead. */
const OWING_STATUSES: RequestStatus[] = ["in_progress", "interrupted"];

/**
 * Step 2c's wait branch (FIX-2082 D1): a session's `waitDeadline` wake is due.
 * Every wait gate pending in that session past its deadline is resumed with
 * the deadline outcome, nothing cancelled (a gate bound to a request that has
 * already ended is resumed with that request's result instead). Then the wake
 * is moved to the next pending deadline there, or cleared when none is left,
 * conditional on the version listed: a wait that parked meanwhile owed it
 * again and keeps it. A wait still being written (before the wake's `landBy`)
 * holds it there. A resume left pending is tried again shortly.
 */
async function resumeDueWaits(args: ResolvedTickArgs, wake: WakeRecord, now: number): Promise<void> {
  const { provider, stores, continueRequest } = args;
  const wakes = stores.wakes;
  // Left due for a sweeper that can continue a request.
  if (continueRequest === undefined || wakes === undefined) return;
  let next = Number.POSITIVE_INFINITY;
  const gates = await provider.listSuspended({ userId: wake.userId, sessionId: wake.sessionId, status: "pending" });
  for (const gate of gates) {
    if (!isWaitGate(gate)) continue;
    const data = waitGateDataOf(gate);
    // A gate parked before FIX-2082 keeps its deadline on its expiry (step 2).
    if (data?.deadline === undefined) continue;
    if (data.deadline > now) {
      next = Math.min(next, data.deadline);
      continue;
    }
    let outcome: WaitOutcome = WAIT_DEADLINE_OUTCOME;
    if ("requestId" in data.binding) {
      const child = await stores.request.get(data.binding.requestId);
      outcome = (child === undefined ? undefined : outcomeOfRequest(child)) ?? WAIT_DEADLINE_OUTCOME;
    }
    await resumeOverdueWait(args, gate, outcome);
    // Re-read, so a gate its resume left pending (the request busy, or still
    // being written parked) is tried again shortly.
    const after = await provider.loadSuspension(gate.requestId, gate.suspensionId);
    if (after?.status === "pending") next = Math.min(next, now + OVERDUE_WAIT_RETRY_MS);
  }
  const dueAt = next !== Number.POSITIVE_INFINITY ? next : now < wake.landBy ? wake.landBy : null;
  if (dueAt === null) await wakes.clear(wake, wake.version);
  else await wakes.move(wake, wake.version, dueAt);
}

/**
 * Resume one overdue wait gate, through the same resume every wait takes
 * (fenced on the gate still being pending, under the request's lease): with
 * the deadline outcome at a wait's deadline (step 2c), or with
 * `wait_timed_out` for a gate parked before FIX-2082 past its expiry (step 2,
 * which goes once no such gate is left). Per-gate failures are logged and the
 * sweep moves on, and the caller re-reads the gate: one left pending (the
 * request busy, or not yet written parked) is tried again shortly.
 */
async function resumeOverdueWait(
  args: ResolvedTickArgs,
  record: SuspensionRecord,
  outcome: WaitOutcome = {
    answered: false,
    error: { code: "wait_timed_out", message: "The wait was still open at its deadline, so it timed out." }
  }
): Promise<void> {
  const { provider, stores, logger, continueRequest } = args;
  if (continueRequest === undefined) return;
  try {
    const result = await resumeWaitGate({ provider, stores, continueRequest }, record, outcome, "durability-sweeper");
    if (result.ok) return;
    if (result.refused === "already-resolved") {
      // Its turn has ended (a stop that ended it before its replay reached
      // the wait): nothing waits on the gate, so it is expired rather than
      // retried every tick.
      const request = await stores.request.get(record.requestId);
      if (request !== undefined && ENDED_STATUSES.includes(request.status)) {
        const current = await provider.loadSuspension(record.requestId, record.suspensionId);
        if (current?.status === "pending") {
          await provider.suspend({ ...current, status: "expired", resolvedAt: Date.now() });
        }
        return;
      }
      // The gate was listed pending this tick, yet the resume found it (or its
      // turn) already past waiting: the answer won the race, or the record and
      // its request disagree. Nothing to change; worth seeing if it recurs.
      logRuntimeEvent(logger, "warn", "[flow-state] durability sweeper: overdue wait gate already resolved", {
        requestId: record.requestId,
        suspensionId: record.suspensionId,
        detail: result.detail
      });
      return;
    }
    logRuntimeEvent(logger, "info", "[flow-state] durability sweeper: overdue wait not resumed", {
      requestId: record.requestId,
      suspensionId: record.suspensionId,
      refused: result.refused
    });
  } catch (err) {
    logRuntimeEvent(logger, "error", "[flow-state] durability sweeper: overdue wait resume failed", {
      requestId: record.requestId,
      suspensionId: record.suspensionId,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * Step 3: prune terminal suspensions resolved before the retention cutoff.
 * Loops until a partial batch signals the eligible set is drained, capped at
 * a per-tick iteration budget so one tick can't run unbounded.
 */
async function pruneTerminalSuspensions(args: ResolvedTickArgs, now: number): Promise<void> {
  const { provider, suspensionTerminalMaxAgeMs, batchLimit, logger } = args;
  const cutoff = now - suspensionTerminalMaxAgeMs;
  // Bound total work per tick: at most MAX_DRAIN_ITERATIONS full batches.
  const MAX_DRAIN_ITERATIONS = 100;
  try {
    for (let i = 0; i < MAX_DRAIN_ITERATIONS; i++) {
      const n = await provider.pruneSuspensions(cutoff, batchLimit);
      if (n < batchLimit) break;
    }
  } catch (err) {
    logRuntimeEvent(logger, "error", "[flow-state] durability sweeper: suspension prune failed", {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/** Step 4: drop expired leases. */
async function pruneExpiredLeases(args: ResolvedTickArgs): Promise<void> {
  const { stores, logger } = args;
  try {
    await stores.leases.pruneExpired();
  } catch (err) {
    logRuntimeEvent(logger, "error", "[flow-state] durability sweeper: lease prune failed", {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * Step 5: prune orphaned checkpoints. For each backstop terminal status,
 * page through requests (up to the per-tick batch budget) and clean up
 * checkpoints for any whose terminal timestamp predates the max-age cutoff.
 * Also cleans up `interrupted` requests aged past the orphan threshold.
 *
 * Resume-safety: `in_progress`, `suspended`, and `created` requests are never
 * selected — their checkpoints are the resume points an active or paused run
 * needs to continue.
 */
async function pruneOrphanCheckpoints(args: ResolvedTickArgs, now: number): Promise<void> {
  const {
    provider,
    stores,
    checkpointMaxAgeMs,
    orphanCheckpointThresholdMs,
    batchLimit,
    logger
  } = args;
  const terminalCutoff = now - checkpointMaxAgeMs;
  const orphanCutoff = now - orphanCheckpointThresholdMs;

  // Per-status, per-tick: read one batch of records and select the eligible
  // ones. Pages with offset up to the budget so a huge table isn't fully
  // enumerated in one tick.
  const sweepStatus = async (
    status: RequestStatus,
    isEligible: (cutoffSource: number | undefined) => boolean,
    timestampOf: (rec: {
      completedAtMs?: number;
      failedAtMs?: number;
      abortedAt?: number;
      interruptedAt?: number;
    }) => number | undefined
  ): Promise<void> => {
    try {
      // Page through every record of this status. `request.list` returns
      // newest-first, but the records we want are the OLDEST (terminal/interrupt
      // timestamp past the cutoff), which sort to the end — so a single page
      // would miss them once the table exceeds one page. Scan all pages instead;
      // `cleanupCheckpoints` is idempotent, so re-visiting already-cleaned
      // records on later ticks is a cheap no-op. `MAX_SCAN_PAGES` bounds the
      // worst case; the request table is itself bounded by session retention.
      let offset = 0;
      for (let page = 0; page < MAX_SCAN_PAGES; page++) {
        const records = await stores.request.list({ status, limit: batchLimit, offset });
        if (records.length === 0) break;
        for (const rec of records) {
          if (isEligible(timestampOf(rec))) {
            await provider.cleanupCheckpoints(rec.id);
          }
        }
        if (records.length < batchLimit) break;
        offset += records.length;
      }
    } catch (err) {
      logRuntimeEvent(logger, "error", "[flow-state] durability sweeper: checkpoint prune failed", {
        status,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  };

  for (const status of PRUNABLE_TERMINAL_STATUSES) {
    await sweepStatus(
      status,
      (ts) => ts !== undefined && ts < terminalCutoff,
      (rec) => rec.completedAtMs ?? rec.failedAtMs ?? rec.abortedAt
    );
  }

  await sweepStatus(
    "interrupted",
    (ts) => ts !== undefined && ts < orphanCutoff,
    (rec) => rec.interruptedAt
  );
}
