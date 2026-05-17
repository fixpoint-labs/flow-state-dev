/**
 * Phase 2 round-robin wiring.
 *
 * One `roundRobin()` instance — bull and bear take turns. `maxDebateRounds`
 * (session state, capped at 2) drives runtime termination via
 * `terminateWhen`; `maxRounds: 2` is the hard cap. `uses: [tradingDesk]`
 * resolves `model` from `costPreset` at runtime, so the same instance
 * serves the `fast` and `full` cost presets without separate variants.
 *
 * `phase2Contributions` is created here and registered on the flow's
 * `resources` map so the consolidator generators and the `tradingDesk`
 * capability presets (`p2Contributions`) share one canonical resource
 * across writers and readers.
 */
import { handler } from "@flow-state-dev/core";
import {
  roundRobin,
  roundRobinInputSchema,
  type RoundRobinState,
} from "@flow-state-dev/patterns/round-robin";
import { z } from "zod";
import { PHASE_2_MEMO_KEYS } from "../agents";
import { sessionStateSchema, type SessionState } from "../state";
import { tradingDesk } from "../services/trading-desk-capability";
import { phase2Contributions } from "./contributions";
import { BEAR_ROLE, BULL_ROLE, ROUND_ROBIN_INSTRUCTIONS } from "./prompts";

// Re-export so existing imports of `./round-robin` keep working.
export { phase2Contributions };

/**
 * Derives the round-robin's `{ goal }` input from session state. Run
 * this step right before the round-robin so its input matches
 * `roundRobinInputSchema` without an explicit `connectInput` adapter.
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

export const phase2RoundRobin = roundRobin({
  name: "p2-research-debate",
  roster: [
    { name: PHASE_2_MEMO_KEYS.bull.agentName, role: BULL_ROLE },
    { name: PHASE_2_MEMO_KEYS.bear.agentName, role: BEAR_ROLE },
  ],
  maxRounds: 2,
  terminateWhen: (ctx) => {
    const state = ctx.sequencer!.state as RoundRobinState;
    const session = ctx.session?.state as SessionState | undefined;
    const max = session?.maxDebateRounds ?? 1;
    return state.round >= max;
  },
  synthesizer: false,
  contributions: phase2Contributions,
  // Accessor name shared with downstream consumers (consolidators +
  // tradingDesk capability presets). Resource state is keyed by accessor
  // name, so writes and reads must align.
  accessorKey: "p2Contributions",
  // Capability resolves `model` from `costPreset` at runtime; no
  // per-variant build-time instances needed.
  uses: [tradingDesk],
  instructions: ROUND_ROBIN_INSTRUCTIONS,
});
