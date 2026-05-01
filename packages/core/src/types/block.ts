import { z, type ZodTypeAny } from "zod";
import type {
  OrgScopeHandle,
  RequestScopeHandle,
  SessionScopeHandle,
  UserScopeHandle
} from "./scope";
import type { AnyResourceRef, DefinedResource, ResourceRef } from "./resource";
import type { DefinedResourceCollection, ResourceCollectionRef } from "./resource-collection";
import type { Middleware } from "./middleware";
import type { ScopeStateOps } from "./state";
import type { ModelResolver } from "./model";
import type { Content } from "../items/content";
import type { AgentType, StructureShape } from "../items/types";
import type { JsonObject } from "../schema/common";
import type { GeneratorModelResult, GeneratorModelUsage } from "./model";

export type BlockKind = "handler" | "generator" | "sequencer" | "router";

/** Payload emitted by the generator after resolving its config, for debug item capture. */
export type BlockDebugCapturePayload = {
  model: string;
  prompt: string;
  tools: string[];
  /** Resolved user-slot values, post-`asUserMessage` wrapping, in the form
   *  the model was sent. Empty array when no user slot was provided. */
  user: unknown[];
  /** Resolved history values (already in message form). Empty array when
   *  no history slot was provided. */
  history: unknown[];
};

export type ExecutionParent = {
  name: string;
  kind: BlockKind;
  instanceId: string;
  parentInstanceId?: string;
  transient?: boolean;
  stateSchema?: ZodTypeAny;
  /** The input value passed to this block when it was executed. Populated for sequencers. */
  input?: unknown;
  /**
   * Structural path locator for deterministic instance IDs. Format is a
   * slash-delimited sequence of `{op}[{index}]` segments rooted at `root`
   * (e.g. `root/then[0]/iter[2]`). Propagated to the child's
   * `_blockIdentity.blockPath` so nested blocks can derive their own paths.
   */
  path?: string;
  /**
   * Execution phase for this scope. Inherited by nested scopes when not
   * explicitly overridden.
   */
  phase?: "main" | "work";
  container?: {
    component?: string;
    label?: string;
    metadata?: Record<string, unknown>;
  };
  /**
   * True when this scope represents a tool invocation from a generator.
   * Suppresses the redundant `block_output` trace item — the generator's
   * tool wrapper emits a richer `block_tool_output` item that fully
   * describes the tool call (name, arguments, result, error).
   */
  isToolCall?: boolean;
};

export interface ResponseEmitterHandle {
  emit(event: unknown): void | Promise<void>;
}

