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
 *      reject stale gates). An **ask gate** is the exception: it is resumed
 *      with `wait_timed_out` instead (FIX-1816), because an `expired` ask gate
 *      would strand its turn: nothing else may resume it.
 *   2b. Re-drive a request left `suspended` or `interrupted` behind a gate that
 *      is already resolved (an ask's answer, failure, timeout or stop, or any
 *      gate stopped), under the request's lease, with the recorded outcome;
 *      and stop a parked request whose stop was recorded while it was still
 *      running (`abortRequested`), as a stop of a parked turn does.
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
 * Scheduling is deadline-aware, and derived from the store. After every tick,
 * whatever it came to, the timer is re-armed from the pending ask gates: those
 * step 2 read and left pending when the tick ran, or a fresh read when it did
 * not (the sweep lease held by another host, or a failure). It is re-armed for
 * the earlier of `sweepIntervalMs` and the earliest deadline among them, never
 * sooner than `MIN_TICK_DELAY_MS`. An ask still pending past its deadline (its
 * turn was busy, still being written parked, or the resume failed) is retried
 * after `OVERDUE_ASK_RETRY_MS`, for up to one interval past its deadline; an
 * idle host keeps its interval. A turn that parks on an ask in this process
 * also notes its deadline (`ask-deadlines.ts`, keyed on the durability
 * provider), and the `onAskDeadline` listener brings the armed tick forward:
 * an optimization the re-arm does not depend on. One timer per host, never one
 * per ask.
 *
 * Otherwise mirrors `execution/stale-request-sweeper.ts`: `unref()` on the
 * timer, an `inFlight` re-entrancy guard (a tick due while one runs is pushed
 * back by the floor), an idempotent `dispose()` that also stops listening, and
 * a no-op handle when the interval is disabled.
 */

import type { RequestRecord, StoreRegistry } from "../stores/types";
import type { RequestStatus, SuspensionRecord } from "@flow-state-dev/core/types";
import {
  DEFAULT_RUNTIME_LOGGER,
  logRuntimeEvent,
  type RuntimeLogger
} from "../execution/logging";
import type { DurabilityProvider } from "./types";
import { isAskGate } from "@flow-state-dev/core/types";
import { resumeAskGate } from "./resume-ask-gate";
import { onAskDeadline } from "./ask-deadlines";
import { PARKED, redriveResolvedGate, stopSuspendedRequest } from "./stop-suspended";
import { latestGateIdOf } from "./resume-under-lease";
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
   * Continues a suspended request, so an overdue ask can be resumed with
   * `wait_timed_out`. Absent → overdue ask gates are left pending (never
   * marked expired, which would strand the turn).
   */
  continueRequest?: ResumeDeps["continueRequest"];
  /**
   * Whether the retention steps (3 to 5: pruning) run. Default true. A host
   * with durable execution but no retention policy sweeps with this off: its
   * gates are still kept (expiry, ask timeouts, re-drive, stop carry), and
   * nothing is pruned.
   */
  prune?: boolean;
};

