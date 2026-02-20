import { z, type ZodTypeAny } from "zod";
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

export interface BlockConfig<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> {
  name: string;
  renderKey?: string;
  description?: string;
  inputSchema?: TInputSchema;
  outputSchema?: TOutputSchema;
  connectInput?: ConnectorFn<unknown, z.infer<TInputSchema>>;

  execute?: (input: z.infer<TInputSchema>, ctx: BlockContext) => Promise<z.infer<TOutputSchema>> | z.infer<TOutputSchema>;
  validateChunk?: (input: z.infer<TInputSchema>, ctx: BlockContext) => Promise<ChunkValidation> | ChunkValidation;
  onCompleted?: (output: z.infer<TOutputSchema>, ctx: BlockContext) => Promise<void> | void;
  onErrored?: (error: Error, ctx: BlockContext) => Promise<void> | void;

  retry?: RetryPolicy;
  clientOutput?: ClientOutputOption<z.infer<TOutputSchema>>;
  llmOutput?: LlmOutputOption<z.infer<TOutputSchema>>;
}

export interface BlockDefinition<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> {
  kind: BlockKind;
  name: string;
  renderKey?: string;
  description?: string;
  inputSchema: TInputSchema;
  outputSchema: TOutputSchema;
  config: BlockConfig<TInputSchema, TOutputSchema>;
  run(input: z.infer<TInputSchema>, ctx: BlockContext): Promise<z.infer<TOutputSchema>>;

  connectInput<TFrom>(mapper: ConnectorFn<TFrom, z.infer<TInputSchema>>): BlockDefinition<ZodTypeAny, TOutputSchema>;
  connectOutput<TTo>(
    mapper: (output: z.infer<TOutputSchema>, ctx: BlockContext) => TTo | Promise<TTo>
  ): BlockDefinition<TInputSchema, ZodTypeAny>;
}

export interface RescueHandlerSpec {
  when?: Array<new (...args: any[]) => Error>;
  block: BlockDefinition<any, any>;
}

/** Extract the inferred input type from a BlockDefinition. */
export type BlockInput<T> = T extends BlockDefinition<infer TIn, any> ? z.infer<TIn> : never;

/** Extract the inferred output type from a BlockDefinition. */
export type BlockOutput<T> = T extends BlockDefinition<any, infer TOut> ? z.infer<TOut> : never;
