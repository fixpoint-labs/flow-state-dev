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
}

/**
 * Build a {@link RuntimeConfig} from the public flat-option shape. Called at
 * the two boundary points (`createFlowState.#doInit` and
 * `createFlowApiRouter`). Trivial today; centralized so future defaulting
 * logic has one home.
 */
export function createRuntimeConfig(options: RuntimeConfig): RuntimeConfig {
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
    requestHost: options.requestHost
  };
}

/** Stale-request sweeper cadence (ms) when the host configures none. */
export const DEFAULT_STALE_SWEEP_INTERVAL_MS = 30_000;
/** Heartbeat-age threshold (ms) for the stale-request sweeper by default. */
export const DEFAULT_STALE_SWEEP_THRESHOLD_MS = 60_000;

/** The public option pair describing the stale-request sweeper. */
export interface StaleSweepOptions {
  staleSweepIntervalMs?: number;
  staleSweepThresholdMs?: number;
}

/**
 * Resolve the stale-sweep pair to the facts the request-host liveness gate
 * reasons about (FIX-999).
 *
 * There are two entry points that construct a `RuntimeConfig` — `createFlowState`
 * (whose config reaches the router *and* `worker.startWorker`) and a direct
 * `createFlowApiRouter` call. Both must describe the same sweeper, so the
 * defaulting rule lives here rather than being restated at each one. `0` is
 * preserved, not defaulted: it means sweeping is deliberately disabled, which
 * the gate refuses liveness on.
 */
export function resolveStaleSweep(options: StaleSweepOptions): {
  staleSweepIntervalMs: number;
  staleThresholdMs: number;
} {
  return {
    staleSweepIntervalMs:
      options.staleSweepIntervalMs ?? DEFAULT_STALE_SWEEP_INTERVAL_MS,
    staleThresholdMs:
      options.staleSweepThresholdMs ?? DEFAULT_STALE_SWEEP_THRESHOLD_MS
  };
}
