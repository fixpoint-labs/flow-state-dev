import { z, type ZodTypeAny } from "zod";
import type {
  BlockContext,
  BlockDefinition,
  ConnectorFn,
  RescueHandlerSpec
} from "../types/block";

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

export type BranchStep<TInput> = readonly [
  connector: ConnectorFn<TInput, any>,
  condition: (input: any, ctx: BlockContext) => boolean | Promise<boolean>,
  block: BlockDefinition<any, any>
];

export type BranchStepOutput<TStep> = TStep extends readonly [
  ConnectorFn<any, any>,
  (input: any, ctx: BlockContext) => boolean | Promise<boolean>,
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
  TOutput = z.infer<TOutputSchema>,
> = Omit<FactoryConfig<TFactory>, "inputSchema" | "name" | "outputSchema" | "execute"> & {
  name?: string;
  outputSchema: TOutputSchema;
  execute?: (input: TInput, ctx: BlockContext) => TOutput | Promise<TOutput>;
};

/**
 * Inline config for tap (output discarded, outputSchema optional).
 */
export type InlineTapConfig<TFactory, TInput> = Omit<FactoryConfig<TFactory>, "inputSchema" | "name" | "outputSchema" | "execute"> & {
  name?: string;
  outputSchema?: ZodTypeAny;
  execute?: (input: TInput, ctx: BlockContext) => unknown | Promise<unknown>;
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
export interface SequencerDefinition<TInput, TOutput> extends BlockDefinition<any, any> {
  // then(block) — infer output from block's output schema
  then<TOutSchema extends ZodTypeAny>(
    block: BlockDefinition<any, TOutSchema>
  ): SequencerDefinition<TInput, z.infer<TOutSchema>>;
  // then(factory, inlineConfig) — inline block definition
  then<TFactory extends InlineBlockFactory, TOutputSchema extends ZodTypeAny>(
    factory: TFactory,
    config: InlineConfig<TFactory, TOutput, TOutputSchema>
  ): SequencerDefinition<TInput, z.infer<TOutputSchema>>;
  // then(connector, block) — connector transforms, block output inferred
  then<TStepIn, TOutSchema extends ZodTypeAny>(
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<any, TOutSchema>
  ): SequencerDefinition<TInput, z.infer<TOutSchema>>;

  // thenIf(condition, block) — conditional, union of current | block output
  thenIf<TOutSchema extends ZodTypeAny>(
    condition: (input: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
    block: BlockDefinition<any, TOutSchema>
  ): SequencerDefinition<TInput, TOutput | z.infer<TOutSchema>>;
  // thenIf(condition, factory, inlineConfig) — conditional inline
  thenIf<TFactory extends InlineBlockFactory, TOutputSchema extends ZodTypeAny>(
    condition: (input: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
    factory: TFactory,
    config: InlineConfig<TFactory, TOutput, TOutputSchema>
  ): SequencerDefinition<TInput, TOutput | z.infer<TOutputSchema>>;
  // thenIf(condition, connector, block) — conditional with connector
  thenIf<TStepIn, TOutSchema extends ZodTypeAny>(
    condition: (input: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<any, TOutSchema>
  ): SequencerDefinition<TInput, TOutput | z.infer<TOutSchema>>;

  map<TNext>(mapper: (input: TOutput, ctx: BlockContext) => TNext | Promise<TNext>): SequencerDefinition<TInput, TNext>;

  parallel<TSteps extends Record<string, ParallelStep<TOutput>>>(
    steps: TSteps,
    options?: { maxConcurrency?: number }
  ): SequencerDefinition<TInput, { [K in keyof TSteps]: ParallelStepOutput<TSteps[K]> }>;

  // forEach(block) — infer element output from block's output schema
  forEach<TOutSchema extends ZodTypeAny>(
    blockOrFactory:
      | BlockDefinition<any, TOutSchema>
      | ((item: TOutput extends readonly (infer TItem)[] ? TItem : unknown, index: number, ctx: BlockContext) => BlockDefinition<any, TOutSchema>),
    options?: { maxConcurrency?: number }
  ): SequencerDefinition<TInput, z.infer<TOutSchema>[]>;
  // forEach(connector, block) — connector provides items, block output inferred
  forEach<TStepIn, TOutSchema extends ZodTypeAny>(
    connector: ConnectorFn<TOutput, TStepIn[]>,
    blockOrFactory:
      | BlockDefinition<any, TOutSchema>
      | ((item: TStepIn, index: number, ctx: BlockContext) => BlockDefinition<any, TOutSchema>),
    options?: { maxConcurrency?: number }
  ): SequencerDefinition<TInput, z.infer<TOutSchema>[]>;

  // doUntil — loop block output inferred from schema
  doUntil<TOutSchema extends ZodTypeAny>(
    condition: (value: z.infer<TOutSchema> | TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
    block: BlockDefinition<any, TOutSchema>
  ): SequencerDefinition<TInput, z.infer<TOutSchema>>;
  doUntil<TStepIn, TOutSchema extends ZodTypeAny>(
    condition: (value: z.infer<TOutSchema> | TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<any, TOutSchema>
  ): SequencerDefinition<TInput, z.infer<TOutSchema>>;

  // doWhile — loop block output inferred from schema
  doWhile<TOutSchema extends ZodTypeAny>(
    condition: (value: z.infer<TOutSchema> | TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
    block: BlockDefinition<any, TOutSchema>
  ): SequencerDefinition<TInput, z.infer<TOutSchema>>;
  doWhile<TStepIn, TOutSchema extends ZodTypeAny>(
    condition: (value: z.infer<TOutSchema> | TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<any, TOutSchema>
  ): SequencerDefinition<TInput, z.infer<TOutSchema>>;

  loopBack(
    targetStepName: string,
    options: {
      when?: (value: unknown, ctx: BlockContext) => boolean | Promise<boolean>;
      maxIterations: number;
    }
  ): SequencerDefinition<TInput, TOutput>;

  work(block: BlockDefinition<any, any>, options?: { name?: string }): SequencerDefinition<TInput, TOutput>;
  work<TStepIn>(
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<any, any>,
    options?: { name?: string }
  ): SequencerDefinition<TInput, TOutput>;

  waitForWork(options?: {
    failOnError?: boolean;
    timeoutMs?: number;
  }): SequencerDefinition<TInput, TOutput>;

  tap(
    blockOrFn:
      | BlockDefinition<any, any>
      | ((value: TOutput, ctx: BlockContext) => void | Promise<void>)
  ): SequencerDefinition<TInput, TOutput>;
  tap<TFactory extends InlineBlockFactory>(
    factory: TFactory,
    config: InlineTapConfig<TFactory, TOutput>
  ): SequencerDefinition<TInput, TOutput>;
  tap<TStepIn>(
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<any, any>
  ): SequencerDefinition<TInput, TOutput>;

  tapIf(
    condition: (value: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
    blockOrFn:
      | BlockDefinition<any, any>
      | ((value: TOutput, ctx: BlockContext) => void | Promise<void>)
  ): SequencerDefinition<TInput, TOutput>;
  tapIf<TStepIn>(
    condition: (value: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<any, any>
  ): SequencerDefinition<TInput, TOutput>;

  rescue(handlers: RescueHandlerSpec[]): SequencerDefinition<TInput, TOutput>;

  branch<TBranches extends Record<string, BranchStep<TOutput>>>(
    branches: TBranches
  ): SequencerDefinition<TInput, BranchStepOutput<TBranches[keyof TBranches]>>;

  validate(): SequencerDefinition<TInput, TOutput>;
}

export type SequencerConfig<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
> = {
  name: string;
  description?: string;
  inputSchema?: TInputSchema;
  outputSchema?: ZodTypeAny;
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
  workTasks: SequencerWorkTask[];
};
