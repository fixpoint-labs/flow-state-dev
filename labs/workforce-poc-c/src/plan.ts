/**
 * The two halves of one plan, using only today's APIs.
 *
 * Prose lives on a sibling `defineResource` (`writeContent` / `readContent`).
 * Rows live on a `defineTaskCollection` drained — or just listed — by `taskBoard`.
 * The session is the plan identity. No doc store. No second planner.
 */
import { defineResource, handler } from "@flow-state-dev/core";
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
import {
  taskBoard,
  taskWorkerInputSchema,
} from "@flow-state-dev/orchestration/task-board";
import type { TaskWorker } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";

/** Spec half — resource text. State is unused; the body is content. */
export const spec = defineResource({
  scope: "session",
  stateSchema: z.object({}).default({}),
});

/** Structured half — `taskSchema` rows on a durable session ledger. */
export const tasks = defineTaskCollection({
  id: "tasks",
  scope: "session",
});

/**
 * Required by `taskBoard`. This lab never drains: add/list is the proof.
 * A worker that ran would still be this board, not a second planner.
 */
const unusedWorker = handler({
  name: "unused-worker",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ ok: z.literal(true) }),
  execute: () => ({ ok: true as const }),
}) as TaskWorker;

export const board = taskBoard({
  name: "plan",
  collection: tasks,
  concurrency: 1,
  workers: unusedWorker,
});