export type StateRef<TState extends object = Record<string, unknown>> = {
  name: string;
  instanceId: string;
  state: Readonly<TState>;
  /** The input value that was passed to this sequencer when it was executed. */
  input: unknown;
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

/** Stable typed reference to a target block's stateful instance. */
export type TargetRef<TState extends object = Record<string, unknown>> = StateRef<TState>;

/** @deprecated Use StateRef instead. */
export type StateHandle<TState extends object = Record<string, unknown>> = StateRef<TState>;

/** @deprecated Use TargetRef instead. */
export type TargetHandle<TState extends object = Record<string, unknown>> = TargetRef<TState>;


export type BlockResult<TOutput> =
  | { status: "not_started" }
  | { status: "running" }
  | { status: "completed"; output: TOutput }
  | { status: "failed"; error: Error };

export interface BlockContext<
  TRequestState extends object = Record<string, unknown>,
  TSessionState extends object = Record<string, unknown>,
  TUserState extends object = Record<string, unknown>,
  TOrgState extends object = Record<string, unknown>,
  TResources extends Record<string, AnyResourceRef> = Record<string, AnyResourceRef>,
  TSequencerState extends object = Record<string, unknown>,
  TParentInput = unknown,
  TTargets extends Record<string, ZodTypeAny> | undefined = undefined,
  // Derive-once: capability helper namespaces from the `uses` array
  TCapabilities extends Record<string, Record<string, (...args: any[]) => any>> = {},
> {
  request: RequestScopeHandle<TRequestState>;
  session: SessionScopeHandle<TSessionState>;
  user: UserScopeHandle<TUserState>;
  org?: OrgScopeHandle<TOrgState>;
  sequencer?: StateRef<TSequencerState>;

  /**
   * Flat resource registry — every resource declared by this block, the
   * flow it lives in, or any capability it uses, accessible by its accessor
   * key. The resource's intrinsic `scope` (set on `defineResource`) routes
   * reads/writes to the right storage layer; consumers don't need to know
   * which scope a resource lives in. Replaces the legacy per-scope
   * `ctx.session.resources.*` / `ctx.user.resources.*` / `ctx.org.resources.*`
   * accessors.
   */
  resources: import("./resource").ResourceRegistry<TResources>;

  /**
   * The immediate parent block in the execution chain, if any.
   * Provides the parent's name, kind, and the input it was called with.
   * Useful when a nested block (e.g. a step inside a sequencer, a tool block
   * inside a generator, or a route inside a router) needs the original input
   * that triggered its parent.
   */
  parent?: {
    name: string;
    kind: BlockKind;
    input: TParentInput;
  };

  response: ResponseEmitterHandle;
  signal: AbortSignal;
  resolveModel: ModelResolver;

  getTarget<TState extends object = Record<string, unknown>>(
    name: string
  ): StateRef<TState> | undefined;

  getBlockOutput<TBlock extends BlockDefinition>(
    block: TBlock
  ): BlockOutput<TBlock> | undefined;

  getBlockResult<TBlock extends BlockDefinition>(
    block: TBlock
  ): BlockResult<BlockOutput<TBlock>>;

  targets: InferTargetStatesFromSchemas<TTargets>;

  /** Capability helper functions, keyed by capability name.
   *  Each capability's fns(ctx) result is memoized on first access. */
  cap: TCapabilities;

  /**
   * Emit a chat message item.
   *
   * Defaults to `transient: false` (persisted) regardless of the producing
   * block's `transient` flag. Pass `{ transient: true }` to opt in to a
   * stream-only message.
   *
   * See `apps/docs/docs/streaming/emitting-items.md` for the
   * transient × key matrix.
   */
  emitMessage(
    text: string,
    options?: { agentType?: AgentType; agentName?: string; transient?: boolean }
  ): void;
  emitMessage(
    content: Content[],
    options?: { agentType?: AgentType; agentName?: string; transient?: boolean }
  ): void;
  /**
   * Emit a component item rendered by a registered UI component.
   *
   * Defaults to `transient: false` (persisted) regardless of the producing
   * block's `transient` flag. Pass `{ transient: true }` to opt in to a
   * stream-only component (e.g. live-only progress with dedup).
   *
   * Combined with a stable `key`, this expresses the "keyed snapshot"
   * pattern: one logical entity whose latest state replays on reload.
   * See `apps/docs/docs/streaming/emitting-items.md` for the
   * transient × key matrix.
   */
  emitComponent(
    component: string,
    data: Record<string, unknown>,
    options?: {
      /**
       * Stable identity for the keyed-snapshot pattern. When supplied, the
       * framework derives a deterministic item ID from the key and **upserts
       * in place**: subsequent emissions with the same key overwrite the
       * prior entry in the persisted record (one entry per
       * `(requestId, key)`). The `data` payload is **replaced, not merged**
       * — fields absent from a later emission are dropped. Live SSE
       * consumers still see every update via the event log. See
       * `apps/docs/docs/streaming/emitting-items.md`.
       */
      key?: string;
      agentType?: AgentType;
      agentName?: string;
      transient?: boolean;
    }
  ): void;
  /**
   * Update the request-scoped status slot. Rendered by clients as a single
   * in-flight indicator ("what is happening right now").
   *
   * - `message` as a string (including `""`) sets the slot; dedupe suppresses
   *   re-emission when the value is unchanged.
   * - `message` as `undefined` preserves the slot value — useful when updating
   *   only `blocked` / `backgroundTasks` signals.
   *
   * Defaults to `transient: true` (live-only) — statuses are naturally
   * ephemeral. Pass `{ transient: false }` to persist a status item.
   */
  emitStatus(
    message: string | undefined,
    options?: { blocked?: boolean; backgroundTasks?: number; transient?: boolean }
  ): void;

  /**
   * Runtime metadata for the current request. Available during server-side
   * execution; undefined in test harnesses or static analysis contexts.
   * Blocks can use this to access client-supplied metadata (e.g., voice
   * settings) passed through `sendAction`.
   */
  requestRuntime?: {
    metadata?: Record<string, unknown>;
  };

  /**
   * 0-indexed retry attempt for the currently-executing block. Starts at 0
   * for the initial invocation and increments per retry. Handlers can use
   * this to drive idempotent behavior (see FIX-402 runOnce).
   */
  attempt?: number;

  /** @internal Server-side instrumentation hooks. Not part of the public API. */
  _runtimeHooks?: {
    onBlockStart?: (blockName: string, blockKind: string, input: unknown) => void;
    onBlockComplete?: (blockName: string, blockKind: string, output: unknown, durationMs: number) => void;
    onBlockError?: (blockName: string, blockKind: string, error: unknown, durationMs: number) => void;
    onRouteSelected?: (routerName: string, selectedBlockName: string, blockInstanceId?: string) => void;
    onGeneratorModelResult?: (payload: {
      model: string;
      usage?: GeneratorModelUsage;
      providerMetadata?: GeneratorModelResult["providerMetadata"];
    }) => void;
    /** Captures resolved generator config for debug item emission. The hook
     *  receives the firing block's context so it can read `_blockIdentity` to
     *  self-identify — required because a single hook closure handles nested
     *  blocks that each have distinct identities. */
    onBlockDebugCapture?: (payload: BlockDebugCapturePayload, ctx: BlockContext) => void;
    /** Fires when a block's `connectInput` actually transformed raw input.
     *  Receives the post-connector value plus the firing block's context so
     *  the server can emit a debug item against the correct block identity. */
    onConnectedInput?: (value: unknown, ctx: BlockContext) => void;
    /**
     * Emits a block_debug item for a nested block. Wired by the server when
     * trace observability is enabled; no-op otherwise. Called from core's
     * sequencer.ts executeBlock before the nested block runs, so the devtool
     * sees a debug row for every block in the trace — not just the root.
     */
    emitNestedBlockDebug?: (
      block: { name: string; kind: string; inputSchema?: unknown; outputSchema?: unknown; config: unknown; transient?: boolean },
      scopedCtx: unknown
    ) => void | Promise<void>;
  };

  /** @internal Current block's identity within the execution chain. */
  _blockIdentity?: {
    blockName: string;
    blockKind?: BlockKind;
    blockInstanceId: string;
    parentBlockInstanceId?: string;
    ownedBy?: string;
    /** Execution phase — "work" for background scopes, "main" otherwise. */
    phase?: "main" | "work";
    /**
     * Structural path to this block within the request's execution tree.
     * Used by runtime helpers to derive deterministic instance IDs for
     * nested children. See ExecutionParent.path for format.
     */
    blockPath?: string;
    /** 0-indexed retry attempt for this block's execution. */
    attempt?: number;
  };

  /** @internal Runtime hook that executes nested blocks with parent-chain metadata. */
  _withExecutionScope?<TValue>(
    parent: ExecutionParent,
    execute: (ctx: BlockContext) => Promise<TValue>
  ): Promise<TValue>;

  /**
   * @internal Hint written by a sequencer/router's execute right before
   * returning to describe the BlockValue kind its block_output should carry
   * (FIX-413). Emitters wrap the returned output as `inline` when no hint is
   * set (the default for generators, handlers, and transforms).
   */
  _blockOutputHint?: BlockOutputHint;

  /**
   * @internal Shared mutable slot that tracks the id of the most recently
   * emitted `block_output` item. Sequencer operations read this immediately
   * after calling a child block so they can record a `ref` descriptor pointing
   * at the child's item. Lives on a ref passed through every scope so child
   * emissions are visible to the parent that spawned them.
   */
  _outputTracker?: { lastBlockOutputItemId?: string };
}

/**
 * Hint communicated from a block's `execute` out to the block_output emitter
 * (FIX-413). One of:
 * - unset / `kind: "inline"` — wrap the returned output as `{ kind: "inline", value: output }`.
 * - `kind: "ref"` — emit `{ kind: "ref", sourceItemId }`; executor flattens
 *   one hop if the target is itself a ref.
 * - `kind: "structure"` — emit `{ kind: "structure", shape }` directly.
 */
export type BlockOutputHint =
  | { kind: "inline" }
  | { kind: "ref"; sourceItemId: string }
  | { kind: "structure"; shape: StructureShape };

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
  transient?: boolean;
  inputSchema?: TInputSchema;
  outputSchema?: TOutputSchema;
  stateSchema?: ZodTypeAny;
  container?: {
    component?: string;
    label?: string | ((input: TInput) => string);
    metadata?: Record<string, unknown> | ((input: TInput) => Record<string, unknown>);
  };
  connectInput?: ConnectorFn<unknown, TInput>;
  /**
   * Active status message for this block — declarative sugar for
   * `ctx.emitStatus()` at block start. A static string is emitted once when
   * the block enters execution; a function receives `(input, ctx)` and its
   * return value is emitted. Use direct `ctx.emitStatus()` only when a block
   * needs to update status mid-execution (e.g. per-file progress).
   */
  activeStatusMessage?: string | ((input: TInput, ctx: BlockContext) => string);

  execute?: (input: TInput, ctx: BlockContext) => Promise<TOutput> | TOutput;
  validateChunk?: (input: TInput, ctx: BlockContext) => Promise<ChunkValidation> | ChunkValidation;
  onCompleted?: (output: TOutput, ctx: BlockContext) => Promise<void> | void;
  onErrored?: (error: Error, ctx: BlockContext) => Promise<void> | void;

  retry?: RetryPolicy;
  middleware?: Middleware[];

  /**
   * Opt-in flag declaring this block requires the session to be bound to an
   * org. Bubbles up via `mergeDeclaredResources` so a flow rejects requests
   * without `orgId` when any block in any action declares it. Per-block
   * (not flow-wide) — block authors opt in deliberately.
   */
  requireOrg?: boolean;
}

