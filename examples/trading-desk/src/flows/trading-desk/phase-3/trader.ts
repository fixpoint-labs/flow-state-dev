/**
 * The Phase 3 trader generator.
 *
 * Reads the Phase 2 InvestmentThesis (plus the four analyst memos and the
 * full debate transcript on `full` preset) and writes a typed
 * `TradeProposal`. `agentType: "primary"` so the structured `TxStruct` card
 * renders in the transcript automatically.
 *
 * Capability-driven context. The `tradingDesk` capability provides:
 *   - `investmentThesis` (always on) — InvestmentThesis + extension fields.
 *   - `phase1MemosFull` and `phase2DebateFull` — same content as the
 *     always-on `phase1Memos` / `phase2Debate` presets, but the context
 *     formatters render an empty string when `costPreset !== "full"`.
 *     Listed statically so the resources they declare (memos collection,
 *     `p2Contributions`) flow through without an extra `resources:` slot.
 */
import { generator } from "@flow-state-dev/core";
import { PHASE_3_MEMO_KEYS } from "../agents";
import { sessionStateSchema } from "../state";
import { tradingDesk } from "../services/trading-desk-capability";
import { tradeProposalOutputSchema } from "./schemas";
import { TRADER_PROMPT } from "./prompts";

export const traderGenerator = generator({
  name: "trader-generator",
  agentType: "primary",
  agentName: PHASE_3_MEMO_KEYS.trader.agentName,
  uses: [
    tradingDesk.presets({
      investmentThesis: true,
      phase1MemosFull: true,
      phase2DebateFull: true,
    }),
  ],
  prompt: TRADER_PROMPT,
  user: "Now write the published TradeProposal.",
  sessionStateSchema,
  outputSchema: tradeProposalOutputSchema,
});
