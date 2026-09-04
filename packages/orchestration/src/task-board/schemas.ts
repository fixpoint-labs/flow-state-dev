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
 * `taskBoardWorkerStateSchema` carries per-worker scratch: a `lastClaimed`
 * flag the checker reads to decide whether to idle-sleep. The claim itself
 * lives one level deeper, on the worker-body state. Each worker has its own
 * state container, so two workers can never collide on either.
 */
import { z, type ZodTypeAny } from "zod";
import { transientSlot } from "@flow-state-dev/core";
import { taskClaimTicketSchema, type Task } from "../tasks";

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
 * The currently-held claim lives one level deeper, on the
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
 * `currentClaim`: the ticket for the task this worker holds — board, task,
 * attempt, and the task's `createdAt` — stamped by the worker-body's leading
 * `.tap()` step (which receives the claimed `Task`) and consumed by
 * `recordSuccess` (success path) and `recordError` (rescue path). Per-instance:
 * each iteration of the worker loop creates a fresh body invocation, so stale
 * values from a previous iteration cannot leak in.
 *
 * Both recorders present it as `claim` so their write-back declines if the
 * attempt was displaced while the worker ran — a lease reclaim followed by
 * another worker claiming the task makes the stale write-back a *legal*
 * transition onto someone else's live attempt — and so a write can only ever
 * land on the task this worker actually claimed.
 *
 * It replaced the separate `currentTaskId` / `currentAttempt` slots in FIX-981;
 * one ticket carries what two loose fields used to, and the target it is valid
 * for travels with it rather than being supplied by the call site. BP-030
 * consequence, for the narrow case of a body state checkpointed under the old
 * shape and resumed under this one: `currentClaim` reads absent, so the
 * recorders write nothing and the task is recovered by the ordinary lease
 * reclaim. That is the containment-safe direction — the alternative is a
 * write-back that cannot prove which task it owns, which is the defect.
 */
export const taskBoardWorkerBodyStateSchema = z.object({
  currentClaim: transientSlot(taskClaimTicketSchema.optional()),
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
 * Worker input shape. Owned next to `TaskWorkerInput` in
 * `../tasks/workers/types.ts` (one object, type inferred) and
 * re-exported here so existing `@flow-state-dev/orchestration/task-board`
 * imports stay put.
 */
export { taskWorkerInputSchema } from "../tasks/workers/types";

/**
 * Output of `checkBoard` — drives the worker's `loopBack` predicate, and
 * carries the exit decision's causal verdict out to the board's completion
 * item.
 *
 * `excusedParked` (FIX-1234) is present, and `true`, only on the iteration
 * where this worker stopped *because* rows parked for a human were excused
 * from the board's waitable count. It is the exit reason's carrier, and it
 * rides the worker's own output for one reason: the value flows from the exit
 * decision to the completion item through the drain's own dataflow — the
 * worker loop's final value becomes an element of the `forEach` result, which
 * is what the completion tap receives — so it is scoped to this drain
 * *invocation* by construction rather than by a policy someone has to keep.
 * Two drains of one board, even inside one request, cannot see each other's.
 *
 * Optional rather than defaulted so a board on the default `onReview` emits
 * exactly the output shape it always did (BP-030), and so a worker-state
 * checkpoint written under the old shape reads as "nothing was excused"
 * instead of failing validation.
 */
export const checkBoardOutputSchema = z.object({
  shouldContinue: z.boolean(),
  reason: z.enum(["drained", "exit", "claimed", "idle", "blocked"]),
  excusedParked: z.boolean().optional(),
});

export type CheckBoardOutput = z.infer<typeof checkBoardOutputSchema>;
