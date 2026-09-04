/**
 * Bundle of instance-level options forwarded verbatim through the server
 * execution chain (`createFlowApiRouter` → `createFlowRouteHandlers` →
 * `createInboundTransportHost` → `runAction`). Internal to
 * `@flow-state-dev/engine` — the type is re-exported from the package root so
 * sibling packages can name it, but it is not part of the public option
 * surface of `createFlowState` / `createFlowApiRouter`.
 *
 * Adding a new forwarded field is a one-line change here plus one assignment
 * at the public boundary that constructs it (`createFlowState.#doInit` or
 * `createFlowApiRouter`). Layers below that boundary do not need editing.
 *
 * Fields that a specific layer actively uses (not just forwards) stay as
 * named parameters on that layer's options interface. RuntimeConfig only
 * holds fields that pass through verbatim.
 */
import type {
  FlowStateSettings,
  ModelResolver,
  VoiceProvider
} from "@flow-state-dev/core/types";
import type { TracingLevel } from "@flow-state-dev/core";
import type { RuntimeLogger } from "./execution/logging";
import type { DurabilityProvider } from "./durability/types";
import type { DurabilityRetentionConfig } from "./durability/durability-sweeper";
import type { ErrorCaptureHandler } from "./errors/error-capture";
import type { RequestHostConstructionInputs } from "./context/types";

export interface RuntimeConfig {
  modelResolver?: ModelResolver;
  /**
   * Voice provider for TTS and STT. Already merged by the host (per-flow
   * `voice.provider` wins over the router-level provider), so layers below the
   * host receive the effective value and never re-merge.
   */
  voiceProvider?: VoiceProvider;
  /** Instance-level settings threaded onto every block as `ctx.settings`. */
  settings?: FlowStateSettings;
  logger?: RuntimeLogger;
  /** Tracing verbosity for observability snapshots (FIX-406 6H). */
  tracingLevel?: TracingLevel;
  /** Maximum buffered SSE bytes per request — see `createLiveRequestStream`. */
  maxResponseBufferSize?: number;
  /**
   * Default SSE wire-level heartbeat interval in milliseconds applied to
   * every live stream when the per-flow `request.sseHeartbeatMs` is unset.
   */
  defaultSseHeartbeatMs?: number;
  /** Forwarded to runAction so serverless platforms can keep work alive. */
  onBackgroundWork?: (promise: Promise<unknown>) => void;
  /** Durable execution provider for checkpoint-based resume and HITL suspend. */
  durabilityProvider?: DurabilityProvider;
  /**
   * Retention policy for the durability sweeper (FIX-141). When set alongside
   * `durabilityProvider`, the router constructs a periodic sweeper that
   * enforces suspension expiry and prunes aged-out suspensions, leases, and
   * orphaned checkpoints. Absent → no sweeper.
   */
  durabilityRetention?: DurabilityRetentionConfig;
  /**
   * Opt-in error-capture sink (FIX-724). Routes runtime block failures to an
   * external observability service (Sentry, Datadog, ...). Forwarded to
   * `createExecutionContext`; absent → no capture.
   */
  errorCapture?: ErrorCaptureHandler;
  /**
   * Construction inputs for the request-host seam (FIX-999), forwarded to
   * `createExecutionContext` (BP-026). A host that executes requests but wires
   * none leaves capabilities unable to reach the runtime — `requireRequestHost`
   * then throws by name rather than failing as `undefined is not a function`.
   */
  requestHost?: RequestHostConstructionInputs;
  /**
   * Resolved queued grace (FIX-999), carried here because three shipped paths
   * sweep and only this bundle reaches all of them: the router's periodic
   * sweeper, startup detection in `createFlowRouteHandlers`, and the
   * client-poked `check-interrupted` route. Absent → `detectInterruptedRequests`
   * applies {@link DEFAULT_QUEUED_GRACE_MS}.
   */
  queuedGraceMs?: number;
  /**
   * Transport sources this deployment adds to the public re-entry allow-list
   * (FIX-999). Carried here for the same reason as `queuedGraceMs`: three
   * routes consult the list — `retry`, `continue` and `resume` — and this
   * bundle is the only thing that reaches all of them from both public entry
   * points. Absent → only the built-in sources are re-enterable.
   */
  publicReentrySources?: readonly string[];
  /**
   * Largest `limit` the workstream listing route accepts (FIX-1012). Absent →
   * {@link DEFAULT_MAX_WORKSTREAM_LIST_LIMIT}.
   *
   * The list a client reads is all-time history — finished workstreams
   * stays listed — so a deployment running large orchestrations outgrows the
   * default. Raising it is a deliberate act because the cost is per row and
   * per read: each row resolves its status from the request store, and clients
   * re-read this list on every interaction. A bigger ceiling therefore buys
   * completeness with read amplification on every turn, which is why this is
   * an operator's decision rather than a caller's.
   */
  maxChildSessionListLimit?: number;
}

