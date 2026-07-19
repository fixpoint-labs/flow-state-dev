// A flow that USES the custom `mapReduce` pattern, to show a consumer's side.
//
// The job: count words across a set of documents. Map each document to its word
// count (in parallel), then reduce the counts to a total. The consumer writes a
// worker and a reducer; the pattern owns the board.
import { defineFlow, handler } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";
import { mapReduce } from "./map-reduce";

// The map worker: one document → its word count. A deterministic handler so the
// example runs with no model.
const countWords = handler({
  name: "count-words",
  inputSchema: taskWorkerInputSchema.extend({
    input: z.object({ text: z.string() }).optional(),
  }),
  outputSchema: z.object({ count: z.number() }),
  execute: (input) => {
    const text = input.input?.text ?? "";
    const count = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
    return { count };
  },
});

const inputSchema = z.object({ documents: z.array(z.string()) });

// Mount the pattern: plan documents into one task each, map with countWords,
// reduce the per-document counts into a total.
const wordCountBlock = mapReduce<z.infer<typeof inputSchema>, { text: string }, { total: number }>({
  name: "word-count",
  inputSchema,
  plan: (input) =>
    input.documents.map((text, i) => ({ id: `doc-${i}`, input: { text } })),
  map: countWords,
  reduce: (outputs) => ({
    total: outputs.reduce<number>(
      (sum, out) => sum + ((out as { count?: number } | undefined)?.count ?? 0),
      0,
    ),
  }),
});

export const wordCountFlow = defineFlow({
  kind: "word-count",
  requireUser: true,
  actions: {
    count: { block: wordCountBlock },
  },
  session: { stateSchema: z.object({}) },
});

export default wordCountFlow({ id: "default" });
