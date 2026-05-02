import { asRuntime, type BlockContext, type BlockDefinition } from "@flow-state-dev/core/types";

/**
 * Drive a block from test code (FIX-503). Local copy of the helper from
 * `@flow-state-dev/testing` — `@flow-state-dev/ui` doesn't depend on
 * the testing package (and its `tsconfig` doesn't reference it), so the
 * UI test harness recovers the substrate runtime view directly via
 * `asRuntime` from `@flow-state-dev/core/types`.
 */
export function runForTest<TInput, TOutput>(
  block: BlockDefinition<any, any, TInput, TOutput>,
  input: TInput,
  ctx: BlockContext
): Promise<TOutput> {
  return asRuntime(block)._run(input, ctx);
}
