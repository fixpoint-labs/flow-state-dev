/**
 * Phase 3 memo-writing block.
 *
 *   - `commitTraderMemo` — plain handler. Derives `conviction` from the
 *     LLM's string-typed `metrics.conviction` (the display shape is
 *     string-only per the Claude Design handoff; the structured 0..1
 *     number is what Phase 5 reads).
 *
 * FIX-780 — this handler is also the desk's stance gate on price levels. The
 * trader is TOLD in its prompt which pair of levels its direction may carry;
 * the commit is where that stops being a request. A flat proposal stores the
 * monitoring pair and no stop/target; a directional one stores the reverse; a
 * proposal that filled the wrong pair loses those numbers rather than having
 * them stored under names the model did not write them as. Same shape as
 * `agreesWithTrader`: what the desk can determine, the desk determines.
 *
 * The display `metrics` row's level entries are derived here too, from the
 * gated typed fields — its keys are level names, so they are bound by the same
 * one labeling rule (`lib/trade-levels.ts`) as the screen and the prompts.
 *
 * The `writing` / `error` memo transitions are placed by `defineMemoStep`
 * (`orchestration/stages.ts`) via the registry-keyed `markWriting` / `markError`.
 */
import { PHASE_3_MEMO_KEYS } from "../../registry";
import { levelsForStance, tradeLevelMetricEntries } from "../../lib/trade-levels";
import { memoHandler, publishMemo } from "../_recipe/memo-writer";
import { tradeProposalOutputSchema } from "./trader";

export const commitTraderMemo = memoHandler({
  name: "commit-memo-p3-trader",
  inputSchema: tradeProposalOutputSchema,
  execute: async (trade, ctx) => {
    const convictionNumber = Number.parseFloat(trade.metrics.conviction);
    const levels = levelsForStance(trade.direction, trade);
    await publishMemo(ctx, PHASE_3_MEMO_KEYS.trader.collectionKey, {
      ...trade,
      // Spread AFTER `trade` so the gated pair overwrites whatever the model
      // emitted — this is the line that makes decision 4 binding.
      ...levels,
      // Key order is display order: direction, size, the levels, conviction.
      metrics: {
        direction: trade.metrics.direction,
        size: trade.metrics.size,
        ...tradeLevelMetricEntries({ direction: trade.direction, ...levels }),
        conviction: trade.metrics.conviction,
      },
      conviction: Number.isFinite(convictionNumber) ? convictionNumber : null,
    });
  },
});
