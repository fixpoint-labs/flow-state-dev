/**
 * Phase 3 trader approach preamble.
 *
 * A fast-model free-text generator that streams the trader's plan in
 * plain English before the structured `traderGenerator` runs. See
 * `lib/approach-generator.ts` for the shared shape.
 *
 * Capability presets: `investmentThesis` only. The preamble needs to
 * know the InvestmentThesis exists (so it can name it in its 1–2
 * sentences), not the full Phase 1 / Phase 2 data depth the structured
 * trader reads.
 */
import { PHASE_3_MEMO_KEYS } from "../../registry";
import { tradingDesk } from "../../capability";
import { createApproachGenerator } from "../_recipe/approach-generator";
import { loadPrompt } from "../../lib/prompt";

export const traderApproachGenerator = createApproachGenerator({
  name: "trader-approach-generator",
  agentName: PHASE_3_MEMO_KEYS.trader.agentName,
  artifactName: "TradeProposal",
  prompt: loadPrompt("agents/trader/prompts/trader-approach.prompt.md").prompt,
  uses: [tradingDesk.presets({ investmentThesis: true })],
});