/** Handle returned by {@link createDurabilitySweeper}. */
export type DurabilitySweeper = {
  /** Stop the periodic sweep. Idempotent. */
  dispose(): void;
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
    prune = true
  } = options;

  const sweepIntervalMs = retention.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const checkpointMaxAgeMs = retention.checkpointMaxAgeMs ?? DEFAULT_CHECKPOINT_MAX_AGE_MS;
  const suspensionTerminalMaxAgeMs =
    retention.suspensionTerminalMaxAgeMs ?? DEFAULT_SUSPENSION_TERMINAL_MAX_AGE_MS;
  const orphanCheckpointThresholdMs =
    retention.orphanCheckpointThresholdMs ?? DEFAULT_ORPHAN_CHECKPOINT_THRESHOLD_MS;
  const batchLimit = retention.batchLimit ?? DEFAULT_BATCH_LIMIT;

  if (!Number.isFinite(sweepIntervalMs) || sweepIntervalMs <= 0) {
    return { dispose: () => {} };
  }

  let disposed = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** When the armed timer fires (epoch ms); infinite while none is armed. */
  let nextAt = Number.POSITIVE_INFINITY;

  // The next tick is the earlier of the interval and the earliest pending ask
  // deadline, so an ask times out within about a second of its deadline on a
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

  // When the next tick is due, from the pending ask gates (the tick's own, or
  // read here when it has none): the earliest deadline, an overdue one retried
  // shortly, else the interval.
  const nextDelay = async (tickPending: SuspensionRecord[] | undefined): Promise<number> => {
    if (continueRequest === undefined) return sweepIntervalMs;
    try {
      const pending = tickPending ?? (await provider.listSuspended({ status: "pending" }));
      const now = Date.now();
      let due = Number.POSITIVE_INFINITY;
      for (const gate of pending) {
        if (!isAskGate(gate) || gate.expiresAt == null) continue;
        if (gate.expiresAt > now) due = Math.min(due, gate.expiresAt);
        else if (now - gate.expiresAt < sweepIntervalMs) due = Math.min(due, now + OVERDUE_ASK_RETRY_MS);
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
      prune
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

  // An ask parked in this process brings the armed tick forward.
  const stopListening = onAskDeadline(provider, (deadline) => {
    arm(deadline - Date.now());
  });

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopListening();
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}

/** The soonest a tick runs after the last one, or after a deadline is noted. */
const MIN_TICK_DELAY_MS = 1_000;

/** How soon an ask still pending past its deadline is tried again. */
const OVERDUE_ASK_RETRY_MS = 5_000;

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
 * Closes the gate so the resume endpoint rejects it.
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
    // The ask gates still pending after this step, which the next tick is
    // scheduled from: those not yet due, and any overdue one its resume left
    // pending (re-read, so a resumed gate does not count).
    const stillPending: SuspensionRecord[] = [];
    let askGatesSkipped = 0;
    for (const record of pending) {
      if (record.expiresAt == null) continue;
      if (record.expiresAt > now) {
        if (isAskGate(record)) stillPending.push(record);
        continue;
      }
      if (isAskGate(record)) {
        // Never `expired`: nothing else may resume an ask gate, so that would
        // strand its turn. Without a way to continue a request, leave it
        // pending for a sweeper that has one.
        if (args.continueRequest === undefined) {
          askGatesSkipped += 1;
          continue;
        }
        await resumeOverdueAsk(args, record);
        const after = await provider.loadSuspension(record.requestId, record.suspensionId);
        if (after?.status === "pending") stillPending.push(after);
        continue;
      }
      // Re-load immediately before writing: an operator may have approved or
      // rejected this suspension via the resume endpoint between the list read
      // above and this write. Skipping unless it is still `pending` shrinks the
      // clobber window from the whole iteration to a single roundtrip, so the
      // sweeper can't overwrite a just-resolved audit record with `expired`.
      // (A full fix needs a store-level CAS the SuspensionStore API lacks.)
      const current = await provider.loadSuspension(
        record.requestId,
        record.suspensionId
      );
      if (current === null || current.status !== "pending") continue;
      await provider.suspend({ ...current, status: "expired", resolvedAt: now });
    }
    if (askGatesSkipped > 0) {
      logRuntimeEvent(
        logger,
        "warn",
        "[flow-state] durability sweeper: overdue ask gates left pending, no way to continue a request",
        { count: askGatesSkipped }
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
 * resolved (FIX-1816, BR-11a, BR-16c). An ask gate answered, failed, timed out
 * or stopped, or any gate stopped, whose request is still `suspended` or
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
      // Owed a re-drive: an ask's answer or ending, or any gate stopped.
      if (gate === null) return;
      if (gate.status !== "stopped" && !(gate.status === "submitted" && isAskGate(gate))) return;
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
 * The ask branch of step 2: resume an overdue ask gate with `wait_timed_out`,
 * through the same resume every ask takes (fenced on the gate still being
 * pending, under the request's lease). The resumed call ends the asked task.
 * Per-gate failures are logged and the sweep moves on. A gate this leaves
 * pending (the turn busy, not yet written parked, or the resume failed) is
 * retried by the next tick, which is scheduled from the pending gates.
 */
async function resumeOverdueAsk(args: ResolvedTickArgs, record: SuspensionRecord): Promise<void> {
  const { provider, stores, logger, continueRequest } = args;
  if (continueRequest === undefined) return;
  try {
    const result = await resumeAskGate(
      { provider, stores, continueRequest },
      record,
      {
        answered: false,
        error: {
          code: "wait_timed_out",
          message: "The ask was still open at its deadline, so it timed out."
        }
      },
      "durability-sweeper"
    );
    if (result.ok) return;
    if (result.refused === "already-resolved") {
      // The gate was listed pending this tick, yet the resume found it (or its
      // turn) already past waiting: the answer won the race, or the record and
      // its request disagree. Nothing to change; worth seeing if it recurs.
      logRuntimeEvent(logger, "warn", "[flow-state] durability sweeper: overdue ask gate already resolved", {
        requestId: record.requestId,
        suspensionId: record.suspensionId,
        detail: result.detail
      });
      return;
    }
    logRuntimeEvent(logger, "info", "[flow-state] durability sweeper: overdue ask not resumed", {
      requestId: record.requestId,
      suspensionId: record.suspensionId,
      refused: result.refused
    });
  } catch (err) {
    logRuntimeEvent(logger, "error", "[flow-state] durability sweeper: overdue ask resume failed", {
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
