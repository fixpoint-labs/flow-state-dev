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
import type { TracingLevel } from "../helpers/tracing-level";
import type { Content } from "../items/content";
import type {
  ItemVisibility,
  BlockValueInternal,
  StructureShape,
  BlockTraceItem,
  OutputItem,
  RouterDecisionItem,
  StateSnapshotItem
} from "../items/types";
import type { JsonObject } from "../schema/common";
import type { GeneratorModelResult, GeneratorModelUsage, ModelIdentity } from "./model";

export type BlockKind = "handler" | "generator" | "sequencer" | "router";

/**
 * Phase tag for {@link BlockContext._runtimeHooks.onBlockTraceCapture}. Each
 * value drives a distinct emission pattern on the unified `block_trace` item:
 *
 * - `added` — fired at block start, before `connectInput`. Constructs the
 *   item with `status: "in_progress"` and the input source descriptor.
 * - `input` — fired after `connectInput`, only when the connector actually
 *   transformed the raw value. Patches `input.connected`.
 * - `generator` — fired post-config-resolution for generator blocks. Patches
 *   `generator: { model, tools, prompt, user?, history? }`. Last write wins
 *   on chained model calls (multi-step tool loops).
 * - `output` — fired at completion. Patches `output`, `status`, `completedAt`,
 *   `duration`, `error?`, `modelUsage?`. Triggers item.done after the patch.
 */
export type BlockTraceCapturePhase = "added" | "input" | "generator" | "output";

/**
 * Payload variant for one phase of {@link BlockContext._runtimeHooks.onBlockTraceCapture}.
 * Untyped on the hook surface (consumers branch on `phase`) to keep the
 * runtime call site simple. The server-side handler reads the matching subset
 * of fields per phase. See {@link BlockTraceCapturePhase} for the per-phase
 * contract.
 */
export type BlockTraceCapturePayload = {
  phase: BlockTraceCapturePhase;
  data: {
    status?: BlockTraceItem["status"];
    blockName?: string;
    blockKind?: BlockTraceItem["blockKind"];
    blockInstanceId?: string;
    input?: { source: import("../items/types").BlockValueInternal<unknown>; connected?: unknown };
    output?: import("../items/types").BlockValueInternal<unknown>;
    generator?: BlockTraceItem["generator"];
    modelUsage?: BlockTraceItem["modelUsage"];
    model?: BlockTraceItem["model"];
    /**
     * Accessor keys the block declares at build time (`ownDeclaredResources`),
     * stamped at the `added` phase so the server can surface declared-vs-loaded
     * resource observability. Carried on the payload the same way
     * `status`/`input` are.
     */
    declaredResources?: string[];
    startedAt?: number;
    completedAt?: number;
    duration?: number;
    error?: { message: string; code?: string };
  };
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
   * (e.g. `root/step[0]/iter[2]`). Propagated to the child's
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
};

