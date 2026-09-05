/**
 * The `answer` verb — an operator's one move, and the three shipped calls it
 * composes.
 *
 * A person names a question row and says what to do. This decides whether that
 * answer may be applied, applies it, re-queues the board row, and then **runs
 * the drain itself**. Zero-model, server-side, in the coordinator's own
 * session.
 *
 * ## The drain belongs to this action, not to the operator's next step
 *
 * `unpark` only leaves the row `pending`, and with `onReview: "exit"`
 * the drain that observed the question has already ended — so an `answer` that
 * stops after two calls leaves the row waiting for whatever happens to drain
 * next, and *"an answer starts the run again"* is a promise the design does not
 * keep. The caller supplies the session, which is why every drain conductor
 * runs names the coordinator session: a drain with an absent `sessionId`
 * resolves a different ledger, finds an empty board, and reports success having
 * reached nothing.
 *
 * ## The guard is conductor's own, and it is a PAIR
 *
 * The substrate refuses a non-parked task itself since FIX-1244 — `unpark` is
 * fenced to `parked` and declines otherwise — so the task-level half of this
 * guard is redundant with it. The guard stays because its other half is
 * conductor's own (the ROW must still be `open`, below) and because
 * collapsing `answer` onto `board.unparkAndDrain` is a follow-up, not this
 * change. Until then `decideAnswer` still calls the verb bare and does not
 * read its verdict.
 *
 * **Parked AND the named row still `open`.** The task is shared across
 * attempts; the row is per-attempt. Attempt 1 asks and fails, so its row is
 * withdrawn; attempt 2 later parks on a question of its own. An answer naming
 * attempt 1's row finds the shared task at `parked`, passes a
 * task-only guard, flips a withdrawn row to `answered` and re-queues the run —
 * while attempt 2's actual question is still open.
 *
 * *Parked* is the one status `answer` proceeds from. **Every other status refuses
 * locally**: `pending` (a retry, and the *second* answer of a duplicate pair,
 * because the first already re-queued the row), `in_progress` (a claim — a live
 * run is not waiting on anybody), and the three terminal ones. *Held* would be
 * exactly the wrong word: on this board a row is held when it is **claimed**,
 * which is the one state the answer path must not proceed from.
 *
 * ## Recovery is ONE rule, read off the questions and never off the counter
 *
 * The three calls are not atomic, and a crash between any two leaves a durable
 * prefix. Those are not several cases; they are one defect — the sequence has
 * committed part of itself, and the proceed lock refuses to re-enter a sequence
 * whose first call already landed.
 *
 * The condition is **the question the task is waiting on**:
 *
 * - **Proceed** names its question directly: the row must be `open`.
 * - **Recovery** names it by absence: the row must be `answered`, and **no** row
 *   under `<issue>/<phase>/` may be `open`. An open row means the task is
 *   waiting on a *different* question and this answer is not the sequence to
 *   restart.
 *
 * **No offset, no arithmetic, no `attempts` in the condition at all.**
 * `applyClaimToTask` advances `attempts` on every claim and `isClaimable`
 * admits a lease-lapsed row, so each abandoned reclaim advances the counter
 * while the open question does not change. A condition written as "one behind"
 * survives exactly one abandoned hand-off. *The counter measures how many times
 * the mechanism moved. The question is what the rule means.*
 *
 * Recovery never re-patches. It reads the task to see how far the sequence got:
 * parked → resume then drain; `pending` → drain only; `in_progress` with a
 * **lapsed lease** (an abandoned claim) → drain only, and the substrate's own
 * reclaim does the rest; **anything else declines** — a live `in_progress`
 * because a run holds it, or a terminal task.
 *
 * **The live-vs-abandoned split is the whole third arm.** Abandoned is
 * `in_progress` with a `leaseUntil` already past, judged against **the
 * collection's own clock** — the same one the claim wrote against, never the
 * action's wall clock. An **absent** `leaseUntil` reads as LIVE and declines
 * (BP-030: rows persisted before leases, rows never claimed). The conservative
 * direction is deliberate: a stranded answer is recoverable by any later wake,
 * **a live run resumed underneath itself is not**.
 *
 * ## Named limits, not tasks — do not close any of these here
 *
 * - **The refusal is right on the common path, not on the race.** This reads
 *   the board row and then calls `unpark`, and the row can move
 *   between them. The verb itself now refuses a non-parked row atomically
 *   (FIX-1244) and returns `declined`; this code does not yet read that
 *   verdict. Do not invent a lock, a compare-and-set, or a conductor-side
 *   status — collapse onto the atomic verb instead, as a follow-up.
 * - **A second answer arriving mid-flight is dropped, not refused.** While the
 *   row is `answered` and the sequence is still moving, recovery cannot tell a
 *   second answer from a replay of the first: it resumes the run holding the
 *   first answer and drops the second's body. Telling them apart needs a body
 *   comparison, which is FIX-1244's.
 * - **A stale name can cause a dispatch this call did not otherwise authorize.**
 *   Recovery ends in a drain, and a drain is not a no-op: on a `pending` row it
 *   claims and dispatches. So an answer naming an old `answered` row while
 *   nothing is open applies no answer and writes nothing, but it **does** start
 *   work. Accepted at this scale, and named so an operator is not surprised.
 * - **The recovery rule has been extended four times and a fifth window is
 *   FIX-1244's, not a fifth arm.** Each extension had one cause: a condition
 *   that named a *mechanism* (a status pair, a counter, an offset) where it
 *   meant a *fact*. The condition is now written entirely over facts. If a
 *   fifth window appears, it means the three-call sequence cannot be made
 *   restartable from outside — escalate to the atomic verb.
 */
