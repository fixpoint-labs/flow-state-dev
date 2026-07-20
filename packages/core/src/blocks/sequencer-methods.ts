import { z, type ZodTypeAny } from "zod";
import type {
  BlockContext,
  BlockDefinition,
  ConnectorFn,
  InferStateFromSchema,
  RescueHandlerSpec
} from "../types/block";
import type { UsesEntry } from "../capability/types";

/**
 * Shorthand for a `BlockContext` whose `sequencer.state` slot is typed from
 * a sequencer-level `stateSchema`. Other generics fall back to the same
 * defaults `BlockContext` itself uses (`Record<string, unknown>` for state
 * slots, `unknown` for parent input, etc.) so non-sequencer accesses still
 * surface typos as type errors instead of silently passing under `any`.
 *
 * FIX-914: the sequencer's own DSL callbacks (`.step`/`.tap`/`.loopBack`'s
 * `when`, etc.) run AS the sequencer's own scope, so `ctx.self` mirrors
 * `ctx.sequencer` here — both typed from the same `TStateSchema`. (A
 * sequencer's `ctx.parent` — its own enclosing block's state — isn't typed
 * here; it falls back to `BlockContext`'s untyped default, same as before
 * this addressing mode existed.)
 */
export type SequencerCtx<TStateSchema extends ZodTypeAny | undefined> =
  BlockContext<
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, import("../types/resource").AnyResourceRef>,
    InferStateFromSchema<TStateSchema>,
    unknown,
    undefined,
    {},
    InferStateFromSchema<TStateSchema>
  >;

export type ParallelStep<TCurrent> =
  | BlockDefinition<any, any>
  | {
      connector: ConnectorFn<TCurrent, unknown>;
      block: BlockDefinition<any, any>;
    };

export type ParallelStepOutput<TStep> = TStep extends { outputSchema: { _output: infer V } }
  ? V
  : TStep extends { block: { outputSchema: { _output: infer V } } }
    ? V
    : never;

export type BranchStep<
  TInput,
  TStateSchema extends ZodTypeAny | undefined = undefined,
> = readonly [
  connector: ConnectorFn<TInput, any>,
  condition: (input: any, ctx: SequencerCtx<TStateSchema>) => boolean | Promise<boolean>,
  block: BlockDefinition<any, any>
];

export type BranchStepOutput<TStep> = TStep extends readonly [
  ConnectorFn<any, any>,
  (input: any, ctx: any) => boolean | Promise<boolean>,
  { outputSchema: { _output: infer V } }
]
  ? V
  : never;

export type WorkResult = {
  name: string;
  status: "fulfilled" | "rejected";
  value?: unknown;
  reason?: Error;
};

/** Extracts the config parameter type from a block factory function. */
export type FactoryConfig<TFactory> = TFactory extends (config: infer C) => any ? C : never;

/**
 * Transforms a factory's config for inline use in a sequencer chain.
 * - Omits inputSchema (auto-injected from previous step's outputSchema)
 * - Makes name optional (auto-generated if omitted)
 * - Overrides execute to receive TInput (the chain's current output type)
 */
export type InlineConfig<
  TFactory,
  TInput,
  TOutputSchema extends ZodTypeAny,
  TStateSchema extends ZodTypeAny | undefined = undefined,
  TOutput = z.infer<TOutputSchema>,
> = Omit<FactoryConfig<TFactory>, "inputSchema" | "name" | "outputSchema" | "execute"> & {
  name?: string;
  outputSchema: TOutputSchema;
  execute?: (input: TInput, ctx: SequencerCtx<TStateSchema>) => TOutput | Promise<TOutput>;
};

/**
 * Inline config for tap (output discarded, outputSchema optional).
 */
export type InlineTapConfig<
  TFactory,
  TInput,
  TStateSchema extends ZodTypeAny | undefined = undefined,
> = Omit<FactoryConfig<TFactory>, "inputSchema" | "name" | "outputSchema" | "execute"> & {
  name?: string;
  outputSchema?: ZodTypeAny;
  execute?: (input: TInput, ctx: SequencerCtx<TStateSchema>) => unknown | Promise<unknown>;
};

/** Factory function type — matches handler(), generator(), router(). */
export type InlineBlockFactory = (config: any) => BlockDefinition<any, any>;

/**
 * Sequencer DSL definition. Types flow through the chain via schema inference:
 * - TInput/TOutput are runtime value types (e.g., `number`, `string`)
 * - Types are inferred from Zod schemas on BlockDefinition via `z.infer<>`
 * - Connectors and conditions receive properly typed values from the previous step
 *
 * The sequencer extends BlockDefinition<any, any> at the boundary for structural compatibility.
 */