export interface ResponseEmitterHandle {
  emit(event: unknown): void | Promise<void>;
  /**
   * Snapshot of every item emitted to this response so far, in stream order.
   * Used by sequencer ops (e.g. `.waitForCondition`) to evaluate predicates
   * over already-flushed items before subscribing for future ones.
   */
  getItems(): readonly OutputItem[];
  /**
   * O(1) count of items currently tracked by this response. Equivalent to
   * `getItems().length` but without materializing or ordering the snapshot —
   * used on the per-emit hot path to assign sequential `itemIndex` values.
   */
  getItemCount(): number;
  /**
   * Subscribe to subsequent item lifecycle transitions on this response.
   * `kind` distinguishes the underlying mutation: `"added"` for a freshly
   * emitted item, `"updated"` for an in-place mutation, `"done"` for a
   * terminal status. Returns an unsubscribe function — callers must invoke
   * it to release the listener (typically inside a `finally`).
   *
   * When `options.filter` is provided, the listener fires only for items
   * the filter returns true for. The filter is evaluated per-event,
   * per-listener; non-matching events skip the listener invocation
   * entirely. Use `filter` to reduce wake-cost when many subscribers share
   * an emitter and most events are uninteresting to most subscribers.
   *
   * Filter exceptions are caught at the emitter boundary, logged via a
   * `response.subscribeToItems.filter_threw` debug event, and the listener
   * STILL FIRES (fail-open). A filter that throws is a caller bug; treating
   * the throw as "skip" would silently mask the bug and surface only as a
   * `.waitForCondition` timeout. Filters MUST be cheap and SHOULD NOT throw.
   */
  subscribeToItems(
    listener: (item: OutputItem, kind: "added" | "updated" | "done") => void,
    options?: {
      filter?: (item: OutputItem, kind: "added" | "updated" | "done") => boolean;
    }
  ): () => void;
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


export type BlockResult<TOutput> =
  | { status: "not_started" }
  | { status: "running" }
  | { status: "completed"; output: TOutput }
  | { status: "failed"; error: Error };

/**
 * Instance-level settings, read inside blocks via `ctx.settings`.
 *
 * Empty by default and framework-provided — users declaration-merge their
 * own keys in their project, exactly as Vite's `ImportMetaEnv` works:
 *
 * ```ts
 * declare module "@flow-state-dev/core" {
 *   interface FlowStateSettings {
 *     sandbox: { type: "local" | "vercel" | "memory" };
 *   }
 * }
 * ```
 *
 * The runtime value is supplied by `createFlowState({ settings })` and threaded
 * onto every `BlockContext`. The `FlowState<TSettings>` generic and this
 * interface are kept in sync by the same declaration merge.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface FlowStateSettings {}

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
   * Instance-level settings declared on `createFlowState({ settings })`.
   * Read-only. Typed via declaration merging into {@link FlowStateSettings}.
   */
  settings: FlowStateSettings;

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

  /**
   * Returns whether `target` — a prior block in the current sequencer scope —
   * recovered an error through its own `.rescue()` handler during its
   * execution. The flag is set on the block that owns the `.rescue()` (e.g. a
   * sub-sequencer wrapping a risky step), so query that block, not the inner
   * step that threw. `target` is a block name or definition (resolved via
   * `block.name`).
   *
   * Scope and resolution match `getBlockResult`: only blocks that ran as prior
   * siblings in the current sequencer run are visible, and under `.loopBack`
   * the most recent (current-iteration) run of a named block is consulted.
   *
   * Returns `false` when the block ran without rescuing, was never dispatched
   * (e.g. skipped by `.stepIf`), is not found in the current scope, or when
   * called outside a sequencer. Never throws.
   */
  wasRescued(target: string | BlockDefinition<any, any>): boolean;

  targets: InferTargetStatesFromSchemas<TTargets>;

  /** Capability helper functions, keyed by capability name.
   *  Each capability's fns(ctx) result is memoized on first access. */
  cap: TCapabilities;

