/**
 * The Phase 2 round-robin instance.
 *
 * One instance, not four. Round Robin's `maxRounds` and `model` are fixed
 * at construction time, but every route handed to a `router()` declares
 * its own internal `contributions` resource — so a multi-route setup
 * fails at startup with a resource-merge conflict. We work around the
 * `maxRounds` axis with `sessionCapJudge`, which reads
 * `session.maxDebateRounds` and terminates the loop early when the
 * session asks for fewer rounds than the pattern's hard cap.
 *
 * Trade-off: model selection is fixed to `intent/chat` (vs. Phase 1's
 * preset-driven `intent/utility` / `intent/chat` split). The cheap
 * preset's cost stays bounded because it runs one round; per-preset
 * model selection inside the round-robin would require either pattern
 * changes (accept an external `contributions` resource) or duplicating
 * the default roster agent block per agent, both of which exceed the
 * scope of this phase. Documented as Open Question 4 in the spec.
 */
import { handler } from "@flow-state-dev/core";
import {
  roundRobin,
  roundRobinContributionEntrySchema,
  roundRobinInputSchema,
} from "@flow-state-dev/patterns/round-robin";
import { z } from "zod";
import { PHASE_2_MEMO_KEYS } from "../agents";
import { sessionStateSchema } from "../state";
import { BEAR_ROLE, BULL_ROLE, ROUND_ROBIN_INSTRUCTIONS } from "./prompts";
import { sessionCapJudge } from "./stub-judge";

const roster = [
  { name: PHASE_2_MEMO_KEYS.bull.agentName, role: BULL_ROLE },
  { name: PHASE_2_MEMO_KEYS.bear.agentName, role: BEAR_ROLE },
];

/**
 * `maxRounds: 2` is the hard ceiling (matching `sessionStateSchema.maxDebateRounds.max(2)`).
 * `sessionCapJudge` enforces the session-driven cap inside that ceiling.
 */
export const phase2RoundRobin = roundRobin({
  name: "p2-research-debate",
  roster,
  maxRounds: 2,
  judge: sessionCapJudge,
  synthesizer: false,
  instructions: ROUND_ROBIN_INSTRUCTIONS,
  model: "intent/chat",
  collectionId: "p2-debate",
});

/**
 * Mirror of `RoundRobinFinalShape` as a zod schema. The pattern only
 * exports the TS interface, but a real schema lets the downstream stash
 * handler carry typed input instead of `any`.
 */
export const roundRobinFinalShapeSchema = z.object({
  rounds: z.number(),
  done: z.boolean(),
  summary: z.string(),
  contributions: z.array(roundRobinContributionEntrySchema),
});

/**
 * Derives the round-robin's `{ goal }` input from session state. Run this
 * step right before the round-robin so the downstream input matches the
 * pattern's input schema without an explicit `connectInput` adapter.
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
