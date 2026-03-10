/**
 * Central block execution entrypoint: dispatch, seam interception, retry, and error normalization.
 */
import type { BlockOutputItem, ItemProvenance } from "@flow-state-dev/core/items";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { composeMiddleware, mergeMiddlewareStacks } from "../middleware/compose";
import type { BlockMiddlewareContext } from "../middleware/types";
import { normalizeError } from "../errors/normalize-error";
import { getResponseItems } from "./internal/response";
import {
  applyBlockInputSeam,
  applyBlockOutputSeam,
  applyNormalizedErrorSeam,
  emitGeneratorLifecycleSeam,
  NOOP_INTERNAL_EXECUTION_SEAMS,
  type InternalExecutionSeams
} from "./internal/seams";
import {
  DEFAULT_RUNTIME_LOGGER,
  createExecutionLogContext,
  logRuntimeEvent,
  summarizeForLog
} from "./logging";
import { mergeRetryPolicy, retryWithPolicy } from "./retry";
import type {
  ExecuteBlockContext,
  ExecuteBlockOptions,
  ExecuteBlockResult,
  ExecutionMetadata
} from "./types";
import { createExecutionMetadata } from "./types";

type ExecuteDispatcherOptions = {
  internalSeams: InternalExecutionSeams;
  metadata: ExecutionMetadata;
};

type GeneratorModelUsageMeta = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  providerMetadata?: Record<string, Record<string, unknown>>;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
};

function hasItemEmitter(response: unknown): response is {
  emitItemAdded: (item: BlockOutputItem) => Promise<unknown>;
  emitItemDone: (item: BlockOutputItem) => Promise<unknown>;
} {
  return (
    typeof response === "object" &&
    response !== null &&
    typeof (response as { emitItemAdded?: unknown }).emitItemAdded === "function" &&
    typeof (response as { emitItemDone?: unknown }).emitItemDone === "function"
  );
}

function createBlockOutputProvenance(
  metadata: ExecutionMetadata,
  blockName: string
): ItemProvenance {
  return {
    blockName,
    blockInstanceId: metadata.blockInstanceId!,
    parentBlockInstanceId: metadata.parentBlockInstanceId,
    phase: metadata.scope === "work" ? "work" : "main",
    stepIndex: metadata.stepIndex,
    workGroupId: metadata.workGroupId,
    attempt: metadata.attempt
  };
}



