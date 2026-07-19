// A custom pattern: `mapReduce`.
//
// A "pattern" in flow-state is just a factory that wraps `taskBoard` into a
// reusable block. The built-in patterns (supervisor, planAndExecute,
// parallelTasks) all follow the same skeleton this one does:
//
//   seed the collection  →  drain via board.block  →  read results back out
//
// `mapReduce` fans a list of items out across a worker (the "map"), then folds
// the workers' outputs with a pure reducer (the "reduce"). A consumer supplies
// three things: how to turn the flow input into items, the map worker, and the
// reduce function. Everything else — the board, the seeding, the gather — is
// packaged here so callers never touch the substrate directly.
import { handler, sequencer, type BlockDefinition } from "@flow-state-dev/core";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { z, type ZodTypeAny } from "zod";

export interface MapReduceConfig<TInput, TItem, TResult> {
  /** Unique name — used for the board and its collection. */
  name: string;
  /** Schema of the flow input this pattern is mounted against. */
  inputSchema: ZodTypeAny;
  /** Turn the flow input into the list of items to map over. */
  plan: (input: TInput) => Array<{ id: string; input: TItem }>;
  /** The worker block that processes one item. Its output is what `reduce` sees. */
  map: BlockDefinition;
  /** Fold the completed workers' outputs into the final result. Pure. */
  reduce: (outputs: unknown[]) => TResult;
}

/**
 * Build a `mapReduce` block. Mount the returned block in a flow action like any
 * other block — the caller never sees the board.
 */
export function mapReduce<TInput, TItem, TResult>(
  config: MapReduceConfig<TInput, TItem, TResult>,
): BlockDefinition {
  const collectionId = config.name;

  const board = taskBoard({
    name: config.name,
    collection: { backing: "request", collectionId },
    concurrency: 8,
    dispatcher: "fifo",
    // One assignee, "map", staffed by the caller's worker.
    workers: { map: config.map },
    initialTasks: [],
  });

  // Seed: plan the input into items and enqueue one task each.
  const seed = handler({
    name: `${config.name}-seed`,
    inputSchema: config.inputSchema,
    outputSchema: z.object({ seeded: z.number() }),
    execute: async (input, ctx) => {
      const collection = await getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });
      const items = config.plan(input as TInput);
      for (const item of items) {
        await collection.addTask({
          id: item.id,
          goal: item.id,
          assignee: "map",
          input: item.input,
        });
      }
      return { seeded: items.length };
    },
  });

  // Gather + reduce: read the completed tasks' outputs and fold them. It reads
  // the collection through `ctx`, so it ignores whatever input it's handed.
  const reduce = handler({
    name: `${config.name}-reduce`,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    execute: async (_input, ctx) => {
      const collection = await getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });
      const outputs = collection
        .list({ status: "completed" })
        .map((task: Task) => task.output);
      return config.reduce(outputs);
    },
  });

  // The pattern is the pipeline: seed (a tap, so it passes the input through) →
  // drain the board → reduce the collected outputs.
  return sequencer({ name: config.name, inputSchema: config.inputSchema })
    .tap(seed)
    .step(board.block)
    .step(reduce);
}
