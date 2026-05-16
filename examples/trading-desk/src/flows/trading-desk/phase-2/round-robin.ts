/**
 * Phase 2 round-robin instances and the router that selects among them.
 *
 * Four pre-built `roundRobin()` instances cover the `(maxRounds, preset)`
 * matrix: `1r-fast`, `1r-full`, `2r-fast`, `2r-full`. A router picks one
 * at runtime by `(maxDebateRounds, costPreset)`.
 *
 * All four instances share a single `contributions` resource created
 * here and registered on the flow. The resource is also exposed so
 * post-loop consolidation generators can read the running transcript
 * via `ctx.resources` without threading it through sequencer state.
 */
import { handler, router } from "@flow-state-dev/core";
import {
  roundRobin,
  roundRobinContributionEntrySchema,
  roundRobinInputSchema,
} from "@flow-state-dev/patterns/round-robin";
import { z } from "zod";
import { PHASE_2_MEMO_KEYS } from "../agents";
import { sessionStateSchema } from "../state";
import { phase2Contributions } from "./contributions";
import { BEAR_ROLE, BULL_ROLE, ROUND_ROBIN_INSTRUCTIONS } from "./prompts";
import { stubJudge } from "./stub-judge";

// Re-export so existing imports of `./round-robin` keep working.
export { phase2Contributions };

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
    contributions: phase2Contributions,
    // Accessor name shared with downstream consumers (consolidators +
    // tradingDesk capability presets). Resource state is keyed by
    // accessor name, so writes and reads must align.
    accessorKey: "p2Contributions",
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
 * Mirror of `RoundRobinFinalShape` as a zod schema. The pattern only
 * exports the TS interface, but a real schema lets the router carry a
 * typed output instead of `any`.
 */
export const roundRobinFinalShapeSchema = z.object({
  rounds: z.number(),
  done: z.boolean(),
  summary: z.string(),
  contributions: z.array(roundRobinContributionEntrySchema),
});

/**
 * Derives the round-robin's `{ goal }` input from session state. Run
 * this step right before the router so the router's input matches each
 * route's `roundRobinInputSchema` without an explicit `connectInput`
 * adapter.
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
 * Routes among the four instances by `(maxDebateRounds, costPreset)`.
 * Input is `{ goal }` (produced by `deriveDebateGoal`); output is
 * `RoundRobinFinalShape` because every route passes `synthesizer: false`.
 *
 * The router merges declared resources across all routes — including
 * `contributions`. Sharing one resource reference (`phase2Contributions`)
 * across the four instances is what makes this merge succeed.
 */
export const phase2RoundRobinRouter = router({
  name: "phase-2-rr-router",
  inputSchema: roundRobinInputSchema,
  outputSchema: roundRobinFinalShapeSchema,
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