import { z } from "zod";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  answerQuestion,
  listQuestions,
  parseQuestionTopic,
  readQuestion,
  withdrawQuestion,
} from "./inbox";
import { conductorTaskId } from "./workspace";

/** The task-board statuses from which nothing can be resumed. */
const TERMINAL_TASK_STATUSES = new Set(["completed", "errored", "cancelled"]);

/** The shipped status a task parks in. Product name: `needs_input`. */
const PARKED = "parked";

/** What `answer` takes. Both halves are the operator's words; nothing else is. */
export const answerInputSchema = z.object({
  /**
   * The question row, named explicitly — `<issue>/<phase>/<attempt>/<hash>`,
   * exactly as `status` reports it. Working out which question a free-form
   * reply addresses is a non-goal; an answer names its row.
   */
  question: z.string(),
  /** What to do. Folded into the next attempt's prompt as an answer. */
  answer: z.string(),
});

/**
 * What `answer` reports.
 *
 * **A refusal is a returned decline, not a throw** — the output carries the
 * reason and both rows' statuses, so an operator (and the suite) can tell
 * *refused* from *done*. A silent decline is the defect class this lab exists
 * to remove, and it would be relocated rather than fixed if this threw.
 */
export const answerOutputSchema = z.object({
  /**
   * `answered` — the answer was applied and the run re-queued.
   * `recovered` — an interrupted sequence was restarted from its durable
   * prefix; no answer was written, because one already had been.
   * `declined` — nothing was applied. `reason` says why.
   */
  result: z.enum(["answered", "recovered", "declined"]),
  /** Why it declined, in stable machine terms. Null on the two success arms. */
  reason: z.string().nullable(),
  /** The row this named, echoed back. */
  question: z.string(),
  /** The board row's status when the decision was made. */
  taskStatus: z.string().nullable(),
  /** The question row's status when the decision was made. */
  questionStatus: z.string().nullable(),
  /**
   * Whether this call ran the drain — i.e. whether it may have started work.
   * On the recovery arm with a stale name that is the only thing it did.
   */
  drained: z.boolean(),
});

