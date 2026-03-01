/**
 * Shared execution runtime types used by block and action orchestration paths.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type {
  ActionConfig,
  BlockDefinition,
  FlowInstance,
  ModelResolver,
  RetryPolicy
} from "@flow-state-dev/core/types";
import type { ExecutionContext } from "../context/types";
import type { FlowError, FlowErrorScope } from "../errors/flow-error";
import type { ResponseEmitter } from "../streaming/response-emitter";
import type { StoreRegistry } from "../stores/types";
import type { RuntimeLogger } from "./logging";

export type ExecutionMetadata = {
  requestId: string;
  actionName: string;
  flowKind: string;
  userId: string;
  sessionId?: string;
  projectId?: string;
  blockName?: string;
  blockKind?: BlockDefinition["kind"];
  blockInstanceId?: string;
  parentBlockInstanceId?: string;
  scope?: FlowErrorScope;
  attempt?: number;
  stepIndex?: number;
  workGroupId?: string;
  tags?: Record<string, unknown>;
};

export type ExecutionResult<TOutput = unknown> = {
  output: TOutput | undefined;
  items: OutputItem[];
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
  projectId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
  modelResolver?: ModelResolver;
  stores: StoreRegistry;
  retry?: RetryPolicy;
  responseEmitter?: ResponseEmitter;
  logger?: RuntimeLogger;
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
    projectId: overrides.projectId ?? ctx.request.identity.projectId,
    blockName: overrides.blockName,
    blockKind: overrides.blockKind,
    blockInstanceId: overrides.blockInstanceId,
    parentBlockInstanceId: overrides.parentBlockInstanceId,
    scope: overrides.scope,
    attempt: overrides.attempt,
    stepIndex: overrides.stepIndex,
    workGroupId: overrides.workGroupId,
    tags: overrides.tags
  };
}