async function emitBlockOutputItem(
  options: {
    block: BlockDefinition<any, any>;
    output: unknown;
    ctx: ExecuteBlockContext;
    metadata: ExecutionMetadata;
    modelUsage?: GeneratorModelUsageMeta;
  }
): Promise<void> {
  if (!hasItemEmitter(options.ctx.response)) {
    return;
  }

  const itemIndex = getResponseItems(options.ctx.response).length;
  const item: BlockOutputItem = {
    id: `item_block_output_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type: "block_output",
    status: "completed",
    transient: options.block.transient || undefined,
    requestId: options.metadata.requestId,
    itemIndex,
    provenance: createBlockOutputProvenance(options.metadata, options.block.name),
    ts: Date.now(),
    blockName: options.block.name,
    output: options.output,
    modelUsage: options.modelUsage
  };

  await options.ctx.response.emitItemAdded(item);
  await options.ctx.response.emitItemDone(item);
}

/**
 * Dispatches block execution to the runtime for each supported block kind.
 */
async function executeByKind(
  block: BlockDefinition,
  input: unknown,
  ctx: ExecuteBlockContext,
  options: ExecuteDispatcherOptions
): Promise<{ output: unknown; modelUsage?: GeneratorModelUsageMeta }> {
  if (block.kind === "generator") {
    const seams = options.internalSeams;
    let modelUsage: GeneratorModelUsageMeta | undefined;
    const runtimeHooks = {
      ...ctx._runtimeHooks,
      onGeneratorModelResult: (payload: {
        model: string;
        usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
        providerMetadata?: Record<string, Record<string, unknown>>;
      }) => {
        if (payload.usage !== undefined) {
          const anthropic = payload.providerMetadata?.anthropic ?? {};
          const readTokens = typeof anthropic.cacheReadInputTokens === "number" ? anthropic.cacheReadInputTokens : undefined;
          const creationTokens = typeof anthropic.cacheCreationInputTokens === "number" ? anthropic.cacheCreationInputTokens : undefined;
          modelUsage = {
            model: payload.model,
            promptTokens: payload.usage.promptTokens,
            completionTokens: payload.usage.completionTokens,
            totalTokens: payload.usage.totalTokens,
            providerMetadata: payload.providerMetadata,
            cacheReadTokens: readTokens,
            cacheCreationTokens: creationTokens
          };
        }
        ctx._runtimeHooks?.onGeneratorModelResult?.(payload);
      }
    };
    const generatorCtx = {
      ...ctx,
      _runtimeHooks: runtimeHooks
    };
    await emitGeneratorLifecycleSeam(seams, "before_execute", options.metadata);
    try {
      const output = await block.run(input, generatorCtx as any);
      await emitGeneratorLifecycleSeam(seams, "after_execute", options.metadata);
      return { output, modelUsage };
    } catch (error) {
      await emitGeneratorLifecycleSeam(seams, "errored", options.metadata);
      throw error;
    }
  }

  if (
    block.kind === "handler" ||
    block.kind === "sequencer" ||
    block.kind === "router"
  ) {
    return { output: await block.run(input, ctx as any) };
  }

  throw new Error(`Unknown block kind "${String(block.kind)}"`);
}

export type ExecuteBlockInternalOptions =
  ExecuteBlockOptions & {
    internalSeams?: InternalExecutionSeams;
  };

/**
 * Executes a block and always returns a structured execution result.
 */
export async function executeBlock(
  options: ExecuteBlockInternalOptions
): Promise<ExecuteBlockResult> {
  const startedAt = Date.now();
  const seams = options.internalSeams ?? NOOP_INTERNAL_EXECUTION_SEAMS;
  const blockInstanceId =
    options.metadata?.blockInstanceId ??
    `${options.block.name}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const metadata = createExecutionMetadata(options.ctx, {
    ...options.metadata,
    blockName: options.block.name,
    blockKind: options.block.kind,
    blockInstanceId,
    scope: options.metadata?.scope ?? "block"
  });
  const logger = options.logger ?? DEFAULT_RUNTIME_LOGGER;
  let attempt = 0;

  try {
    const run = async (): Promise<{ output: unknown; modelUsage?: GeneratorModelUsageMeta }> => {
      attempt += 1;
      const attemptMetadata = {
        ...metadata,
        attempt
      };

      logRuntimeEvent(
        logger,
        "debug",
        "[flow-state] block execution started",
        {
          ...createExecutionLogContext(attemptMetadata),
          input: summarizeForLog(options.input)
        }
      );

      const interceptedInput = applyBlockInputSeam(
        seams,
        options.input,
        attemptMetadata
      );

      const containerConfig =
        options.block.kind === "sequencer" || options.block.kind === "router"
          ? (options.block.config as {
              container?: {
                component?: string;
                label?: string | ((input: unknown) => string);
                metadata?: Record<string, unknown> | ((input: unknown) => Record<string, unknown>);
              };
            }).container
          : undefined;

      // Build middleware chain: caller-provided (global + flow) + block-level.
      const middlewareStack = mergeMiddlewareStacks(
        options.middleware,
        options.block.config.middleware
      );
      const blockInfo = { name: options.block.name, kind: options.block.kind };
      const runMiddleware = composeMiddleware(middlewareStack, blockInfo);

      const middlewareContext: BlockMiddlewareContext = {
        block: blockInfo,
        input: interceptedInput,
        metadata: attemptMetadata,
        blockContext: options.ctx
      };

      const executeCore = async (): Promise<{ output: unknown; modelUsage?: GeneratorModelUsageMeta }> => {
        if (options.ctx._withExecutionScope === undefined) {
          return executeByKind(
            options.block,
            interceptedInput,
            options.ctx,
            {
              internalSeams: seams,
              metadata: attemptMetadata
            }
          );
        }
        return options.ctx._withExecutionScope(
          {
            name: options.block.name,
            kind: options.block.kind,
            instanceId: attemptMetadata.blockInstanceId ?? blockInstanceId,
            transient: options.block.transient || undefined,
            stateSchema: options.block.kind === "sequencer" ? options.block.config.stateSchema : undefined,
            parentInstanceId: attemptMetadata.parentBlockInstanceId,
            container:
              containerConfig === undefined
                ? undefined
                : {
                    component: containerConfig.component,
                    label:
                      typeof containerConfig.label === "function"
                        ? containerConfig.label(interceptedInput)
                        : containerConfig.label,
                    metadata:
                      typeof containerConfig.metadata === "function"
                        ? containerConfig.metadata(interceptedInput)
                        : containerConfig.metadata
                  }
          },
          async (scopedCtx) =>
            executeByKind(
              options.block,
              interceptedInput,
              scopedCtx as ExecuteBlockContext,
              {
                internalSeams: seams,
                metadata: attemptMetadata
              }
            )
        );
      };

      // Run middleware chain around block execution.
      // Middleware wraps the output only; modelUsage is captured internally.
      let capturedModelUsage: GeneratorModelUsageMeta | undefined;
      const executionResult = await runMiddleware(
        middlewareContext,
        async () => {
          const result = await executeCore();
          capturedModelUsage = result.modelUsage;
          return result.output;
        }
      ).then((output) => ({
        output,
        modelUsage: capturedModelUsage
      }));

      const interceptedOutput = applyBlockOutputSeam(seams, executionResult.output, attemptMetadata);

      logRuntimeEvent(
        logger,
        "debug",
        "[flow-state] block execution completed",
        {
          ...createExecutionLogContext(attemptMetadata),
          durationMs: Date.now() - startedAt,
          output: summarizeForLog(interceptedOutput)
        }
      );

      return {
        output: interceptedOutput,
        modelUsage: executionResult.modelUsage
      };
    };

    const retryPolicy = mergeRetryPolicy(
      options.block.config.retry,
      options.retry
    );
    const executionResult =
      retryPolicy === undefined
        ? await run()
        : await retryWithPolicy(run, retryPolicy, {
            signal: options.ctx.signal,
            onRetry: (retryAttempt, error) => {
              logRuntimeEvent(
                logger,
                "warn",
                "[flow-state] block execution retry scheduled",
                {
                  ...createExecutionLogContext({
                    ...metadata,
                    attempt: retryAttempt
                  }),
                  maxAttempts: retryPolicy.maxAttempts,
                  delayMs: Math.min(
                    retryPolicy.maxDelayMs,
                    retryPolicy.baseDelayMs * Math.pow(2, retryAttempt - 1)
                  ),
                  error: summarizeForLog(error)
                }
              );
            }
          });

    await emitBlockOutputItem({
      block: options.block,
      output: executionResult.output,
      ctx: options.ctx,
      metadata: {
        ...metadata,
        attempt
      },
      modelUsage: executionResult.modelUsage
    });

    return {
      output: executionResult.output,
      items: getResponseItems(options.ctx.response),
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    const normalized = normalizeError(error, {
      blockName: options.block.name,
      scope: "block"
    });

    logRuntimeEvent(
      logger,
      "error",
      "[flow-state] block execution failed",
      {
        ...createExecutionLogContext({
          ...metadata,
          attempt: attempt > 0 ? attempt : metadata.attempt
        }),
        durationMs: Date.now() - startedAt,
        error: summarizeForLog(normalized)
      }
    );

    return {
      output: undefined,
      items: getResponseItems(options.ctx.response),
      durationMs: Date.now() - startedAt,
      error: applyNormalizedErrorSeam(seams, normalized, metadata)
    };
  }
}
