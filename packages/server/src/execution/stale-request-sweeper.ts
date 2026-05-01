/**
 * Server-internal sweeper that periodically marks stuck requests interrupted.
 *
 * Reads the active request registry on a fixed interval and calls
 * `detectInterruptedRequests` for any entry whose heartbeat is older than the
 * configured threshold. A "stuck" entry usually means the executing process
 * died or got cut off — its registry heartbeat stopped, but the persisted
 * request record still says `in_progress`.
 *
 * The sweeper is idempotent and race-safe: `detectInterruptedRequests`
 * already guards on `requestRecord.status === "in_progress"` before writing,
 * so a request that just transitioned to a terminal status will not be
 * overwritten. Choose `staleThresholdMs >= 2 * heartbeatIntervalMs` to keep
 * the safety window comfortable for healthy executors.
 */
import { detectInterruptedRequests } from "./request-recovery";
import type { StoreRegistry } from "../stores/types";
import {
  DEFAULT_RUNTIME_LOGGER,
  logRuntimeEvent,
  type RuntimeLogger
} from "./logging";

export type CreateStaleRequestSweeperOptions = {
  stores: StoreRegistry;
  /**
   * How often the sweeper runs (milliseconds). Default: 30000 (30s).
   * Set to 0 or a negative number to disable; the returned handle's
   * `dispose` is a no-op.
   */
  intervalMs?: number;
  /**
   * Stale threshold (milliseconds). Entries with `lastHeartbeatAt` older
   * than `Date.now() - staleThresholdMs` are eligible to be marked
   * `interrupted`. Default: 60000 (60s).
   */
  staleThresholdMs?: number;
  /**
   * Registry heartbeat interval the executor uses (milliseconds). Used only
   * for the "is your threshold sane?" warning. The sweeper does not consult
   * per-flow `request.heartbeatIntervalMs` because flows can be registered
   * after the router (and therefore after this sweeper) has been built.
   * Default: 10000 (10s) — matches `runAction`'s default.
   */
  registryHeartbeatMs?: number;
  logger?: RuntimeLogger;
};

export type StaleRequestSweeper = {
  /** Stop the periodic sweep. Idempotent. */
  dispose(): void;
};

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_THRESHOLD_MS = 60_000;
const DEFAULT_REGISTRY_HEARTBEAT_MS = 10_000;

/**
 * Build a stale-request sweeper. Returns a handle whose `dispose` clears
 * the underlying interval — call it on router teardown to avoid leaking a
 * timer (vitest will report an open handle if you don't).
 */
export function createStaleRequestSweeper(
  options: CreateStaleRequestSweeperOptions
): StaleRequestSweeper {
  const {
    stores,
    intervalMs = DEFAULT_INTERVAL_MS,
    staleThresholdMs = DEFAULT_THRESHOLD_MS,
    registryHeartbeatMs = DEFAULT_REGISTRY_HEARTBEAT_MS,
    logger = DEFAULT_RUNTIME_LOGGER
  } = options;

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return { dispose: () => {} };
  }

  // Sanity check: thresholds shorter than 2× the executor's registry
  // heartbeat will fight with healthy heartbeats and produce false positives.
  if (
    Number.isFinite(staleThresholdMs) &&
    Number.isFinite(registryHeartbeatMs) &&
    registryHeartbeatMs > 0 &&
    staleThresholdMs < 2 * registryHeartbeatMs
  ) {
    logRuntimeEvent(
      logger,
      "warn",
      "[flow-state] stale-request sweeper threshold may be too low",
      {
        staleThresholdMs,
        registryHeartbeatMs,
        recommendedMinimumMs: 2 * registryHeartbeatMs
      }
    );
  }

  let disposed = false;

  let inFlight = false;
  const tick = (): void => {
    if (disposed || inFlight) return;
    inFlight = true;
    detectInterruptedRequests({ stores, staleThresholdMs, logger })
      .catch((err) => {
        logRuntimeEvent(
          logger,
          "error",
          "[flow-state] stale-request sweeper iteration failed",
          { error: err instanceof Error ? err.message : String(err) }
        );
      })
      .finally(() => {
        inFlight = false;
      });
  };

  const timer = setInterval(tick, intervalMs);
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
