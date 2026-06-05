/**
 * Pipeline guards + standing-instruction writer for the trading-desk flow.
 *
 * These handlers are the orchestration-level wiring that `analyze.ts`
 * composes between the agent stages:
 *
 *   - `seedSession` patches session state from action input and resets the
 *     memo-status mirror so a re-run starts from a clean navigator.
 *   - `checkTickerResolvable`, `checkPhase1HasFundamentalsAndProfile`, and
 *     `checkPhase1HasData` are the three stop-condition guards. Each patches
 *     `stoppedReason` + `stoppedMessage` on session state when it trips; the
 *     following `.exitIf` in `analyze.ts` bails out before the next stage, so
 *     a stop is a normal terminal state, not an exceptional condition.
 *   - `setInstructions` persists the user's standing special instructions
 *     (global + per-phase).
 *
 * They live here (not in `flow.ts`) so `flow.ts` is the bare `defineFlow`
 * contract and the execution-order knowledge stays inside `orchestration/`.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { PHASE_1_MEMO_KEYS } from "../registry";
import { analyzeInputSchema } from "../flow-schema";
import { resolveTicker } from "../lib/ticker-resolver";
import { memoResources, type MemoStatus } from "../resources";
import { specialInstructionsStateSchema } from "../special-instructions";
import { specialInstructionsResource } from "../special-instructions-resource";
import { sessionStateSchema } from "../state";

/**
 * Patches session state from action input and resets the memo-status
 * mirror so a re-run starts from a clean navigator.
 */
export const seedSession = handler({
  name: "seed-session",
  inputSchema: analyzeInputSchema,
  outputSchema: analyzeInputSchema,
  sessionStateSchema,
  execute: async (input, ctx) => {
    // Freeze the per-run thesis at seed time so editing the form mid-run
    // can't affect the session that's already analyzing. A non-null
    // `userThesis` gates Phase 6; a sub-threshold (< 20 chars) thesis is
    // treated as no thesis — Phase 6 is skipped and a soft warning is
    // surfaced rather than halting.
    const rawThesis = input.userThesis?.trim() ?? "";
    const hasUsableThesis = rawThesis.length >= 20;
    const userThesis = hasUsableThesis ? rawThesis : null;
    const userThesisWarning =
      rawThesis.length > 0 && !hasUsableThesis
        ? "Thesis too short to audit (under 20 characters) — Phase 6 skipped."
        : null;

    await ctx.session.patchState({
      ticker: input.ticker,
      date: input.date,
      costPreset: input.costPreset,
      dataSource: input.dataSource,
      activePhase: "idle",
      // Cheap preset runs one bull/bear round; full preset runs two. Caller
      // input never sets this — the schema's `max(2)` enforces the ceiling.
      maxDebateRounds: input.costPreset === "full" ? 2 : 1,
      memoStatus: {} as Record<string, MemoStatus>,
      runComplete: false,
      // Reset terminal stop state from any prior run on this session key
      // so the navigator doesn't render a stale "stopped" banner.
      stoppedReason: null,
      stoppedMessage: null,
      userThesis,
      userThesisRationale: userThesis === null ? null : input.userThesisRationale,
      userThesisWarning,
      // Freeze the per-run portfolio snapshot (Slice 5), same discipline as
      // `userThesis`. Null → portfolio-blind run. The pipeline (P1–P2) runs
      // blind; only the lens pack, the trader, and the PM read it.
      portfolio: input.portfolio,
      selectedAccountIds: input.selectedAccountIds,
    });
    return input;
  },
});

/**
 * Pre-flight ticker resolution. Probes the active data source for the
 * requested ticker; if it can't be resolved (missing fixture / all live
 * providers down), patches `stoppedReason: "unresolvable-ticker"` so the
 * following `.exitIf` bails before any model spend.
 */
