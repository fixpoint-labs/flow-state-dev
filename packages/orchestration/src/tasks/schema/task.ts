/**
 * Task schema (FIX-443 §2).
 *
 * The Task schema is the canonical work-unit shape that every dispatcher,
 * worker, and pattern in the substrate operates on. `input` and `output`
 * are validated as `unknown`; the `Task<TInput, TOutput>` runtime type
 * narrows them at the consumer's call site.
 */
import { z } from "zod";
import { taskStatusSchema, type TaskStatus } from "./task-status";

/** The base Task schema. */
export const taskSchema = z.object({
  id: z.string(),
  goal: z.string(),
  /**
   * Concise human-readable label for the task, distinct from the full
   * `goal`. Optional. Plan UIs render `title ?? goal` so the task list
   * stays scannable when `goal` is a verbose self-contained objective.
   */
  title: z.string().optional(),
  /**
   * Readable per-task support text — the slice of the originating
   * request / conversation a worker needs to act on this task. Optional.
   * Distinct from the generic typed `input` payload: `context` is prose
   * data a worker reads, not a directive. Plan-shaped patterns populate
   * it at planning time (see `@flow-state-dev/patterns` planning-entry).
   */
  context: z.string().optional(),

  status: taskStatusSchema,
  attempts: z.number().int().nonnegative().default(0),
  /**
   * Optional retry budget. When set and `attempts < maxAttempts`, a
   * call to `fail()` re-pends the task with the error captured as
   * `feedback` instead of going terminal. Default behavior (unset) is
   * single-attempt — `fail()` transitions straight to `errored`.
   */
  maxAttempts: z.number().int().positive().optional(),
  /**
   * This task's record against the collection's cumulative retry budget
   * (`maxTotalRetries`, FIX-948). Written only by `fail()`, inside the same
   * atomic write that routes the failure.
   *
   * Two facts, one field, because they are written at the same seam and are read
   * together: how many retries this task was GRANTED, and whether one was
   * REFUSED because the board's budget was spent.
   *
   * `granted` counts AUTHORIZED failure retries — incremented when `fail()`
   * re-pends the task, not when the retry is later observed at claim time. It is
   * therefore not derivable from `attempts`, which also moves for re-claims
   * after an `unblock`, a `resumeFromReview`, or a `reclaim` — none of which are
   * failure retries and none of which touch this field.
   *
   * `deniedByBudget` is what the board's `terminationReason` reads. It exists so
   * that reason can never be inferred from arithmetic: a task can consume the
   * last grant and then succeed while an unrelated task fails normally, leaving
   * the count at the limit with nothing ever refused.
   *
   * **Absent on any task persisted before FIX-948**, and on any task that has
   * never failed. Read it through one `== null` guard on the object (BP-030) —
   * absent means "no counted history": zero granted, not denied. It is
   * deliberately not backfilled from `attempts`; see the "counting begins at
   * upgrade" section in `tasks/collection/task-caps.ts`.
   */
  retryLedger: z
    .object({
      /** Failure retries this task was authorized, since the FIX-948 upgrade. */
      granted: z.number().int().nonnegative(),
      /** True once a retry was refused because the collection's budget was spent. */
      deniedByBudget: z.boolean(),
    })
    .optional(),

  assignee: z.string().optional(),
  deps: z.array(z.string()).optional(),
  priority: z.number().optional(),
  leaseUntil: z.number().optional(),

  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  feedback: z.string().optional(),

  labels: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),

  createdAt: z.number(),
  updatedAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
});

/**
 * Generic Task type. Pattern code typically narrows `TInput` / `TOutput`
 * via `Task<MyInput, MyOutput>` to surface payload types at the worker
 * boundary.
 */
export type Task<TInput = unknown, TOutput = unknown> = Omit<
  z.infer<typeof taskSchema>,
  "input" | "output"
> & {
  input?: TInput;
  output?: TOutput;
};

export type { TaskStatus };
