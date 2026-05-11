/**
 * `sessionCapJudge` — Round Robin loop terminator for Phase 2.
 *
 * Round Robin's `maxRounds` is fixed at construction time, but Phase 2's
 * round cap is session-driven (`session.maxDebateRounds`: 1 on the cheap
 * preset, 2 on full). We build the round-robin with `maxRounds: 2` (the
 * schema's hard cap) and let this judge stop the loop earlier when the
 * session asks for one round.
 *
 * Reads the current round from sequencer state (`roundRobinStateSchema`'s
 * `round` field) and compares against `session.maxDebateRounds`. Returns
 * `done: true` once the count is hit; no LLM call.
 */
import { handler } from "@flow-state-dev/core";
import { roundRobinStateSchema } from "@flow-state-dev/patterns/round-robin";
import { z } from "zod";
import { sessionStateSchema } from "../state";

const judgeOutputSchema = z.object({
  done: z.boolean(),
  summary: z.string(),
});

export const sessionCapJudge = handler({
  name: "p2-session-cap-judge",
  inputSchema: z.any(),
  outputSchema: judgeOutputSchema,
  sessionStateSchema,
  sequencerStateSchema: roundRobinStateSchema,
  execute: (_input, ctx) => {
    const max = (ctx.session.state.maxDebateRounds as number | undefined) ?? 1;
    const current = ctx.sequencer!.state.round ?? 0;
    return { done: current >= max, summary: "" };
  },
});