export type AnswerInput = z.infer<typeof answerInputSchema>;
export type AnswerOutput = z.infer<typeof answerOutputSchema>;

/** The slice of a task row this decision reads. Structural, like the fence's. */
interface TaskView {
  status?: string;
  /** Present since leases shipped; **absent reads as live** (BP-030). */
  leaseUntil?: number | undefined;
}

/**
 * The board surface this decision needs.
 *
 * `now` is the collection's own clock rather than `Date.now()` — a lease is a
 * comparison and a comparison needs one clock. Reading the wall clock instead
 * works right up until the collection is built on an injected one, at which
 * point a live task can read as abandoned and an abandoned one as live.
 */
export interface AnswerBoard {
  get(id: string): TaskView | undefined;
  unpark(id: string, feedback?: string): Promise<unknown>;
  now(): number;
}

/**
 * Decide, write, and re-queue. **Does not drain** — the caller's sequencer
 * runs `board.drain` when `drained` comes back true, so the drain is a real
 * board step inside the same request rather than a second entry point into the
 * board's machinery.
 */
export async function decideAnswer(
  ctx: BlockContext,
  board: AnswerBoard,
  input: AnswerInput,
): Promise<AnswerOutput> {
  const topic = input.question;
  const decline = (
    reason: string,
    taskStatus: string | null,
    questionStatus: string | null,
  ): AnswerOutput => ({
    result: "declined",
    reason,
    question: topic,
    taskStatus,
    questionStatus,
    drained: false,
  });

  // The one place caller-supplied text becomes a key. A name that does not
  // parse can never reach a task id or a storage key (BP-031).
  const coordinates = parseQuestionTopic(topic);
  if (coordinates === undefined) return decline("malformed-question", null, null);

  const { issue, phase } = coordinates;
  const row = await readQuestion(ctx, topic);
  if (row === undefined) return decline("unknown-question", null, null);

  const taskId = conductorTaskId(issue, phase);
  const task = board.get(taskId);
  const taskStatus = task?.status ?? null;

  // ── FIRST: is this the question the task is waiting on? ────────────────────
  // Read off the questions themselves, never off the counter. Whatever the
  // statuses say, an answer that is not this sequence declines here.
  if (row.status === "open") {
    return proceed(ctx, board, { topic, taskId, task, answer: input.answer });
  }

  if (row.status === "answered") {
    // Named by absence: an `answered` row means the patch is durable, and
    // nothing open beside it means the task is not waiting on some OTHER
    // question. An earlier attempt's retained `answered` row is refused
    // exactly while a later question waits, which is what it exists for.
    const questions = await listQuestions(ctx, issue, phase);
    if (questions.some((q) => q.state.status === "open")) {
      return decline("another-question-open", taskStatus, row.status);
    }
    return recover(board, { topic, taskId, task, taskStatus });
  }

  // `withdrawn`. The row is not deleted, so the answer is reported back rather
  // than applied, and the task is untouched — including when it is parked on a
  // LATER attempt's question, which is what the guard's row half exists for.
  return decline("question-not-open", taskStatus, row.status);
}

