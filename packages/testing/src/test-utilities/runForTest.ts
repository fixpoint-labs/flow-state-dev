/**
 * `runForTest` — substrate-friendly entry point for driving a block from
 * test code (FIX-503).
 *
 * The public `BlockDefinition` type intentionally omits the runtime
 * dispatch entry (`run`); production callers are expected to compose
 * blocks via sequencer/router/generator rather than invoking them
 * directly. Tests still need to fire a single block in isolation, so
 * this helper recovers the substrate view via `asRuntime` and delegates.
 *
 * The runtime BP-011 nesting guard does NOT fire here because tests are
 * the top-level caller — the `INSIDE_EXECUTE` symbol isn't stamped on
 * the test's `BlockContext`.
 */
import { asRuntime, type BlockContext, type BlockDefinition } from "@flow-state-dev/core/types";
import type { ZodTypeAny } from "zod";

export function runForTest<
  TInputSchema extends ZodTypeAny,
  TOutputSchema extends ZodTypeAny,
  TInput,
  TOutput,
>(
  block: BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput>,
  input: TInput,
  ctx: BlockContext
): Promise<TOutput> {
  return asRuntime(block).run(input, ctx);
}
