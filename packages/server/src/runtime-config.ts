/**
 * Bundle of instance-level options forwarded verbatim through the server
 * execution chain (`createFlowApiRouter` → `createFlowRouteHandlers` →
 * `createInboundTransportHost` → `runAction`). Internal to
 * `@flow-state-dev/server` — the type is re-exported from the package root so
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
  Middleware,
  ModelResolver,
  SpeechResolver,
  TranscriptionResolver
} from "@flow-state-dev/core/types";
import type { TracingLevel } from "@flow-state-dev/core";
import type { RuntimeLogger } from "./execution/logging";

export interface RuntimeConfig {
  modelResolver?: ModelResolver;
  speechResolver?: SpeechResolver;
  transcriptionResolver?: TranscriptionResolver;
  /** Instance-level settings threaded onto every block as `ctx.settings`. */
  settings?: FlowStateSettings;
  middleware?: Middleware[];
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
    speechResolver: options.speechResolver,
    transcriptionResolver: options.transcriptionResolver,
    settings: options.settings,
    middleware: options.middleware,
    logger: options.logger,
    tracingLevel: options.tracingLevel,
    maxResponseBufferSize: options.maxResponseBufferSize,
    defaultSseHeartbeatMs: options.defaultSseHeartbeatMs,
    onBackgroundWork: options.onBackgroundWork
  };
}