export interface SequencerDefinition<
  TInput,
  TOutput,
  TStateSchema extends ZodTypeAny | undefined = undefined,
> extends BlockDefinition<any, any> {
  // step(block) — infer output from block's output schema
  step<TOutSchema extends ZodTypeAny>(
    block: BlockDefinition<any, TOutSchema>
  ): SequencerDefinition<TInput, z.infer<TOutSchema>, TStateSchema>;
  // step(factory, inlineConfig) — inline block definition
  step<TFactory extends InlineBlockFactory, TOutputSchema extends ZodTypeAny>(
    factory: TFactory,
    config: InlineConfig<TFactory, TOutput, TOutputSchema, TStateSchema>
  ): SequencerDefinition<TInput, z.infer<TOutputSchema>, TStateSchema>;
  // step(connector, block) — connector transforms, block output inferred
  step<TStepIn, TOutSchema extends ZodTypeAny>(
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<any, TOutSchema>
  ): SequencerDefinition<TInput, z.infer<TOutSchema>, TStateSchema>;

  // stepIf(condition, block) — conditional, union of current | block output
  stepIf<TOutSchema extends ZodTypeAny>(
    condition: (input: TOutput, ctx: SequencerCtx<TStateSchema>) => boolean | Promise<boolean>,
    block: BlockDefinition<any, TOutSchema>
  ): SequencerDefinition<TInput, TOutput | z.infer<TOutSchema>, TStateSchema>;
  // stepIf(condition, factory, inlineConfig) — conditional inline
  stepIf<TFactory extends InlineBlockFactory, TOutputSchema extends ZodTypeAny>(
    condition: (input: TOutput, ctx: SequencerCtx<TStateSchema>) => boolean | Promise<boolean>,
    factory: TFactory,
    config: InlineConfig<TFactory, TOutput, TOutputSchema, TStateSchema>
  ): SequencerDefinition<TInput, TOutput | z.infer<TOutputSchema>, TStateSchema>;
  // stepIf(condition, connector, block) — conditional with connector
  stepIf<TStepIn, TOutSchema extends ZodTypeAny>(
    condition: (input: TOutput, ctx: SequencerCtx<TStateSchema>) => boolean | Promise<boolean>,
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<any, TOutSchema>
  ): SequencerDefinition<TInput, TOutput | z.infer<TOutSchema>, TStateSchema>;

  map<TNext>(
    mapper: (input: TOutput, ctx: SequencerCtx<TStateSchema>) => TNext | Promise<TNext>
  ): SequencerDefinition<TInput, TNext, TStateSchema>;

  parallel<TSteps extends Record<string, ParallelStep<TOutput>>>(
    steps: TSteps,
    options?: { maxConcurrency?: number }
  ): SequencerDefinition<TInput, { [K in keyof TSteps]: ParallelStepOutput<TSteps[K]> }, TStateSchema>;

  // forEach(block) — infer element output from block's output schema
  forEach<TOutSchema extends ZodTypeAny>(
    blockOrFactory:
      | BlockDefinition<any, TOutSchema>
      | ((item: TOutput extends readonly (infer TItem)[] ? TItem : unknown, index: number, ctx: SequencerCtx<TStateSchema>) => BlockDefinition<any, TOutSchema>),
    options?: { maxConcurrency?: number }
  ): SequencerDefinition<TInput, z.infer<TOutSchema>[], TStateSchema>;
  // forEach(connector, block) — connector provides items, block output inferred
  forEach<TStepIn, TOutSchema extends ZodTypeAny>(
    connector: ConnectorFn<TOutput, TStepIn[]>,
    blockOrFactory:
      | BlockDefinition<any, TOutSchema>
      | ((item: TStepIn, index: number, ctx: SequencerCtx<TStateSchema>) => BlockDefinition<any, TOutSchema>),
    options?: { maxConcurrency?: number }
  ): SequencerDefinition<TInput, z.infer<TOutSchema>[], TStateSchema>;

  // forEachBackground(block) — fire-and-forget fan-out, dispatches each iteration as background work
  forEachBackground(
    blockOrFactory:
      | BlockDefinition<any, any>
      | ((item: TOutput extends readonly (infer TItem)[] ? TItem : unknown, index: number, ctx: SequencerCtx<TStateSchema>) => BlockDefinition<any, any>),
    options?: { concurrency?: number }
  ): SequencerDefinition<TInput, TOutput, TStateSchema>;
  // forEachBackground(connector, block) — connector provides items, each dispatched as background work
  forEachBackground<TStepIn>(
    connector: ConnectorFn<TOutput, TStepIn[]>,
    blockOrFactory:
      | BlockDefinition<any, any>
      | ((item: TStepIn, index: number, ctx: SequencerCtx<TStateSchema>) => BlockDefinition<any, any>),
    options?: { concurrency?: number }
  ): SequencerDefinition<TInput, TOutput, TStateSchema>;

  // doUntil — loop block output inferred from schema
  doUntil<TOutSchema extends ZodTypeAny>(
    condition: (value: z.infer<TOutSchema> | TOutput, ctx: SequencerCtx<TStateSchema>) => boolean | Promise<boolean>,
    block: BlockDefinition<any, TOutSchema>
  ): SequencerDefinition<TInput, z.infer<TOutSchema>, TStateSchema>;
  doUntil<TStepIn, TOutSchema extends ZodTypeAny>(
    condition: (value: z.infer<TOutSchema> | TOutput, ctx: SequencerCtx<TStateSchema>) => boolean | Promise<boolean>,
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<any, TOutSchema>
  ): SequencerDefinition<TInput, z.infer<TOutSchema>, TStateSchema>;

  // doWhile — loop block output inferred from schema
  doWhile<TOutSchema extends ZodTypeAny>(
    condition: (value: z.infer<TOutSchema> | TOutput, ctx: SequencerCtx<TStateSchema>) => boolean | Promise<boolean>,
    block: BlockDefinition<any, TOutSchema>
  ): SequencerDefinition<TInput, z.infer<TOutSchema>, TStateSchema>;
  doWhile<TStepIn, TOutSchema extends ZodTypeAny>(
    condition: (value: z.infer<TOutSchema> | TOutput, ctx: SequencerCtx<TStateSchema>) => boolean | Promise<boolean>,
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<any, TOutSchema>
  ): SequencerDefinition<TInput, z.infer<TOutSchema>, TStateSchema>;

  loopBack(
    targetStepName: string,
    options: {
      when?: (value: unknown, ctx: SequencerCtx<TStateSchema>) => boolean | Promise<boolean>;
      maxIterations: number;
    }
  ): SequencerDefinition<TInput, TOutput, TStateSchema>;

  work(block: BlockDefinition<any, any>, options?: { name?: string }): SequencerDefinition<TInput, TOutput, TStateSchema>;
  work<TStepIn>(
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<any, any>,
    options?: { name?: string }
  ): SequencerDefinition<TInput, TOutput, TStateSchema>;

  /**
   * Conditional variant of `.work()` — dispatches a fire-and-forget sidechain
   * only when the condition is truthy. Complete no-op when falsy (no items, no trace).
   *
   * The condition is evaluated once per execution before dispatching. The
   * function form receives the running step value first and the
   * `BlockContext` second — matching `.stepIf` and `.tapIf` — so authors can
   * gate dispatch on either the upstream output or live session/request
   * state.
   */
  workIf(
    condition:
      | boolean
      | ((value: TOutput, ctx: SequencerCtx<TStateSchema>) => boolean | Promise<boolean>),
    block: BlockDefinition<any, any>,
    options?: { name?: string }
  ): SequencerDefinition<TInput, TOutput, TStateSchema>;
  workIf<TStepIn>(
    condition:
      | boolean
      | ((value: TOutput, ctx: SequencerCtx<TStateSchema>) => boolean | Promise<boolean>),
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<any, any>,
    options?: { name?: string }
  ): SequencerDefinition<TInput, TOutput, TStateSchema>;

  waitForWork(options?: {
    failOnError?: boolean;
    timeoutMs?: number;
  }): SequencerDefinition<TInput, TOutput, TStateSchema>;

  tap(
    blockOrFn:
      | BlockDefinition<any, any>
      | ((value: TOutput, ctx: SequencerCtx<TStateSchema>) => void | Promise<void>)
  ): SequencerDefinition<TInput, TOutput, TStateSchema>;
  tap<TFactory extends InlineBlockFactory>(
    factory: TFactory,
    config: InlineTapConfig<TFactory, TOutput, TStateSchema>
  ): SequencerDefinition<TInput, TOutput, TStateSchema>;
  tap<TStepIn>(
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<any, any>
  ): SequencerDefinition<TInput, TOutput, TStateSchema>;

  tapIf(
    condition: (value: TOutput, ctx: SequencerCtx<TStateSchema>) => boolean | Promise<boolean>,
    blockOrFn:
      | BlockDefinition<any, any>
      | ((value: TOutput, ctx: SequencerCtx<TStateSchema>) => void | Promise<void>)
  ): SequencerDefinition<TInput, TOutput, TStateSchema>;
  tapIf<TStepIn>(
    condition: (value: TOutput, ctx: SequencerCtx<TStateSchema>) => boolean | Promise<boolean>,
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<any, any>
  ): SequencerDefinition<TInput, TOutput, TStateSchema>;

  rescue(handlers: RescueHandlerSpec[]): SequencerDefinition<TInput, TOutput, TStateSchema>;

  branch<TBranches extends Record<string, BranchStep<TOutput, TStateSchema>>>(
    branches: TBranches
  ): SequencerDefinition<TInput, BranchStepOutput<TBranches[keyof TBranches]>, TStateSchema>;

  /** Run an array of blocks concurrently with the same input, collect all results as an ordered array. Like Promise.all. */
  stepAll<TSteps extends Array<ParallelStep<TOutput>>>(
    steps: [...TSteps],
    options?: { maxConcurrency?: number }
  ): SequencerDefinition<TInput, { [K in keyof TSteps]: ParallelStepOutput<TSteps[K]> }, TStateSchema>;

  /** Try blocks sequentially in order. Return the first successful result; skip remaining blocks. Throws AggregateError if all fail. */
  stepAny(
    blocks: BlockDefinition<any, any>[]
  ): SequencerDefinition<TInput, unknown, TStateSchema>;

  /** Run blocks concurrently, return the first successful result, abort the rest. Throws AggregateError if all fail. */
  race(
    blocks: BlockDefinition<any, any>[],
    options?: { maxConcurrency?: number }
  ): SequencerDefinition<TInput, unknown, TStateSchema>;

  /**
   * Suspend the chain until `predicate` over the request's item stream
   * returns true, or until `timeoutMs` elapses (whichever comes first).
   *
   * Evaluation: once synchronously at entry against the items already
   * emitted on the response (no subscription if it returns true). Otherwise
   * the runtime subscribes to subsequent item lifecycle events and re-runs
   * the predicate on each — exactly once per event. On timeout or parent
   * abort the subscription is torn down.
   *
   * Output: `{ timedOut: false }` when the predicate became true,
   * `{ timedOut: true }` when the timer fired first. Parent abort also
   * resolves with `{ timedOut: false }` — `timedOut` is strictly a timer
   * signal, not a cancellation signal. Callers that need to distinguish
   * "condition met" from "request cancelled" should check `ctx.signal.aborted`
   * on the next step (the sequencer kernel also short-circuits between steps
   * on an aborted signal). If the predicate itself throws the error
   * propagates after teardown.
   *
   * `wakeOn` is an optional cheap pre-filter on item events. When provided,
   * the predicate is only re-evaluated for items the filter matches. Use
   * to reduce wake-cost in high-fanout patterns (e.g. a task-board worker
   * that only cares about `task-change` items, not `resource_change` churn
   * from sibling workers). The filter does NOT affect the initial on-entry
   * predicate evaluation; that always runs once before any subscription.
   */
  waitForCondition(
    predicate: (items: readonly import("../items/types").OutputItem[]) => boolean,
    options: {
      timeoutMs: number;
      wakeOn?: (
        item: import("../items/types").OutputItem,
        kind: "added" | "updated" | "done"
      ) => boolean;
    }
  ): SequencerDefinition<TInput, { timedOut: boolean }, TStateSchema>;

  /** Exit the sequencer chain early if condition returns true. Current value becomes the sequencer output. */
  exitIf(
    condition: (value: TOutput, ctx: SequencerCtx<TStateSchema>) => boolean | Promise<boolean>
  ): SequencerDefinition<TInput, TOutput, TStateSchema>;

  /**
   * Throw an error if `condition` returns true — a guard primitive for
   * halting the chain when an invariant fails. The error is supplied as
   * either a static `Error` or a factory `(value, ctx) => Error` so the
   * message can carry runtime context. Pairs with `.rescue([{ when: [...] }])`
   * when a typed early-stop pattern is wanted.
   */
  throwIf(
    condition: (value: TOutput, ctx: SequencerCtx<TStateSchema>) => boolean | Promise<boolean>,
    error: Error | ((value: TOutput, ctx: SequencerCtx<TStateSchema>) => Error | Promise<Error>)
  ): SequencerDefinition<TInput, TOutput, TStateSchema>;

  /**
   * Build-time conformance check between the sequencer's declared `outputSchema`
   * (from config) and the chain's tracked schema (inferred from the final step).
   * Throws `SequencerSchemaMismatchError` when structurally incompatible. No-op
   * when either schema is undefined.
   *
   * Conservative — checks top-level kind, object key sets, array element kinds,
   * and one level of object-value kinds. Does NOT verify deep schema equivalence,
   * refinements, brands, or union-variant shapes.
   *
   * Returns `void`. Call as a terminal assertion (typically at end of build or
   * in a setup test) — DSL operations added after `.validate()` are NOT covered
   * by the check.
   */
  validate(): void;

  // connectInput — native override returns SequencerDefinition (not a wrapper block)
  connectInput<TFrom>(
    mapper: ConnectorFn<TFrom, TInput>
  ): SequencerDefinition<TFrom, TOutput, TStateSchema>;
}

