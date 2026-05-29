/**
 * Shared execution runtime types used by block and action orchestration paths.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type {
  ActionConfig,
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
  signal?: AbortSignal;
  stores: StoreRegistry;
  retry?: RetryPolicy;
  responseEmitter?: ResponseEmitter;
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
