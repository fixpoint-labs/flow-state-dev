/**
 * `setupPhase5aMemos` — pre-creates the scenario-forecaster memo resource
 * in `pending` before the forecaster generator runs. Built via the shared
 * `defineMemoSetup` factory, mirroring Phase 5/6.
 */
import { PHASE_5A_MEMO_KEYS } from "../agents";
import { defineMemoSetup } from "../lib/memo-setup";

export const setupPhase5aMemos = defineMemoSetup({
  phaseId: "p5a",
  agentTeam: "pm",
  keys: PHASE_5A_MEMO_KEYS,
  activePhase: "phase-5a",
});