  /**
   * @deprecated Use `ctx.emit.message(...)` instead. Removed in next major.
   *
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
    options?: { itemVisibility?: ItemVisibility; agentName?: string; transient?: boolean }
  ): void;
  /** @deprecated Use `ctx.emit.message(...)` instead. Removed in next major. */
  emitMessage(
    content: Content[],
    options?: { itemVisibility?: ItemVisibility; agentName?: string; transient?: boolean }
  ): void;
  /**
   * @deprecated Use `ctx.emit.component(...)` instead. Removed in next major.
   *
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
      /** Stable identity for the keyed-snapshot pattern. See {@link ComponentItem.key}. */
      key?: string;
      itemVisibility?: ItemVisibility;
      agentName?: string;
      transient?: boolean;
    }
  ): void;
  /**
   * @deprecated Use `ctx.emit.status(...)` instead. Removed in next major.
   *
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
   * Namespaced emission API. Prefer `ctx.emit.message`/`ctx.emit.component`/
   * `ctx.emit.status` over the flat `ctx.emitMessage`/`ctx.emitComponent`/
   * `ctx.emitStatus` aliases (which are deprecated).
   *
   * `ctx.emit.trace.*` is reserved for framework auto-emitters of the four
   * trace item types and rarely called by user code.
   */
  emit: {
    /** See {@link BlockContext.emitMessage}. */
    message: BlockContext["emitMessage"];
    /** See {@link BlockContext.emitComponent}. */
    component: BlockContext["emitComponent"];
    /** See {@link BlockContext.emitStatus}. */
    status: BlockContext["emitStatus"];
    /** @internal — used by framework auto-emitters; user code rarely calls these. */
    trace: {
      blockTrace: (item: BlockTraceItem) => void;
      routerDecision: (item: RouterDecisionItem) => void;
      stateSnapshot: (item: StateSnapshotItem) => void;
    };
  };

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

  /**
   * Stable idempotency key for the currently-executing block. Derived from
   * `${requestId}:${blockPath}` and intentionally excludes `attempt` so the
   * value is identical across retries of the same logical step within a
   * request. Suitable for passing directly to external APIs that accept an
   * idempotency key (e.g. Stripe's `Idempotency-Key` header).
   *
   * Cross-request de-dup is out of scope: `retryRequest` creates a new
   * request ID and therefore a new key. Use a user-controlled external key
   * if cross-request idempotency is required.
   */
  idempotencyKey?: string;

  /**
   * Execute `fn` once per `(requestId, userKey)` and memoize the result on
   * the request store. Subsequent calls — whether triggered by a block
   * retry or a re-entry within the same request — return the persisted
   * value without re-executing `fn`. The user-supplied `key` is the
   * dedup unit, namespaced under the current request.
   *
   * Concurrent in-process calls with the same key share a single inflight
   * promise so the wrapped side effect cannot fire twice in a race.
   *
   * Scope is per-request: a fresh `requestId` (including the one created by
   * a `retryRequest` recovery dispatch) starts with an empty key space.
   * Results must be JSON-serializable; non-serializable values throw.
   */
  runOnce?<T>(key: string, fn: () => Promise<T>): Promise<T>;

  /**
   * Suspend execution and wait for external input. On first call, throws
   * a SuspensionError that the sequencer catches at the step boundary. On
   * resume, returns the resume data instead of throwing.
   *
   * Only callable inside a block that runs within a durable sequencer.
   * Throws if called outside a durable context.
   */
  suspend?(options: import("../errors/suspension-error").SuspendOptions): Promise<unknown>;

  /**
   * Manually save a checkpoint at the current execution point. Normally
   * checkpoints are automatic at sequencer step boundaries; this is for
   * blocks that perform expensive work within a single step and want
   * finer-grained recovery.
   *
   * Only available in durable contexts.
   */
  saveCheckpoint?(): Promise<void>;

  /** @internal Server-side instrumentation hooks. Not part of the public API. */
  _runtimeHooks?: {
    onBlockStart?: (blockName: string, blockKind: string, input: unknown, transient?: boolean) => void;
    onBlockComplete?: (blockName: string, blockKind: string, output: unknown, durationMs: number, transient?: boolean) => void;
    onBlockError?: (blockName: string, blockKind: string, error: unknown, durationMs: number, transient?: boolean, ctx?: BlockContext) => void;
    /**
     * Fired when a router selects a route, before the branch dispatches. May
     * return a promise that resolves once the `router_decision` trace item has
     * landed in the response log — the router awaits it so a suspension inside
     * the chosen branch can never persist before its decision anchor (FIX-814).
     */
    onRouteSelected?: (routerName: string, selectedBlockName: string, blockInstanceId?: string) => void | Promise<void>;
    onGeneratorModelResult?: (payload: {
      model: string;
      usage?: GeneratorModelUsage;
      providerMetadata?: GeneratorModelResult["providerMetadata"];
      /** Resolved identity of the model that produced this result. */
      identity?: ModelIdentity;
    }) => void;
    /**
     * Unified block-lifecycle capture hook. Fires four phases per block:
     * `added` (at start), `input` (post-connectInput, only on transform),
     * `generator` (post-resolve), and `output` (at completion). The hook
     * receives the firing block's context so it can read `_blockIdentity`
     * to self-identify — required because a single hook closure handles
     * nested blocks that each have distinct identities. See
     * {@link BlockTraceCapturePayload} for the per-phase data contract.
     */
    onBlockTraceCapture?: (payload: BlockTraceCapturePayload, ctx: BlockContext) => void;
  };

  /** @internal Current block's identity within the execution chain. */
  _blockIdentity?: {
    blockName: string;
    blockKind?: BlockKind;
    blockInstanceId: string;
    parentBlockInstanceId?: string;
    ownedBy?: string;
    /**
     * Id of the active task for this scope, resolved from the nearest
     * enclosing scope marked via `_markTaskScope`. Stamped onto every item
     * this scope emits as `OutputItem.taskId`.
     */
    taskId?: string;
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
    /**
     * Mirror of the originating block's `transient` flag. Used by the
     * runtime's auto-emission hooks (e.g. `onBlockTraceCapture`) to inherit
     * the flag onto bookkeeping items so they stream live but skip
     * persistence. Required for the FIX-478 contract; see FIX-586.
     */
    transient?: boolean;
  };

  /**
   * @internal Runtime hook that executes nested blocks with parent-chain
   * metadata. The optional `signalOverride` sets the `ctx.signal` of the
   * child scope (and, transitively, every descendant scope that doesn't
   * supply its own override). The sequencer DSL threads
   * `_requestBackgroundSignal` here at `.work()` dispatch so background
   * task trees see the background signal instead of the request signal.
   * When omitted, the child inherits the current parent ctx's `signal`.
   */
  _withExecutionScope?<TValue>(
    parent: ExecutionParent,
    execute: (ctx: BlockContext) => Promise<TValue>,
    signalOverride?: AbortSignal
  ): Promise<TValue>;

  /**
   * @internal Resume replay (FIX-811). Register a completed sibling entry for a
   * block whose output was injected from the ReplayLog instead of re-run. The
   * core `executeBlock` replay short-circuit calls this before returning the
   * cached output so a later sibling's `ctx.getBlockOutput(replayedBlock)`
   * resolves. Trace-free and scope-free: it neither runs the body nor emits a
   * trace (the prior run's trace is canonical). No-op in unit contexts that
   * don't provide it.
   */
  _registerReplayedChild?(parent: ExecutionParent, output: unknown): void;

  /**
   * @internal Reserve the next synchronous `itemIndex` for a runtime-emitted
   * item (FIX-811). Shares the per-run item-index counter that block traces and
   * other server-emitted items use, so runtime items (e.g. `suspension_resume`)
   * interleave correctly with block items instead of running a parallel counter.
   * On a same-request continuation the counter is seeded from the prior log's
   * length, so reserved indices continue after the pre-suspension history. No-op
   * fallback in unit contexts that don't provide it.
   */
  _reserveItemIndex?(): number;

  /**
   * @internal Top up the per-scope resource caches with an action's or block's
   * declared resources at dispatch time (FIX-688 Waves 2 & 3). Loads only the
   * eager entries not already cached; with `loadLazySingles: true` (per-block
   * dispatch) it additionally loads `prefetchMode: 'lazy'` single resources so
   * their `.state` stays synchronous inside `execute()`. Lazy collections are
   * never loaded here — their async accessor fetches on demand. Concurrent
   * loads of the same key/prefix are single-flight deduped. No-op in mock/unit
   * contexts that do not provide it.
   */
  _loadDeclaredResources?(
    declared: DeclaredResources | undefined,
    options: { loadLazySingles: boolean }
  ): Promise<void>;

  /**
   * @internal Mark the nearest enclosing sequencer scope as belonging to a
   * task. Every item emitted by this scope and its descendants (constructed
   * after the mark) inherits the task id as `OutputItem.taskId`. The
   * task-board worker body calls this once per claimed task so a worker's
   * emissions attribute to the task it is running — correct under concurrent
   * fan-out and across sequential `loopBack` turns, where execution paths
   * collide but each turn is a fresh scope. Pass `null` to clear. No-op when
   * the runtime does not provide it (mock contexts).
   */
  _markTaskScope?(taskId: string | null): void;

  /**
   * @internal Read the current value of the request-scoped status slot.
   * Used by the generator's tool-call dispatch to snapshot/restore the slot
   * around a tool round so a tool's `activeStatusMessage` does not linger
   * past the tool's lifetime.
   */
  _peekStatus?(): string;

  /**
   * @internal Hint written by a sequencer/router's execute right before
   * returning to describe the BlockValue kind its `block_trace.output` should
   * carry (FIX-413). Emitters wrap the returned output as `inline` when no
   * hint is set (the default for generators, handlers, and transforms).
   */
  _blockOutputHint?: BlockOutputHint;

  /**
   * @internal Hint stashed by a sequencer/router on the scoped child context
   * just before invoking a child block. Describes the BlockValue source the
   * child's `input.source` should carry on its emitted `block_trace` item.
   * `ref` for previous-step / fan-in branches that already have an item;
   * `inline` for sequencer-head literals; `structure` for aggregator inputs.
   */
  _blockInputHint?: BlockValueInternal<unknown>;

  /**
   * @internal Shared mutable slot that tracks the id of the most recently
   * emitted `block_trace` item. Sequencer operations read this immediately
   * after calling a child block so they can record a `ref` descriptor pointing
   * at the child's item. Lives on a ref passed through every scope so child
   * emissions are visible to the parent that spawned them.
   */
  _outputTracker?: { lastBlockOutputItemId?: string };

  /**
   * @internal Set by the sequencer runtime when a `.rescue()` handler recovers
   * a thrown error. Read by `_withExecutionScope` post-execution to stamp the
   * block's sibling-registry result (`result.rescued`), which `wasRescued`
   * later consults. Not part of the public API.
   */
  _didRescue?: boolean;

  /**
   * @internal Per-request background work pool. Set by the server's request
   * executor; absent in unit-test contexts. Sequencer DSL pushes here from
   * `.work()` / `.workIf()` / `.forEachBackground()`. The request executor
   * drains the pool exactly once before terminal status. When absent (unit
   * tests), sequencer DSL falls back to per-sequencer auto-await.
   */
  _requestWorkPool?: import("../execution/request-work-pool").RequestWorkPool;

  /**
   * @internal Background-work abort signal. Set by the server's request
   * executor; absent in unit-test contexts. Fires ONLY when the request is
   * explicitly aborted (e.g. POST `/abort`, `session.abortRequest()`), NOT
   * on transport-level events like client disconnect, SSE close, or tab
   * refresh. The sequencer DSL substitutes this for `ctx.signal` when
   * dispatching `.work()` / `.workIf()` / `.forEachBackground()` tasks so
   * background generators survive transport teardown.
   *
   * In unit-test contexts where this is absent, `.work()` falls back to the
   * parent's `ctx.signal` — matching the pre-FIX-663 behavior.
   */
  _requestBackgroundSignal?: AbortSignal;

  /**
   * @internal Effective tracing verbosity for this request (FIX-406 6H).
   * Set by the runtime from `createFlowApiRouter({ tracingLevel })`; read by
   * sequencers to gate non-durable observability snapshots. Absent → the
   * sequencer falls back to `resolveTracingLevel()` (env / observability).
   */
  _tracingLevel?: TracingLevel;

  /**
   * @internal Per-request single-flight map for cacheable tool calls
   * (FIX-610). Keys are the cache keys produced by `buildCacheKey`; values
   * are the in-flight promises so concurrent calls within the same request
   * share one upstream execution. Lazily created by
   * `wrapToolExecuteWithCache` on the first cacheable tool call. Scope is
   * per-request — concurrent calls across different requests each execute.
   */
  _toolInFlight?: Map<string, Promise<unknown>>;

  /**
   * @internal Optional hook invoked by `wrapToolExecuteWithCache` after a
   * tool call resolves (hit or miss). Wave 2 of FIX-610 wires this up to
   * write into the Task Board observation ledger so a later worker's
   * flow policy can see prior tool traffic. Absent in Wave 1 and in any
   * runtime that has no observation ledger installed.
   */
  _writeToolObservation?: (entry: {
    toolName: string;
    args: unknown;
    result?: unknown;
    error?: string;
    cached: boolean;
  }) => void;

  /**
   * @internal Resolved identity of the model currently producing this block's
   * output. Written by the generator block during execute; read by build-block
   * to construct the `meta.model` argument for `onCompleted`. Not part of the
   * public surface — user code reads `meta.model`, never this slot.
   */
  _currentModelIdentity?: ModelIdentity;
}

