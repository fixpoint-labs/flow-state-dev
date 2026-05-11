/**
 * `phase2Pipeline` — the Phase 2 sub-sequencer.
 *
 * Runs after Phase 1: pre-creates three p2 memos in `pending`, derives the
 * debate goal from session state, routes to one of four pre-built
 * `roundRobin()` instances by `(maxDebateRounds, costPreset)`, then
 * writes bull / bear / research-manager memos in sequence with full
 * `pending → writing → published` lifecycles.
 *
 * All four roundRobin instances share `phase2Contributions` (registered
 * on the flow's resources map). The three post-loop consolidation
 * generators read the running transcript via `ctx.resources` rather
 * than threading it through the sub-sequencer's state.
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
  markPhase2ErrorOnWriting,
  markWritingP2,
} from "./writer";

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
  // Bull consolidation
  .tap(markWritingP2("bull"))
  .then(consolidateBullMemo)
  .tap(commitBullMemo)
  // Bear consolidation
  .tap(markWritingP2("bear"))
  .then(consolidateBearMemo)
  .tap(commitBearMemo)
  // Research manager synthesis
  .tap(markWritingP2("researchManager"))
  .then(researchManagerGenerator)
  .tap(commitResearchManagerMemo)
  // Catch-all: if any p2 step fails, flip the in-flight memo from
  // `writing` to `error` so the navigator's red dot and the document
  // area's error treatment surface. Mirrors Phase 1's per-analyst
  // `.rescue([{ block: markError(shortName) }])` convention but at the
  // pipeline level since Phase 2's steps run sequentially.
  .rescue([{ block: markPhase2ErrorOnWriting }]);
