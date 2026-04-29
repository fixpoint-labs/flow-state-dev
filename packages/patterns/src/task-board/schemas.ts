/**
 * Schemas for the Task Board pattern (FIX-446).
 *
 * `taskBoardStateSchema` is the canonical sequencer-state shape for a
 * sequencer-backed Task Board. Patterns that bring their own state record
 * — different key, additional fields — pass `stateKey` on the collection
 * spec or call `getOrCreateTaskCollection` directly.
 *
 * `taskBoardWorkerStateSchema` carries per-worker scratch — currently a
 * placeholder for forward-compatibility with metrics and reclaim hooks.
 */
import { z } from "zod";
import { taskSchema } from "@flow-state-dev/tasks";

/** Default outer-sequencer state shape: a `tasks` record under the default key. */
export const taskBoardStateSchema = z.object({
  tasks: z.record(z.string(), taskSchema).default({}),
});

export type TaskBoardState = z.infer<typeof taskBoardStateSchema>;

/** Per-worker sequencer state. Empty in v1; reserved for future worker-local scratch. */
export const taskBoardWorkerStateSchema = z.object({}).passthrough();

export type TaskBoardWorkerState = z.infer<typeof taskBoardWorkerStateSchema>;
