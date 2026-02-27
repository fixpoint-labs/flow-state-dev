/**
 * Central block execution entrypoint: dispatch, seam interception, retry, and error normalization.
 */
import type { BlockOutputItem, ItemProvenance } from "@flow-state-dev/core/items";
import type { BlockDefinition } from "@flow-state-dev/core/types";
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
    blockInstanceId:
      metadata.blockInstanceId ?? `${blockName}_${metadata.requestId}`,
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
    requestId: options.metadata.requestId,
    itemIndex,
    provenance: createBlockOutputProvenance(options.metadata, options.block.name),
    ts: Date.now(),
    blockName: options.block.name,
    output: options.output
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
): Promise<unknown> {
  if (block.kind === "generator") {
    const seams = options.internalSeams;
    await emitGeneratorLifecycleSeam(seams, "before_execute", options.metadata);
    try {
      const output = await block.run(input, ctx as any);
      await emitGeneratorLifecycleSeam(seams, "after_execute", options.metadata);
      return output;
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
    return block.run(input, ctx as any);
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
  const metadata = createExecutionMetadata(options.ctx, {
    ...options.metadata,
    blockName: options.block.name,
    blockKind: options.block.kind,
    scope: options.metadata?.scope ?? "block"
  });
  const logger = options.logger ?? DEFAULT_RUNTIME_LOGGER;
  let attempt = 0;

  try {
    const run = async (): Promise<unknown> => {
      attempt += 1;
      const attemptMetadata = {
        ...metadata,
        attempt
      };

      logRuntimeEvent(
        logger,
        "info",
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

      const output = await executeByKind(
        options.block,
        interceptedInput,
        options.ctx,
        {
          internalSeams: seams,
          metadata: attemptMetadata
        }
      );

      const interceptedOutput = applyBlockOutputSeam(seams, output, attemptMetadata);

      logRuntimeEvent(
        logger,
        "info",
        "[flow-state] block execution completed",
        {
          ...createExecutionLogContext(attemptMetadata),
          output: summarizeForLog(interceptedOutput)
        }
      );

      return interceptedOutput;
    };

    const retryPolicy = mergeRetryPolicy(
      options.block.config.retry,
      options.retry
    );
    const output =
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
      output,
      ctx: options.ctx,
      metadata: {
        ...metadata,
        attempt
      }
    });

    return {
      output,
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
