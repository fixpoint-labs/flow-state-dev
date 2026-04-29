/**
 * Schemas for the Task Board pattern (FIX-446).
 *
 * Every schema here is a concrete Zod object — no `z.any()` escape
 * hatches. The pattern's blocks consume each other through these
 * schemas (claim → worker → record → check) so the framework's input
 * validation runs at every step boundary.
 *
 * `taskBoardStateSchema` is the canonical sequencer-state shape for a
 * sequencer-backed Task Board. Patterns that bring their own state
 * record — different key, additional fields — pass `stateKey` on the
 * collection spec or call `getOrCreateTaskCollection` directly.
 *
 * `taskBoardWorkerStateSchema` carries per-worker scratch: the id of
 * the task currently being processed and a `lastClaimed` flag the
 * checker reads to decide whether to idle-sleep. Each worker has its
 * own state container, so two workers can never collide on
 * `currentTaskId`.
 */
import { z } from "zod";
import { taskSchema } from "@flow-state-dev/tasks";

/** Default outer-sequencer state shape: a `tasks` record under the default key. */
export const taskBoardStateSchema = z.object({
  tasks: z.record(z.string(), taskSchema).default({}),
});

export type TaskBoardState = z.infer<typeof taskBoardStateSchema>;

/**
 * Per-worker (outer) sequencer state.
 *
 * `lastClaimed`: was the most recent `claimTask` successful? Set by
 * `claimTask`, consumed by `checkBoard` to gate the idle-sleep path.
 *
 * The currently-claimed task id lives one level deeper, on the
 * worker-body sequencer's state (`taskBoardWorkerBodyStateSchema`),
 * because `recordSuccess` and `recordError` run inside the body's
 * `.rescue()` scope and need their own state container they can read
 * directly via `ctx.sequencer`.
 */
export const taskBoardWorkerStateSchema = z.object({
  lastClaimed: z.boolean().default(false),
});

export type TaskBoardWorkerState = z.infer<typeof taskBoardWorkerStateSchema>;

/**
 * Worker-body sequencer state.
 *
 * `currentTaskId`: set by the worker-body's leading `.tap()` step
 * (which receives the claimed `Task`), consumed by `recordSuccess`
 * (success path) and `recordError` (rescue path). Per-instance — each
 * iteration of the worker loop creates a fresh body invocation, so
 * stale values from a previous iteration cannot leak in.
 */
export const taskBoardWorkerBodyStateSchema = z.object({
  currentTaskId: z.string().optional(),
});

export type TaskBoardWorkerBodyState = z.infer<
  typeof taskBoardWorkerBodyStateSchema
>;

/**
 * Output of `claimTask`. Workers branch on `claimed`: when true, the
 * pipeline runs the worker and records a result; when false, the
 * pipeline skips straight to `checkBoard` (which idle-sleeps or
 * exits).
 */
export const claimResultSchema = z.object({
  claimed: z.boolean(),
  task: taskSchema.optional(),
});

export type ClaimResult = z.infer<typeof claimResultSchema>;

/**
 * Worker input shape — mirrors the substrate's `TaskWorkerInput`
 * structurally. Defined as a Zod schema here (instead of a bare TS
 * type) so the pattern's worker-router can declare it as `inputSchema`
 * and have the framework validate every dispatch.
 */
export const taskWorkerInputSchema = z.object({
  taskId: z.string(),
  goal: z.string(),
  input: z.unknown().optional(),
  attempts: z.number().int().nonnegative(),
  feedback: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  deps: z.record(z.unknown()).optional(),
});

/** Output of `checkBoard` — drives the worker's `loopBack` predicate. */
export const checkBoardOutputSchema = z.object({
  shouldContinue: z.boolean(),
  reason: z.enum(["drained", "exit", "claimed", "idle"]),
});

export type CheckBoardOutput = z.infer<typeof checkBoardOutputSchema>;
