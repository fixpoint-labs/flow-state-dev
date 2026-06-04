/**
 * `setupLensMemos` — pre-creates the N lens-pack memo resources in `pending`
 * before the parallel lens fan-out, so the navigator renders the slots
 * immediately (same idiom as every other phase). Built via the shared
 * `defineMemoSetup` factory over `PHASE_2B_MEMO_KEYS`.
 *
 * The `{ replace: true }` create in `defineMemoSetup` also RESETS each lens memo
 * on a re-run, so prior verdicts don't bleed through (open-Q#5). The
 * `lensConvergence` resource is re-defaulted separately by the convergence tap,
 * which re-`patchState`s a freshly-computed value on every run — so a re-run
 * never shows a stale convergence read.
 */
import { PHASE_2B_MEMO_KEYS } from "../../agents";
import { defineMemoSetup } from "../_recipe/memo-setup";

export const setupLensMemos = defineMemoSetup({
  phaseId: "p2b",
  agentTeam: "research",
  keys: PHASE_2B_MEMO_KEYS,
  // The lens pack runs between Phase 2 and Phase 3; it has no distinct
  // `activePhase` enum value, so it stays in `phase-2` (the convergence read is
  // a pre-decision input, not a separate user-visible phase). Keeping it as
  // `phase-2` avoids widening the `activePhase` enum for a transient sub-phase.
  activePhase: "phase-2",
});
