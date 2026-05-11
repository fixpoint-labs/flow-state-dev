/**
 * `phase2Pipeline` — the Phase 2 sub-sequencer.
 *
 * Runs after Phase 1: pre-creates three p2 memos in `pending`, derives the
 * debate goal from session state, executes the round-robin loop (model and
 * `maxRounds` chosen by router), then writes bull / bear / research-manager
 * memos in sequence with full `pending → writing → published` lifecycles.
 *
 * Sequencer state holds the loop's contributions and the consolidated
 * theses so each post-loop generator can read them off `ctx.sequencer.state`
 * without threading them through input schemas.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import {
  consolidateBearMemo,
  consolidateBullMemo,
  researchManagerGenerator,
} from "./generators";
import { phase2StateSchema, type Phase2State } from "./sequencer-state";
import {
  deriveDebateGoal,
  phase2RoundRobinRouter,
  roundRobinFinalShapeSchema,
} from "./round-robin";
import { setupPhase2Memos } from "./setup";
import {
  bearThesisOutputSchema,
  bullThesisOutputSchema,
  type BearThesisOutput,
  type BullThesisOutput,
} from "./thesis-schemas";
import {
  commitBearMemo,
  commitBullMemo,
  commitResearchManagerMemo,
  markPhase2ErrorOnWriting,
  markWritingP2,
} from "./writer";

/** Capture the loop transcript on exit so downstream generators can read it. */
const stashContributions = handler({
  name: "p2-stash-contributions",
  inputSchema: roundRobinFinalShapeSchema,
  outputSchema: z.void(),
  sequencerStateSchema: phase2StateSchema,
  execute: async (input, ctx) => {
    await ctx.sequencer!.patchState({
      contributions: input.contributions,
    });
  },
});

/** Save the bull thesis so the bear consolidator and RM can reference it. */
const stashBullThesis = handler({
  name: "p2-stash-bull",
  inputSchema: bullThesisOutputSchema,
  outputSchema: z.void(),
  sequencerStateSchema: phase2StateSchema,
  execute: async (thesis: BullThesisOutput, ctx) => {
    await ctx.sequencer!.patchState({ bullThesis: thesis });
  },
});

/** Save the bear thesis so the RM can reference it. */
const stashBearThesis = handler({
  name: "p2-stash-bear",
  inputSchema: bearThesisOutputSchema,
  outputSchema: z.void(),
  sequencerStateSchema: phase2StateSchema,
  execute: async (thesis: BearThesisOutput, ctx) => {
    await ctx.sequencer!.patchState({ bearThesis: thesis });
  },
});

export const phase2Pipeline = sequencer({
  name: "phase-2-research-debate",
  stateSchema: phase2StateSchema,
  container: {
    component: "phase-2-debate",
    label:
      "Phase 2 — Research Debate begins. Bull and Bear take turns; Research Manager synthesizes.",
  },
})
  .tap(setupPhase2Memos)
  .then(deriveDebateGoal)
  .then(phase2RoundRobinRouter)
  .tap(stashContributions)
  // Bull consolidation
  .tap(markWritingP2("bull"))
  .then(consolidateBullMemo)
  .tap(stashBullThesis)
  .tap(commitBullMemo)
  // Bear consolidation — generator ignores its input and reads sequencer state
  .tap(markWritingP2("bear"))
  .then(consolidateBearMemo)
  .tap(stashBearThesis)
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

export type { Phase2State };
