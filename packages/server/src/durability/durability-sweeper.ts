/**
 * Server-internal retention sweeper for durable-execution artifacts.
 *
 * Runs on a fixed interval and, on each tick, performs five independent
 * maintenance steps against the durability stores:
 *
 *   1. Acquire a single-holder sentinel lease so only one host sweeps at a
 *      time (reuses the existing LeaseStore to avoid a multi-host thundering
 *      herd against the same rows).
 *   2. Enforce suspension expiry: any `pending` suspension past its
 *      `expiresAt` is re-set to `expired` (closes the FIX-140 gap where
 *      expiry was recorded but never enforced, so the resume endpoint can
 *      reject stale gates).
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
 * Mirrors `execution/stale-request-sweeper.ts` for the timer mechanics:
 * `setInterval` + `unref()`, an `inFlight` re-entrancy guard, an idempotent
 * `dispose()`, and a no-op handle when the interval is disabled.
 */

import type { StoreRegistry } from "../stores/types";
import type { RequestStatus, SuspensionRecord } from "@flow-state-dev/core/types";
import {
  DEFAULT_RUNTIME_LOGGER,
  logRuntimeEvent,
  type RuntimeLogger
} from "../execution/logging";
import type { DurabilityProvider } from "./types";

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
 * Build a durability retention sweeper. Returns a handle whose `dispose`
 * clears the underlying interval — call it on router teardown to avoid
 * leaking a timer. When `sweepIntervalMs <= 0` (or non-finite) the returned
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
    logger = DEFAULT_RUNTIME_LOGGER
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

  const tick = (): void => {
    if (disposed || inFlight) return;
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
      batchLimit
    })
      .catch((err) => {
        // A failure that escapes the per-step guards is still never thrown
        // out of the interval callback — log and continue next tick.
        logRuntimeEvent(
          logger,
          "error",
          "[flow-state] durability sweeper iteration failed",
          { error: err instanceof Error ? err.message : String(err) }
        );
      })
      .finally(() => {
        inFlight = false;
      });
  };

  const timer = setInterval(tick, sweepIntervalMs);
  // Don't keep a Node process alive solely for the sweeper.
  if (typeof (timer as unknown as { unref?: () => void }).unref === "function") {
    (timer as unknown as { unref: () => void }).unref();
  }

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
    }
  };
}

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
export async function runTick(rawArgs: RunTickArgs): Promise<void> {
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
  if (lease === null) return;

  try {
    await enforceSuspensionExpiry(args, now);
    await pruneTerminalSuspensions(args, now);
    await pruneExpiredLeases(args);
    await pruneOrphanCheckpoints(args, now);
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
async function enforceSuspensionExpiry(args: ResolvedTickArgs, now: number): Promise<void> {
  const { provider, logger } = args;
  try {
    const pending = await provider.listSuspended({ status: "pending" });
    for (const record of pending) {
      if (record.expiresAt != null && record.expiresAt <= now) {
        const expired: SuspensionRecord = {
          ...record,
          status: "expired",
          resolvedAt: now
        };
        await provider.suspend(expired);
      }
    }
  } catch (err) {
    logRuntimeEvent(logger, "error", "[flow-state] durability sweeper: expiry enforcement failed", {
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
      let offset = 0;
      let scanned = 0;
      while (scanned < batchLimit) {
        const records = await stores.request.list({ status, limit: batchLimit, offset });
        if (records.length === 0) break;
        for (const rec of records) {
          scanned++;
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
