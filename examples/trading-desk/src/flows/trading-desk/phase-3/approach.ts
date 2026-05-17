/**
 * Phase 3 trader approach preamble.
 *
 * A fast-model free-text generator that streams the trader's plan in
 * plain English before the structured `traderGenerator` runs. See
 * `services/approach-generator.ts` for the shared shape.
 *
 * Capability presets: `investmentThesis` only. The preamble needs to
 * know the InvestmentThesis exists (so it can name it in its 1–2
 * sentences), not the full Phase 1 / Phase 2 data depth the structured
 * trader reads.
 */
import { PHASE_3_MEMO_KEYS } from "../agents";
import { tradingDesk } from "../services/trading-desk-capability";
import { createApproachGenerator } from "../services/approach-generator";
import { TRADER_APPROACH_PROMPT } from "./prompts";

export const traderApproachGenerator = createApproachGenerator({
  name: "trader-approach-generator",
  agentName: PHASE_3_MEMO_KEYS.trader.agentName,
  artifactName: "TradeProposal",
  prompt: TRADER_APPROACH_PROMPT,
  uses: [tradingDesk.presets({ investmentThesis: true })],
});
