/**
 * `stubJudge` — Round Robin loop terminator for Phase 2.
 *
 * Phase 2's research manager is a synthesizer, not a judge. Round Robin
 * requires a judge slot to terminate the loop; we fill it with a 3-line
 * handler that always returns `done: false` and lean on the pattern's
 * `maxRounds` cap (driven per-preset by the four router-selected
 * instances). This is the README's canonical idiom for fixed-length loops.
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
