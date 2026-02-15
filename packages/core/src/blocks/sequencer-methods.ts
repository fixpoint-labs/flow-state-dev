import type {
  BlockContext,
  BlockDefinition,
  ConnectorFn,
  MessageOption,
  RenderOption,
  RescueHandlerSpec
} from "../types/block";

export type ParallelStep<TCurrent> =
  | BlockDefinition<TCurrent, unknown>
  | {
      connector: ConnectorFn<TCurrent, unknown>;
      block: BlockDefinition<unknown, unknown>;
    };

export type ParallelStepOutput<TStep> = TStep extends BlockDefinition<any, infer TOutput>
  ? TOutput
  : TStep extends { block: BlockDefinition<any, infer TOutput> }
    ? TOutput
    : never;

export type BranchStep<TInput> = readonly [
  connector: ConnectorFn<TInput, any>,
  condition: (input: any, ctx: BlockContext) => boolean | Promise<boolean>,
  block: BlockDefinition<any, any>
];

export type BranchStepOutput<TStep> = TStep extends readonly [
  ConnectorFn<any, any>,
  (input: any, ctx: BlockContext) => boolean | Promise<boolean>,
  BlockDefinition<any, infer TOutput>
]
  ? TOutput
  : never;

export type WorkResult = {
  name: string;
  status: "fulfilled" | "rejected";
  value?: unknown;
  reason?: Error;
};

export interface SequencerDefinition<TInput, TOutput> extends BlockDefinition<TInput, TOutput> {
  then<TNext>(block: BlockDefinition<TOutput, TNext>): SequencerDefinition<TInput, TNext>;
  then<TStepIn, TNext>(
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<TStepIn, TNext>
  ): SequencerDefinition<TInput, TNext>;

  thenIf<TNext>(
    condition: (input: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
    block: BlockDefinition<TOutput, TNext>
  ): SequencerDefinition<TInput, TOutput | TNext>;
  thenIf<TStepIn, TNext>(
    condition: (input: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<TStepIn, TNext>
  ): SequencerDefinition<TInput, TOutput | TNext>;

  map<TNext>(mapper: (input: TOutput, ctx: BlockContext) => TNext | Promise<TNext>): SequencerDefinition<TInput, TNext>;

  parallel<TSteps extends Record<string, ParallelStep<TOutput>>>(
    steps: TSteps,
    options?: { maxConcurrency?: number }
  ): SequencerDefinition<TInput, { [K in keyof TSteps]: ParallelStepOutput<TSteps[K]> }>;

  forEach<TItem, TStepOut>(
    blockOrFactory:
      | BlockDefinition<TItem, TStepOut>
      | ((item: TItem, index: number, ctx: BlockContext) => BlockDefinition<TItem, TStepOut>),
    options?: { maxConcurrency?: number }
  ): SequencerDefinition<TInput, TStepOut[]>;
  forEach<TItem, TStepIn, TStepOut>(
    connector: ConnectorFn<TOutput, TStepIn[]>,
    blockOrFactory:
      | BlockDefinition<TStepIn, TStepOut>
      | ((item: TStepIn, index: number, ctx: BlockContext) => BlockDefinition<TStepIn, TStepOut>),
    options?: { maxConcurrency?: number }
  ): SequencerDefinition<TInput, TStepOut[]>;

  doUntil<TStepIn, TNext>(
    condition: (value: TNext | TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
    block: BlockDefinition<TStepIn, TNext>
  ): SequencerDefinition<TInput, TNext>;
  doUntil<TStepIn, TNext>(
    condition: (value: TNext | TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<TStepIn, TNext>
  ): SequencerDefinition<TInput, TNext>;

  doWhile<TStepIn, TNext>(
    condition: (value: TNext | TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
    block: BlockDefinition<TStepIn, TNext>
  ): SequencerDefinition<TInput, TNext>;
  doWhile<TStepIn, TNext>(
    condition: (value: TNext | TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<TStepIn, TNext>
  ): SequencerDefinition<TInput, TNext>;

  loopBack(
    targetStepName: string,
    options: {
      when?: (value: unknown, ctx: BlockContext) => boolean | Promise<boolean>;
      maxIterations: number;
    }
  ): SequencerDefinition<TInput, TOutput>;

  work(block: BlockDefinition<TOutput, unknown>, options?: { name?: string }): SequencerDefinition<TInput, TOutput>;
  work<TStepIn>(
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<TStepIn, unknown>,
    options?: { name?: string }
  ): SequencerDefinition<TInput, TOutput>;

  waitForWork(options?: {
    failOnError?: boolean;
    timeoutMs?: number;
  }): SequencerDefinition<TInput, TOutput>;

  tap(
    blockOrFn:
      | BlockDefinition<TOutput, unknown>
      | ((value: TOutput, ctx: BlockContext) => void | Promise<void>)
  ): SequencerDefinition<TInput, TOutput>;
  tap<TStepIn>(
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<TStepIn, unknown>
  ): SequencerDefinition<TInput, TOutput>;

  tapIf(
    condition: (value: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
    blockOrFn:
      | BlockDefinition<TOutput, unknown>
      | ((value: TOutput, ctx: BlockContext) => void | Promise<void>)
  ): SequencerDefinition<TInput, TOutput>;
  tapIf<TStepIn>(
    condition: (value: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
    connector: ConnectorFn<TOutput, TStepIn>,
    block: BlockDefinition<TStepIn, unknown>
  ): SequencerDefinition<TInput, TOutput>;

  rescue(handlers: RescueHandlerSpec[]): SequencerDefinition<TInput, TOutput>;

  branch<TBranches extends Record<string, BranchStep<TOutput>>>(
    branches: TBranches
  ): SequencerDefinition<TInput, BranchStepOutput<TBranches[keyof TBranches]>>;
}

export type SequencerConfig<TInput = unknown> = {
  name: string;
  description?: string;
  inputSchema?: BlockDefinition<TInput, TInput>["inputSchema"];
  outputSchema?: BlockDefinition<TInput, TInput>["outputSchema"];
  render?: RenderOption<TInput>;
  message?: MessageOption<TInput>;
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