export type SequencerConfig<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  TStateSchema extends ZodTypeAny | undefined = undefined,
> = {
  name: string;
  description?: string;
  transient?: boolean;
  /**
   * When true (default), the sequencer's state is checkpointed to
   * `stores.checkpoints` at every step boundary. The Phase 2 resume runtime
   * (FIX-141) reads the latest checkpoint to pick up after an interrupted
   * request. Set `false` to opt out — typically for tests or single-shot
   * ephemeral sequencers where persistence is unwanted overhead.
   *
   * Latest-only semantics: storage is constant per sequencer regardless of
   * step count. See `SequencerCheckpoint` and FIX-401 spec.
   */
  durable?: boolean;
  inputSchema?: TInputSchema;
  outputSchema?: ZodTypeAny;
  /** This sequencer's own request-scoped state (FIX-914 alias: also exposed
   *  as `ctx.self` within its own DSL callbacks, in addition to `ctx.sequencer`). */
  stateSchema?: TStateSchema;
  /** Capabilities to install. Merges resources, state schemas, targets,
   *  and any active preset surfaces into this sequencer's config. */
  uses?: readonly UsesEntry[];
  /**
   * Active status message for this sequencer — declarative sugar for
   * `ctx.emit.status()` at sequencer start. A static string is emitted once
   * when the sequencer enters execution; a function receives `(input, ctx)`
   * and its return value is emitted.
   */
  activeStatusMessage?: string | ((input: TInput, ctx: SequencerCtx<TStateSchema>) => string);
  container?: {
    component?: string;
    label?: string | ((input: TInput) => string);
    metadata?: Record<string, unknown> | ((input: TInput) => Record<string, unknown>);
  };
};