/**
 * A permissive, variance-friendly alias for `BlockContext` — typed where it
 * matters (the session scope) and permissive everywhere else.
 *
 * Use this for helper functions that take a block's `ctx` as a parameter:
 * the full `BlockContext`'s `TResources` generic is invariant on
 * `ResourceRegistry`, so a handler whose `ctx.resources` is inferred as
 * `ResourceRegistry<{ memos: ... }>` can't be assigned to a parameter typed
 * `BlockContext<unknown, MyState>` (the default `ResourceRegistry<Record<...>>`
 * isn't a supertype of the narrow inferred form). `LooseBlockContext` sidesteps
 * the variance trap by leaving `resources` permissive — the helper accepts any
 * block's ctx, and the call site retains its narrower typing internally.
 *
 * When the helper actually needs typed resources, narrow per call site or
 * declare a stricter ctx shape inline. `LooseBlockContext` is for the
 * common case where the helper only touches `ctx.session`.
 */
export type LooseBlockContext<
  TSessionState extends object = Record<string, unknown>,
> = {
  session: import("./scope").SessionScopeHandle<TSessionState>;
  user: import("./scope").UserScopeHandle<Record<string, unknown>>;
  org?: import("./scope").OrgScopeHandle<Record<string, unknown>>;
  request: import("./scope").RequestScopeHandle<Record<string, unknown>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resources: any;
};

