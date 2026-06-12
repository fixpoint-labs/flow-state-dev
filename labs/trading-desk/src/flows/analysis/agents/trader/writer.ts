/**
 * Phase 3 memo-writing block.
 *
 *   - `commitTraderMemo` — plain handler. Derives `conviction` from the
 *     LLM's string-typed `metrics.conviction` (the display shape is
 *     string-only per the Claude Design handoff; the structured 0..1
 *     number is what Phase 5 reads).
 *
 * The `writing` / `error` memo transitions are placed by `defineMemoStep`
 * (`orchestration/stages.ts`) via the registry-keyed `markWriting` / `markError`.
 */
import { PHASE_3_MEMO_KEYS } from "../../registry";
import { memoHandler, publishMemo } from "../_recipe/memo-writer";
import { tradeProposalOutputSchema } from "./trader";

export const commitTraderMemo = memoHandler({
  name: "commit-memo-p3-trader",
  inputSchema: tradeProposalOutputSchema,
  execute: async (trade, ctx) => {
    const convictionNumber = Number.parseFloat(trade.metrics.conviction);
    await publishMemo(ctx, PHASE_3_MEMO_KEYS.trader.collectionKey, {
      ...trade,
      conviction: Number.isFinite(convictionNumber) ? convictionNumber : null,      
    });
  },
});