/** The proceed path: the named row is `open`. */
async function proceed(
  ctx: BlockContext,
  board: AnswerBoard,
  args: { topic: string; taskId: string; task: TaskView | undefined; answer: string },
): Promise<AnswerOutput> {
  const { topic, taskId, task, answer } = args;
  const taskStatus = task?.status ?? null;

  if (task === undefined) {
    return {
      result: "declined",
      reason: "unknown-task",
      question: topic,
      taskStatus: null,
      questionStatus: "open",
      drained: false,
    };
  }

  if (taskStatus !== PARKED) {
    // **The only write a refusal makes.** An `open` row whose task is terminal
    // is unanswerable by construction — the guard above refuses it forever —
    // so leaving it open shows it in `status` as a question nobody can act on.
    // Same read-site reconciliation `status` performs; this action is a read of
    // the same pair, so it does it too. A cancel writes the task row and
    // nothing else, so neither of the manager's withdrawal arms ever fires.
    const terminal = taskStatus !== null && TERMINAL_TASK_STATUSES.has(taskStatus);
    if (terminal) await withdrawQuestion(ctx, topic);
    return {
      result: "declined",
      reason: terminal ? "task-terminal" : "task-not-parked",
      question: topic,
      taskStatus,
      questionStatus: terminal ? "withdrawn" : "open",
      drained: false,
    };
  }

  // Conditional `open` → `answered`, atomically. A refusal here means a
  // withdrawal or a racing answer moved the row between the read above and this
  // write: the first answer always takes effect and the body is never
  // overwritten.
  const write = await answerQuestion(ctx, topic, answer);
  if (write.outcome === "refused") {
    return {
      result: "declined",
      reason: "answer-lost-race",
      question: topic,
      taskStatus,
      questionStatus: write.observed,
      drained: false,
    };
  }

  // **No feedback.** That field is the board's carrier for why the LAST attempt
  // failed, and the two channels never carry each other. Passing none also
  // clears the previous failure's reason, so the resumed attempt is not told
  // its own answer is why it stopped.
  await board.unpark(taskId);

  return {
    result: "answered",
    reason: null,
    question: topic,
    taskStatus,
    questionStatus: "answered",
    drained: true,
  };
}

/**
 * The recovery path: the named row is already `answered` and nothing else is
 * open. The patch is durable, so restart the sequence from that prefix and
 * **never re-patch** — the row's body is never rewritten.
 *
 * Idempotent by construction: a repeat of either branch is a drain that finds
 * nothing left to claim. Re-running is safe, not merely tolerated.
 */
async function recover(
  board: AnswerBoard,
  args: {
    topic: string;
    taskId: string;
    task: TaskView | undefined;
    taskStatus: string | null;
  },
): Promise<AnswerOutput> {
  const { topic, taskId, task, taskStatus } = args;
  const recovered = (drained: boolean): AnswerOutput => ({
    result: "recovered",
    reason: null,
    question: topic,
    taskStatus,
    questionStatus: "answered",
    drained,
  });
  const declined = (reason: string): AnswerOutput => ({
    result: "declined",
    reason,
    question: topic,
    taskStatus,
    questionStatus: "answered",
    drained: false,
  });

  if (task === undefined) return declined("unknown-task");

  // Crashed between the patch and `unpark`: the operator watched the
  // answer land and the task is still parked. Written as a status PAIR this
  // case was missed, which parks the task forever holding an accepted answer.
  if (taskStatus === PARKED) {
    await board.unpark(taskId);
    return recovered(true);
  }

  // Crashed between `unpark` and the drain: re-queued, and
  // `onReview: "exit"` already ended the drain that saw the question.
  if (taskStatus === "pending") return recovered(true);

  if (taskStatus === "in_progress") {
    // The drain is not atomic either, so the sequence has FOUR commit points:
    // patch, resume, **claim**, hand off. The claim advances `attempts` and
    // takes the row `in_progress` before the hand-off is attempted, and a
    // hand-off that throws leaves nothing owning the row — it simply sits until
    // its lease lapses. Ownership rather than status is what this reads,
    // because a live run and an abandoned claim are the same status.
    //
    // The re-claim charges another attempt and records an abandonment — the
    // board's own accounting, which this design does not adjust. It is bounded:
    // past `DEFAULT_MAX_ABANDONMENTS` the next drain settles the row `errored`,
    // and the arm then declines like any other terminal task. Guaranteed
    // recovery past that bound is FIX-1244's, not this rule's to grow.
    const lease = task.leaseUntil;
    if (lease == null) return declined("run-live");
    return lease <= board.now() ? recovered(true) : declined("run-live");
  }

  return declined(TERMINAL_TASK_STATUSES.has(taskStatus ?? "") ? "task-terminal" : "task-not-parked");
}