/**
 * Build a {@link RuntimeConfig} from the public flat-option shape. Called at
 * the two boundary points (`createFlowState.#doInit` and
 * `createFlowApiRouter`). Trivial today; centralized so future defaulting
 * logic has one home.
 */
export function createRuntimeConfig(options: RuntimeConfig): RuntimeConfig {
  // Both boundary points funnel through here, so a host that never builds a
  // router is validated too.
  assertMaxChildSessionListLimit(options.maxChildSessionListLimit);
  return {
    modelResolver: options.modelResolver,
    voiceProvider: options.voiceProvider,
    settings: options.settings,
    logger: options.logger,
    tracingLevel: options.tracingLevel,
    maxResponseBufferSize: options.maxResponseBufferSize,
    defaultSseHeartbeatMs: options.defaultSseHeartbeatMs,
    onBackgroundWork: options.onBackgroundWork,
    durabilityProvider: options.durabilityProvider,
    durabilityRetention: options.durabilityRetention,
    errorCapture: options.errorCapture,
    requestHost: options.requestHost,
    queuedGraceMs: options.queuedGraceMs,
    publicReentrySources: options.publicReentrySources,
    maxChildSessionListLimit: options.maxChildSessionListLimit
  };
}

/**
 * Largest `limit` the workstream listing route accepts when the host
 * configures none (FIX-1012). Bounds read amplification rather than payload
 * size: each row resolves its status from the request store.
 */
export const DEFAULT_MAX_WORKSTREAM_LIST_LIMIT = 100;

/**
 * Validate a host's `maxChildSessionListLimit` at construction, throwing on a
 * value that cannot bound anything.
 *
 * Loud rather than silently ignored: this number is a safety cap, and every
 * bad value fails in a direction that looks like it worked. `Infinity` and
 * `NaN` make the upper-bound comparison vacuous, so the route would accept an
 * arbitrarily large page and the amplification the cap exists to bound goes
 * unbounded. Zero or a negative would be handed to the store as a page size.
 * `NaN` in particular is what `Number(process.env.X)` produces from a typo,
 * which is exactly how this option will usually be set.
 */
export function assertMaxChildSessionListLimit(limit: number | undefined): void {
  if (limit === undefined) return;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error(
      `maxChildSessionListLimit must be a positive safe integer, received ${String(limit)}. ` +
        "It caps how many workstream rows one read may return, and a value that " +
        "cannot be compared against (Infinity, NaN) or cannot be a page size " +
        "(zero, negative) would leave the read unbounded rather than capped."
    );
  }
}

/** Stale-request sweeper cadence (ms) when the host configures none. */
export const DEFAULT_STALE_SWEEP_INTERVAL_MS = 30_000;
/** Heartbeat-age threshold (ms) for the stale-request sweeper by default. */
export const DEFAULT_STALE_SWEEP_THRESHOLD_MS = 60_000;

/**
 * How long a request may sit in an external queue, unclaimed, before the
 * sweeper treats it as lost rather than waiting (FIX-999).
 *
 * Deliberately NOT derived from the stale threshold. That threshold answers
 * "how long since a live worker checked in", tuned against the heartbeat
 * cadence and typically seconds. This answers "how long might a job
 * legitimately queue before a worker frees up", which is a property of the
 * queue's depth and worker count and has nothing to do with heartbeat cadence.
 * Scaling one off the other would couple two unrelated timescales and give a
 * deployment that tightened its heartbeat a queue grace it never asked to
 * shorten.
 *
 * Ten minutes is generous for a backlog and still bounded, so a job the queue
 * genuinely dropped does not linger `in_progress` forever. A deployment that
 * knows its worst-case queue wait raises it with `queuedGraceMs`.
 */
