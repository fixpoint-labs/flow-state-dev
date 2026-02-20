import type { ZodTypeAny } from "zod";
import type {
  ProjectScopeHandle,
  RequestScopeHandle,
  SessionScopeHandle,
  UserScopeHandle
} from "./scope";
import type { ScopeStateOps } from "./state";
import type { ModelResolver } from "./model";

export type BlockKind = "handler" | "generator" | "sequencer" | "router";

export interface ResponseEmitterHandle {
  emit(event: unknown): void | Promise<void>;
}

export type TargetHandle<TState extends object = Record<string, unknown>> = {
  name: string;
  instanceId: string;
  state: Readonly<TState>;
} & Pick<
  ScopeStateOps<TState>,
  | "patchState"
  | "setState"
  | "incState"
  | "pushState"
  | "setStateRecord"
  | "deleteStateRecord"
  | "atomicState"
>;

export interface BlockContext<
  TRequestState extends object = Record<string, unknown>,
  TSessionState extends object = Record<string, unknown>,
  TUserState extends object = Record<string, unknown>,
  TProjectState extends object = Record<string, unknown>
> {
  request: RequestScopeHandle<TRequestState>;
  session?: SessionScopeHandle<TSessionState>;
  user: UserScopeHandle<TUserState>;
  project?: ProjectScopeHandle<TProjectState>;

  response: ResponseEmitterHandle;
  signal: AbortSignal;
  resolveModel: ModelResolver;

  getBlockResult(name: string): unknown;
  getTarget<TState extends object = Record<string, unknown>>(
    name: string
  ): TargetHandle<TState> | undefined;
}

export type ConnectorFn<TFrom, TTo> = (
  input: TFrom,
  ctx: BlockContext
) => TTo | Promise<TTo>;

export interface RetryPolicy {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryableErrors?: Array<new (...args: any[]) => Error>;
}

export interface ChunkValidation {
  action: "allow" | "replace" | "drop" | "abort";
  replacement?: unknown;
  reason?: string;
}

export type ClientOutputOption<TOutput> =
  | false
  | true
  | ((output: TOutput) => Record<string, unknown> | null);

export type LlmOutputOption<TOutput> =
  | false
  | true
  | string
  | ((output: TOutput) => unknown | null);

export interface BlockConfig<TInput = unknown, TOutput = unknown> {
  name: string;
  renderKey?: string;
  description?: string;
  inputSchema?: ZodTypeAny;
  outputSchema?: ZodTypeAny;
  connectInput?: ConnectorFn<unknown, TInput>;

  execute?: (input: TInput, ctx: BlockContext) => Promise<TOutput> | TOutput;
  validateChunk?: (input: TInput, ctx: BlockContext) => Promise<ChunkValidation> | ChunkValidation;
  onCompleted?: (output: TOutput, ctx: BlockContext) => Promise<void> | void;
  onErrored?: (error: Error, ctx: BlockContext) => Promise<void> | void;

  retry?: RetryPolicy;
  clientOutput?: ClientOutputOption<TOutput>;
  llmOutput?: LlmOutputOption<TOutput>;

  [key: string]: unknown;
}

export interface BlockDefinition<TInput = unknown, TOutput = unknown> {
  kind: BlockKind;
  name: string;
  renderKey?: string;
  description?: string;
  inputSchema?: ZodTypeAny;
  outputSchema?: ZodTypeAny;
  config: BlockConfig<TInput, TOutput>;
  run(input: TInput, ctx: BlockContext): Promise<TOutput>;

  connectInput<TFrom>(mapper: ConnectorFn<TFrom, TInput>): BlockDefinition<TFrom, TOutput>;
  connectOutput<TTo>(
    mapper: (output: TOutput, ctx: BlockContext) => TTo | Promise<TTo>
  ): BlockDefinition<TInput, TTo>;
}

export interface RescueHandlerSpec {
  when?: Array<new (...args: any[]) => Error>;
  block: BlockDefinition<any, any>;
}
