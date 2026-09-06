/**
 * Shared board for lab B. The working set is a user-scoped
 * `defineTaskCollection`. Reply turns use `TaskCollectionRef.claim` —
 * the same CAS claim `taskBoard` drain uses — not a MessageBoard lock.
 *
 * `board.drain` is never called. A dummy worker exists only because
 * `taskBoard()` requires `workers`. Calling drain throws.
 */
import { handler } from "@flow-state-dev/core";
import {
  defineTaskCollection,
  type TaskWorker,
} from "@flow-state-dev/orchestration";
import {
  taskBoard,
  taskWorkerInputSchema,
} from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

/** Payload stored on each post's task `input`. */
export const postPayloadSchema = z.object({
  body: z.string(),
  addressedTo: z.string().optional(),
  needsReply: z.boolean().optional(),
});

export type PostPayload = z.infer<typeof postPayloadSchema>;

export const BOARD_NAME = "replyBoard";

/** User-scoped so every subscriber session sees one ledger. */
export const boardPosts = defineTaskCollection({
  id: "boardPosts",
  scope: "user",
  stateSchema: postPayloadSchema,
});

const drainMustNotRun = handler({
  name: "drain-must-not-run",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ ok: z.boolean() }),
  execute: () => {
    throw new Error(
      "POC lab B never drains — a wake is not a turn. Use receive + claim."
    );
  },
}) as TaskWorker;

export const replyBoard = taskBoard({
  name: BOARD_NAME,
  collection: boardPosts,
  workers: drainMustNotRun,
});
