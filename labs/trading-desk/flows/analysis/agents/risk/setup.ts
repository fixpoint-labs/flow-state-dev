/**
 * `setupPhase4Memos` — pre-creates the four Phase 4 memo resources (the
 * three persona critiques + the consolidated risk assessment) in `pending`
 * before any persona runs. Built via the shared `defineMemoSetup` factory.
 */
import { PHASE_4_MEMO_KEYS } from "../../registry";
import { defineMemoSetup } from "../_recipe/memo-setup";

export const setupPhase4Memos = defineMemoSetup({
  phaseId: "p4",
  agentTeam: "risk",
  keys: PHASE_4_MEMO_KEYS,
  activePhase: "phase-4",
});
