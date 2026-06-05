/**
 * `setupPhase5Memos` — pre-creates the portfolio-manager memo resource in
 * `pending` before its generator runs, via the shared `defineMemoSetup`
 * factory.
 */
import { PHASE_5_MEMO_KEYS } from "../../registry";
import { defineMemoSetup } from "../_recipe/memo-setup";

export const setupPhase5Memos = defineMemoSetup({
  phaseId: "p5",
  agentTeam: "pm",
  keys: { portfolioManager: PHASE_5_MEMO_KEYS.portfolioManager },
  activePhase: "phase-5",
});
