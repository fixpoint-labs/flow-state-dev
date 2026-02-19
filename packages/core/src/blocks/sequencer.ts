import type { BlockContext, BlockDefinition, ConnectorFn, RescueHandlerSpec } from "../types/block";
import type {
  BranchStep,
  BranchStepOutput,
  ParallelStep,
  ParallelStepOutput,
  SequencerConfig,
  SequencerDefinition,
  SequencerRuntimeState,
  WorkResult
} from "./sequencer-methods";
import { buildBlock } from "./internal/build-block";

const DEFAULT_MAX_LOOP_GUARD = 250;

type SequencerOperation = {
  name: string;
  run: (
    value: unknown,
    ctx: BlockContext,
    runtime: SequencerRuntimeState,
    stepIndex: number
  ) => Promise<{ value: unknown; jumpTo?: string }>;
};

type WorkOptions = {
  name?: string;
};

type WaitForWorkOptions = {
  failOnError?: boolean;
  timeoutMs?: number;
};

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    return new Error(value);
  }

  return new Error("Sequencer execution failed");
}

function isBlockDefinition(value: unknown): value is BlockDefinition<any, any> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const maybeBlock = value as Record<string, unknown>;
  return (
    typeof maybeBlock.kind === "string" &&
    typeof maybeBlock.name === "string" &&
    typeof maybeBlock.config === "object" &&
    maybeBlock.config !== null
  );
}

