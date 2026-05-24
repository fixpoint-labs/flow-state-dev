/**
 * `setupPhase5Memos` — pre-creates the portfolio-manager memo resource in
 * `pending` before the PM generator runs. Built via the shared
 * `defineMemoSetup` factory.
 */
import { PHASE_5_MEMO_KEYS } from "../agents";
import { defineMemoSetup } from "../lib/memo-setup";

export const setupPhase5Memos = defineMemoSetup({
  phaseId: "p5",
  agentTeam: "pm",
  keys: PHASE_5_MEMO_KEYS,
  activePhase: "phase-5",
});
