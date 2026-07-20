import { handler } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

/**
 * A deterministic worker so the whole example runs in tests and via `fsdev`
 * with no model. It uppercases its task's `text` — enough to prove a task was
 * claimed, ran, and produced output. Swap it for a `generator` for real work.
 */
export const processor = handler({
  name: "processor",
  inputSchema: taskWorkerInputSchema.extend({
    input: z.object({ text: z.string() }).optional(),
  }),
  outputSchema: z.object({ result: z.string() }),
  execute: (input) => ({
    result: (input.input?.text ?? "").toUpperCase(),
  }),
});
