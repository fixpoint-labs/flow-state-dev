/**
 * `phase2Pipeline` — the Phase 2 sub-sequencer.
 *
 * Runs after Phase 1: pre-creates three p2 memos in `pending`, derives the
 * debate goal from session state, routes to one of four pre-built
 * `roundRobin()` instances by `(maxDebateRounds, costPreset)`, then writes
 * bull, bear, and research-manager memos in sequence — each wrapped in its
 * own sub-sequencer with a per-step rescue. Mirrors Phase 1's
 * `defineAnalyst` idiom: if one generator throws, only that memo flips to
 * `error` (with a captured `errorMessage`); the remaining steps still run.
 *
 * Why per-step rescue, not pipeline-level: a single outer `.rescue([...])`
 * over a multi-step chain is undiagnosable — you can't tell which step
 * failed without scanning state, and downstream steps never run. Per-step
 * rescue surfaces the failing memo's identity directly and keeps the
 * pipeline producing whatever artifacts it still can.
 *
 * All four roundRobin instances share `phase2Contributions` (registered on
 * the flow's resources map). The three post-loop consolidation generators
 * read the running transcript via `ctx.resources` rather than threading it
 * through the sub-sequencer's state.
 */
import { sequencer } from "@flow-state-dev/core";
import {
  consolidateBearMemo,
  consolidateBullMemo,
  researchManagerGenerator,
} from "./generators";
import {
  deriveDebateGoal,
  phase2RoundRobinRouter,
} from "./round-robin";
import { setupPhase2Memos } from "./setup";
import {
  commitBearMemo,
  commitBullMemo,
  commitResearchManagerMemo,
  markErrorP2,
  markWritingP2,
} from "./writer";

const bullStep = sequencer({ name: "phase-2-bull-step" })
  .tap(markWritingP2("bull"))
  .then(consolidateBullMemo)
  .tap(commitBullMemo)
  .rescue([{ block: markErrorP2("bull") }]);

const bearStep = sequencer({ name: "phase-2-bear-step" })
  .tap(markWritingP2("bear"))
  .then(consolidateBearMemo)
  .tap(commitBearMemo)
  .rescue([{ block: markErrorP2("bear") }]);

const researchManagerStep = sequencer({ name: "phase-2-research-manager-step" })
  .tap(markWritingP2("researchManager"))
  .then(researchManagerGenerator)
  .tap(commitResearchManagerMemo)
  .rescue([{ block: markErrorP2("researchManager") }]);

export const phase2Pipeline = sequencer({
  name: "phase-2-research-debate",
  container: {
    component: "phase-2-debate",
    label:
      "Phase 2 — Research Debate begins. Bull and Bear take turns; Research Manager synthesizes.",
  },
})
  .tap(setupPhase2Memos)
  .then(deriveDebateGoal)
  .then(phase2RoundRobinRouter)
  .then(bullStep)
  .then(bearStep)
  .then(researchManagerStep);
