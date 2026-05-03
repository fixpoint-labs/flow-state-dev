/**
 * `runForTest` — substrate-friendly entry point for driving a block from
 * test code (FIX-503).
 *
 * The public `BlockDefinition` type intentionally omits the runtime
 * dispatch entry (`run`); production callers are expected to compose
 * blocks via sequencer/router/generator rather than invoking them
 * directly. Tests still need to fire a single block in isolation, so
 * this helper recovers the substrate view via `asRuntime` and delegates.
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
