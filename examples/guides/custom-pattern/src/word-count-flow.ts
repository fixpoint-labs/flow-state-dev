// A flow that USES the custom `planMapReduce` pattern, to show a consumer's side.
//
// The job: count words across a set of documents. A plan block turns the input
// into one item per document, the map worker counts each, and the reducer sums
// the counts. The consumer writes three blocks + a fold; the pattern owns the
// board.
import { defineFlow, handler } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";
import { planMapReduce, planOutputSchema } from "./plan-map-reduce";

const inputSchema = z.object({ documents: z.array(z.string()) });

// The plan block: flow input → the items to map over. A deterministic handler
// here so the example runs with no key. In practice this is often a
// `generator` that decides the work — e.g. splits a task into subtasks.
const planDocuments = handler({
  name: "plan-documents",
  inputSchema,
  outputSchema: planOutputSchema,
  execute: (input) => ({
    items: input.documents.map((text, i) => ({ id: `doc-${i}`, input: { text } })),
  }),
});

// The map worker: one document → its word count.
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

// Mount the pattern: plan → map with countWords → reduce the counts to a total.
const wordCountBlock = planMapReduce<{ total: number }>({
  name: "word-count",
  inputSchema,
  plan: planDocuments,
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