export const checkTickerResolvable = handler({
  name: "check-ticker-resolvable",
  inputSchema: analyzeInputSchema,
  outputSchema: z.void(),
  sessionStateSchema,
  execute: async (input, ctx) => {
    const result = await resolveTicker(input);
    if (!result.resolved) {
      await ctx.session.patchState({
        stoppedReason: "unresolvable-ticker",
        stoppedMessage:
          result.reason ?? `Could not resolve ticker ${input.ticker}.`,
        runComplete: true,
      });
      // Badge the reports-index row so Past Reports renders a stopped run
      // distinctly. Additive metadata merge — the four tuple keys are preserved.
      await ctx.session.setMetadata({
        metadata: { reportStatus: "stopped" },
      });
    }
  },
});

/**
 * Post-Phase-1 data-quality check. If every analyst memo is in `error`,
 * patches `stoppedReason: "phase-1-no-data"` so the following `.exitIf`
 * bails before phases 2–5 synthesize on no data.
 */
export const checkPhase1HasData = handler({
  name: "check-phase-1-has-data",
  inputSchema: z.unknown(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (_input, ctx) => {
    const memoStatuses = await Promise.all(
      Object.values(PHASE_1_MEMO_KEYS).map(
        async (m) => (await ctx.resources.memos.getOptional(m.collectionKey))?.state.status,
      ),
    );
    const allErrored = memoStatuses.every((status) => status === "error");
    if (allErrored) {
      await ctx.session.patchState({
        stoppedReason: "phase-1-no-data",
        stoppedMessage:
          `Every Phase 1 analyst failed for ${ctx.session.state.ticker}. ` +
          "Halting before synthesis — no usable upstream data.",
        runComplete: true,
      });
      // Badge the reports-index row (see checkTickerResolvable). Additive merge.
      await ctx.session.setMetadata({
        metadata: { reportStatus: "stopped" },
      });
    }
  },
});

/**
 * Post-Phase-1 primary-analyst check. `fundamentals` and `companyProfile`
 * are the only non-substitutable analysts — the debate (Phase 2) and every
 * downstream phase reason from the company's identity and its financials, so
 * a missing one can't be papered over by the four other memos. If either
 * errored, patch `stoppedReason: "phase-1-missing-primary"` so the following
 * `.exitIf` halts before synthesis. This fires on the realistic partial
 * failure (one provider rate-limited) that `checkPhase1HasData`'s all-error
 * condition would miss.
 */
export const checkPhase1HasFundamentalsAndProfile = handler({
  name: "check-phase-1-has-fundamentals-and-profile",
  inputSchema: z.unknown(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (_input, ctx) => {
    const erroredAt = async (collectionKey: string) =>
      (await ctx.resources.memos.getOptional(collectionKey))?.state.status === "error";
    const fundamentalsErrored = await erroredAt(PHASE_1_MEMO_KEYS.fundamentals.collectionKey);
    const profileErrored = await erroredAt(PHASE_1_MEMO_KEYS.companyProfile.collectionKey);
    if (!fundamentalsErrored && !profileErrored) return;
    const which = [
      fundamentalsErrored && "fundamentals",
      profileErrored && "companyProfile",
    ]
      .filter(Boolean)
      .join(" + ");
    await ctx.session.patchState({
      stoppedReason: "phase-1-missing-primary",
      stoppedMessage:
        `Non-substitutable Phase 1 analyst failed (${which}) for ` +
        `${ctx.session.state.ticker}. Halting before synthesis.`,
      runComplete: true,
    });
    // Badge the reports-index row (see checkTickerResolvable). Additive merge.
    await ctx.session.setMetadata({
      metadata: { reportStatus: "stopped" },
    });
  },
});

/**
 * Persists the user's standing special instructions (global + per-phase) to
 * the user-scoped, flow-isolated `specialInstructionsResource`.
 */
export const setInstructions = handler({
  name: "set-instructions",
  inputSchema: specialInstructionsStateSchema,
  outputSchema: z.void(),
  resources: { specialInstructions: specialInstructionsResource },
  execute: async (input, ctx) => {
    await ctx.resources.specialInstructions.patchState(input);
  },
});
