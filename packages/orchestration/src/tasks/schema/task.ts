// FIX-443 §2.
/**
 * Task schema.
 *
 * The Task schema is the canonical work-unit shape that every claim order,
 * worker, and pattern in the substrate operates on. `input` and `output`
 * are validated as `unknown`; the `Task<TInput, TOutput>` runtime type
 * narrows them at the consumer's call site.
 */
import { z } from "zod";
import { persistedTaskStatusSchema, type TaskStatus } from "./task-status";
import { taskSteerSchema } from "./steer";
import { taskHoldSchema } from "./hold";
import { taskSpendSchema } from "./spend";

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

  // Decoded from a stored row, so it tolerates the pre-FIX-1245 member.
  status: persistedTaskStatusSchema,
  attempts: z.number().int().nonnegative().default(0),
  /**
   * Optional retry budget. When set and `attempts < maxAttempts`, a
   * call to `fail()` re-pends the task with the error captured as
   * `feedback` instead of going terminal. Default behavior (unset) is
   * single-attempt — `fail()` transitions straight to `errored`.
   */
  maxAttempts: z.number().int().positive().optional(),
  // FIX-948; BP-030.
  /**
   * This task's record against the collection's cumulative retry budget
   * (`maxTotalRetries`). Written only by `fail()`, inside the same
   * atomic write that routes the failure.
   *
   * Two facts, one field, because they are written at the same seam and are read
   * together: how many retries this task was GRANTED, and whether one was
   * REFUSED because the board's budget was spent.
   *
   * `granted` counts AUTHORIZED failure retries — incremented when `fail()`
   * re-pends the task, not when the retry is later observed at claim time. It is
   * therefore not derivable from `attempts`, which also moves for re-claims
   * after an `unblock` or a `reclaim` — none of which are
   * failure retries and none of which touch this field.
   *
   * `deniedByBudget` is what the board's `terminationReason` reads. It exists so
   * that reason can never be inferred from arithmetic: a task can consume the
   * last grant and then succeed while an unrelated task fails normally, leaving
   * the count at the limit with nothing ever refused.
   *
   * **Absent on any task persisted by an older version**, and on any task that has
   * never failed. Read it through one `== null` guard on the object —
   * absent means "no counted history": zero granted, not denied. It is
   * deliberately not backfilled from `attempts`; see the "counting begins at
   * upgrade" section in `tasks/collection/task-caps.ts`.
   */
  retryLedger: z
    .object({
      // FIX-948.
      /** Failure retries this task was authorized, since the upgrade. */
      granted: z.number().int().nonnegative(),
      /** True once a retry was refused because the collection's budget was spent. */
      deniedByBudget: z.boolean(),
    })
    .optional(),

  // FIX-1005; BP-031; BP-030.
  /**
   * How many times this task's work was abandoned — claimed by a worker that
   * then stopped renewing its lease — and handed back out.
   *
   * **Its own budget, deliberately separate from `maxAttempts`.** Recovery
   * runs through `claim`, which advances `attempts`, so without this counter a
   * crashed machine would spend the retries a caller configured for real
   * failures: with `maxAttempts: 3` two crashes would exhaust the whole
   * failure budget without a single failure, and a task with no `maxAttempts`
   * — the default — would get zero recoveries. `shouldRetryOnFail` therefore
   * reads `attempts - abandonments < maxAttempts`, discounting them.
   *
   * Incremented in the same atomic write that recovers a lapsed row, and read
   * in that same write to decide whether to recover it at all or settle it
   * `errored`.
   *
   * **Top level, never inside `metadata`.** `patchMetadata` merges
   * arbitrary caller keys with a plain spread and is exposed to a model
   * through `updateTask`, so a counter living there could be reset (unbounded
   * recovery) or inflated (a live task terminalized early) from
   * caller-controllable input — and this counter drives a terminal settlement.
   * The typed write surface reaches no top-level field, so this placement
   * needs no per-seam guard.
   *
   * **Absent reads as zero** — a task persisted by an older version, one
   * that has never been abandoned, or one whose counter an older writer
   * normalized away. That direction is deliberate: a stripped counter costs
   * *recovery bounding*, which is in policy, while the opposite reading would
   * withhold recovery, which is the bug this exists to fix.
   */
  abandonments: z.number().int().nonnegative().optional(),

  // FIX-2086; BP-030.
  /**
   * Words sent into this task while it was open: `updateTask`'s
   * `message`, or a line typed in its session. Server-written by the
   * collection's `steer`, append-only, at most `MAX_STEERS`; never patched. Each
   * names its sender and the attempt that took it (`../steers`). Every later
   * attempt reads every steer, and a finished task takes none. **Absent** on
   * a task never steered.
   */
  steers: z.array(taskSteerSchema).optional(),

  // FIX-1817; BP-030.
  /**
   * The finished task this one follows up: its root, never another
   * follow-up, so a chain of follow-ups names one task. A follow-up runs in
   * that task's session, with its worker. Written once, by the add that files
   * it, after the add checked it in the same partition; never patched.
   * **Absent** on every task that is not a follow-up.
   */
  followUpOf: z.string().optional(),

  // FIX-2081; BP-030.
  /**
   * The task whose request filed this one: a piece of that task,
   * or a step it planned. Server-written at filing from the filer's own
   * claim or session, never from input, and never patched. `listTasks`
   * filters by it (`filedByTask`). **Absent** on a task filed by no task: a
   * conversation's turn, a screen, a schedule.
   */
  filedByTask: z.string().optional(),

  // FIX-2080; BP-030.
  /**
   * Where the task runs (a filing setting): `"new"`, a session of
   * its own (the default for a delegated task), or `"ongoing"`, the
   * delegate's session for this conversation. A follow-up runs in its root's
   * session and takes none. Chosen at filing, refused there by a board that
   * can't honour it, and never changed. **Absent reads as `"new"`**.
   */
  session: z.enum(["new", "ongoing"]).optional(),

  // FIX-2080; BP-030.
  /**
   * Who hears the task's result (a filing setting): `"filer"`, the
   * one that filed it (the default), or `"conversation"`, the conversation
   * it was filed from. A conversation-result task has one attempt. Chosen at
   * filing and never changed. **Absent reads as `"filer"`**.
   */
  resultTo: z.enum(["filer", "conversation"]).optional(),

  // FIX-2083.
  /**
   * The workstream record the task goes to (a filing setting): the
   * target of a delegate record whose worker leads that workstream. Chosen at
   * filing, refused there by a filer with no such record, and never changed.
   * **Absent** on every task filed for a delegate record with no target.
   */
  target: z.string().optional(),

  // FIX-2083; BP-031; BP-030.
  /**
   * The session `target` resolved to when the task was filed: the
   * workstream's session, where a task filed `session: "ongoing"` runs.
   * Server-written by the filing, top level beside `session` so no
   * caller-writable surface reaches it, and never patched.
   * **Absent** on a task with no `target`.
   */
  targetSessionId: z.string().optional(),

  assignee: z.string().optional(),
  deps: z.array(z.string()).optional(),
  priority: z.number().optional(),
  leaseUntil: z.number().optional(),
  // FIX-1305; BP-030.
  /**
   * The lease duration the current claim committed to, in milliseconds.
   * Written by `applyClaimToTask` from the duration the claim was
   * made with, and read back by `committedLeaseSpan`.
   *
   * **Stored rather than re-derived, because `leaseUntil - updatedAt` is not
   * the same number for long.** That subtraction is exact at the instant of
   * the claim — both stamps come from one clock read inside the claim write —
   * and it decays with every other write to the row: `setPriority`,
   * `addLabel`, `removeLabel` and `patchMetadata` are all supported on an
   * `in_progress` task and all advance `updatedAt` while leaving `leaseUntil`
   * alone. Two consumers read the span (the renewal driver's cadence, and the
   * claim gate taking a lapsed row back), and under the derivation a
   * coordinator relabelling a running task would silently shorten one and
   * refuse the other.
   *
   * **Absent on any task persisted by an older version**, and on any task never
   * claimed. Read it through {@link committedLeaseSpan}, which falls back to
   * the old subtraction rather than treating absence as "no lease".
   *
   * Server-set, like `leaseUntil` and `claimedBy`: it is absent from
   * `TaskInit`, so no caller and no model writes it.
   */
  leaseDurationMs: z.number().optional(),

  // FIX-1005; BP-030.
  /**
   * Where the current attempt is running — the execution coordinate the
   * substrate stamps inside the claim write. A fact ("attempt N ran
   * here"), never policy ("work should run here"). Written only by
   * `applyClaimToTask` and cleared wherever the claim ends; absent from
   * `TaskInit`, so no caller and no model ever writes it.
   *
   * Distinct from **both** of the other "who has this" fields, which is the
   * thing to keep straight when reading a claim:
   * - `assignee` is the user-set worker-registry routing key, which `reclaim`
   *   preserves on purpose. It says where work *should* run.
   * - `claim(workerId)`'s argument is trace attribution — a label. It is not
   *   stored here. `claimedBy` is the execution coordinate, so the name says
   *   *by whom* while the value says *where*.
   *
   * **Server-only, never sent to a client.** See `SERVER_ONLY_TASK_FIELDS` in
   * `collection/change-event.ts`, canonical for the redaction and its shape.
   *
   * **Absent on any task persisted by an older version**, on any task never
   * claimed, and on any row an older writer normalized. Read it through one
   * `== null` guard; the next claim re-stamps it.
   */
  claimedBy: z
    .object({
      /** Session the claiming execution ran under (`ctx.session.identity.id`). */
      sessionId: z.string(),
      /** Request that performed the claim (`ctx.request.identity.id`). */
      requestId: z.string(),
      /** Tenant the claim ran under, when the deployment is multi-tenant. */
      tenantId: z.string().optional(),
    })
    .optional(),

  // FIX-1668; BP-030.
  /**
   * Which run is working this task, or last worked it — the
   * session a dispatched attempt executes in, that attempt's request there,
   * and the attempt number.
   *
   * **Written from inside the run.** The board's claim gate writes it in the
   * run's own session, through the claim-fenced `linkRun`, before the worker's
   * first step. Only the run knows for certain which session it landed in:
   * that depends on the assignee's session policy and on the conversation that
   * drained the board, so nothing outside can rebuild it. Distinct from
   * `claimedBy`, which on a dispatched row names the *claiming* conversation.
   *
   * **Lifetime: until the next claim.** `applyClaimToTask` clears it in the
   * same write that advances `attempts`; settlement, retry and abandonment
   * leave it alone, so a finished or failed task still names the run that last
   * worked it. It says *which* run, not *whether* work is live — read
   * `status` and the run's request for that.
   *
   * **Client-visible**, unlike `claimedBy`: a UI opens the run from it. The
   * ids grant nothing; opening the session still passes the server's owner
   * check. The run's flow is not here: read it off the session (`flowId`),
   * since an assignee may dispatch to another flow than the board's.
   *
   * Server-set: absent from `TaskInit` and every patch surface. **Absent on
   * rows stored before this shipped, on inline boards, and between a claim and
   * its run's start** — one `== null` guard, nothing inferred.
   */
  run: z
    .object({
      /** The session the run executes in (`ctx.session.identity.id` inside the run). */
      sessionId: z.string(),
      /** This attempt's request in that session (`ctx.request.identity.id`). */
      requestId: z.string(),
      /** The attempt that started the run — equal to `attempts` while it is the latest. */
      attempt: z.number().int().nonnegative(),
      // FIX-2077; BP-030.
      /**
       * When this attempt's first run started, in ms: what "during
       * this attempt" is measured from. A resume or a lapsed lease taken back
       * relinks the same attempt and keeps it. **Absent** on links written
       * before it was.
       */
      startedAt: z.number().optional(),
    })
    .optional(),

  // FIX-2288; BP-030.
  /**
   * What the task's runs spent: per request admitted for the task,
   * the spend its endings settled and what it has spent so far while it runs,
   * with the harness and model it last reported. Read it folded, through
   * `taskSpendView`: model, harness and tokens.
   *
   * **Written from inside the run**, as `run` is: the request admitted for the
   * task writes its live spend every few seconds while it changes and settles
   * it at each ending, through the identity-fenced `recordSpend`, so a failed
   * attempt's tokens land after its row settled. Never model-writable, absent
   * from `TaskInit` and every patch surface. **Client-visible** through the
   * board's `listTasks` action, and kept out of its model-facing tool. Kept
   * across attempts: a retry adds to it.
   *
   * **Absent** on rows stored before it, and on a task that never ran in a
   * request of its own: one `== null` guard.
   */
  spend: taskSpendSchema.nullable().optional(),

  input: z.unknown().optional(),
  output: z.unknown().optional(),
  // FIX-2081; BP-030.
  /**
   * `output` is a checkpoint its worker reported while it ran (`reportProgress`), not a result handed back at the end. The latest
   * checkpoint is the task's output: completing the task keeps it, and the
   * worker's final result is written only when no checkpoint was made. A
   * failed attempt or a reclaimed lease keeps it. **Absent** when the worker
   * never checkpointed.
   */
  checkpointed: z.literal(true).optional(),
  // FIX-2081.
  /**
   * The one-line note its worker last reported while it ran (`reportProgress`), for task views. Never the task's status: done still
   * follows the worker's return. **Absent** until one is reported.
   */
  statusNote: z.string().optional(),
  // FIX-2081; BP-031.
  /**
   * How the cancel that ended this task was made: `"tool"`, its
   * filer's model calling `updateTask` in its own turn, or `"action"`, a
   * public `updateTask_<board>` action. Written by the cancel from how the
   * caller was built, never from input. **Absent** on a cancel that
   * named no source: a cascade, a substrate write-back, an older row.
   */
  cancelledVia: z.enum(["tool", "action"]).optional(),
  // FIX-2080, BP-030; FIX-2081.
  /**
   * The row was stored `blocked` and read as `held`. Set
   * only at the read boundary, and persisted with the row when it is next
   * written; a release clears it. Such a row may have started before it was
   * blocked, and a release alone is how it runs again; no current path holds
   * a row that has started.
   */
  heldFromBlocked: z.literal(true).optional(),
  error: z.string().optional(),
  feedback: z.string().optional(),

  labels: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),

  // FIX-989; BP-030.
  /**
   * Committed-write counter, bumped by **every** write that changed this task,
   * whoever made it.
   *
   * Declared here rather than added by the backings because a durable task is
   * validated by `taskEnvelopeSchema` on its way to the store, and a Zod object
   * schema strips keys it does not declare — an undeclared field would work
   * perfectly on the two in-memory backings and vanish on the one that
   * persists.
   *
   * **Absent on any task persisted by an older version**, and on any task written by
   * a hand-written `TaskCollectionRef` that maintains no provenance. Read it
   * through `didWriteLand`, which `== null`-guards it and answers "cannot tell"
   * — never treat an absent revision as "nothing has happened".
   */
  revision: z.number().int().optional(),
  // FIX-989.
  /**
   * Bounded, newest-last log of write receipts.
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
  // FIX-989.
  /**
   * Has `writeLog` ever dropped a receipt?
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
  // FIX-989 follow-up; BP-030.
  /**
   * A per-incarnation identity nonce, minted once when the task is created and
   * never touched again.
   *
   * `createdAt` cannot serve as incarnation identity: it is a millisecond
   * clock, and a delete-then-recreate under the same id lands in the same
   * millisecond often enough (measured 198/200) that two different rows share
   * it. `incarnationId` is minted fresh with `crypto.randomUUID()`, so a
   * recreated row gets a new one every time, clock collisions or not — and
   * because it is persisted and compared across processes on a durable board,
   * it needs a generator that is unique across them, which `generateId`'s
   * per-process counter and 24-bit random tail are not.
   *
   * Declared here rather than added by the backings for the identical reason
   * `revision` is: a durable task is validated by `taskEnvelopeSchema` on its
   * way to the store, and a Zod object schema strips keys it does not
   * declare.
   *
   * **Absent on any task persisted before this shipped**, and on any task
   * written by a hand-written `TaskCollectionRef` that maintains no
   * provenance. Read it only through `didWriteLand`'s incarnation arm, which
   * withholds rather than guessing when either side lacks it.
   */
  incarnationId: z.string().optional(),
  // BP-031; BP-030.
  /**
   * The user whose request added this task, stamped by the substrate from the
   * running session when the task is built and never patched. Not a field a
   * caller supplies (`TaskInit` has none), so a hand-over can resolve "the
   * filer's own" worker against it. Absent on a task added with no
   * user in the session, and on any task persisted before it shipped: read it
   * as "filer unknown", never as a match. Server-only: never emitted
   * to a client (`SERVER_ONLY_TASK_FIELDS`).
   */
  createdBy: z.string().optional(),

  // FIX-2082; FIX-1816; BP-030.
  /**
   * The row's **wait slot**: a request is waiting on this row's ending
   * (one wait per row). `gateId` names the gate the
   * waiting request parks on, unique within its session; `deadline` is when
   * the wait resumes with the row still running (epoch ms); `requestId` is the
   * waiting request, server-written.
   *
   * Taken when a wait starts, in one conditional write that refuses a second
   * taker (`TaskCollectionRef.markWait`), and never at filing. At the deadline
   * the slot **lapses** (`lapsed`) rather than clears: an ending written while
   * the request that waited still runs is held for it, and that request's next
   * read of the row is its delivery (`releaseWait` hands one it never read to
   * the filer's notice). Never a model-facing field.
   *
   * **Absent** on every row nobody waits on. A slot an older
   * version's filing wrote has no `requestId` and reads as live, as it did.
   */
  wait: z
    .object({
      gateId: z.string(),
      deadline: z.number(),
      // FIX-2082.
      /** The waiting request. Absent on a slot a filing wrote before it. */
      requestId: z.string().optional(),
      // FIX-2082.
      /** The deadline passed with the row still open: nobody is parked on it now. */
      lapsed: z.literal(true).optional(),
      // BP-030.
      /**
       * The waiting request is a plan's drain, on a row it handed to another
       * session: written by the drain's own wait, never from
       * input, and kept while the slot is lapsed, so `getTask`'s wait refuses
       * the row (`wait_on_plan_step`) rather than take the slot the drain
       * waits with. **Absent** on every other slot, and on a drain's slot
       * written before it, which its next round marks.
       */
      drain: z.literal(true).optional(),
    })
    .optional(),

  // FIX-1816; BP-031; BP-030.
  /**
   * The waiting turn is owed its answer: written in the same write that ends a
   * waited-on row (`wait` set), whoever ends it, and cleared once the turn has its
   * answer. A touch of the board replays it by resuming the parked
   * turn, so an ending that lands while nothing is listening, or a resume lost
   * to a restart, is never lost.
   *
   * Top level and server-written for `abandonments`' reason: it
   * drives a resume, so no caller-writable surface reaches it. **Absent reads
   * as not owed**.
   */
  resumeOwed: z.boolean().optional(),

  // FIX-2080; FIX-2077 D1; FIX-2086 D2; BP-030.
  /**
   * What keeps this running task open while no worker holds it:
   * `"suspended"`, its own request is suspended (a `suspendForUser` stop,
   * which the row's suspension hold in `holds` mirrors, or any other: a
   * webhook, a call); `"filed"`, work it filed that still keeps it open. Only on an
   * `in_progress` row. A row kept open has no lease, so the reclaim leaves it
   * alone: that task is never run again by a lapse. `"steer"`, a steer no
   * request has taken: the turn owed for it is on its way, with
   * no lease. The request admitted for it next clears it and starts a lease;
   * every ending, and every claim, clears it.
   *
   * Not the `held`, which is the filer's hold, a status before a start,
   * nor `holds`, which says what the row is held on for a person, nor `wait`,
   * a request waiting on this row's ending. Server-written by the claim gate
   * (`setKeptOpenBy`), never by a caller. **Absent, or `null`, reads as kept
   * open by nothing**.
   */
  keptOpenBy: z.enum(["suspended", "filed", "steer"]).nullable().optional(),

  // FIX-2183; FIX-2133 D2, FIX-2317.
  /**
   * What holds the task on its row for a person: its
   * question holds, a question or a confirm kept on the row (`source.kind:
   * "row"`), and the mirror of a task run's `suspendForUser` stop
   * (`"suspension"`), oldest first. A question is one kind of hold, beside the
   * filer's (status `held`). *Open holds* (`openHolds`) is the one predicate
   * every reader asks: the claim never takes a row with one, the row settles
   * with one only by cancel, and the Inbox lists a row's open `actor: "user"`
   * holds. Before its start a held row is `pending`; midway, `in_progress`
   * with no lease. A cancel closes every hold.
   *
   * Server-written by the collection's one hold write (`collection/holds`),
   * never by a caller. **Absent** on a row nothing has held. A row stored with
   * them under `questions` (its former name) reads them here (the
   * retired-shape map's `questions` entry).
   */
  holds: z.array(taskHoldSchema).optional(),

  // FIX-2133 D3.
  /**
   * The row's turn generation: advanced by every claim of the
   * row, a same-attempt re-entry's included, and carried on the claim ticket,
   * so a turn's late write never lands after its successor's claim. **Absent
   * reads as 0**, a row never claimed.
   */
  turn: z.number().int().nonnegative().optional(),

  // FIX-2086; FIX-2133 D3.
  /**
   * The last open row hold of a running task closed: it owes one
   * more turn on its same attempt, with no lease. The claim takes it, using
   * no attempt, and clears it in the claim's write; a wake only starts that
   * sooner. Not the `keptOpenBy: "steer"`, which keeps its own meaning.
   * Server-written. **Absent** on every other row.
   */
  turnOwed: z.literal(true).optional(),

  // FIX-2133.
  /**
   * The turn generation that asked questions midway: written by
   * the midway question, so the request working that turn may not stop for the user and
   * never settles, whether its questions are answered yet or not, across a
   * resume too. A later turn's claim leaves it behind (its generation is
   * newer). Server-written. **Absent** until a turn asks.
   */
  askedInTurn: z.number().int().nonnegative().optional(),

  // FIX-2383; BP-030.
  /**
   * Reopened by a user's retry and not claimed since: the row
   * waits like a newly filed one, so it holds no session its last attempt ran
   * in until a claim takes it again. Written by `retry`, cleared by the next
   * claim. Server-written. **Absent** on every other row.
   */
  retryPending: z.literal(true).optional(),

  // FIX-2133 D1.
  /**
   * The tenant and organization the filing request ran under, from its
   * verified identity, beside the user in `createdBy`. The board's
   * `updateTask` reaches a row's holds only for a caller in the same user,
   * tenant and org. Server-only (`SERVER_ONLY_TASK_FIELDS`). **Absent** on a
   * row filed with neither.
   */
  filedUnder: z.object({ tenantId: z.string().optional(), orgId: z.string().optional() }).optional(),

  // FIX-1844; BP-031; BP-030.
  /**
   * The wait on this row is over (its turn was stopped, or it timed out) but
   * the cancel that should have ended the row failed. A touch of
   * the board pays it by cancelling the row. Whatever ends the row pays it,
   * in that ending's write, and owes the turn no resume: nobody waits.
   *
   * Top level and server-written, as `resumeOwed` is: it drives a
   * cancel. **Absent reads as not owed**.
   */
  cancelOwed: z.boolean().optional(),

  // FIX-2080 D2; BP-031; BP-030.
  /**
   * A cascade is owed for this row's ending: written in the
   * same write as the ending, so a crash between the ending and the cascade
   * leaves it owed, not lost. Covers both cascades: the open dependents of a
   * failed or cancelled row on this board, and the open tasks a task filed
   * (its board's `cascadeFiled`, for a failure, a cancel or a retry). `due`
   * is the write + {@link CASCADE_DUE_MS}: the ending's own pass pays it at
   * once, and a touch of the board pays it once past due. Cleared by the pass
   * that paid it.
   *
   * Top level and server-written for `abandonments`' reason: it
   * drives cancels, so no caller-writable surface reaches it. **Absent reads
   * as not owed**.
   */
  cascadeOwed: z
    .object({
      due: z.number(),
      // BP-030.
      /**
       * When the ending that owes it was written. A late payment cancels only
       * what was filed by then: a retry's next attempt files under the same
       * parent. **Absent on a debt written before it**: read with
       * `cascadeEndedAt`.
       */
      endedAt: z.number().optional(),
    })
    .optional(),

  // FIX-2078; BP-031; BP-030; FIX-2123.
  /**
   * Who filed this row: the session whose request filed it, stamped
   * at filing from the request's server-set identity, never from caller input.
   * A follow-up copies its root's, so the filer is the one that
   * filed the work, not the session a follow-up was typed in. Where its ending
   * is delivered. Its flow is read from the session's own record when needed.
   * **Absent** on a row filed before it: a composing layer may name a
   * fallback, and with none its notice is settled undeliverable.
   *
   * `requestId` is the request that filed it, when that request runs in the
   * filer's session, from the engine's request identity: the row's
   * notice waits until that request ends, so a wait in it reads the ending
   * first. Absent on a row filed before it, and on a follow-up filed outside
   * the filer's session: its notice is admitted at once, as before.
   */
  filer: z.object({ sessionId: z.string(), requestId: z.string().optional() }).optional(),

  // FIX-2080; BP-030.
  /**
   * The task whose ending cancelled this row: set by a cascade's
   * cancel, server-written, so whatever reports the cancel names its cause.
   * **Absent** on every row no cascade cancelled.
   */
  causedBy: z.string().optional(),

  // BP-031; BP-030.
  /**
   * A payload the code that filed the row wrote with it, for whatever runs the
   * row: which entry and session it goes to, and what that entry reads. Written
   * once, in the write that files the row, by a caller filing through the ref.
   * No task tool and no update reaches it, so a model can neither set nor
   * change it, the reason `metadata` (model-writable through `updateTask`)
   * can't carry it. Packed to the worker as `TaskWorkerInput.sealed`;
   * `TaskFilter.sealed` matches on its plain values. **Absent** on every row
   * filed without one.
   */
  sealed: z.record(z.unknown()).optional(),

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

// FIX-1005.
/**
 * The execution coordinate stamped into a claim write — see
 * {@link taskSchema}'s `claimedBy`.
 *
 * Named so the backings can accept it as a narrowed option rather than taking
 * a whole `BlockContext` into the write path.
 */
export type TaskClaimIdentity = NonNullable<
  z.infer<typeof taskSchema>["claimedBy"]
>;

// FIX-1668.
/** The run link a dispatched attempt writes onto its task — see {@link taskSchema}'s `run`. */
export type TaskRunLink = NonNullable<z.infer<typeof taskSchema>["run"]>;

/** One entry in {@link taskSchema}'s `writeLog` — a caller's write id and the revision it committed at. */
export type TaskWriteReceipt = NonNullable<
  z.infer<typeof taskSchema>["writeLog"]
>[number];

export type { TaskStatus };
