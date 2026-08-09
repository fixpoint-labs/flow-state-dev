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

  /**
   * Committed-write counter, bumped by **every** write that changed this task,
   * whoever made it (FIX-989).
   *
   * Declared here rather than added by the backings because a durable task is
   * validated by `taskEnvelopeSchema` on its way to the store, and a Zod object
   * schema strips keys it does not declare — an undeclared field would work
   * perfectly on the two in-memory backings and vanish on the one that
   * persists.
   *
   * **Absent on any task persisted before FIX-989**, and on any task written by
   * a hand-written `TaskCollectionRef` that maintains no provenance. Read it
   * through `didWriteLand`, which `== null`-guards it and answers "cannot tell"
   * (BP-030) — never treat an absent revision as "nothing has happened".
   */
  revision: z.number().int().optional(),
  /**
   * Bounded, newest-last log of write receipts (FIX-989).
   *
   * Appended only when a caller handed a write token in, so this is not an
   * audit trail of all activity — `task-change` events already carry that. It
   * exists so a caller whose call *threw* can find out whether its own write
   * committed, which a return value cannot tell it.
   *
   * Deliberately carries no enum and no free-form kind: a `safeParse` failure
   * on the durable path persists `{}`, so one unrecognised enum value on a
   * persisted field would wipe the task record.
   */
  writeLog: z
    .array(
      z.object({
        /** The caller's write-token id. */
        id: z.string(),
        /** The revision this write committed at. */
        revision: z.number().int(),
      })
    )
    .optional(),
  /**
   * Has `writeLog` ever dropped a receipt (FIX-989)?
   *
   * A field rather than a derivation, and that was checked rather than assumed.
   * The tempting derivation — *"the log is under the cap, so it never
   * evicted"* — is sound for a fixed cap and **unsafe the moment the cap
   * changes**: a log written under a cap of 4 that did evict still has length
   * 4, and reading it later under a cap of 8 makes `4 < 8` look like "never
   * evicted", producing a confident "did not land" for a write that landed.
   * That is the permissive direction, so one monotonic field is paid for
   * instead — and it keeps the read rule free of any cap constant.
   *
   * Written whenever `revision` is, so it is present on every record the
   * substrate wrote. Absent means legacy or a non-provenance ref.
   */
  writeLogTruncated: z.boolean().optional(),

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

/** One entry in {@link taskSchema}'s `writeLog` — a caller's write id and the revision it committed at. */
export type TaskWriteReceipt = NonNullable<
  z.infer<typeof taskSchema>["writeLog"]
>[number];

export type { TaskStatus };
