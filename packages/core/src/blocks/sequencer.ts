import { z, type ZodTypeAny } from "zod";
import type { BlockContext, BlockDefinition, ConnectorFn, RescueHandlerSpec } from "../types/block";
import type {
  BranchStep,
  BranchStepOutput,
  InlineBlockFactory,
  ParallelStep,
  ParallelStepOutput,
  SequencerConfig,
  SequencerDefinition,
  SequencerRuntimeState,
  WorkResult
} from "./sequencer-methods";
import { buildBlock, mergeDeclaredResources } from "./internal/build-block";
import type { DeclaredResources } from "../types/block";
import { isBlockDefinition, toError, withTimeout } from "./internal/utils";

const DEFAULT_MAX_LOOP_GUARD = 250;

let inlineBlockCounter = 0;

function autoInlineName(): string {
  inlineBlockCounter += 1;
  return `inline-${inlineBlockCounter}`;
}

/**
 * Detects inline config objects passed to sequencer DSL methods.
 * Primary discriminator: outputSchema (a Zod type with _def property).
 * Secondary discriminator: execute function (for tap where outputSchema is optional).
 * Rejects BlockDefinition objects (which also have properties but are identified by kind/name/config).
 */
function isInlineConfig(value: unknown): boolean {
  if (typeof value !== "object" || value === null || isBlockDefinition(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  // Primary: has a Zod outputSchema
  if (
    record.outputSchema !== undefined &&
    typeof record.outputSchema === "object" &&
    record.outputSchema !== null &&
    (record.outputSchema as Record<string, unknown>)._def !== undefined
  ) {
    return true;
  }

  // Secondary: has execute function (for tap where outputSchema is optional)
  return typeof record.execute === "function";
}

/**
 * Builds a BlockDefinition from a factory function and inline config,
 * injecting inputSchema from the previous step's output schema.
 */
function buildInlineBlock(
  factory: InlineBlockFactory,
  inlineConfig: Record<string, unknown>,
  lastOutputSchema: ZodTypeAny | undefined
): BlockDefinition<any, any> {
  const name = (inlineConfig.name as string | undefined) ?? autoInlineName();
  return factory({
    ...inlineConfig,
    name,
    inputSchema: lastOutputSchema ?? z.any()
  });
}

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

async function executeBlock(
  block: BlockDefinition<any, any>,
  input: unknown,
  ctx: BlockContext
): Promise<unknown> {
  const startedAt = Date.now();
  const run = async (scopedCtx: BlockContext): Promise<unknown> => {
    scopedCtx._runtimeHooks?.onBlockStart?.(block.name, block.kind, input);
    try {
      const output = await block.run(input, scopedCtx);
      scopedCtx._runtimeHooks?.onBlockComplete?.(block.name, block.kind, output, Date.now() - startedAt);
      return output;
    } catch (error) {
      scopedCtx._runtimeHooks?.onBlockError?.(block.name, block.kind, error, Date.now() - startedAt);
      throw error;
    }
  };

  if (ctx._withExecutionScope === undefined) {
    return run(ctx);
  }

  const containerConfig =
    block.kind === "sequencer" || block.kind === "router"
      ? (block.config as { container?: { component?: string; label?: string | ((input: unknown) => string); metadata?: Record<string, unknown> | ((input: unknown) => Record<string, unknown>); } }).container
      : undefined;

  return ctx._withExecutionScope(
    {
      name: block.name,
      kind: block.kind,
      instanceId: `${block.name}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      stateSchema: block.kind === "sequencer" ? block.config.stateSchema : undefined,
      container:
        containerConfig === undefined
          ? undefined
          : {
              component: containerConfig.component,
              label:
                typeof containerConfig.label === "function"
                  ? containerConfig.label(input as any)
                  : containerConfig.label,
              metadata:
                typeof containerConfig.metadata === "function"
                  ? containerConfig.metadata(input as any)
                  : containerConfig.metadata
            }
    },
    run
  );
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
    workTasks: [],
    stateVersion: 0
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
  config: SequencerConfig<any>,
  operations: SequencerOperation[],
  rescueHandlers: RescueHandlerSpec[],
  lastOutputSchema?: ZodTypeAny,
  resolvedInputSchema?: ZodTypeAny,
  accumulatedResources?: DeclaredResources
): SequencerDefinition<TInput, TOutput> {
  // The tracked output schema reflects the chain's last step (informational for devtools/composition).
  // We pass undefined to buildBlock's outputSchema so the sequencer itself doesn't validate output —
  // individual blocks in the chain already validate their own outputs.
  const trackedOutputSchema = lastOutputSchema ?? config.outputSchema;

  const baseBlock = buildBlock({
    kind: "sequencer",
    config: {
      name: config.name,
      description: config.description,
      inputSchema: resolvedInputSchema ?? config.inputSchema,
      outputSchema: undefined,
      stateSchema: config.stateSchema,
      container: config.container
    },
    execute: runSequencerOperations(operations, rescueHandlers) as (
      input: unknown,
      ctx: BlockContext
    ) => Promise<unknown>,
    declaredResources: accumulatedResources
  });

  // Override the informational schema on the block definition so devtools and consumers
  // (parallel, forEach) see the real output type — without triggering validation.
  if (trackedOutputSchema !== undefined) {
    (baseBlock as any).outputSchema = trackedOutputSchema;
    (baseBlock as any).config = { ...baseBlock.config, outputSchema: trackedOutputSchema };
  }

  /** Merge a child block's declaredResources into the sequencer's accumulator. */
  const mergeFrom = (...blocks: Array<BlockDefinition<any, any> | undefined>): DeclaredResources | undefined => {
    let merged = accumulatedResources;
    for (const block of blocks) {
      if (block?.declaredResources !== undefined) {
        merged = mergeDeclaredResources(merged, block.declaredResources);
      }
    }
    return merged;
  };

  const extend = <TNext>(
    operation: SequencerOperation,
    newOutputSchema?: ZodTypeAny,
    newInputSchema?: ZodTypeAny,
    newResources?: DeclaredResources
  ): SequencerDefinition<TInput, TNext> =>
    createSequencer<TInput, TNext>(config, [...operations, operation], rescueHandlers, newOutputSchema, newInputSchema ?? resolvedInputSchema, newResources ?? accumulatedResources);

  /**
   * On the first step (no operations yet) when neither config nor resolved input
   * schema is set, capture the block's inputSchema as the sequencer's inputSchema.
   * Returns the captured schema or undefined (meaning no override).
   */
  const inferFirstBlockInput = (block: BlockDefinition<any, any>): ZodTypeAny | undefined => {
    if (operations.length === 0 && resolvedInputSchema === undefined && config.inputSchema === undefined) {
      return block.config.inputSchema;
    }
    return undefined;
  };

  const definition: SequencerDefinition<TInput, TOutput> = Object.assign(baseBlock, {
    then<TStepIn, TNext>(
      arg1: BlockDefinition<any, any> | ConnectorFn<TOutput, TStepIn> | InlineBlockFactory,
      arg2?: BlockDefinition<any, any> | Record<string, unknown>
    ): SequencerDefinition<TInput, TNext> {
      // Path 1: then(factory, inlineConfig) — inline block definition
      if (typeof arg1 === "function" && !isBlockDefinition(arg1) && arg2 !== undefined && isInlineConfig(arg2)) {
        const block = buildInlineBlock(arg1 as InlineBlockFactory, arg2 as Record<string, unknown>, lastOutputSchema);
        const capturedInput = inferFirstBlockInput(block);
        return extend<TNext>(
          {
            name: block.name,
            run: async (value, ctx) => {
              const output = await executeBlock(block, value, ctx);
              return { value: output };
            }
          },
          block.config.outputSchema,
          capturedInput,
          mergeFrom(block)
        );
      }

      // Path 2: then(block) — pre-defined block
      // Path 3: then(connector, block) — connector + pre-defined block
      const connector = arg2 === undefined ? undefined : (arg1 as ConnectorFn<TOutput, TStepIn>);
      const block = (arg2 ?? arg1) as BlockDefinition<any, any>;
      const capturedInput = inferFirstBlockInput(block);

      return extend<TNext>(
        {
          name: block.name,
          run: async (value, ctx) => {
            const nextInput = connector === undefined ? value : await connector(value as TOutput, ctx);
            const output = await executeBlock(block, nextInput, ctx);
            return { value: output };
          }
        },
        block.config.outputSchema,
        capturedInput,
        mergeFrom(block)
      );
    },

    thenIf<TStepIn, TNext>(
      condition: (input: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
      arg2: BlockDefinition<any, any> | ConnectorFn<TOutput, TStepIn> | InlineBlockFactory,
      arg3?: BlockDefinition<any, any> | Record<string, unknown>
    ): SequencerDefinition<TInput, TOutput | TNext> {
      // Path 1: thenIf(condition, factory, inlineConfig) — inline block definition
      if (typeof arg2 === "function" && !isBlockDefinition(arg2) && arg3 !== undefined && isInlineConfig(arg3)) {
        const block = buildInlineBlock(arg2 as InlineBlockFactory, arg3 as Record<string, unknown>, lastOutputSchema);
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

                const output = await executeBlock(block, value, ctx);
                return { value: output };
              }
            }
          ],
          rescueHandlers,
          block.config.outputSchema,
          resolvedInputSchema,
          mergeFrom(block)
        );
      }

      // Path 2: thenIf(condition, block) — pre-defined block
      // Path 3: thenIf(condition, connector, block) — connector + pre-defined block
      const connector = arg3 === undefined ? undefined : (arg2 as ConnectorFn<TOutput, TStepIn>);
      const block = (arg3 ?? arg2) as BlockDefinition<any, any>;

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
              const output = await executeBlock(block, nextInput, ctx);
              return { value: output };
            }
          }
        ],
        rescueHandlers,
        block.config.outputSchema,
        resolvedInputSchema,
        mergeFrom(block)
      );
    },

    map<TNext>(mapper: (input: TOutput, ctx: BlockContext) => TNext | Promise<TNext>): SequencerDefinition<TInput, TNext> {
      return extend<TNext>(
        {
          name: "map",
          run: async (value, ctx) => ({ value: await mapper(value as TOutput, ctx) })
        },
        undefined
      );
    },

    parallel<TSteps extends Record<string, ParallelStep<TOutput>>>(
      steps: TSteps,
      options?: { maxConcurrency?: number }
    ): SequencerDefinition<TInput, { [K in keyof TSteps]: ParallelStepOutput<TSteps[K]> }> {
      // Build composite output schema: { key: step.outputSchema, ... }
      const schemaShape: Record<string, ZodTypeAny> = {};
      const stepBlocks: BlockDefinition<any, any>[] = [];
      for (const [key, step] of Object.entries(steps)) {
        const stepBlock = isBlockDefinition(step)
          ? (step as BlockDefinition<any, any>)
          : (step as { block: BlockDefinition<any, any> }).block;
        schemaShape[key] = stepBlock.config.outputSchema ?? z.any();
        stepBlocks.push(stepBlock);
      }
      const compositeSchema = z.object(schemaShape);

      return extend<{ [K in keyof TSteps]: ParallelStepOutput<TSteps[K]> }>(
        {
          name: "parallel",
          run: async (value, ctx) => {
            const entries = Object.entries(steps) as Array<[keyof TSteps, TSteps[keyof TSteps]]>;
            const outputs = await mapWithConcurrency(
              entries,
              options?.maxConcurrency,
              async ([, step]): Promise<unknown> => {
                if (isBlockDefinition(step)) {
                  return executeBlock(step as BlockDefinition<any, any>, value, ctx);
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
        },
        compositeSchema,
        undefined,
        mergeFrom(...stepBlocks)
      );
    },

    forEach<TItem, TStepIn, TStepOut>(
      arg1:
        | BlockDefinition<any, any>
        | ((item: TItem, index: number, ctx: BlockContext) => BlockDefinition<any, any>)
        | ConnectorFn<TOutput, TStepIn[]>,
      arg2?:
        | BlockDefinition<any, any>
        | ((item: TStepIn, index: number, ctx: BlockContext) => BlockDefinition<any, any>)
        | { maxConcurrency?: number },
      arg3?: { maxConcurrency?: number }
    ): SequencerDefinition<TInput, TStepOut[]> {
      const hasConnector =
        arg3 !== undefined || (arg2 !== undefined && !isConcurrencyOptions(arg2));
      const connector = hasConnector ? (arg1 as ConnectorFn<TOutput, TStepIn[]>) : undefined;
      const blockOrFactory = (hasConnector ? arg2 : arg1) as
        | BlockDefinition<any, any>
        | ((item: TStepIn, index: number, ctx: BlockContext) => BlockDefinition<any, any>);
      const options = (hasConnector ? arg3 : arg2) as { maxConcurrency?: number } | undefined;

      // Determine element output schema for z.array() propagation
      const elementBlock = isBlockDefinition(blockOrFactory)
        ? (blockOrFactory as BlockDefinition<any, any>)
        : undefined;
      const arraySchema = elementBlock?.config.outputSchema
        ? z.array(elementBlock.config.outputSchema)
        : undefined;

      return extend<TStepOut[]>(
        {
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
                  : (blockOrFactory as BlockDefinition<any, any>);

              return executeBlock(block, item, ctx);
            });

            return { value: outputs };
          }
        },
        arraySchema,
        undefined,
        mergeFrom(elementBlock)
      );
    },

    doUntil<TStepIn, TNext>(
      condition: (value: TNext | TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
      arg2: BlockDefinition<any, any> | ConnectorFn<TOutput, TStepIn>,
      arg3?: BlockDefinition<any, any>
    ): SequencerDefinition<TInput, TNext> {
      const connector = arg3 === undefined ? undefined : (arg2 as ConnectorFn<TOutput, TStepIn>);
      const block = (arg3 ?? arg2) as BlockDefinition<any, any>;

      return extend<TNext>(
        {
          name: `doUntil:${block.name}`,
          run: async (value, ctx) => {
            let nextInput =
              connector === undefined ? value : await connector(value as TOutput, ctx);
            let guard = 0;

            while (true) {
              const output = await executeBlock(block, nextInput, ctx);
              const done = await condition(output as TNext, ctx);
              if (done) {
                return { value: output };
              }

              guard += 1;
              if (guard > DEFAULT_MAX_LOOP_GUARD) {
                throw new Error(`doUntil exceeded max loop guard (${DEFAULT_MAX_LOOP_GUARD})`);
              }

              nextInput = output;
            }
          }
        },
        block.config.outputSchema,
        undefined,
        mergeFrom(block)
      );
    },

    doWhile<TStepIn, TNext>(
      condition: (value: TNext | TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
      arg2: BlockDefinition<any, any> | ConnectorFn<TOutput, TStepIn>,
      arg3?: BlockDefinition<any, any>
    ): SequencerDefinition<TInput, TNext> {
      const connector = arg3 === undefined ? undefined : (arg2 as ConnectorFn<TOutput, TStepIn>);
      const block = (arg3 ?? arg2) as BlockDefinition<any, any>;

      return extend<TNext>(
        {
          name: `doWhile:${block.name}`,
          run: async (value, ctx) => {
            let nextInput =
              connector === undefined ? value : await connector(value as TOutput, ctx);
            let output = await executeBlock(block, nextInput, ctx);
            let guard = 0;

            while (await condition(output as TNext, ctx)) {
              guard += 1;
              if (guard > DEFAULT_MAX_LOOP_GUARD) {
                throw new Error(`doWhile exceeded max loop guard (${DEFAULT_MAX_LOOP_GUARD})`);
              }

              nextInput = output;
              output = await executeBlock(block, nextInput, ctx);
            }

            return { value: output };
          }
        },
        block.config.outputSchema,
        undefined,
        mergeFrom(block)
      );
    },

    loopBack(
      targetStepName: string,
      options: {
        when?: (value: unknown, ctx: BlockContext) => boolean | Promise<boolean>;
        maxIterations: number;
      }
    ): SequencerDefinition<TInput, TOutput> {
      return extend<TOutput>(
        {
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
        },
        lastOutputSchema
      );
    },

    work<TStepIn>(
      arg1: BlockDefinition<any, any> | ConnectorFn<TOutput, TStepIn>,
      arg2?: BlockDefinition<any, any> | WorkOptions,
      arg3?: WorkOptions
    ): SequencerDefinition<TInput, TOutput> {
      const hasConnector = isBlockDefinition(arg2);
      const connector = hasConnector ? (arg1 as ConnectorFn<TOutput, TStepIn>) : undefined;
      const block = (hasConnector ? arg2 : arg1) as BlockDefinition<any, any>;
      const options = (hasConnector ? arg3 : arg2) as WorkOptions | undefined;

      return extend<TOutput>(
        {
          name: options?.name ?? `work:${block.name}`,
          run: async (value, ctx, runtime) => {
            const name = options?.name ?? block.name;
            const input =
              connector === undefined ? value : await connector(value as TOutput, ctx);

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
        },
        lastOutputSchema,
        undefined,
        mergeFrom(block)
      );
    },

    waitForWork(options?: WaitForWorkOptions): SequencerDefinition<TInput, TOutput> {
      return extend<TOutput>(
        {
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
        },
        lastOutputSchema
      );
    },

    tap<TStepIn>(
      arg1:
        | BlockDefinition<any, any>
        | ((value: TOutput, ctx: BlockContext) => void | Promise<void>)
        | ConnectorFn<TOutput, TStepIn>
        | InlineBlockFactory,
      arg2?: BlockDefinition<any, any> | Record<string, unknown>
    ): SequencerDefinition<TInput, TOutput> {
      // Path 1: tap(factory, inlineConfig) — inline block as side effect
      if (typeof arg1 === "function" && !isBlockDefinition(arg1) && arg2 !== undefined && isInlineConfig(arg2)) {
        const block = buildInlineBlock(arg1 as InlineBlockFactory, arg2 as Record<string, unknown>, lastOutputSchema);
        return extend<TOutput>(
          {
            name: `tap:${block.name}`,
            run: async (value, ctx) => {
              await executeBlock(block, value, ctx);
              return { value };
            }
          },
          lastOutputSchema,
          undefined,
          mergeFrom(block)
        );
      }

      // Path 2: tap(block | fn) — pre-defined block or function
      // Path 3: tap(connector, block) — connector + pre-defined block
      const connector = arg2 === undefined ? undefined : (arg1 as ConnectorFn<TOutput, TStepIn>);
      const tapTarget = (arg2 ?? arg1) as
        | BlockDefinition<any, any>
        | ((value: TOutput, ctx: BlockContext) => void | Promise<void>);

      // Only merge resources if tapTarget is a block (not a function)
      const tapBlock = isBlockDefinition(tapTarget) ? (tapTarget as BlockDefinition<any, any>) : undefined;

      return extend<TOutput>(
        {
          name: "tap",
          run: async (value, ctx) => {
            if (connector === undefined) {
              if (isBlockDefinition(tapTarget)) {
                await executeBlock(tapTarget as BlockDefinition<any, any>, value, ctx);
              } else {
                await (tapTarget as (value: TOutput, ctx: BlockContext) => void | Promise<void>)(
                  value as TOutput,
                  ctx
                );
              }
            } else {
              const connectedInput = await connector(value as TOutput, ctx);
              await executeBlock(tapTarget as BlockDefinition<any, any>, connectedInput, ctx);
            }

            return { value };
          }
        },
        lastOutputSchema,
        undefined,
        mergeFrom(tapBlock)
      );
    },

    tapIf<TStepIn>(
      condition: (value: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
      arg2:
        | BlockDefinition<any, any>
        | ((value: TOutput, ctx: BlockContext) => void | Promise<void>)
        | ConnectorFn<TOutput, TStepIn>,
      arg3?: BlockDefinition<any, any>
    ): SequencerDefinition<TInput, TOutput> {
      const connector = arg3 === undefined ? undefined : (arg2 as ConnectorFn<TOutput, TStepIn>);
      const tapTarget = (arg3 ?? arg2) as
        | BlockDefinition<any, any>
        | ((value: TOutput, ctx: BlockContext) => void | Promise<void>);

      const tapIfBlock = isBlockDefinition(tapTarget) ? (tapTarget as BlockDefinition<any, any>) : undefined;

      return extend<TOutput>(
        {
          name: "tapIf",
          run: async (value, ctx) => {
            const matches = await condition(value as TOutput, ctx);
            if (!matches) {
              return { value };
            }

            if (connector === undefined) {
              if (isBlockDefinition(tapTarget)) {
                await executeBlock(tapTarget as BlockDefinition<any, any>, value, ctx);
              } else {
                await (tapTarget as (value: TOutput, ctx: BlockContext) => void | Promise<void>)(
                  value as TOutput,
                  ctx
                );
              }
            } else {
              const connectedInput = await connector(value as TOutput, ctx);
              await executeBlock(tapTarget as BlockDefinition<any, any>, connectedInput, ctx);
            }

            return { value };
          }
        },
        lastOutputSchema,
        undefined,
        mergeFrom(tapIfBlock)
      );
    },

    rescue(handlers: RescueHandlerSpec[]): SequencerDefinition<TInput, TOutput> {
      // Collect resources from rescue handler blocks
      const rescueResources = handlers.reduce<DeclaredResources | undefined>(
        (acc, h) => mergeDeclaredResources(acc, h.block.declaredResources),
        accumulatedResources
      );
      return createSequencer<TInput, TOutput>(config, operations, handlers, lastOutputSchema, resolvedInputSchema, rescueResources);
    },

    branch<TBranches extends Record<string, BranchStep<TOutput>>>(
      branches: TBranches
    ): SequencerDefinition<TInput, BranchStepOutput<TBranches[keyof TBranches]>> {
      // Branch output schema is ambiguous (depends on which branch matches at runtime),
      // so we take the first branch block's outputSchema as a best-effort propagation.
      const branchEntries = Object.values(branches) as Array<BranchStep<TOutput>>;
      const firstBranchSchema = branchEntries.length > 0
        ? branchEntries[0][2].config.outputSchema
        : undefined;

      // Collect resources from all branch blocks
      const branchBlocks = branchEntries.map((entry) => entry[2]);

      return extend<BranchStepOutput<TBranches[keyof TBranches]>>(
        {
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
        },
        firstBranchSchema,
        undefined,
        mergeFrom(...branchBlocks)
      );
    },

    validate(): SequencerDefinition<TInput, TOutput> {
      if (config.outputSchema === undefined || lastOutputSchema === undefined) {
        return definition;
      }

      const declaredTypeName = (config.outputSchema as any)._def?.typeName as string | undefined;
      const actualTypeName = (lastOutputSchema as any)._def?.typeName as string | undefined;

      if (declaredTypeName !== undefined && actualTypeName !== undefined && declaredTypeName !== actualTypeName) {
        throw new Error(
          `Sequencer "${config.name}" output schema mismatch: declared ${declaredTypeName} but chain produces ${actualTypeName}`
        );
      }

      // For ZodObject schemas, also check shape keys match
      if (declaredTypeName === "ZodObject") {
        const declaredShape = (config.outputSchema as any)._def?.shape?.();
        const actualShape = (lastOutputSchema as any)._def?.shape?.();
        if (declaredShape !== undefined && actualShape !== undefined) {
          const declaredKeys = Object.keys(declaredShape).sort();
          const actualKeys = Object.keys(actualShape).sort();
          if (declaredKeys.join(",") !== actualKeys.join(",")) {
            throw new Error(
              `Sequencer "${config.name}" output schema shape mismatch: declared keys [${declaredKeys}] but chain produces [${actualKeys}]`
            );
          }
        }
      }

      return definition;
    }
  });

  return definition;
}

export function sequencer<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
>(
  config: SequencerConfig<TInputSchema, TInput>
): SequencerDefinition<TInput, TInput> {
  return createSequencer<TInput, TInput>(
    config as SequencerConfig<any>,
    [],
    [],
    config.inputSchema,
    config.inputSchema
  );
}
