// FIX-2537.
/**
 * A failed model call, as a value: the `.rescue` block a check uses so its
 * caller decides what a failed call means, instead of the request failing.
 * The fit check reads it, and so does the subscriptions' interest judgment.
 *
 * A cancelled request is not a failed call: its error goes on up.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";

/** What a failed model call leaves: the reason, as a value. */
export const failedCallSchema = z.object({ failed: z.string() });

/** Turn a failed call into a value the caller reads, for `.rescue([{ block }])`. A cancel rethrows. */
export function callFailed(name: string): BlockDefinition<z.ZodUnknown, typeof failedCallSchema> {
  return handler({
    name,
    inputSchema: z.unknown(),
    outputSchema: failedCallSchema,
    execute: (error: unknown, ctx) => {
      if (ctx.signal.aborted) throw error;
      return { failed: error instanceof Error ? error.message : String(error) };
    }
  });
}
