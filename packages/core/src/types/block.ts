import { z, type ZodTypeAny } from "zod";
import type {
  ProjectScopeHandle,
  RequestScopeHandle,
  SessionScopeHandle,
  UserScopeHandle
} from "./scope";
import type { DefinedResource, ResourceHandle } from "./resource";
import type { ScopeStateOps } from "./state";
import type { ModelResolver } from "./model";
import type { Content } from "../items/content";
import type { JsonObject } from "../schema/common";
import type { GeneratorModelResult, GeneratorModelUsage } from "./model";

export type BlockKind = "handler" | "generator" | "sequencer" | "router";

export type ExecutionParent = {
  name: string;
  kind: BlockKind;
  instanceId: string;
  parentInstanceId?: string;
  stateSchema?: ZodTypeAny;
  container?: {
    component?: string;
    label?: string;
    metadata?: Record<string, unknown>;
  };
};

export interface ResponseEmitterHandle {
  emit(event: unknown): void | Promise<void>;
}

export type StateHandle<TState extends object = Record<string, unknown>> = {
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


export type BlockResult<TOutput> =
  | { status: "not_started" }
  | { status: "running" }
  | { status: "completed"; output: TOutput }
  | { status: "failed"; error: Error };

export interface MessageHandle {
  addContent(content: Content): void;
  appendDelta(text: string): void;
  done(): void;
}

export interface ComponentHandle {
  update(data: Record<string, unknown>): void;
  done(): void;
}

export interface BlockContext<
  TRequestState extends object = Record<string, unknown>,
  TSessionState extends object = Record<string, unknown>,
  TUserState extends object = Record<string, unknown>,
  TProjectState extends object = Record<string, unknown>,
  TSessionResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>,
  TUserResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>,
  TProjectResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>,
  TSequencerState extends object = Record<string, unknown>,
  TTargets extends Record<string, ZodTypeAny> | undefined = undefined,
> {
  request: RequestScopeHandle<TRequestState>;
  session: SessionScopeHandle<TSessionState, TSessionResources>;
  user: UserScopeHandle<TUserState, TUserResources>;
  project?: ProjectScopeHandle<TProjectState, TProjectResources>;
  sequencer?: StateHandle<TSequencerState>;

  response: ResponseEmitterHandle;
  signal: AbortSignal;
  resolveModel: ModelResolver;

  getTarget<TState extends object = Record<string, unknown>>(
    name: string
  ): StateHandle<TState> | undefined;

  getBlockOutput<TBlock extends BlockDefinition>(
    block: TBlock
  ): BlockOutput<TBlock> | undefined;

  getBlockResult<TBlock extends BlockDefinition>(
    block: TBlock
  ): BlockResult<BlockOutput<TBlock>>;

  targets: InferTargetStatesFromSchemas<TTargets>;

  emitMessage(text: string): MessageHandle;
  emitMessage(content: Content[]): MessageHandle;
  emitComponent(component: string, data: Record<string, unknown>): ComponentHandle;
  emitLLMContext(text: string): void;
  emitStatus(message: string): void;

  /**
   * Runtime metadata for the current request. Available during server-side
   * execution; undefined in test harnesses or static analysis contexts.
   * Blocks can use this to access client-supplied metadata (e.g., voice
   * settings) passed through `sendAction`.
   */
  requestRuntime?: {
    metadata?: Record<string, unknown>;
  };

  /** @internal Server-side instrumentation hooks. Not part of the public API. */
  _runtimeHooks?: {
    onBlockStart?: (blockName: string, blockKind: string, input: unknown) => void;
    onBlockComplete?: (blockName: string, blockKind: string, output: unknown, durationMs: number) => void;
    onBlockError?: (blockName: string, blockKind: string, error: unknown, durationMs: number) => void;
    onRouteSelected?: (routerName: string, selectedBlockName: string) => void;
    onGeneratorModelResult?: (payload: {
      model: string;
      usage?: GeneratorModelUsage;
      providerMetadata?: GeneratorModelResult["providerMetadata"];
    }) => void;
  };

  /** @internal Runtime hook that executes nested blocks with parent-chain metadata. */
  _withExecutionScope?<TValue>(
    parent: ExecutionParent,
    execute: (ctx: BlockContext) => Promise<TValue>
  ): Promise<TValue>;
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

export interface BlockConfig<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  TOutput = z.infer<TOutputSchema>,
> {
  name: string;
  description?: string;
  inputSchema?: TInputSchema;
  outputSchema?: TOutputSchema;
  stateSchema?: ZodTypeAny;
  container?: {
    component?: string;
    label?: string | ((input: TInput) => string);
    metadata?: Record<string, unknown> | ((input: TInput) => Record<string, unknown>);
  };
  connectInput?: ConnectorFn<unknown, TInput>;

  execute?: (input: TInput, ctx: BlockContext) => Promise<TOutput> | TOutput;
  validateChunk?: (input: TInput, ctx: BlockContext) => Promise<ChunkValidation> | ChunkValidation;
  onCompleted?: (output: TOutput, ctx: BlockContext) => Promise<void> | void;
  onErrored?: (error: Error, ctx: BlockContext) => Promise<void> | void;

  retry?: RetryPolicy;
}

export type DeclaredResources = {
  session?: Record<string, DefinedResource>;
  user?: Record<string, DefinedResource>;
  project?: Record<string, DefinedResource>;
};

export interface BlockDefinition<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  TOutput = z.infer<TOutputSchema>,
> {
  kind: BlockKind;
  name: string;
  description?: string;
  inputSchema: TInputSchema;
  outputSchema: TOutputSchema;
  config: BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>;
  declaredResources?: DeclaredResources;
  run(input: TInput, ctx: BlockContext): Promise<TOutput>;

  connectInput<TFrom>(mapper: ConnectorFn<TFrom, TInput>): BlockDefinition<ZodTypeAny, TOutputSchema>;
  connectOutput<TTo>(
    mapper: (output: TOutput, ctx: BlockContext) => TTo | Promise<TTo>
  ): BlockDefinition<TInputSchema, ZodTypeAny>;
}

export interface RescueHandlerSpec {
  when?: Array<new (...args: any[]) => Error>;
  block: BlockDefinition<any, any>;
}

/** Extract the inferred input value type from a BlockDefinition. */
export type BlockInput<T> = T extends { inputSchema: { _output: infer V } } ? V : never;

/** Extract the inferred output value type from a BlockDefinition. */
export type BlockOutput<T> = T extends { outputSchema: { _output: infer V } } ? V : never;

/**
 * Derive-once utility for block-level state schemas.
 * When a Zod schema is provided, infer the value type. When absent (undefined), fall back
 * to Record<string, unknown> so that ctx.session.state etc. remain loosely typed.
 */
export type InferStateFromSchema<T> =
  T extends ZodTypeAny ? z.infer<T> : Record<string, unknown>;

/**
 * Derive-once utility for block-level resource schemas.
 * Given a Zod object schema like `z.object({ artifacts: artifactStateSchema })`,
 * produces a typed resource handle map: `{ artifacts: ResourceHandle<ArtifactState> }`.
 * When absent (undefined), falls back to the untyped default.
 */
export type InferResourcesFromSchemas<T> =
  T extends ZodTypeAny
    ? { [K in keyof z.infer<T>]: ResourceHandle<z.infer<T>[K]> }
    : Record<string, ResourceHandle<any>>;

/**
 * Derive typed ResourceHandle records from a `Record<string, DefinedResource>`.
 * Each DefinedResource carries a phantom `StateType` that maps to
 * `ResourceHandle<StateType>`.
 */
export type InferResourcesFromDefinitions<T> =
  T extends Record<string, DefinedResource>
    ? { [K in keyof T]: ResourceHandle<T[K] extends DefinedResource<infer S> ? S : JsonObject> }
    : Record<string, ResourceHandle<any>>;

/**
 * Combined resource inference: prefers DefinedResource-based definitions
 * when available, otherwise falls back to schema-based inference.
 */
export type InferBlockResources<TSchemas, TDefs> =
  TDefs extends Record<string, DefinedResource>
    ? InferResourcesFromDefinitions<TDefs>
    : InferResourcesFromSchemas<TSchemas>;

/**
 * Derive typed state handles from block-level target state schemas.
 * Each declared target name maps to `StateHandle<z.infer<schema>> | undefined`.
 */
export type InferTargetStatesFromSchemas<TSchemas> =
  TSchemas extends Record<string, ZodTypeAny>
    ? { [K in keyof TSchemas]: StateHandle<z.infer<TSchemas[K]>> | undefined }
    : Record<string, never>;