export type DeclaredResourceEntry = DefinedResource | DefinedResourceCollection;

/**
 * Flat resource declaration: accessor key → resource definition. The
 * resource's intrinsic `scope` (and `flowIsolation`) determines its storage
 * placement; the accessor key is what consumers reach for via
 * `ctx.resources.<key>`. The two are independent — multiple accessor keys
 * can point at the same `(scope, ref)` only if the storage keys do not
 * collide (see flow-build collision detection).
 */
export type DeclaredResources = Record<string, DeclaredResourceEntry>;

export interface BlockDefinition<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  TOutput = z.infer<TOutputSchema>,
> {
  kind: BlockKind;
  name: string;
  description?: string;
  transient: boolean;
  inputSchema: TInputSchema;
  outputSchema: TOutputSchema;
  config: BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>;
  declaredResources?: DeclaredResources;
  /**
   * Computed at build time: true when this block declares `requireOrg: true`,
   * or — for sequencers — when any child block requires it. Bubbled by
   * `mergeDeclaredResources` and surfaced on the flow as `flow.requiresOrg`
   * for HTTP-layer enforcement.
   */
  requiresOrg: boolean;
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
 * produces a typed resource handle map: `{ artifacts: ResourceRef<ArtifactState> }`.
 * When absent (undefined), falls back to the untyped default.
 */
export type InferResourcesFromSchemas<T> =
  T extends ZodTypeAny
    ? { [K in keyof z.infer<T>]: ResourceRef<z.infer<T>[K]> }
    : Record<string, ResourceRef<any>>;

/**
 * Derive typed ResourceRef / ResourceCollectionRef records from a
 * `Record<string, DefinedResource | DefinedResourceCollection>`.
 * DefinedResource → ResourceRef, DefinedResourceCollection → ResourceCollectionRef.
 */
export type InferResourcesFromDefinitions<T> =
  T extends Record<string, DeclaredResourceEntry>
    ? {
        [K in keyof T]: T[K] extends DefinedResourceCollection<infer S>
          ? ResourceCollectionRef<S>
          : T[K] extends DefinedResource<infer S>
            ? ResourceRef<S>
            : ResourceRef<JsonObject>;
      }
    : Record<string, ResourceRef<any>>;

/**
 * Combined resource inference: prefers DefinedResource-based definitions
 * when available, otherwise falls back to schema-based inference.
 */
export type InferBlockResources<TSchemas, TDefs> =
  TDefs extends Record<string, DeclaredResourceEntry>
    ? InferResourcesFromDefinitions<TDefs>
    : InferResourcesFromSchemas<TSchemas>;

/**
 * Derive typed state handles from block-level target state schemas.
 * Each declared target name maps to `StateRef<z.infer<schema>> | undefined`.
 */
export type InferTargetStatesFromSchemas<TSchemas> =
  TSchemas extends Record<string, ZodTypeAny>
    ? { [K in keyof TSchemas]: StateRef<z.infer<TSchemas[K]>> | undefined }
    : Record<string, never>;
