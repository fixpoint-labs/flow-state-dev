// Board lifecycle, made observable.
//
// A `taskBoard` gives you two separable things:
//   1. a task COLLECTION — durable state whose lifetime is set by the backing
//      (here `request`, so it survives every block boundary in one request);
//   2. `board.block` — the DRAIN, which claims pending tasks, runs workers, and
//      moves tasks pending → completed. The drain only happens while this block
//      executes inside a request.
//
// The two actions below seed the SAME collection identically. The only
// difference is whether `board.block` runs:
//   - seedAndInspect: seed, then read without draining → tasks are "pending".
//   - seedDrainRead:  seed, run board.block, then read → tasks are "completed".
//
// That contrast is the whole lesson: a collection can hold tasks, but nothing
// processes them until a drain runs over it.
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { processor } from "./workers";

const COLLECTION_ID = "queue";

const inputSchema = z.object({
  items: z.array(z.string()).min(1),
});

// Block A — seeds the request-backed collection. It resolves the collection by
// id (it did NOT create it) and adds one task per item. `.tap` runs it for its
// state mutation and passes the original input through to the next step.
const seedTasks = handler({
  name: "seed-tasks",
  inputSchema,
  outputSchema: z.object({ seeded: z.number() }),
  execute: async (input, ctx) => {
    const collection = await getOrCreateTaskCollection({
      ctx,
      backing: "request",
      collectionId: COLLECTION_ID,
    });
    for (const [i, text] of input.items.entries()) {
      await collection.addTask({
        id: `task-${i}`,
        goal: `process ${text}`,
        assignee: "processor",
        input: { text },
      });
    }
    return { seeded: input.items.length };
  },
});

// Block C — reads the SAME collection back. Any block in the request can resolve
// it by id; here we report each task's id, status, and (if it ran) its result.
const readResults = handler({
  name: "read-results",
  inputSchema: z.unknown(),
  outputSchema: z.object({
    tasks: z.array(
      z.object({
        id: z.string(),
        status: z.string(),
        result: z.string().nullable(),
      }),
    ),
  }),
  execute: async (_input, ctx) => {
    const collection = await getOrCreateTaskCollection({
      ctx,
      backing: "request",
      collectionId: COLLECTION_ID,
    });
    const tasks = collection.list().map((task: Task) => ({
      id: task.id,
      status: task.status,
      result: (task.output as { result?: string } | undefined)?.result ?? null,
    }));
    return { tasks };
  },
});

// The board: request-backed, same collectionId as the blocks above, and NO
// initialTasks — it drains whatever the seed block put in the collection.
const board = taskBoard({
  name: "queue-board",
  collection: { backing: "request", collectionId: COLLECTION_ID },
  concurrency: 4,
  dispatcher: "fifo",
  workers: { processor },
  initialTasks: [],
});

// seedAndInspect — seed, then read. No drain runs, so tasks stay "pending".
const seedAndInspect = sequencer({ name: "seed-and-inspect", inputSchema })
  .tap(seedTasks)
  .step(readResults);

// seedDrainRead — seed, drain via board.block, then read. Now tasks are
// "completed" and carry their worker output.
const seedDrainRead = sequencer({ name: "seed-drain-read", inputSchema })
  .tap(seedTasks)
  .step(board.block)
  .step(readResults);

export const boardLifecycleFlow = defineFlow({
  kind: "board-lifecycle",
  requireUser: true,
  actions: {
    seedAndInspect: { block: seedAndInspect },
    seedDrainRead: { block: seedDrainRead },
  },
  session: { stateSchema: z.object({}) },
});

export default boardLifecycleFlow({ id: "default" });
