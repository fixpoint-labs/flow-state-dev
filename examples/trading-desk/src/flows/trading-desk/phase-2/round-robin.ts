/**
 * Phase 2 round-robin instances and the router that selects among them.
 *
 * Round Robin's `model` and `maxRounds` are fixed at construction time, but
 * Phase 2 needs both to vary by session state (`costPreset` and
 * `maxDebateRounds`). We pre-build four instances — one per
 * `(maxRounds, preset)` combination — and a router picks one at runtime.
 *
 * The judge slot is filled with `stubJudge` (always returns `done: false`);
 * the synthesizer slot is `false` because Phase 2 does its own bull/bear
 * memo writes and research-manager synthesis downstream.
 */
import { handler, router } from "@flow-state-dev/core";
import {
  roundRobin,
  roundRobinInputSchema,
} from "@flow-state-dev/patterns/round-robin";
import { z } from "zod";
import { PHASE_2_MEMO_KEYS } from "../agents";
import { sessionStateSchema } from "../state";
import { BEAR_ROLE, BULL_ROLE, ROUND_ROBIN_INSTRUCTIONS } from "./prompts";
import { stubJudge } from "./stub-judge";

const roster = [
  { name: PHASE_2_MEMO_KEYS.bull.agentName, role: BULL_ROLE },
  { name: PHASE_2_MEMO_KEYS.bear.agentName, role: BEAR_ROLE },
];

function buildInstance(opts: {
  maxRounds: 1 | 2;
  model: string;
  variant: string;
}) {
  return roundRobin({
    name: `p2-research-debate-${opts.variant}`,
    roster,
    maxRounds: opts.maxRounds,
    judge: stubJudge,
    synthesizer: false,
    instructions: ROUND_ROBIN_INSTRUCTIONS,
    model: opts.model,
    collectionId: `p2-debate-${opts.variant}`,
  });
}

export const phase2RoundRobin_1round_fast = buildInstance({
  maxRounds: 1,
  model: "intent/utility",
  variant: "1r-fast",
});

export const phase2RoundRobin_1round_full = buildInstance({
  maxRounds: 1,
  model: "intent/chat",
  variant: "1r-full",
});

export const phase2RoundRobin_2round_fast = buildInstance({
  maxRounds: 2,
  model: "intent/utility",
  variant: "2r-fast",
});

export const phase2RoundRobin_2round_full = buildInstance({
  maxRounds: 2,
  model: "intent/chat",
  variant: "2r-full",
});

/**
 * Derives the round-robin's `{ goal }` input from session state. Run this
 * step right before the router so the router's input matches each route's
 * input schema and no per-route `connectInput` adapter is needed.
 */
export const deriveDebateGoal = handler({
  name: "p2-derive-goal",
  inputSchema: z.any(),
  outputSchema: roundRobinInputSchema,
  sessionStateSchema,
  execute: (_input, ctx) => {
    const ticker = ctx.session.state.ticker ?? "(unknown)";
    const date = ctx.session.state.date ?? "(unknown)";
    return {
      goal: [
        `Decide whether ${ticker} on ${date} is a long, short, or pass.`,
        "Bull argues the long thesis. Bear argues the short / pass case. Cite",
        "the analyst memos. Do not concede the strongest opposing points without",
        "rebuttal. The Research Manager will synthesize after the loop.",
      ].join(" "),
    };
  },
});

/**
 * Routes among the four pre-built instances by `(maxDebateRounds, costPreset)`.
 * Input is `{ goal }` (produced by `deriveDebateGoal`); output is whatever
 * the chosen round-robin returns — `RoundRobinFinalShape` because all four
 * instances pass `synthesizer: false`.
 */
export const phase2RoundRobinRouter = router({
  name: "phase-2-rr-router",
  inputSchema: roundRobinInputSchema,
  outputSchema: z.any(),
  routes: [
    phase2RoundRobin_1round_fast,
    phase2RoundRobin_1round_full,
    phase2RoundRobin_2round_fast,
    phase2RoundRobin_2round_full,
  ],
  sessionStateSchema,
  execute: (_input, ctx) => {
    const maxDebateRounds = ctx.session.state.maxDebateRounds ?? 1;
    const costPreset = ctx.session.state.costPreset ?? "fast";
    if (maxDebateRounds === 2 && costPreset === "full") {
      return phase2RoundRobin_2round_full;
    }
    if (maxDebateRounds === 2) {
      return phase2RoundRobin_2round_fast;
    }
    if (costPreset === "full") {
      return phase2RoundRobin_1round_full;
    }
    return phase2RoundRobin_1round_fast;
  },
});
