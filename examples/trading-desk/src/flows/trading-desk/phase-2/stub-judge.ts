/**
 * `stubJudge` — the loop terminator for the Phase 2 round-robin.
 *
 * Round Robin requires a judge slot but Phase 2's research manager is a
 * synthesizer, not a judge. The pattern's README's canonical idiom is to
 * pass a stub judge that always returns `{ done: false }` and lean on
 * `maxRounds` for termination. No LLM call; cost is one local handler
 * invocation per round.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const judgeOutputSchema = z.object({
  done: z.boolean(),
  summary: z.string(),
});

export const stubJudge = handler({
  name: "p2-stub-judge",
  inputSchema: z.any(),
  outputSchema: judgeOutputSchema,
  execute: () => ({ done: false, summary: "" }),
});
