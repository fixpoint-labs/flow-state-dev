/**
 * Executes handler blocks, which rely on user-defined execute logic.
 */
import type { BlockDefinition } from "@flow-state-dev/core/types";
import type { ExecuteBlockContext } from "./types";

/**
 * Runs a handler block after validating that the block kind is correct.
 */
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
