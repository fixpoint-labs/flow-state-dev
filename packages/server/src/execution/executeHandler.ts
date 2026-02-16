import type { BlockDefinition } from "@flow-state-dev/core/types";
import type { ExecuteBlockContext } from "./types";

export async function executeHandler<TInput, TOutput>(
  block: BlockDefinition<TInput, TOutput>,
  input: TInput,
  ctx: ExecuteBlockContext
): Promise<TOutput> {
  if (block.kind !== "handler") {
    throw new Error(
      `executeHandler expected "handler" block, received "${block.kind}"`
    );
  }

  if (block.config.execute === undefined) {
    throw new Error(`Handler block "${block.name}" is missing config.execute`);
  }

  return block.config.execute(input, ctx as any);
}
