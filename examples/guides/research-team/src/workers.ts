import { handler } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

/** What each analyst task carries as its typed `input` payload. */
const analysisInput = taskWorkerInputSchema.extend({
  input: z.object({ subject: z.string() }).optional(),
});
const analysisOutput = z.object({ findings: z.string() });

/**
 * An analyst worker. It's a plain `handler` here so the example runs in
 * tests without a model. Swap the handler for a `generator({ model,
 * prompt })` to have it call an LLM — a worker is any block.
 */
export function analyst(lens: string) {
  return handler({
    name: `${lens}-analyst`,
    inputSchema: analysisInput,
    outputSchema: analysisOutput,
    execute: (input) => ({
      findings: `${lens}: ${input.input?.subject ?? "unknown"}`,
    }),
  });
}

const synthesisInput = taskWorkerInputSchema.extend({
  input: z.object({ subject: z.string() }).optional(),
});

/**
 * The synthesizer. When a task declares `deps`, the board materializes
 * each completed dependency's output onto `input.deps`, keyed by task
 * id. So the synthesizer reads its inputs off `input.deps` directly —
 * no collection lookup, no glue.
 */
export const synthesizer = handler({
  name: "synthesizer",
  inputSchema: synthesisInput,
  outputSchema: z.object({ report: z.string() }),
  execute: (input) => {
    const findings = Object.values(input.deps ?? {})
      .map((dep) => (dep as { findings?: string })?.findings ?? "?")
      .join(" | ");
    return { report: `${input.input?.subject ?? "unknown"} — ${findings}` };
  },
});