/**
 * Hint communicated from a block's `execute` out to the block_trace emitter
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
   * Per-block rescue handlers (FIX-742). When this block's execution throws a
   * non-`SuspensionError`, the first handler whose `when` matches runs with the
   * block's own scoped context — so it can read sequencer state — and its
   * output replaces the throw, letting the enclosing chain / fan-out continue.
   * Set via `block.rescue([...])`. Sequencers handle their own chain-level
   * rescue in the operation loop and do not use this field.
   */
  rescue?: RescueHandlerSpec[];

  /**
   * Opt-in flag declaring this block requires the session to be bound to an
   * org. Bubbles up via `mergeDeclaredResources` so a flow rejects requests
   * without `orgId` when any block in any action declares it. Per-block
   * (not flow-wide) — block authors opt in deliberately.
   */
  requireOrg?: boolean;

  /**
   * Opt-in tool-result memoization (FIX-610). When set, and when this
   * block is installed as a tool on a generator, the framework caches the
   * tool's output keyed on `(toolName, canonicalize(args), scope)` and
   * serves repeat calls from the cache. Errors are never cached. Identical
   * concurrent calls within a request are coalesced (single-flight).
   *
   * Pass `true` for cache-everything defaults, or an object to tune TTL,
   * scope, key derivation, and a `cacheIf` predicate.
   *
   * No effect when the block is used outside a generator's tool slot.
   */
  cacheable?: BlockCacheableConfig | true;
}