function isConcurrencyOptions(value: unknown): value is { maxConcurrency?: number } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (isBlockDefinition(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return "maxConcurrency" in record || Object.keys(record).length === 0;
}

async function executeBlock<TInput, TOutput>(
  block: BlockDefinition<TInput, TOutput>,
  input: TInput,
  ctx: BlockContext
): Promise<TOutput> {
  if (block.config.execute === undefined) {
    throw new Error(`Block "${block.name}" cannot run because config.execute is missing`);
  }

  return block.config.execute(input, ctx);
}

async function withTimeout<TValue>(
  promise: Promise<TValue>,
  timeoutMs: number | undefined,
  label: string
): Promise<TValue> {
  if (timeoutMs === undefined || timeoutMs <= 0) {
    return promise;
  }

  return new Promise<TValue>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

async function mapWithConcurrency<TInput, TOutput>(
  values: readonly TInput[],
  maxConcurrency: number | undefined,
  mapper: (value: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  if (values.length === 0) {
    return [];
  }

  const limit = Math.max(1, maxConcurrency ?? values.length);
  const results: TOutput[] = new Array<TOutput>(values.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  };

  const workers: Promise<void>[] = [];
  for (let index = 0; index < Math.min(limit, values.length); index += 1) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

function matchesRescueHandler(error: Error, handler: RescueHandlerSpec): boolean {
  if (handler.when === undefined || handler.when.length === 0) {
    return true;
  }

  for (const ErrorType of handler.when) {
    if (error instanceof ErrorType) {
      return true;
    }
  }

  return false;
}

function createRuntimeState(): SequencerRuntimeState {
  return {
    stepHistory: [],
    loopCounts: new Map<string, number>(),
    workTasks: []
  };
}

function runSequencerOperations(
  operations: SequencerOperation[],
  rescueHandlers: RescueHandlerSpec[]
): (input: unknown, ctx: BlockContext) => Promise<unknown> {
  return async (input: unknown, ctx: BlockContext): Promise<unknown> => {
    const runtime = createRuntimeState();
    let currentValue: unknown = input;

    try {
      for (let index = 0; index < operations.length; index += 1) {
        const operation = operations[index];
        runtime.stepHistory.push(operation.name);
        const result = await operation.run(currentValue, ctx, runtime, index);
        currentValue = result.value;

        if (result.jumpTo !== undefined) {
          const jumpIndex = operations.findIndex((candidate) => candidate.name === result.jumpTo);
          if (jumpIndex < 0) {
            throw new Error(`loopBack target "${result.jumpTo}" was not found in sequencer "${runtime.stepHistory[0]}"`);
          }

          index = jumpIndex - 1;
        }
      }

      return currentValue;
    } catch (error) {
      const normalizedError = toError(error);
      for (const handler of rescueHandlers) {
        if (!matchesRescueHandler(normalizedError, handler)) {
          continue;
        }

        return executeBlock(handler.block, normalizedError, ctx);
      }

      throw normalizedError;
    }
  };
}

function createSequencer<TInput, TOutput>(
  config: SequencerConfig<TInput>,
  operations: SequencerOperation[],
  rescueHandlers: RescueHandlerSpec[]
): SequencerDefinition<TInput, TOutput> {
  const baseBlock = buildBlock<TInput, TOutput>({
    kind: "sequencer",
    config: {
      name: config.name,
      description: config.description,
      inputSchema: config.inputSchema,
      outputSchema: config.outputSchema,
      clientOutput: config.clientOutput as any,
      llmOutput: config.llmOutput as any
    },
    execute: runSequencerOperations(operations, rescueHandlers) as (
      input: TInput,
      ctx: BlockContext
    ) => Promise<TOutput>
  });

  const extend = <TNext>(
    operation: SequencerOperation
  ): SequencerDefinition<TInput, TNext> =>
    createSequencer<TInput, TNext>(config, [...operations, operation], rescueHandlers);

  const definition: SequencerDefinition<TInput, TOutput> = Object.assign(baseBlock, {
    then<TStepIn, TNext>(
      arg1: BlockDefinition<TOutput, TNext> | ConnectorFn<TOutput, TStepIn>,
      arg2?: BlockDefinition<TStepIn, TNext>
    ): SequencerDefinition<TInput, TNext> {
      const connector = arg2 === undefined ? undefined : (arg1 as ConnectorFn<TOutput, TStepIn>);
      const block = (arg2 ?? arg1) as BlockDefinition<TStepIn, TNext>;

      return extend<TNext>({
        name: block.name,
        run: async (value, ctx) => {
          const nextInput = connector === undefined ? value : await connector(value as TOutput, ctx);
          const output = await executeBlock(block, nextInput as TStepIn, ctx);
          return { value: output };
        }
      });
    },

    thenIf<TStepIn, TNext>(
      condition: (input: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
      arg2: BlockDefinition<TOutput, TNext> | ConnectorFn<TOutput, TStepIn>,
      arg3?: BlockDefinition<TStepIn, TNext>
    ): SequencerDefinition<TInput, TOutput | TNext> {
      const connector = arg3 === undefined ? undefined : (arg2 as ConnectorFn<TOutput, TStepIn>);
      const block = (arg3 ?? arg2) as BlockDefinition<TStepIn, TNext>;

      return createSequencer<TInput, TOutput | TNext>(
        config,
        [
          ...operations,
          {
            name: `if:${block.name}`,
            run: async (value, ctx) => {
              const matches = await condition(value as TOutput, ctx);
              if (!matches) {
                return { value };
              }

              const nextInput = connector === undefined ? value : await connector(value as TOutput, ctx);
              const output = await executeBlock(block, nextInput as TStepIn, ctx);
              return { value: output };
            }
          }
        ],
        rescueHandlers
      );
    },

    map<TNext>(mapper: (input: TOutput, ctx: BlockContext) => TNext | Promise<TNext>): SequencerDefinition<TInput, TNext> {
      return extend<TNext>({
        name: "map",
        run: async (value, ctx) => ({ value: await mapper(value as TOutput, ctx) })
      });
    },

    parallel<TSteps extends Record<string, ParallelStep<TOutput>>>(
      steps: TSteps,
      options?: { maxConcurrency?: number }
    ): SequencerDefinition<TInput, { [K in keyof TSteps]: ParallelStepOutput<TSteps[K]> }> {
      return extend<{ [K in keyof TSteps]: ParallelStepOutput<TSteps[K]> }>({
        name: "parallel",
        run: async (value, ctx) => {
          const entries = Object.entries(steps) as Array<[keyof TSteps, TSteps[keyof TSteps]]>;
          const outputs = await mapWithConcurrency(
            entries,
            options?.maxConcurrency,
            async ([, step]): Promise<unknown> => {
              if (isBlockDefinition(step)) {
                return executeBlock(step as BlockDefinition<TOutput, unknown>, value as TOutput, ctx);
              }

              const connected = await step.connector(value as TOutput, ctx);
              return executeBlock(step.block, connected, ctx);
            }
          );

          const result = {} as { [K in keyof TSteps]: ParallelStepOutput<TSteps[K]> };
          entries.forEach(([key], index) => {
            result[key] = outputs[index] as ParallelStepOutput<TSteps[typeof key]>;
          });

          return { value: result };
        }
      });
    },

    forEach<TItem, TStepIn, TStepOut>(
      arg1:
        | BlockDefinition<TItem, TStepOut>
        | ((item: TItem, index: number, ctx: BlockContext) => BlockDefinition<TItem, TStepOut>)
        | ConnectorFn<TOutput, TStepIn[]>,
      arg2?:
        | BlockDefinition<TStepIn, TStepOut>
        | ((item: TStepIn, index: number, ctx: BlockContext) => BlockDefinition<TStepIn, TStepOut>)
        | { maxConcurrency?: number },
      arg3?: { maxConcurrency?: number }
    ): SequencerDefinition<TInput, TStepOut[]> {
      const hasConnector =
        arg3 !== undefined || (arg2 !== undefined && !isConcurrencyOptions(arg2));
      const connector = hasConnector ? (arg1 as ConnectorFn<TOutput, TStepIn[]>) : undefined;
      const blockOrFactory = (hasConnector ? arg2 : arg1) as
        | BlockDefinition<TStepIn, TStepOut>
        | ((item: TStepIn, index: number, ctx: BlockContext) => BlockDefinition<TStepIn, TStepOut>);
      const options = (hasConnector ? arg3 : arg2) as { maxConcurrency?: number } | undefined;

      return extend<TStepOut[]>({
        name: "forEach",
        run: async (value, ctx) => {
          const items = (
            connector === undefined ? (value as unknown as TStepIn[]) : await connector(value as TOutput, ctx)
          ) ?? [];

          if (!Array.isArray(items)) {
            throw new Error("forEach expected an array input");
          }

          const outputs = await mapWithConcurrency(items, options?.maxConcurrency, async (item, index) => {
            const block =
              typeof blockOrFactory === "function" && !isBlockDefinition(blockOrFactory)
                ? blockOrFactory(item, index, ctx)
                : (blockOrFactory as BlockDefinition<TStepIn, TStepOut>);

            return executeBlock(block, item, ctx);
          });

          return { value: outputs };
        }
      });
    },

    doUntil<TStepIn, TNext>(
      condition: (value: TNext | TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
      arg2: BlockDefinition<TStepIn, TNext> | ConnectorFn<TOutput, TStepIn>,
      arg3?: BlockDefinition<TStepIn, TNext>
    ): SequencerDefinition<TInput, TNext> {
      const connector = arg3 === undefined ? undefined : (arg2 as ConnectorFn<TOutput, TStepIn>);
      const block = (arg3 ?? arg2) as BlockDefinition<TStepIn, TNext>;

      return extend<TNext>({
        name: `doUntil:${block.name}`,
        run: async (value, ctx) => {
          let nextInput =
            connector === undefined ? (value as unknown as TStepIn) : await connector(value as TOutput, ctx);
          let guard = 0;

          while (true) {
            const output = await executeBlock(block, nextInput, ctx);
            const done = await condition(output, ctx);
            if (done) {
              return { value: output };
            }

            guard += 1;
            if (guard > DEFAULT_MAX_LOOP_GUARD) {
              throw new Error(`doUntil exceeded max loop guard (${DEFAULT_MAX_LOOP_GUARD})`);
            }

            nextInput = output as unknown as TStepIn;
          }
        }
      });
    },

    doWhile<TStepIn, TNext>(
      condition: (value: TNext | TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
      arg2: BlockDefinition<TStepIn, TNext> | ConnectorFn<TOutput, TStepIn>,
      arg3?: BlockDefinition<TStepIn, TNext>
    ): SequencerDefinition<TInput, TNext> {
      const connector = arg3 === undefined ? undefined : (arg2 as ConnectorFn<TOutput, TStepIn>);
      const block = (arg3 ?? arg2) as BlockDefinition<TStepIn, TNext>;

      return extend<TNext>({
        name: `doWhile:${block.name}`,
        run: async (value, ctx) => {
          let nextInput =
            connector === undefined ? (value as unknown as TStepIn) : await connector(value as TOutput, ctx);
          let output = await executeBlock(block, nextInput, ctx);
          let guard = 0;

          while (await condition(output, ctx)) {
            guard += 1;
            if (guard > DEFAULT_MAX_LOOP_GUARD) {
              throw new Error(`doWhile exceeded max loop guard (${DEFAULT_MAX_LOOP_GUARD})`);
            }

            nextInput = output as unknown as TStepIn;
            output = await executeBlock(block, nextInput, ctx);
          }

          return { value: output };
        }
      });
    },

    loopBack(
      targetStepName: string,
      options: {
        when?: (value: unknown, ctx: BlockContext) => boolean | Promise<boolean>;
        maxIterations: number;
      }
    ): SequencerDefinition<TInput, TOutput> {
      return extend<TOutput>({
        name: `loopBack:${targetStepName}`,
        run: async (value, ctx, runtime, stepIndex) => {
          const shouldLoop = options.when === undefined ? true : await options.when(value, ctx);
          if (!shouldLoop) {
            return { value };
          }

          const key = `${targetStepName}:${stepIndex}`;
          const currentCount = runtime.loopCounts.get(key) ?? 0;
          if (currentCount >= options.maxIterations) {
            return { value };
          }

          runtime.loopCounts.set(key, currentCount + 1);
          return { value, jumpTo: targetStepName };
        }
      });
    },

    work<TStepIn>(
      arg1: BlockDefinition<TOutput, unknown> | ConnectorFn<TOutput, TStepIn>,
      arg2?: BlockDefinition<TStepIn, unknown> | WorkOptions,
      arg3?: WorkOptions
    ): SequencerDefinition<TInput, TOutput> {
      const hasConnector = isBlockDefinition(arg2);
      const connector = hasConnector ? (arg1 as ConnectorFn<TOutput, TStepIn>) : undefined;
      const block = (hasConnector ? arg2 : arg1) as BlockDefinition<TStepIn, unknown>;
      const options = (hasConnector ? arg3 : arg2) as WorkOptions | undefined;

      return extend<TOutput>({
        name: options?.name ?? `work:${block.name}`,
        run: async (value, ctx, runtime) => {
          const name = options?.name ?? block.name;
          const input =
            connector === undefined ? (value as unknown as TStepIn) : await connector(value as TOutput, ctx);

          const promise = executeBlock(block, input, ctx)
            .then(
              (result): WorkResult => ({
                name,
                status: "fulfilled",
                value: result
              })
            )
            .catch((error): WorkResult => ({
              name,
              status: "rejected",
              reason: toError(error)
            }));

          runtime.workTasks.push({ name, promise });
          return { value };
        }
      });
    },

    waitForWork(options?: WaitForWorkOptions): SequencerDefinition<TInput, TOutput> {
      return extend<TOutput>({
        name: "waitForWork",
        run: async (value, _ctx, runtime) => {
          if (runtime.workTasks.length === 0) {
            return { value };
          }

          const workTasks = runtime.workTasks.splice(0, runtime.workTasks.length);
          const results = await withTimeout(
            Promise.all(workTasks.map((task) => task.promise)),
            options?.timeoutMs,
            "waitForWork"
          );

          if (options?.failOnError === true) {
            const rejected = results.find((result) => result.status === "rejected");
            if (rejected !== undefined) {
              throw rejected.reason ?? new Error(`Background work "${rejected.name}" failed`);
            }
          }

          return { value };
        }
      });
    },

    tap<TStepIn>(
      arg1:
        | BlockDefinition<TOutput, unknown>
        | ((value: TOutput, ctx: BlockContext) => void | Promise<void>)
        | ConnectorFn<TOutput, TStepIn>,
      arg2?: BlockDefinition<TStepIn, unknown>
    ): SequencerDefinition<TInput, TOutput> {
      const connector = arg2 === undefined ? undefined : (arg1 as ConnectorFn<TOutput, TStepIn>);
      const tapTarget = (arg2 ?? arg1) as
        | BlockDefinition<TStepIn, unknown>
        | ((value: TOutput, ctx: BlockContext) => void | Promise<void>);

      return extend<TOutput>({
        name: "tap",
        run: async (value, ctx) => {
          if (connector === undefined) {
            if (isBlockDefinition(tapTarget)) {
              await executeBlock(
                tapTarget as unknown as BlockDefinition<TOutput, unknown>,
                value as TOutput,
                ctx
              );
            } else {
              await (tapTarget as (value: TOutput, ctx: BlockContext) => void | Promise<void>)(
                value as TOutput,
                ctx
              );
            }
          } else {
            const connectedInput = await connector(value as TOutput, ctx);
            await executeBlock(tapTarget as BlockDefinition<TStepIn, unknown>, connectedInput, ctx);
          }

          return { value };
        }
      });
    },

    tapIf<TStepIn>(
      condition: (value: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
      arg2:
        | BlockDefinition<TOutput, unknown>
        | ((value: TOutput, ctx: BlockContext) => void | Promise<void>)
        | ConnectorFn<TOutput, TStepIn>,
      arg3?: BlockDefinition<TStepIn, unknown>
    ): SequencerDefinition<TInput, TOutput> {
      const connector = arg3 === undefined ? undefined : (arg2 as ConnectorFn<TOutput, TStepIn>);
      const tapTarget = (arg3 ?? arg2) as
        | BlockDefinition<TStepIn, unknown>
        | ((value: TOutput, ctx: BlockContext) => void | Promise<void>);

      return extend<TOutput>({
        name: "tapIf",
        run: async (value, ctx) => {
          const matches = await condition(value as TOutput, ctx);
          if (!matches) {
            return { value };
          }

          if (connector === undefined) {
            if (isBlockDefinition(tapTarget)) {
              await executeBlock(
                tapTarget as unknown as BlockDefinition<TOutput, unknown>,
                value as TOutput,
                ctx
              );
            } else {
              await (tapTarget as (value: TOutput, ctx: BlockContext) => void | Promise<void>)(
                value as TOutput,
                ctx
              );
            }
          } else {
            const connectedInput = await connector(value as TOutput, ctx);
            await executeBlock(tapTarget as BlockDefinition<TStepIn, unknown>, connectedInput, ctx);
          }

          return { value };
        }
      });
    },

    rescue(handlers: RescueHandlerSpec[]): SequencerDefinition<TInput, TOutput> {
      return createSequencer<TInput, TOutput>(config, operations, handlers);
    },

    branch<TBranches extends Record<string, BranchStep<TOutput>>>(
      branches: TBranches
    ): SequencerDefinition<TInput, BranchStepOutput<TBranches[keyof TBranches]>> {
      return extend<BranchStepOutput<TBranches[keyof TBranches]>>({
        name: "branch",
        run: async (value, ctx) => {
          for (const key of Object.keys(branches) as Array<keyof TBranches>) {
            const [connector, condition, block] = branches[key];
            const connectedInput = await connector(value as TOutput, ctx);
            const matches = await condition(connectedInput, ctx);
            if (!matches) {
              continue;
            }

            const output = await executeBlock(block, connectedInput, ctx);
            return { value: output };
          }

          throw new Error("branch had no matching route");
        }
      });
    }
  });

  return definition;
}

export function sequencer<TInput = unknown>(config: SequencerConfig<TInput>): SequencerDefinition<TInput, TInput> {
  return createSequencer<TInput, TInput>(config, [], []);
}
