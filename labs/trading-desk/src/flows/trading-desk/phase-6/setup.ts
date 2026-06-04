/**
 * `setupPhase6Memos` — pre-creates the thesis-alignment memo resource in
 * `pending` before the validator generator runs. Built via the shared
 * `defineMemoSetup` factory, mirroring Phase 3/5.
 */
import { PHASE_6_MEMO_KEYS } from "../agents";
import { defineMemoSetup } from "../agents/_recipe/memo-setup";

export const setupPhase6Memos = defineMemoSetup({
  phaseId: "p6",
  agentTeam: "pm",
  keys: PHASE_6_MEMO_KEYS,
  activePhase: "phase-6",
});
