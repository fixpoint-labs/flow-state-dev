/**
 * Phase 3 memo-writing blocks.
 *
 *   - `markWritingP3` / `markErrorP3` — built via `defineMemoStateBlocks`.
 *   - `commitTraderMemo` — plain handler. Derives `conviction` from the
 *     LLM's string-typed `metrics.conviction` (the display shape is
 *     string-only per the Claude Design handoff; the structured 0..1
 *     number is what Phase 5 reads).
 */
import { PHASE_3_MEMO_KEYS } from "../agents";
import {
  defineMemoStateBlocks,
  memoHandler,
  publishMemo,
} from "../lib/memo-writer";
import { tradeProposalOutputSchema } from "./trader";

export const {
  markWriting: markWritingP3,
  markError: markErrorP3,
} = defineMemoStateBlocks({
  phaseId: "p3",
  agentTeam: "trade",
  keys: PHASE_3_MEMO_KEYS,
  errorMessageFallback: "Phase 3 generator failed.",
});

export const commitTraderMemo = memoHandler({
  name: "commit-memo-p3-trader",
  inputSchema: tradeProposalOutputSchema,
  execute: async (trade, ctx) => {
    const convictionNumber = Number.parseFloat(trade.metrics.conviction);
    await publishMemo(ctx, "trader", PHASE_3_MEMO_KEYS.trader.collectionKey, {
      label: trade.label,
      headline: trade.headline,
      rating: trade.rating,
      body: trade.body,
      metrics: trade.metrics,
      conviction: Number.isFinite(convictionNumber) ? convictionNumber : null,
      direction: trade.direction,
      sizePct: trade.sizePct,
      stopPrice: trade.stopPrice,
      targetPrice: trade.targetPrice,
      holdingPeriod: trade.holdingPeriod,
      invalidationCriteria: trade.invalidationCriteria,
      dependsOn: trade.dependsOn,
    });
  },
});
