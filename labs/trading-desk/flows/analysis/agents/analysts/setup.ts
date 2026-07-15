/**
 * `setupPhase1Memos` — pre-creates the five Phase 1 memo resources in
 * `pending` before the parallel analyst fan-out starts. Built via the
 * shared `defineMemoSetup` factory; the navigator reads each memo's status
 * live off the collection, so all Phase 1 memos appear in `pending`
 * immediately before any generator runs.
 */
import { PHASE_1_MEMO_KEYS } from "../../registry";
import { defineMemoSetup } from "../_recipe/memo-setup";

export const setupPhase1Memos = defineMemoSetup({
  phaseId: "p1",
  agentTeam: "analyst",
  keys: PHASE_1_MEMO_KEYS,
  activePhase: "phase-1",
});
