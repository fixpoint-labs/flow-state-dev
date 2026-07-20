// A custom pattern: `planMapReduce`.
//
// A "pattern" in flow-state is just a factory that wraps `taskBoard` into a
// reusable block. The built-in patterns (supervisor, planAndExecute,
// parallelTasks) all follow the same skeleton:
//
//   plan the work  →  seed the collection  →  drain via board.drain  →  reduce
//
// The important design choice: `plan` is a **block**, not a plain function.
// Real planning usually calls a model — a generator that looks at the input and
// decides the tasks — so the pattern takes a plan *block* whose output is the
// list of items to map over. (In this example the plan block is a deterministic
// handler so the tests need no key; swap it for a generator for real work.)
import { handler, sequencer, type BlockDefinition } from "@flow-state-dev/core";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { z, type ZodTypeAny } from "zod";

/** The shape a `plan` block must output: the items to map over. */
export const planOutputSchema = z.object({
  items: z.array(z.object({ id: z.string(), input: z.unknown() })),
});

export interface PlanMapReduceConfig<TResult> {
  /** Unique name — used for the board and its collection. */
  name: string;
  /** Schema of the flow input this pattern is mounted against. */
  inputSchema: ZodTypeAny;
  /**
   * A block (usually a generator) that turns the flow input into the items to
   * map over. Its output must match `planOutputSchema`: `{ items: [{ id, input }] }`.
   */
  plan: BlockDefinition;
  /** The worker block that processes one item. Its output is what `reduce` sees. */
  map: BlockDefinition;
  /** Fold the completed workers' outputs into the final result. Pure. */
  reduce: (outputs: unknown[]) => TResult;
}

/**
 * Build a `planMapReduce` block. Mount the returned block in a flow action like
 * any other block — the caller never sees the board.
 */
export function planMapReduce<TResult>(
  config: PlanMapReduceConfig<TResult>,
): BlockDefinition {
  const collectionId = config.name;

  const board = taskBoard({
    name: config.name,
    collection: { collectionId },
    concurrency: 8,
    dispatcher: "fifo",
    // One assignee, "map", staffed by the caller's worker.
    workers: { map: config.map },
    initialTasks: [],
  });

  // Seed: consume the plan block's `{ items }` output and enqueue one task each.
  const seed = handler({
    name: `${config.name}-seed`,
    inputSchema: planOutputSchema,
    outputSchema: z.object({ seeded: z.number() }),
    execute: async (input, ctx) => {
      const collection = await getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });
      for (const item of input.items) {
        await collection.addTask({
          id: item.id,
          goal: item.id,
          assignee: "map",
          input: item.input,
        });
      }
      return { seeded: input.items.length };
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

  // The pattern is the pipeline: plan (input → items) → seed → drain → reduce.
  return sequencer({ name: config.name, inputSchema: config.inputSchema })
    .step(config.plan)
    .step(seed)
    .step(board.drain)
    .step(reduce);
}