export const DEFAULT_QUEUED_GRACE_MS = 10 * 60_000;

/**
 * Reject a `queuedGraceMs` that cannot bound a queued entry (FIX-999).
 *
 * The grace is the only bound there is. `readLiveness` treats a `queuedAt`
 * entry as unconditionally live and defers the bound to the sweep on purpose,
 * and the sweep applies it as `sweepStartedAt - entry.queuedAt > queuedGraceMs`.
 * So a non-finite value does not degrade the feature, it removes reconciliation:
 * nothing compares greater than `NaN` or `Infinity`, so a queued row is never
 * selected as stale, never marked `interrupted`, never deregistered — and
 * therefore reads live for the life of the deployment. A job the queue lost
 * after enqueue would wait forever with nothing able to notice. A negative
 * grace fails the other way and reaps every queued row on sight, which is the
 * false negative the grace exists to fix.
 *
 * Rejected rather than normalized, because neither is a value anyone means and
 * a silent fallback would hide the misconfiguration behind the symptom. This
 * matches the `Number.isFinite` rejection the `check-interrupted` route already
 * applies to its caller-supplied `staleThresholdMs`.
 *
 * `0` is legal: "no grace, reap a queued row as soon as it is stale" is a
 * coherent choice, the same shape as `staleSweepIntervalMs: 0` meaning off.
 *
 * The sibling bounds need no guard here — `stale-request-sweeper.ts` already
 * refuses a non-finite interval or threshold, and the liveness gate refuses on
 * the same test, so a bad value there is a named refusal rather than a silently
 * unfalsifiable comparison.
 */
function assertUsableQueuedGrace(value: number | undefined): void {
  if (value === undefined) return;
  if (Number.isFinite(value) && value >= 0) return;
  throw new Error(
    `queuedGraceMs must be a finite, non-negative number of milliseconds (received ${String(value)}). ` +
      "It is the only bound on a request waiting in an external queue: a non-finite value " +
      "makes the sweep's age comparison always false, so a queued request is never reaped " +
      "and is reported as live indefinitely. Use 0 to reap queued requests as soon as they " +
      "are stale."
  );
}

/** The public options describing the stale-request sweeper. */
export interface StaleSweepOptions {
  staleSweepIntervalMs?: number;
  staleSweepThresholdMs?: number;
  queuedGraceMs?: number;
}

/**
 * Resolve the stale-sweep options to the facts the sweepers and the
 * request-host liveness gate reason about (FIX-999).
 *
 * There are two entry points that construct a `RuntimeConfig` — `createFlowState`
 * (whose config reaches the router *and* `worker.startWorker`) and a direct
 * `createFlowApiRouter` call. Both must describe the same sweeper, so the
 * defaulting rule lives here rather than being restated at each one. `0` is
 * preserved, not defaulted: it means sweeping is deliberately disabled, which
 * the gate refuses liveness on.
 *
 * Only the first two are gate facts. `queuedGraceMs` governs which rows a sweep
 * reaps and is deliberately kept out of `RequestHostConstructionInputs`: the
 * liveness read leaves queued entries unbounded on purpose and defers the bound
 * to the sweep, so a second copy of the grace on the read side is exactly the
 * desynchronization that reintroduces the false negative being fixed. Callers
 * destructure rather than spreading this whole result onto the seam.
 */
export function resolveStaleSweep(options: StaleSweepOptions): {
  staleSweepIntervalMs: number;
  staleThresholdMs: number;
  queuedGraceMs: number;
} {
  assertUsableQueuedGrace(options.queuedGraceMs);

  return {
    staleSweepIntervalMs:
      options.staleSweepIntervalMs ?? DEFAULT_STALE_SWEEP_INTERVAL_MS,
    staleThresholdMs:
      options.staleSweepThresholdMs ?? DEFAULT_STALE_SWEEP_THRESHOLD_MS,
    queuedGraceMs: options.queuedGraceMs ?? DEFAULT_QUEUED_GRACE_MS
  };
}
