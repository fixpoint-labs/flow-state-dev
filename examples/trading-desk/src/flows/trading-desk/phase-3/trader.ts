/**
 * The Phase 3 trader generator.
 *
 * Reads the Phase 2 InvestmentThesis (plus the four analyst memos and the
 * full debate transcript on `full` preset) and writes a typed
 * `TradeProposal`. `agentType: "primary"` so the structured `TxStruct` card
 * renders in the transcript automatically.
 *
 * Capability-driven context. The `tradingDesk` capability provides:
 *   - `investmentThesis` preset (always on) — InvestmentThesis + extension
 *     fields. Declares the `memos` resource.
 *   - `phase1Memos` and `phase2Debate` presets (added via dynamic `uses` on
 *     the `full` preset) — full context only when the cost budget warrants.
 *
 * The `p2Contributions` resource is declared on the generator directly so
 * the dynamic `phase2Debate` preset can read it. (Dynamic uses contribute
 * context only — resources must be declared statically.)
 */
import { generator } from "@flow-state-dev/core";
import { PHASE_3_MEMO_KEYS } from "../agents";
import { phase2Contributions } from "../phase-2/round-robin";
import { sessionStateSchema } from "../state";
import { tradingDesk } from "../services/trading-desk-capability";
import { tradeProposalOutputSchema } from "./schemas";
import { TRADER_PROMPT } from "./prompts";

export const traderGenerator = generator({
  name: "trader-generator",
  agentType: "primary",
  agentName: PHASE_3_MEMO_KEYS.trader.agentName,
  uses: [
    tradingDesk.presets({ investmentThesis: true }),
    (ctx: { session: { state: { costPreset?: string } } }) =>
      ctx.session.state.costPreset === "full"
        ? ([tradingDesk.presets({ phase1Memos: true, phase2Debate: true })] as const)
        : ([] as const),
  ] as const,
  resources: { p2Contributions: phase2Contributions },
  prompt: TRADER_PROMPT,
  user: "Now write the published TradeProposal.",
  sessionStateSchema,
  outputSchema: tradeProposalOutputSchema,
});
