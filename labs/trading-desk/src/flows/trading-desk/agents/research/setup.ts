/**
 * `setupPhase2Memos` — pre-creates the three Phase 2 memo resources
 * (bull, bear, research manager) in `pending` before the debate loop
 * starts. Built via the shared `defineMemoSetup` factory.
 */
import { PHASE_2_MEMO_KEYS } from "../../registry";
import { defineMemoSetup } from "../_recipe/memo-setup";

export const setupPhase2Memos = defineMemoSetup({
  phaseId: "p2",
  agentTeam: "research",
  keys: PHASE_2_MEMO_KEYS,
  activePhase: "phase-2",
});
