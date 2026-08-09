/**
 * The liveness enablement gate (FIX-999).
 *
 * The liveness verb answers "is this request still running?" by reading the
 * active request registry. Three supported configurations make that answer a
 * lie, each in a different direction, and none of them is detectable from the
 * answer itself. So the decision is made once, at construction, and a
 * configuration that cannot support the signal gets the verb **absent and
 * named** rather than present and wrong.
 *
 * Keeping all three arms here — rather than pushing one into a per-read check —
 * is deliberate: one place answers "can this signal be trusted in this
 * deployment?", and the read stays a plain lookup plus a freshness comparison.
 */
import type { ActiveRequestRegistry } from "../stores/types";
import { isRegistrySharedAcrossProcesses } from "../stores/shared";

/** Why the gate refused to wire the liveness verb. */
export type LivenessRefusalReason =
  | "registry-not-shared"
  | "heartbeat-too-slow"
  | "sweeper-not-running";

/** Construction inputs the gate needs. Each is a fact a host has to travel to it. */
export type LivenessGateInputs = {
  /** The deployment's request registry. Only its sharedness declaration is read. */
  registry: Pick<ActiveRequestRegistry, "sharedAcrossProcesses">;
  /**
   * The executing flow's `request.heartbeatIntervalMs`. `0` is supported and
   * creates no timer, which is exactly the case this gate has to catch.
   */
  heartbeatIntervalMs: number | undefined;
  /** The sweeper's stale threshold — entries older than this are reaped. */
  staleThresholdMs: number | undefined;
  /**
   * The sweeper's cadence. `undefined` means the host cannot say, which is
   * treated as *not sweeping* (fail-closed), same posture as the registry's
   * undeclared sharedness.
   */
  staleSweepIntervalMs: number | undefined;
};

export type LivenessGateVerdict =
  | {
      enabled: true;
      /**
       * Handed to the read so it can compare `lastHeartbeatAt` and treat an
       * entry past the threshold as not live.
       *
       * A nonzero sweep cadence is necessary but **not sufficient**: a cadence
       * much larger than this threshold leaves a worker that crashed just after
       * a sweep registered until the next tick, and a plain `get()` would report
       * it alive for that whole window — blocking reconciliation and holding
       * capacity for a dead request. Comparing freshness at the read is correct
       * however the cadence is tuned, and adds nothing for an operator to tune.
       */
      staleThresholdMs: number;
    }
  | {
      enabled: false;
      reason: LivenessRefusalReason;
      /** Operator-facing explanation. Branch on `reason`, not on this. */
      detail: string;
    };

const DEFAULT_HEARTBEAT_MS = 10_000;
const DEFAULT_STALE_THRESHOLD_MS = 60_000;

/**
 * Decide whether the liveness verb can be trusted in this deployment.
 *
 * Arms are evaluated in a fixed order so the reported reason is stable, and the
 * most fundamental problem is reported first: a per-process registry makes the
 * other two moot.
 */
export function evaluateLivenessGate(inputs: LivenessGateInputs): LivenessGateVerdict {
  // (i) A per-process registry cannot see another process's requests at all, so
  // absence there means "not my process", not "not running".
  if (!isRegistrySharedAcrossProcesses(inputs.registry)) {
    return {
      enabled: false,
      reason: "registry-not-shared",
      detail:
        "the active request registry is not shared across processes (an adapter that " +
        "does not declare sharedness is treated as per-process), so a request running " +
        "in another process would read as not live"
    };
  }

  const heartbeatMs = inputs.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
  const thresholdMs = inputs.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;

  // (ii) No heartbeat timer is created at 0, but the sweeper reaps regardless —
  // a healthy request would read dead. The sweeper's own guidance is
  // `staleThresholdMs >= 2 * heartbeatIntervalMs`; enforce it rather than warn.
  if (!Number.isFinite(heartbeatMs) || heartbeatMs <= 0) {
    return {
      enabled: false,
      reason: "heartbeat-too-slow",
      detail:
        "request heartbeats are disabled (heartbeatIntervalMs is 0), so no timer keeps " +
        "a healthy request's registry entry warm while the stale sweeper still reaps it"
    };
  }
  if (!Number.isFinite(thresholdMs) || thresholdMs < 2 * heartbeatMs) {
    return {
      enabled: false,
      reason: "heartbeat-too-slow",
      detail:
        `the stale threshold (${thresholdMs}ms) is below twice the heartbeat interval ` +
        `(${heartbeatMs}ms), so a healthy request can be reaped between beats and read as not live`
    };
  }

  // (iii) With sweeping off, nothing ever removes a crashed worker's entry from
  // a shared registry, so it reads live forever. This is the arm whose failure
  // deadlocks rather than overspends.
  const sweepMs = inputs.staleSweepIntervalMs;
  if (sweepMs == null || !Number.isFinite(sweepMs) || sweepMs <= 0) {
    return {
      enabled: false,
      reason: "sweeper-not-running",
      detail:
        sweepMs == null
          ? "this host cannot report whether a stale-request sweeper is running, and an " +
            "unswept shared registry reports a crashed worker as live indefinitely"
          : "stale sweeping is disabled (staleSweepIntervalMs is 0), so a crashed worker's " +
            "registry entry is never removed and would read as live indefinitely"
    };
  }

  return { enabled: true, staleThresholdMs: thresholdMs };
}
