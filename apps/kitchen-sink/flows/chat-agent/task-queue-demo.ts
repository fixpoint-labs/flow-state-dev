/**
 * Task-queue demo — chat-agent action.
 *
 * Demonstrates serial task dispatch with mid-run enqueue using `taskBoard` +
 * `fifoDispatcher`. The substrate replaces the retired `eventQueue` pattern;
 * the chain shape (SEARCH → ANALYZE → maybe EXTRACT → done) is unchanged.
 *
 * Each handler enqueues follow-up tasks by resolving the same request-scoped
 * collection via `getOrCreateTaskCollection` and calling `addTask`. Workers
 * are routed by `task.assignee`.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";

const COLLECTION_ID = "task-queue-demo";

// ---------------------------------------------------------------------------
// Per-step input shapes (carried on `task.input`)
// ---------------------------------------------------------------------------

const searchInputSchema = z.object({ query: z.string() });
const analyzeInputSchema = z.object({ data: z.string() });
const extractInputSchema = z.object({
  source: z.string(),
  fields: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Handlers — receive `TaskWorkerInput`, enqueue follow-ups via the collection
// ---------------------------------------------------------------------------

function getCollection(ctx: BlockContext) {
  return getOrCreateTaskCollection({
    ctx,
    backing: "request",
    collectionId: COLLECTION_ID,
  });
}

const handleSearch = handler({
  name: "handle-search",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ found: z.string() }),
  execute: async (input, ctx) => {
    const { query } = searchInputSchema.parse(input.input);
    const found = `Search results for "${query}": [doc-1, doc-2, doc-3]`;

    const collection = await getCollection(ctx as unknown as BlockContext);
    await collection.addTask({
      goal: `analyze: ${query}`,
      assignee: "ANALYZE",
      input: { data: found },
    });

    ctx.emit.status(`Searched for: ${query}`);
    return { found };
  },
});

const handleAnalyze = handler({
  name: "handle-analyze",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ analysis: z.string() }),
  execute: async (input, ctx) => {
    const { data } = analyzeInputSchema.parse(input.input);
    const hasStructuredData = data.includes("doc-");
    const analysis = `Analyzed: ${data.slice(0, 60)}`;

    if (hasStructuredData) {
      const collection = await getCollection(ctx as unknown as BlockContext);
      await collection.addTask({
        goal: "extract fields",
        assignee: "EXTRACT",
        input: { source: data, fields: ["title", "author", "date"] },
      });
    }

    ctx.emit.status(`Analyzed data (${hasStructuredData ? "structured" : "unstructured"})`);
    return { analysis };
  },
});

const handleExtract = handler({
  name: "handle-extract",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ extracted: z.record(z.string()) }),
  execute: async (input, ctx) => {
    const { fields } = extractInputSchema.parse(input.input);
    const extracted: Record<string, string> = {};
    for (const field of fields) {
      extracted[field] = `<${field} from source>`;
    }
    ctx.emit.status(`Extracted ${fields.length} fields`);
    return { extracted };
  },
});

// ---------------------------------------------------------------------------
// Action block
// ---------------------------------------------------------------------------

export const taskQueueDemoInputSchema = z.object({
  query: z.string().default("flow-state patterns"),
});

const board = taskBoard({
  name: "task-queue-demo",
  collection: { collectionId: COLLECTION_ID },
  // Cast: TaskWorkerRegistry expects TaskWorker<unknown, unknown>; our
  // handlers are typed-narrower (z.object outputs). The taskBoard
  // pipeline only reads task.input/output as `unknown`, so the runtime
  // contract is satisfied.
  workers: {
    SEARCH: handleSearch,
    ANALYZE: handleAnalyze,
    EXTRACT: handleExtract,
  } as Record<string, any>,
  concurrency: 1,
  dispatcher: "fifo",
  onIdle: "complete",
  initialTasks: [
    {
      goal: "search initial query",
      assignee: "SEARCH",
      input: { query: "flow-state patterns" },
    },
  ],
  maxIterations: 20,
});

export const taskQueueDemo = board.drain;
