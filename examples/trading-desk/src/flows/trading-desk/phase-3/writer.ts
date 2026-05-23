/**
 * Phase 3 memo state-transition blocks — built via the shared
 * `defineMemoWriter` factory. The trader commit projects the seven Phase 3
 * extension fields onto the memo and derives `conviction` from the LLM's
 * string-typed `metrics.conviction` (the display shape is string-only per
 * the Claude Design handoff; the structured `conviction` 0..1 number is
 * what Phase 5 reads).
 */
import { defineMemoWriter } from "../lib/memo-writer";
import { PHASE_3_MEMO_KEYS } from "../agents";
import { tradeProposalOutputSchema } from "./trader";

const writer = defineMemoWriter({
  phaseId: "p3",
  agentTeam: "trade",
  keys: PHASE_3_MEMO_KEYS,
  errorMessageFallback: "Phase 3 generator failed.",
});

export const { markWriting: markWritingP3, markError: markErrorP3 } = writer;

export const commitTraderMemo = writer.defineCommit({
  shortName: "trader",
  inputSchema: tradeProposalOutputSchema,
  project: (trade) => {
    const convictionNumber = Number.parseFloat(trade.metrics.conviction);
    return {
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
    };
  },
});