export type SequencerWorkTask = {
  name: string;
  promise: Promise<WorkResult>;
};

export type SequencerRuntimeState = {
  stepHistory: string[];
  loopCounts: Map<string, number>;
  /**
   * Per-sequencer fallback work list. Populated only when the request-scoped
   * work pool is absent (unit-test contexts without `_requestWorkPool`). When
   * a pool is present, sequencer DSL pushes tasks onto the pool tagged with
   * `scopeId`, and this list stays empty.
   */
  workTasks: SequencerWorkTask[];
  stateVersion: number;
  /**
   * Per-sequencer-instance scope ID. `.work()` / `.workIf()` /
   * `.forEachBackground()` tag pool tasks with this id so `.waitForWork()`
   * drains only the calling sequencer's contributions to the pool.
   */
  scopeId: string;
  /**
   * Path of the most recently invoked child block within this sequencer. Used
   * by subsequent ops to compute the `input.source` ref for the next child
   * (FIX-573 §3.3). Undefined before the first child runs (sequencer head)
   * and for ops that don't dispatch a child (`.map`, `.exitIf`, etc.).
   */
  lastChildPath?: string;
  /**
   * Running BlockValue descriptor for the sequencer's value as it would feed
   * into the next op (FIX-573 §3.3). Mirrors the running output descriptor at
   * sequencer level, but expressed as a `BlockValueInternal` source so it can
   * be stamped directly onto the next child's `input.source`. Aggregator ops
   * (`.parallel`, `.stepAll`, `.forEach`) write a `structure` here so the
   * downstream sequential op stamps a structure-shaped input rather than a
   * single ref.
   */
  lastChildInputHint?: import("../items/types").BlockValueInternal<unknown>;
  /**
   * Active `loopBack` generation for child path construction (FIX-643). 0
   * (the default) on the first pass and after a loop exits, so child paths are
   * unchanged for non-looping code. Each `loopBack` jump bumps it to the
   * loop's incremented `loopCounts` value, so steps re-executed in pass N get a
   * `loop[N]` parent-path prefix and a distinct `blockInstanceId` per iteration.
   */
  activeLoopGeneration: number;
};
