// FIX-2378.
/**
 * The marker a delegate's answer carries when it lands in a conversation as
 * written: a task filed with `resultTo: "conversation"`, routed or
 * not, whose completion is the delegate's reply itself rather than a notice's
 * line. Its message item names the worker that answered and the task it
 * answered, in `metadata`, so a client tells a delegate's answer from the
 * conversation's own words without matching on `agentName`.
 *
 * A notice's line (any other ending a conversation hears) carries
 * orchestration's `noticeMetadata` instead, read with `parseNotice`.
 *
 * Also the text a completed task's output says (`answerTextOf`), here because
 * this module imports nothing: a browser reads a task's answer by the rule the
 * server lands it by.
 */

/** The key a delegate's answer carries its marker under, in its message item's `metadata`. */
const DELEGATE_ANSWER_KEY = "delegateAnswer";

/** A delegate's answer, as its item names it. */
export interface DelegateAnswer {
  /** The worker that answered, by id. */
  readonly worker: string;
  /** The task it answered, by id. */
  readonly taskId: string;
}

/**
 * The `metadata` a delegate's answer is emitted with:
 * `ctx.emit.message(answer, { agentName: worker, metadata: delegateAnswerMetadata({ worker, taskId }) })`.
 */
export function delegateAnswerMetadata(answer: DelegateAnswer): { [DELEGATE_ANSWER_KEY]: DelegateAnswer } {
  return { [DELEGATE_ANSWER_KEY]: { worker: answer.worker, taskId: answer.taskId } };
}

/**
 * The delegate's answer a message item is, or `undefined` for any other item.
 * An answer stored before its item carried the marker reads as `undefined`:
 * nothing on it told a delegate's answer apart then, but a guess at its
 * `agentName`.
 *
 * @param item A stored or streamed item: a message's `metadata`.
 */
export function delegateAnswerOf(item: {
  readonly type?: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}): DelegateAnswer | undefined {
  if (item.type !== undefined && item.type !== "message") return undefined;
  const marked = item.metadata?.[DELEGATE_ANSWER_KEY] as { worker?: unknown; taskId?: unknown } | null | undefined;
  if (marked == null || typeof marked.worker !== "string" || typeof marked.taskId !== "string") return undefined;
  return { worker: marked.worker, taskId: marked.taskId };
}

/**
 * A completed task's answer, as a line the user reads: its output when that
 * is text (an agent worker's answer), or its `answer` (a coder's run, whose
 * output also carries its branch and commits). `undefined` when blank or absent.
 */
export function answerTextOf(output: unknown): string | undefined {
  const text = typeof output === "string" ? output : (output as { answer?: unknown } | null | undefined)?.answer;
  return typeof text === "string" && text.trim() !== "" ? text : undefined;
}
