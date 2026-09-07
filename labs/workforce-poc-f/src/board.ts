/**
 * Shared intake board. User-scoped so the intake worker and member
 * workers see one ledger. The inbox is still one session; this board
 * is the working set. Do not merge the two jobs.
 *
 * `board.drain` is never called. A dummy worker exists only because
 * `taskBoard()` requires `workers`.
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

export const routePayloadSchema = z.object({
  body: z.string(),
  route: z.enum(["claim", "ordered", "fan-out"]),
  roster: z.string(),
  seat: z.string().optional(),
});

export type RoutePayload = z.infer<typeof routePayloadSchema>;

export const BOARD_NAME = "intakeBoard";

export const intakeRoutes = defineTaskCollection({
  id: "intakeRoutes",
  scope: "user",
  stateSchema: routePayloadSchema,
});

const drainMustNotRun = handler({
  name: "drain-must-not-run",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ ok: z.boolean() }),
  execute: () => {
    throw new Error(
      "POC lab F never drains — intake files tasks; members pick them up.",
    );
  },
}) as TaskWorker;

export const intakeBoard = taskBoard({
  name: BOARD_NAME,
  collection: intakeRoutes,
  workers: drainMustNotRun,
});