/**
 * Per-tool memoization config (FIX-610). See {@link BlockConfig.cacheable}.
 *
 * Cache writes happen after the tool returns successfully. Errors are
 * never cached. Within a request, identical concurrent calls share one
 * in-flight execution (single-flight). Cross-request concurrent calls
 * each execute; last writer wins for the cache entry.
 */
export interface BlockCacheableConfig {
  /**
   * TTL in milliseconds. Omit to use the cache's default (board-level or
   * the framework default of 5 minutes). `0` disables caching and
   * emits a dev-mode warning.
   */
  ttl?: number;

  /**
   * Cache scope, controlling how widely a cached entry is reused:
   *
   * - `"run"` (default): one Task Board run. Entries are dropped when
   *   the outer board exits.
   * - `"request"`: the lifetime of the current request.
   * - `"session"`: persists across requests within a session. Carries
   *   the most leakage risk — only use when arguments unambiguously
   *   identify the tenant.
   */
  scope?: "run" | "request" | "session";

  /**
   * Custom key derivation. Receives the tool's input and ctx; returns a
   * deterministic string. Defaults to `JSON.stringify(canonicalize(args))`
   * with recursive object-key sorting. Override when args carry
   * irrelevant fields (timestamps, request ids) that should be excluded
   * from the key.
   */
  keyFn?: (input: unknown, ctx: BlockContext) => string;

