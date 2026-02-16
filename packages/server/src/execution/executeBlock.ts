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
