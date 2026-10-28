/**
 * The ask step: the one place a harness run's verdict becomes a stop for a
 * person (FIX-2132).
 *
 * Every ask the manager makes comes here: a run's own question (its marker),
 * the judge's *ask*, and held work that does not match its record. Each one is
 * a question, so each holds the run's task on it through the board's one ask
 * write (`askMidway`, FIX-2133): the question is kept on the task's row, the
 * row's lease is dropped, and the turn ends without settling. The Inbox lists
 * the held task as a question, and its answer, from the Inbox or a line typed
 * in the run's session, owes the task one more turn on the same attempt. That
 * turn's run resumes the coding session this attempt confirmed.
 *
 * Nothing here suspends a request, writes an inbox row, or parks a row: no
 * other module in this package asks.
 *
 * The write presents the claim this request holds, which the claim gate (or a
 * board's drain) stamped when it claimed the turn: the run's attempt and its
 * turn generation, never a ticket minted from the row as it stands now.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { currentLeaseRenewal } from "@flow-state-dev/orchestration";
import { askMidway } from "@flow-state-dev/orchestration/task-board";
import { MAX_QUESTION_PROMPT, type TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";

/** What the ask step did: the task is held on the question, or this turn no longer holds its row. */
export type AskStepOutcome = "held" | "superseded";

/**
 * Hold the task on `question`, from the turn that holds its claim.
 *
 * A question past the length a row keeps ({@link MAX_QUESTION_PROMPT}) is cut, with
 * an ellipsis, so the person still sees it rather than the run failing; the
 * run's full text stays in its marker file in the checkout.
 *
 * @returns `"held"` once the question is on the row, and `"superseded"` when
 *   the board refused the write because this turn no longer holds the row
 *   (another turn claimed it, it was cancelled or settled, or it is another
 *   task now).
 * @throws {Error} when the request holds no claim on this board, or the board
 *   keeps no questions: a wiring fault, not a failed attempt. Also when the
 *   row has no room left for an answer (`steer-limit`).
 */
export async function askStep(ctx: BlockContext, board: TaskCollectionRef, question: string): Promise<AskStepOutcome> {
  const prompt = question.length > MAX_QUESTION_PROMPT ? `${question.slice(0, MAX_QUESTION_PROMPT - 1)}…` : question;
  const asked = await askMidway(ctx, board, [{ prompt }]);
  if (asked.ok) {
    // The turn is over and its lease is gone, so nothing renews it again. The
    // claim gate's admission stops its own renewal in the ask; a board's
    // inline drain renews through this seam instead.
    currentLeaseRenewal()?.stop();
    return "held";
  }
  if (asked.reason === "lost-claim" || asked.reason === "not-my-task" || asked.reason === "terminal") return "superseded";
  throw new Error(
    `[harness-manager] the run's question could not hold its task (${asked.reason}). ` +
      (asked.reason === "no-claim"
        ? "The manager must run as a board's worker, behind its claim gate or drain, so its request holds the task's claim."
        : asked.reason === "not-supported"
          ? `The board "${board.collectionId}" keeps no questions.`
          : "The task has no room left for an answer."),
  );
}

/**
 * Thrown to stop the manager's chain before any harness runs, once the ask
 * step held the task on a question: held work that does not match its record
 * (BR-19, BR-29). Not a failed attempt: the claim gate's end-of-request check
 * sees the turn asked and records nothing, and the manager's rescue leaves the
 * run record's outcome at `running`, as on any question.
 */
export class HeldOnQuestion extends Error {
  constructor(readonly field: string) {
    super(
      `[harness-manager] the run's held work does not match its record (${field}); ` +
        `its task is held on a question for the run's owner, before the harness ran.`,
    );
    this.name = "HeldOnQuestion";
  }
}