  /**
   * Predicate gating which results are cacheable. Receives the resolved
   * output; return `true` to store, `false` to skip. Errors are never
   * cached regardless of this predicate. Useful for tools that return a
   * structured "no result" envelope that shouldn't poison the cache.
   * Default: cache every successful result.
   */
  cacheIf?: (output: unknown, input: unknown) => boolean;
}

export type DeclaredResourceEntry =
  | DefinedResource
  | DefinedResourceCollection<JsonObject>;

/**
 * Flat resource declaration: accessor key → resource definition. The
 * resource's intrinsic `scope` (and `flowIsolation`) determines its storage
 * placement; the accessor key is what consumers reach for via
 * `ctx.resources.<key>`. The two are independent — multiple accessor keys
 * can point at the same `(scope, ref)` only if the storage keys do not
 * collide (see flow-build collision detection).
 */
export type DeclaredResources = Record<string, DeclaredResourceEntry>;

/**
 * Public block surface — what user code holds and passes around (FIX-503).
 *
 * Deliberately omits the dispatch entry point. Substrate code (executor,
 * sequencer, router, generator tool loop, CLI) sees the runtime view via
 * `BlockRuntime` and uses `asRuntime()` to recover it at the boundary.
 * Removing `run` from the public type makes `block.run(input, ctx)` from
 * inside a handler's `execute` a TypeScript error — closing BP-011 at the
 * type system instead of at convention.
 */
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
   * This block's OWN declared resources (FIX-688): its own `resources` config
   * plus its own capability-injected resources, EXCLUDING resources that bubble
   * up from descendant/child blocks. Where `declaredResources` is the bubble-up
   * (this block + all descendants), `ownDeclaredResources` is the strict subset
   * this block itself contributes. For leaf blocks (handler/generator) the two
   * are identical; for composites (sequencer/router) it omits children's
   * declarations so the block-dispatch prefetch hook can load only this block's
   * own declarations without re-loading children's.
   */
  ownDeclaredResources?: DeclaredResources;
  /**
   * Computed at build time: true when this block declares `requireOrg: true`,
   * or — for sequencers — when any child block requires it. Bubbled by
   * `mergeDeclaredResources` and surfaced on the flow as `flow.requiresOrg`
   * for HTTP-layer enforcement.
   */
  requiresOrg: boolean;

  connectInput<TFrom>(mapper: ConnectorFn<TFrom, TInput>): BlockDefinition<ZodTypeAny, TOutputSchema>;
  connectOutput<TTo>(
    mapper: (output: TOutput, ctx: BlockContext) => TTo | Promise<TTo>
  ): BlockDefinition<TInputSchema, ZodTypeAny>;
  /**
   * Declare a separate, model-visible representation of this block's output
   * for use when the block is installed as a tool on a generator. The mapper
   * fires only at the AI SDK bridge boundary, producing the string the LLM
   * observes on its next turn.
   *
   * The structured `TOutput` continues to flow through the block graph
   * unchanged: `tool_output` items, downstream sequencer steps, devtool,
   * tests, and replay all see the original value. Both `TInputSchema` and
   * `TOutputSchema` are preserved.
   *
   * The mapper is a property of the block definition. When the block is used
   * as a regular sequencer step (not via `tools: [...]`), the mapper is
   * silently inert.
   *
   * The mapper is expected to be deterministic: history replay re-runs it
   * rather than persisting its string output. A non-deterministic formatter
   * would produce different strings between original turn and replay.
   */
  mapModelOutput(
    mapper: (output: TOutput, ctx: BlockContext) => string | Promise<string>
  ): BlockDefinition<TInputSchema, TOutputSchema>;

  /**
   * Wrap this block so that, when executed inside a sequencer step, it emits
   * a `tool_output` item with the same envelope and lifecycle the AI SDK
   * tool-loop wrapper produces inside generators. The wrapped block runs
   * normally and returns its typed output unchanged.
   *
   * Use this when a tool has been moved out of an LLM-driven loop into a
   * deterministic prefetch (e.g. inside a `.parallel({...})` step) and the
   * transcript should keep showing it as a tool pill.
   *
   * Attribution (`itemVisibility`, `agentName`) is supplied via opts; when omitted
   * the fields are not stamped on the emitted item.
   */
  asTool(
    opts?: AsToolOpts
  ): BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput>;

  /**
   * Return a copy of this block that recovers from its own failures. If the
   * block throws a non-`SuspensionError`, the first handler whose `when` matches
   * runs — receiving the thrown error, with the same scoped context the block
   * executed in (so it can read sequencer state) — and its output is returned in
   * place of the throw. The enclosing sequencer chain, `forEach` fan-out,
   * `parallel` branch, or `router` route therefore continues to the next step.
   * `ctx.wasRescued(block)` reports `true` afterwards.
   *
   * Available on every block kind. A leaf step recovers and the chain
   * continues; a whole sequencer recovers as a unit (the steps after the failure
   * have already unwound) — the same behavior as `SequencerDefinition.rescue()`,
   * which is the chain-level spelling.
   */
  rescue(handlers: RescueHandlerSpec[]): BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput>;
}

