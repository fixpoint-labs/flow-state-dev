/**
 * `setupPhase3Memos` — pre-creates the trader memo resource in `pending`
 * before the trader generator runs. Built via the shared `defineMemoSetup`
 * factory.
 */
import { PHASE_3_MEMO_KEYS } from "../../registry";
import { defineMemoSetup } from "../_recipe/memo-setup";

export const setupPhase3Memos = defineMemoSetup({
  phaseId: "p3",
  agentTeam: "trade",
  keys: PHASE_3_MEMO_KEYS,
  activePhase: "phase-3",
});
