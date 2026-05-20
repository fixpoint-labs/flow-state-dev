/**
 * Phase 3 memo state-transition taps.
 *
 * Three handlers, structurally identical to Phase 2's: `markWritingP3`
 * flips the memo to `writing` + `startedAt`, `markErrorP3` records the
 * rescue, and `commitTraderMemo` writes the design-shape fields plus the
 * seven Phase 3 extension fields and flips status to `published`.
 *
 * `commitTraderMemo` uses `get()` (throws) rather than `getOptional()`:
 * by commit time `setupPhase3Memos` + `markWritingP3` have created or
 * patched the resource, and a missing ref signals a real bug we want
 * surfaced into the per-step rescue.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  PHASE_3_MEMO_KEYS,
  type Phase3MemoShortName,
} from "../agents";
import { memoResources } from "../resources";
import { sessionStateSchema } from "../state";
import {
  tradeProposalOutputSchema,
  type TradeProposalOutput,
} from "./schemas";

/** Pre-mark a Phase 3 memo as `writing` and stamp `startedAt`. */
export function markWritingP3(shortName: Phase3MemoShortName) {
  const { collectionKey, agentName } = PHASE_3_MEMO_KEYS[shortName];
  return handler({
    name: `mark-writing-p3-${shortName}`,
    inputSchema: z.unknown(),
    outputSchema: z.void(),
    sessionStateSchema,
    resources: memoResources,
    execute: async (_input, ctx) => {
      const ref = ctx.resources.memos.getOptional(collectionKey);
      const startedAt = new Date().toISOString();
      if (ref !== undefined) {
        await ref.patchState({ status: "writing", startedAt, agentName });
      } else {
        // Framework parses against memoStateSchema and applies
        // `.default(null)` to every nullable field — only the scaffold
        // needs to be supplied here.
        await ctx.resources.memos.create(collectionKey, {
          status: "writing",
          startedAt,
          agentName,
          agentTeam: "trade",
          phaseId: "p3",
          ticker: ctx.session.state.ticker,
          date: ctx.session.state.date,
        });
      }
      const memoStatus = ctx.session.state.memoStatus;
      if (memoStatus[shortName] !== "writing") {
        await ctx.session.setStateRecord("memoStatus", shortName, "writing");
      }
    },
  });
}

/** Mark a specific Phase 3 memo as `error` with the rescued error's message. */
export function markErrorP3(shortName: Phase3MemoShortName) {
  const { collectionKey } = PHASE_3_MEMO_KEYS[shortName];
  return handler({
    name: `mark-error-p3-${shortName}`,
    inputSchema: z.object({ error: z.unknown() }).passthrough(),
    outputSchema: z.object({ status: z.literal("error") }),
    sessionStateSchema,
    resources: memoResources,
    execute: async (input, ctx) => {
      const error = (input as { error?: unknown }).error;
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Phase 3 generator failed.";
      const ref = ctx.resources.memos.getOptional(collectionKey);
      if (ref !== undefined) {
        await ref.patchState({
          status: "error",
          errorMessage: message,
          completedAt: new Date().toISOString(),
        });
      }
      const memoStatus = ctx.session.state.memoStatus;
      if (memoStatus[shortName] !== "error") {
        await ctx.session.setStateRecord("memoStatus", shortName, "error");
      }
      return { status: "error" as const };
    },
  });
}

/**
 * Commit a `TradeProposal` to `memos/p3/trader`. Populates the design-shape
 * `Thesis` fields plus the seven Phase 3 extension fields and flips status
 * to `published`. Trader's `conviction` (0..1) is written into the existing
 * `memoStateSchema.conviction` field — same convention Phase 2 uses for the
 * research-manager memo.
 */
export const commitTraderMemo = handler({
  name: "commit-memo-p3-trader",
  inputSchema: tradeProposalOutputSchema,
  outputSchema: z.void(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (trade: TradeProposalOutput, ctx) => {
    const ref = ctx.resources.memos.get(PHASE_3_MEMO_KEYS.trader.collectionKey);
    const completedAt = new Date().toISOString();
    const convictionNumber = Number.parseFloat(trade.metrics.conviction);
    await ref.patchState({
      status: "published",
      label: trade.label,
      headline: trade.headline,
      rating: trade.rating,
      body: trade.body,
      metrics: trade.metrics,
      completedAt,
      errorMessage: null,
      conviction: Number.isFinite(convictionNumber) ? convictionNumber : null,
      direction: trade.direction,
      sizePct: trade.sizePct,
      stopPrice: trade.stopPrice,
      targetPrice: trade.targetPrice,
      holdingPeriod: trade.holdingPeriod,
      invalidationCriteria: trade.invalidationCriteria,
      dependsOn: trade.dependsOn,
    });
    const memoStatus = ctx.session.state.memoStatus;
    if (memoStatus.trader !== "published") {
      await ctx.session.setStateRecord("memoStatus", "trader", "published");
    }
  },
});
