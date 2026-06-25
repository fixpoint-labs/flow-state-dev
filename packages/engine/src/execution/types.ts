/**
 * Shared execution runtime types used by block and action orchestration paths.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type {
  ActionConfig,
  ActionCore,
  BlockDefinition,
  FlowInstance,
  Middleware,
  RetryPolicy
} from "@flow-state-dev/core/types";
import type { ExecutionContext } from "../context/types";
import type { FlowError, FlowErrorScope } from "../errors/flow-error";
import type { ResponseEmitter } from "../streaming/response-emitter";
import type { StoreRegistry } from "../stores/types";
import type { RuntimeConfig } from "../runtime-config";
import type { RuntimeLogger } from "./logging";

export type ExecutionMetadata = {
  requestId: string;
  actionName: string;
  flowKind: string;
  userId: string;
  sessionId?: string;
  orgId?: string;
  blockName?: string;
  blockKind?: BlockDefinition["kind"];
  blockInstanceId?: string;
  parentBlockInstanceId?: string;
  /**
   * Structural path of this block in the request's execution tree (e.g.
   * `root/step[0]/iter[2]`). Combined with `requestId` and `attempt`, this
   * uniquely and deterministically identifies the block instance.
   */
  blockPath?: string;
  scope?: FlowErrorScope;
  attempt?: number;
  stepIndex?: number;
  workGroupId?: string;
  tags?: Record<string, unknown>;
};

export type ExecutionResult<TOutput = unknown> = {
  output: TOutput | undefined;
  items: import("./internal/response").RuntimeItem[];
  durationMs: number;
  error?: FlowError;
  /**
   * Id of the dispatched request. Set by `runAction` (request-level execution)
   * so non-HTTP callers can correlate logs or attach a stream by it without
   * pre-generating an id. Absent for standalone block-level executions
   * (`executeBlock`), which have no request context.
   */
  requestId?: string;
};

export type ExecuteBlockResult<TOutput = unknown> = ExecutionResult<TOutput>;

export type ExecuteBlockContext = ExecutionContext;

export type ExecuteBlockOptions = {
  block: BlockDefinition;
  input: unknown;
  ctx: ExecuteBlockContext;
  retry?: RetryPolicy;
  middleware?: Middleware[];
  metadata?: Partial<ExecutionMetadata>;
  logger?: RuntimeLogger;
};

export type RunActionOptions<
  TFlow extends FlowInstance = FlowInstance,
  TActionName extends keyof TFlow["actions"] & string = keyof TFlow["actions"] & string
> = {
  flow: TFlow;
  actionName: TActionName;
  input: unknown;
  userId: string;
  sessionId?: string;
  orgId?: string;
  tenantId?: string;
  requestId?: string;
  /**
   * Inbound transport provenance, propagated to `RequestRecord.source` and
   * `ActiveRequestEntry.source`. Defaults to `"http"` to preserve behavior
   * for callers that pre-date the transport adapter contract (FIX-438).
   */
  source?: string;
  metadata?: Record<string, unknown>;
  /**
   * Pre-resolved action core, set only by adapters for an event dispatch with
   * no static coordinate (the dynamic schedule). When present, `runAction`
   * runs it directly instead of resolving from `flow`. See
   * `InboundRequestEnvelope.resolvedActionCore` for the full contract and why
   * it adds no caller-addressed attack surface.
   */
  resolvedActionCore?: ActionCore;
  signal?: AbortSignal;
  stores: StoreRegistry;
  retry?: RetryPolicy;
  responseEmitter?: ResponseEmitter;
  /**
   * Starting sequence number for the internally-created `ResponseEmitter` —
   * the first emitted event gets `startSequenceNumber + 1`. Queue consumers
   * that re-run an action under the same `requestId` (e.g. a BullMQ retry
   * attempt) pass the last persisted sequence number so the per-request
   * event log stays strictly increasing across attempts; tailing clients
   * filter on `sequence_number > cursor` and would otherwise never see the
   * retry's events. Ignored when `responseEmitter` is provided — the
   * caller's emitter owns numbering.
   */
  startSequenceNumber?: number;
  /**
   * Starting item index for the internally-created `ResponseEmitter` — the next
   * emitted item gets `startItemIndex + (items so far)`. A same-request
   * continuation (FIX-811) passes the suspended request's last persisted item
   * index so re-entry items continue after the prior log instead of restarting
   * at `0` (which would mis-order them on stores that sort by item index).
   * Ignored when `responseEmitter` is provided — the caller's emitter owns
   * index assignment.
   */
  startItemIndex?: number;
  /**
   * Live-subscription convenience for callers that run a flow outside the HTTP
   * transport (jobs, cron, queue consumers) and want to observe items as they
   * happen without assembling their own `ResponseEmitter`. Called for every
   * item as it is added / updated / done — the same live fan-out that feeds
   * connected SSE clients, so transient items (live-only, absent from the
   * persisted log) appear here too; do not re-filter them. Listener exceptions
   * are isolated and never break the run.
   */
  onItem?: (item: OutputItem, kind: "added" | "updated" | "done") => void;
  /**
   * Same-request continuation flag (FIX-811). Set by `continueRequest` when a
   * suspended/interrupted request re-enters under its OWN id. Triggers replay
   * mode: prior persisted items are loaded into a `ReplayLog` so completed
   * blocks are injected (not re-run), a `suspension_resume` audit item is
   * emitted, and the terminal write merges prior + re-entry items. Inferred as
   * `true` when a `resumeContext` is present and the existing record is
   * `suspended`, so callers that thread a resumeContext for a same-id record
   * get replay even without setting this explicitly.
   */
  replayMode?: boolean;
  /**
   * Instance-level options forwarded verbatim through the execution chain
   * (resolvers, settings, middleware, logger, tracing). See
   * {@link RuntimeConfig}.
   */
  runtimeConfig: RuntimeConfig;
};

export type RunActionResolved<
  TFlow extends FlowInstance = FlowInstance,
  TActionName extends keyof TFlow["actions"] & string = keyof TFlow["actions"] & string
> = {
  action: ActionConfig;
  requestId: string;
  startedAtMs: number;
};

/**
 * Builds execution metadata from context with optional caller overrides.
 */
export function createExecutionMetadata(
  ctx: ExecuteBlockContext,
  overrides: Partial<ExecutionMetadata> = {}
): ExecutionMetadata {
  return {
    requestId: overrides.requestId ?? ctx.requestRuntime.requestId,
    actionName: overrides.actionName ?? ctx.actionName,
    flowKind: overrides.flowKind ?? ctx.flow.kind,
    userId:
      overrides.userId ??
      ctx.user.identity.userId ??
      ctx.request.identity.userId ??
      "unknown_user",
    sessionId: overrides.sessionId ?? ctx.session.identity.id,
    orgId: overrides.orgId ?? ctx.request.identity.orgId,
    blockName: overrides.blockName,
    blockKind: overrides.blockKind,
    blockInstanceId: overrides.blockInstanceId,
    parentBlockInstanceId: overrides.parentBlockInstanceId,
    blockPath: overrides.blockPath,
    scope: overrides.scope,
    attempt: overrides.attempt,
    stepIndex: overrides.stepIndex,
    workGroupId: overrides.workGroupId,
    tags: overrides.tags
  };
}
