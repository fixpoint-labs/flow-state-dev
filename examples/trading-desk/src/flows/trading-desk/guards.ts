/**
 * Early-stop primitives (FIX-605).
 *
 * `EarlyStopError` is thrown by the two `.throwIf` guards on the analyze
 * pipeline — the pre-flight ticker check and the post-Phase-1 data-quality
 * gate — and caught by `rescueEarlyStop` via `.rescue([{ when: [EarlyStopError], ... }])`.
 * The rescue patches session state to reflect the terminal stopped condition
 * (status bar reads `runComplete + stoppedReason + stoppedMessage`) so the
 * navigator can render a clean "could not analyze this" banner instead of a
 * wall of error memos followed by a confident hallucinated decision.
 *
 * The guards themselves now live inline in `flow.ts` as `.throwIf`
 * predicates — the conditions are short enough that a dedicated handler
 * per guard was more ceremony than signal.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { sessionStateSchema } from "./state";

/** Reason discriminant carried on each `EarlyStopError`. Surfaces to the
 *  client as `session.stoppedReason` after the rescue runs. */
export type StoppedReason = "unresolvable-ticker" | "phase-1-no-data";

/**
 * Halts the analyze pipeline cleanly. The `userMessage` becomes
 * `session.stoppedMessage` for direct UI rendering after `rescueEarlyStop`
 * runs.
 */
export class EarlyStopError extends Error {
  readonly reason: StoppedReason;
  readonly userMessage: string;
  constructor(reason: StoppedReason, userMessage: string) {
    super(userMessage);
    this.name = "EarlyStopError";
    this.reason = reason;
    this.userMessage = userMessage;
  }
}

const stoppedSentinelSchema = z.object({
  stopped: z.literal(true),
});

/**
 * Rescue handler for `EarlyStopError`. The sequencer rescue path passes the
 * normalized `Error` directly as the block's input (see
 * `executeBlock(handler.block, normalizedError, ...)` in core's
 * `sequencer.ts`) — *not* wrapped in `{ error: ... }` — so the input schema
 * is `z.unknown()` and the handler reads `input` as the error itself.
 *
 * Patches session state to the terminal stopped condition and returns a
 * sentinel so the outer sequencer ends cleanly. Other error types are
 * re-thrown so the runtime's normal error handling kicks in (the outer
 * `.rescue` already filters on `when: [EarlyStopError]`, so this is
 * defense-in-depth against a future caller using this block without that
 * filter).
 */
export const rescueEarlyStop = handler({
  name: "rescue-early-stop",
  inputSchema: z.unknown(),
  outputSchema: stoppedSentinelSchema,
  sessionStateSchema,
  execute: async (input, ctx) => {
    if (!(input instanceof EarlyStopError)) {
      throw input instanceof Error ? input : new Error(String(input));
    }
    await ctx.session.patchState({
      stoppedReason: input.reason,
      stoppedMessage: input.userMessage,
      runComplete: true,
    });
    return { stopped: true as const };
  },
});
