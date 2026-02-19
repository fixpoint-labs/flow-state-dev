/**
 * Central block execution entrypoint: dispatch, seam interception, retry, and error normalization.
 */
import type { BlockOutputItem, ItemProvenance } from "@flow-state-dev/core/items";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { normalizeError } from "../errors/normalize-error";
import { executeGenerator } from "./executeGenerator";
import { executeHandler } from "./executeHandler";
import { executeRouter } from "./executeRouter";
import { executeSequencer } from "./executeSequencer";
import { getResponseItems } from "./internal/response";
import {
  applyBlockInputSeam,
  applyBlockOutputSeam,
  applyNormalizedErrorSeam,
  NOOP_INTERNAL_EXECUTION_SEAMS,
  type InternalExecutionSeams
} from "./internal/seams";
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

function resolveBlockOutputVisibility(
  block: BlockDefinition<any, any>
): BlockOutputItem["visibility"] {
  const clientEnabled = block.config.clientOutput !== false;
  const llmEnabled = block.config.llmOutput !== false;

  if (clientEnabled && llmEnabled) {
    return "both";
  }

  if (clientEnabled) {
    return "ui";
  }

  if (llmEnabled) {
    return "llm";
  }

  return "internal";
}

function resolveBlockOutputPayload<TOutput>(
  block: BlockDefinition<any, TOutput>,
  output: TOutput
): unknown {
  if (typeof block.config.clientOutput === "function") {
    return block.config.clientOutput(output);
  }

  return output;
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

async function emitBlockOutputItem<TOutput>(
  options: {
    block: BlockDefinition<any, TOutput>;
    output: TOutput;
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
    type: "fsd:block_output",
    status: "completed",
    visibility: resolveBlockOutputVisibility(options.block),
    requestId: options.metadata.requestId,
    itemIndex,
    provenance: createBlockOutputProvenance(options.metadata, options.block.name),
    ts: Date.now(),
    blockName: options.block.name,
    renderKey: options.block.renderKey ?? options.block.config.renderKey,
    output: resolveBlockOutputPayload(options.block, options.output)
  };

  await options.ctx.response.emitItemAdded(item);
  await options.ctx.response.emitItemDone(item);
}

/**
 * Dispatches block execution to the runtime for each supported block kind.
 */
async function executeByKind<TInput, TOutput>(
  block: BlockDefinition<TInput, TOutput>,
  input: TInput,
  ctx: ExecuteBlockContext,
  options: ExecuteDispatcherOptions
): Promise<TOutput> {
  if (block.kind === "handler") {
    return executeHandler(block, input, ctx);
  }

  if (block.kind === "generator") {
    return executeGenerator(block, input, ctx, {
      internalSeams: options.internalSeams,
      metadata: options.metadata
    });
  }

  if (block.kind === "sequencer") {
    return executeSequencer(block, input, ctx);
  }

  if (block.kind === "router") {
    return executeRouter(block, input, ctx);
  }

  throw new Error(`Unknown block kind "${String(block.kind)}"`);
}

export type ExecuteBlockInternalOptions<TInput = unknown, TOutput = unknown> =
  ExecuteBlockOptions<TInput, TOutput> & {
    internalSeams?: InternalExecutionSeams;
  };

/**
 * Executes a block and always returns a structured execution result.
 */
export async function executeBlock<TInput, TOutput>(
  options: ExecuteBlockInternalOptions<TInput, TOutput>
): Promise<ExecuteBlockResult<TOutput>> {
  const startedAt = Date.now();
  const seams = options.internalSeams ?? NOOP_INTERNAL_EXECUTION_SEAMS;
  const metadata = createExecutionMetadata(options.ctx, {
    ...options.metadata,
    blockName: options.block.name,
    blockKind: options.block.kind,
    scope: options.metadata?.scope ?? "block"
  });

  try {
    const run = async (): Promise<TOutput> => {
      const interceptedInput = applyBlockInputSeam(
        seams,
        options.input,
        metadata
      );

      const output = await executeByKind(
        options.block,
        interceptedInput,
        options.ctx,
        {
          internalSeams: seams,
          metadata
        }
      );

      return applyBlockOutputSeam(seams, output, metadata);
    };

    const retryPolicy = mergeRetryPolicy(
      options.block.config.retry,
      options.retry
    );
    const output =
      retryPolicy === undefined
        ? await run()
        : await retryWithPolicy(run, retryPolicy, {
            signal: options.ctx.signal
          });

    await emitBlockOutputItem({
      block: options.block,
      output,
      ctx: options.ctx,
      metadata
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

    return {
      output: undefined,
      items: getResponseItems(options.ctx.response),
      durationMs: Date.now() - startedAt,
      error: applyNormalizedErrorSeam(seams, normalized, metadata)
    };
  }
}
