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
import { z, type ZodTypeAny } from "zod";
import { transientSlot } from "@flow-state-dev/core";
import { type Task } from "../tasks";

/**
 * Default outer-sequencer state shape: a `tasks` record under the default key.
 *
 * The record value is `z.unknown()` rather than `taskSchema` because deep
 * `z.record(z.string(), <complex>).default(...)` inference triggers TS's
 * "excessively deep" guard and OOMs the typecheck. The framework persists
 * Task objects through the substrate's CAS-guarded mutation helpers, which
 * already validate task shape at every transition — the schema-level
 * validation here is redundant. `TaskBoardState` is hand-declared so
 * consumers stay strongly typed.
 */
const tasksRecordSchema: ZodTypeAny = z
  .record(z.string(), z.unknown())
  .default({});

export const taskBoardStateSchema: ZodTypeAny = z.object({
  tasks: tasksRecordSchema,
});

export type TaskBoardState = { tasks: Record<string, Task> };

/**
 * Per-worker (outer) sequencer state.
 *
 * `lastClaimed`: was the most recent `claimTask` successful? Set by
 * `claimTask`, consumed by `checkBoard` to gate the idle-sleep path.
 * Marked `transientSlot` because the value is purely a worker-local
 * scratch flag — clients have no use for it, and emitting a patch on
 * every idle poll dominates the SSE stream when many workers are idle
 * (FIX-477).
 *
 * The currently-claimed task id lives one level deeper, on the
 * worker-body sequencer's state (`taskBoardWorkerBodyStateSchema`),
 * because `recordSuccess` and `recordError` run inside the body's
 * `.rescue()` scope and need their own state container they can read
 * directly via `ctx.sequencer`.
 */
export const taskBoardWorkerStateSchema = z.object({
  lastClaimed: transientSlot(z.boolean().default(false)),
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
 *
 * `currentAttempt`: the claimed task's `attempts` at claim time, stamped
 * by the same `.tap()` (FIX-951). Both recorders pass it as
 * `expectAttempt` so their write-back declines if the attempt was
 * displaced while the worker ran — a lease reclaim followed by another
 * worker claiming the task makes the stale write-back a *legal*
 * transition onto someone else's live attempt. Optional so a body state
 * checkpointed before this field existed still runs: the guard is simply
 * not applied, leaving the pre-FIX-951 behaviour for that one iteration.
 */
export const taskBoardWorkerBodyStateSchema = z.object({
  currentTaskId: transientSlot(z.string().optional()),
  currentAttempt: transientSlot(z.number().optional()),
});

export type TaskBoardWorkerBodyState = z.infer<
  typeof taskBoardWorkerBodyStateSchema
>;

/**
 * Output of `claimTask`. Workers branch on `claimed`: when true, the
 * pipeline runs the worker and records a result; when false, the
 * pipeline skips straight to `checkBoard` (which idle-sleeps or
 * exits).
 *
 * `task` is `z.unknown()` (the runtime instance is a `Task`) for the
 * same depth-instantiation reason as `tasksRecordSchema` — embedding
 * the deep `taskSchema` here would re-explode TS inference. The
 * substrate's CAS path already validates the `Task` shape at every
 * mutation, so this loses no integrity.
 */
export const claimResultSchema = z.object({
  claimed: z.boolean(),
  task: z.unknown().optional(),
});

export type ClaimResult = {
  claimed: boolean;
  task?: Task;
};

/**
 * Worker input shape — mirrors the substrate's `TaskWorkerInput`
 * structurally. Defined as a Zod schema here (instead of a bare TS
 * type) so the pattern's worker-router can declare it as `inputSchema`
 * and have the framework validate every dispatch.
 */
export const taskWorkerInputSchema = z.object({
  taskId: z.string(),
  goal: z.string(),
  title: z.string().optional(),
  context: z.string().optional(),
  input: z.unknown().optional(),
  attempts: z.number().int().nonnegative(),
  feedback: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  deps: z.record(z.unknown()).optional(),
});

/** Output of `checkBoard` — drives the worker's `loopBack` predicate. */
export const checkBoardOutputSchema = z.object({
  shouldContinue: z.boolean(),
  reason: z.enum(["drained", "exit", "claimed", "idle", "blocked"]),
});

export type CheckBoardOutput = z.infer<typeof checkBoardOutputSchema>;
