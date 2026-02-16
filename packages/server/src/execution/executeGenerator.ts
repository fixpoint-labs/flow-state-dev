/**
 * Executes generator blocks and emits internal lifecycle seams around execution.
 */
import type { BlockDefinition } from "@flow-state-dev/core/types";
import {
  emitGeneratorLifecycleSeam,
  NOOP_INTERNAL_EXECUTION_SEAMS,
  type InternalExecutionSeams
} from "./internal/seams";
import type { ExecuteBlockContext, ExecutionMetadata } from "./types";

export type ExecuteGeneratorOptions = {
  internalSeams?: InternalExecutionSeams;
  metadata: ExecutionMetadata;
};

/**
 * Runs a generator block and emits before/after/error lifecycle hooks for instrumentation.
 */
export async function executeGenerator<TInput, TOutput>(
  block: BlockDefinition<TInput, TOutput>,
  input: TInput,
  ctx: ExecuteBlockContext,
  options: ExecuteGeneratorOptions
): Promise<TOutput> {
  if (block.kind !== "generator") {
    throw new Error(
      `executeGenerator expected "generator" block, received "${block.kind}"`
    );
  }

  const execute = block.config.execute as
    | ((value: TInput, runtime: ExecuteBlockContext) => Promise<TOutput> | TOutput)
    | undefined;
  if (typeof execute !== "function") {
    throw new Error(
      `Generator block "${block.name}" is missing framework-compiled execution`
    );
  }

  const seams = options.internalSeams ?? NOOP_INTERNAL_EXECUTION_SEAMS;
  await emitGeneratorLifecycleSeam(seams, "before_execute", options.metadata);

  try {
    const output = await execute(input, ctx as any);
    await emitGeneratorLifecycleSeam(seams, "after_execute", options.metadata);
    return output;
  } catch (error) {
    await emitGeneratorLifecycleSeam(seams, "errored", options.metadata);
    throw error;
  }
}