/** Options for {@link BlockDefinition.asTool}. */
export type AsToolOpts = {
  /** Stamped on the emitted `tool_output`; controls grouping under the parent agent's card. */
  itemVisibility?: ItemVisibility;
  agentName?: string;
};

/**
 * Internal substrate view of a block (FIX-503). Adds the `run` dispatch
 * entry point that the runtime uses to actually execute a block. Recovered
 * from a public `BlockDefinition` via `asRuntime()` at substrate boundaries.
 *
 * Not part of the public API surface — `run` is invisible on `BlockDefinition`,
 * so user code can't call `block.run(...)` without first laundering through
 * `asRuntime()`. That deliberate friction is the BP-011 firewall: anyone who
 * reaches for `asRuntime` inside a handler is signing their name on the
 * deviation. There is no runtime guard.
 *
 * @internal
 */
export interface BlockRuntime<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  TOutput = z.infer<TOutputSchema>,
> extends BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput> {
  /** @internal — dispatch entry point used by the substrate. */
  run(input: TInput, ctx: BlockContext): Promise<TOutput>;
  /**
   * @internal — mapper installed via `mapModelOutput`. Read by the generator
   * tool bridge (`compileToolsWithExecute`) and forwarded as `toModelOutput`
   * on the resulting `GeneratorModelTool`. Absent on blocks that never call
   * `mapModelOutput`.
   */
  _modelOutputMapper?: (output: TOutput, ctx: BlockContext) => string | Promise<string>;
}

/**
 * Substrate-only helper that recovers the runtime view of a block. Pure
 * type-level cast — every `BlockDefinition` produced by `buildBlock`
 * carries the `run` method at runtime. Substrate (executor, sequencer,
 * router, generator tool loop, CLI block runner) uses this at the call
 * boundary.
 *
 * @internal
 */
export function asRuntime<
  TInputSchema extends ZodTypeAny,
  TOutputSchema extends ZodTypeAny,
  TInput,
  TOutput,
>(
  block: BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput>
): BlockRuntime<TInputSchema, TOutputSchema, TInput, TOutput> {
  return block as BlockRuntime<TInputSchema, TOutputSchema, TInput, TOutput>;
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
        // All collection refs expose async reads regardless of prefetchMode
        // — FIX-700 collapsed the eager/lazy type split.
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
