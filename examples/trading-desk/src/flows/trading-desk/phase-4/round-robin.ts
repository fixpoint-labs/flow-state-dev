/**
 * Phase 4 round-robin wiring.
 *
 * One `roundRobin()` instance — three roster slots, each overridden with a
 * small sub-sequencer that marks the persona memo as `writing`, runs the
 * persona generator, commits the structured critique, and adapts the
 * generator's output to the `{ text }` shape the round-robin's
 * `record-contribution` tap consumes. A per-step rescue wraps each slot
 * so a single persona's failure flips only that memo to `error` and the
 * remaining personas still run.
 *
 * `maxRounds: 1`, `synthesizer: false`, `judge: stubJudge` — single pass.
 * The downstream `riskAssessmentGenerator` runs as its own step in
 * `phase4Pipeline`, not as the pattern's synthesizer.
 *
 * `phase4Contributions` is created here and registered on the flow's
 * `resources` map so the consolidator can declare it on its own
 * `resources:` slot and read entries via `ctx.resources`.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import {
  createRoundRobinContributions,
  roundRobin,
  roundRobinInputSchema,
} from "@flow-state-dev/patterns/round-robin";
import { z } from "zod";
import { sessionStateSchema } from "../state";
import { stubJudge } from "../phase-2/stub-judge";
import {
  aggressiveRiskGenerator,
  conservativeRiskGenerator,
  neutralRiskGenerator,
} from "./personas";
import { ROUND_ROBIN_INSTRUCTIONS } from "./prompts";
import {
  commitAggressiveRiskMemo,
  commitConservativeRiskMemo,
  commitNeutralRiskMemo,
  markErrorP4,
  markWritingP4,
} from "./writer";
import type {
  NeutralCritiqueOutput,
  PersonaCritiqueOutput,
} from "./schemas";

/** Shared contributions resource. Passed to the `roundRobin()` instance
 *  below AND registered on the flow's `resources` map (see `flow.ts`) so
 *  the consolidation generator can read entries via `ctx.resources`. */
export const phase4Contributions = createRoundRobinContributions();

/** Map a persona's structured critique to the `{ text }` shape the
 *  round-robin's `record-contribution` tap expects. Concatenates body
 *  sections so the transcript carries a faithful free-form rendition of
 *  what the persona said. Subsequent personas read structured fields
 *  from the memo, not from this text. */
const toContributionShape = handler({
  name: "p4-to-contribution-shape",
  inputSchema: z.any(),
  outputSchema: z.object({ text: z.string() }),
  execute: async (input: PersonaCritiqueOutput | NeutralCritiqueOutput) => {
    const text = input.body
      .map((s) => `${s.h}: ${s.p ?? ""}`)
      .filter((s) => s.length > 2)
      .join("\n\n");
    return { text };
  },
});

const aggressiveStep = sequencer({ name: "phase-4-aggressive-step" })
  .tap(markWritingP4("aggressive"))
  .then(aggressiveRiskGenerator)
  .tap(commitAggressiveRiskMemo)
  .then(toContributionShape)
  .rescue([{ block: markErrorP4("aggressive") }]);

const conservativeStep = sequencer({ name: "phase-4-conservative-step" })
  .tap(markWritingP4("conservative"))
  .then(conservativeRiskGenerator)
  .tap(commitConservativeRiskMemo)
  .then(toContributionShape)
  .rescue([{ block: markErrorP4("conservative") }]);

const neutralStep = sequencer({ name: "phase-4-neutral-step" })
  .tap(markWritingP4("neutral"))
  .then(neutralRiskGenerator)
  .tap(commitNeutralRiskMemo)
  .then(toContributionShape)
  .rescue([{ block: markErrorP4("neutral") }]);

/** Derive the round-robin's `{ goal }` input from session state. Run
 *  right before the round-robin so the pattern's input matches its
 *  `roundRobinInputSchema` without an explicit adapter. */
export const deriveRiskGoal = handler({
  name: "p4-derive-goal",
  inputSchema: z.any(),
  outputSchema: roundRobinInputSchema,
  sessionStateSchema,
  execute: (_input, ctx) => {
    const ticker = ctx.session.state.ticker ?? "(unknown)";
    const date = ctx.session.state.date ?? "(unknown)";
    return {
      goal: [
        `Critique the Phase 3 trade proposal for ${ticker} on ${date}.`,
        "Three risk officers each provide a structured critique in fixed order:",
        "aggressive (push for outsized sizing), conservative (push for tighter risk),",
        "neutral (filter signal from noise). A consolidator follows.",
      ].join(" "),
    };
  },
});

export const phase4RoundRobin = roundRobin({
  name: "p4-risk-debate",
  roster: [
    { name: "aggressiveRisk", block: aggressiveStep },
    { name: "conservativeRisk", block: conservativeStep },
    { name: "neutralRisk", block: neutralStep },
  ],
  maxRounds: 1,
  judge: stubJudge,
  synthesizer: false,
  contributions: phase4Contributions,
  collectionId: "p4-debate",
  // Distinct accessor key so phase 2's round-robin (which uses the default
  // `"contributions"`) and phase 4's round-robin can coexist in the same
  // sequencer chain without a build-time resource-merge conflict.
  accessorKey: "p4Contributions",
  instructions: ROUND_ROBIN_INSTRUCTIONS,
});
