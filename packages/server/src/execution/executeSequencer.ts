import type { BlockDefinition } from "@flow-state-dev/core/types";
import type { ExecuteBlockContext } from "./types";

export async function executeSequencer<TInput, TOutput>(
  block: BlockDefinition<TInput, TOutput>,
  input: TInput,
  ctx: ExecuteBlockContext
): Promise<TOutput> {
  if (block.kind !== "sequencer") {
    throw new Error(
      `executeSequencer expected "sequencer" block, received "${block.kind}"`
    );
  }

  const execute = block.config.execute as
    | ((value: TInput, runtime: ExecuteBlockContext) => Promise<TOutput> | TOutput)
    | undefined;
  if (typeof execute !== "function") {
    throw new Error(
      `Sequencer block "${block.name}" is missing framework-compiled execution`
    );
  }

  return execute(input, ctx as any);
}
