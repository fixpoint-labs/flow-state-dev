/**
 * Executes router blocks, which select downstream blocks via user-defined execute logic.
 */
import type { BlockDefinition } from "@flow-state-dev/core/types";
import type { ExecuteBlockContext } from "./types";

/**
 * Runs a router block after validating that the block kind is correct.
 */
export async function executeRouter<TInput, TOutput>(
  block: BlockDefinition<TInput, TOutput>,
  input: TInput,
  ctx: ExecuteBlockContext
): Promise<TOutput> {
  if (block.kind !== "router") {
    throw new Error(
      `executeRouter expected "router" block, received "${block.kind}"`
    );
  }

  if (block.config.execute === undefined) {
    throw new Error(`Router block "${block.name}" is missing config.execute`);
  }

  return block.config.execute(input, ctx as any);
}
