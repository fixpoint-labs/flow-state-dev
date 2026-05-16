/**
 * Pipeline guards (FIX-605) — defense-in-depth against bogus / unresolvable
 * tickers producing a confident hallucinated analysis.
 *
 * Two guards, both halting the pipeline before phases 2–5 can synthesize a
 * trade recommendation on no data:
 *
 *   1. `validateTickerGuard` — pre-flight ticker resolution. Runs after
 *      `seedSession` and before `phase1Pipeline`. Throws `EarlyStopError`
 *      if the ticker cannot be resolved under the chosen data source.
 *
 *   2. `phase1QualityGate` — post-Phase-1 data-quality gate. Catches the
 *      live-mode case where the ticker happens to "look real" (so the
 *      pre-flight passes) but every analyst still ends in error because
 *      its tools all returned empty payloads. Throws `EarlyStopError` if
 *      every Phase 1 memo is in `error` status.
 *
 * Both `throw` `EarlyStopError`, which is caught by `rescueEarlyStop` at the
 * top of the analyze pipeline. The rescue handler patches session state to
 * reflect the terminal stopped condition (status bar reads `runComplete +
 * stoppedReason + stoppedMessage`) and returns a sentinel object — the rest
 * of phases 2–5 never run. Any other error type bubbles up unchanged.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { PHASE_1_MEMO_KEYS } from "./agents";
import { analyzeInputSchema } from "./flow-schema";
import { memoResources } from "./resources";
import { resolveTicker } from "./services/ticker-resolver";
import { sessionStateSchema } from "./state";

/**
 * Thrown by either guard to halt the pipeline cleanly. Carries the
 * session-state patch the rescue handler should apply.
 */
export class EarlyStopError extends Error {
  readonly reason: "unresolvable-ticker" | "phase-1-no-data";
  readonly userMessage: string;
  constructor(
    reason: "unresolvable-ticker" | "phase-1-no-data",
    userMessage: string,
  ) {
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
 * Pre-flight ticker resolution. Throws `EarlyStopError` if the ticker can't
 * be resolved under the current data source — fixture missing on fixture
 * mode, all live providers throwing on live mode. Used as `.tap()` per
 * BP-014 since the happy path produces no new output.
 */
export const validateTickerGuard = handler({
  name: "validate-ticker-guard",
  inputSchema: analyzeInputSchema,
  outputSchema: z.void(),
  sessionStateSchema,
  execute: async (input) => {
    const result = await resolveTicker({
      ticker: input.ticker,
      date: input.date,
      dataSource: input.dataSource,
    });
    if (!result.resolved) {
      throw new EarlyStopError(
        "unresolvable-ticker",
        result.reason ?? `Could not resolve ticker ${input.ticker}.`,
      );
    }
  },
});

/**
 * Post-Phase-1 data-quality gate. If every analyst memo is in `error`
 * status, phases 2–5 would be synthesizing on no data — throw
 * `EarlyStopError` so the rescue handler stops the run.
 *
 * "Every memo errored" is a stricter trigger than "any memo errored":
 * the demo intentionally tolerates partial Phase 1 failures (per-step
 * rescues in `analysts.ts` exist precisely for that). The gate is only
 * tripped when there is no usable upstream signal at all.
 */
export const phase1QualityGate = handler({
  name: "phase-1-quality-gate",
  inputSchema: z.unknown(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (_input, ctx) => {
    const shortNames = Object.keys(
      PHASE_1_MEMO_KEYS,
    ) as (keyof typeof PHASE_1_MEMO_KEYS)[];
    const statuses = shortNames.map((name) => {
      const { collectionKey } = PHASE_1_MEMO_KEYS[name];
      return ctx.resources.memos.getOptional(collectionKey)?.state.status;
    });
    const allErrored =
      statuses.length > 0 && statuses.every((s) => s === "error");
    if (allErrored) {
      throw new EarlyStopError(
        "phase-1-no-data",
        `Every Phase 1 analyst failed for ${ctx.session.state.ticker}. ` +
          "Halting before synthesis — no usable upstream data.",
      );
    }
  },
});

/**
 * Rescue handler for `EarlyStopError`. The sequencer rescue path passes the
 * normalized `Error` directly as the block's input (see
 * `executeBlock(handler.block, normalizedError, ...)` in core's
 * `sequencer.ts`) — *not* wrapped in `{ error: ... }` — so the input schema
 * is `z.unknown()` and the handler reads `input` as the error itself.
 *
 * Patches session state to reflect the terminal stopped condition and
 * returns a sentinel object so the outer sequencer ends cleanly. Other
 * error types are re-thrown so the runtime's normal error handling kicks
 * in (the outer `.rescue` already filters on `when: [EarlyStopError]`, so
 * this is defense-in-depth against a future caller using this block
 * without that filter).
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
