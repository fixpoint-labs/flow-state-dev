/**
 * The Inbox's browser client: its one answer call, routed by each hold's
 * source (the epic FIX-2058's ER-7). A suspension goes to the engine's answer
 * route (FIX-2129), with the answer its ask takes mapped to the engine's
 * resume action there; a row hold, a question or a confirm, goes to the
 * board's `updateTask` action on the session that holds the board, as the
 * signed-in user (FIX-2133 D1). The routing lives here and nowhere else.
 */
import { ClientHttpError, type Client } from "@flow-state-dev/client";
import type { RequestStatus, ResumeAction } from "@flow-state-dev/core/types";
import type { InboxAnswer, InboxAskKind, InboxQuestion, InboxItem, RowQuestionSource } from "./types";

/** The engine's resume action and data for a suspension hold's answer. */
function resumeOf(kind: InboxAskKind, answer: InboxAnswer): { action: ResumeAction; data?: unknown } {
  const a = answer as Record<string, unknown>;
  if (kind === "approval" && typeof a.approved === "boolean") return { action: a.approved ? "approve" : "reject", ...(a.data !== undefined ? { data: a.data } : {}) };
  if ((kind === "input" || kind === "review") && a.skipped === true) return { action: "skip" };
  if ((kind === "input" || kind === "review") && "value" in a) return { action: "submit", data: a.value };
  throw new Error(`An answer to ${kind === "approval" ? "an approval" : `a ${kind}`} question doesn't take ${JSON.stringify(answer)}`);
}

/** The board's `updateTask` input for a row hold's answer: a question's words, or a confirm's go with its note. */
function updateOf(kind: InboxAskKind, answer: InboxAnswer): { message?: string; done?: boolean } {
  const a = answer as Record<string, unknown>;
  if (kind === "question" && typeof a.text === "string" && a.text.trim().length > 0) return { message: a.text };
  if (kind === "confirm" && typeof a.done === "boolean") {
    return { done: a.done, ...(typeof a.note === "string" && a.note.trim().length > 0 ? { message: a.note } : {}) };
  }
  throw new Error(`An answer to a ${kind} question doesn't take ${JSON.stringify(answer)}`);
}

/** How long the board's answer is waited on, and how often the request's wait looks at it. */
const ANSWER_TIMEOUT_MS = 30_000;
const ANSWER_POLL_MS = 150;

/**
 * Answer a row hold through the board's `updateTask` action, and read what it
 * said back: the action answers `{ ok: false, error }` for a refusal (the
 * question already answered, the task finished), which rejects here with its
 * words.
 */
async function answerRowHold(client: Client, source: RowQuestionSource, questionId: string, update: { message?: string; done?: boolean }): Promise<void> {
  const { flowId, sessionId, action } = source;
  if (flowId === null || sessionId === null || action === null) throw new Error(`Inbox question "${questionId}" names no board to answer through`);
  const flow = client.flow(flowId);
  let requestId: string;
  try {
    requestId = (await flow.send(action, { id: source.taskId, answers: questionId, ...update }, { sessionId })).id;
  } catch (error) {
    if (error instanceof ClientHttpError && error.status >= 400 && error.status < 500) throw new Error(error.message);
    throw error;
  }
  let status: RequestStatus;
  try {
    status = (await flow.request(requestId).wait({ pollMs: ANSWER_POLL_MS, timeoutMs: ANSWER_TIMEOUT_MS })).status;
  } catch (error) {
    if (error instanceof ClientHttpError && error.status === 0) throw new Error("The answer was sent, and the board didn't say in time whether it took it.");
    throw error;
  }
  // The status carries no output: the session's listing does.
  const listed = await client.sessions.requests(sessionId, { status, includeResultOutput: true, limit: 100 });
  const found = listed.find((request) => request.id === requestId);
  if (status !== "completed") throw new Error(found?.result?.error?.message ?? `The board's answer ended ${status}.`);
  const output = found?.result?.output as { ok?: boolean; error?: string } | undefined;
  if (output?.ok === false) throw new Error(output.error ?? "The board refused the answer.");
}

/** The Inbox's client: its one answer call. */
export type InboxClient = {
  /**
   * Answer `item`'s hold `questionId` (its first when omitted) with the answer
   * its ask takes. Rejects when the hold isn't answerable, or the route refuses.
   */
  answer(item: InboxItem<unknown>, answer: InboxAnswer, questionId?: string): Promise<void>;
  /** Answer one hold, as an item's are answered: for a hold drawn on its own, such as an ask in a task's session view. */
  answerOne(hold: InboxQuestion<unknown>, answer: InboxAnswer): Promise<void>;
};

/** The Inbox's client over one connection. */
export function createInboxClient(client: Client): InboxClient {
  const answerOne: InboxClient["answerOne"] = async (hold, answer) => {
    if (hold.unanswerable !== null) throw new Error(hold.unanswerable);
    if (hold.source.kind === "row") {
      await answerRowHold(client, hold.source, hold.id, updateOf(hold.ask.kind, answer));
      return;
    }
    const { flowId, requestId, suspensionId } = hold.source;
    if (flowId === null) throw new Error(`Inbox question "${hold.id}" names no flow`);
    const resume = resumeOf(hold.ask.kind, answer);
    await client.flow(flowId).request(requestId).answer({ suspensionId, ...resume });
  };
  return {
    answerOne,
    async answer(item, answer, questionId) {
      const hold = questionId === undefined ? item.questions[0] : item.questions.find((h) => h.id === questionId);
      if (hold === undefined) throw new Error(`Inbox item "${item.id}" holds no "${questionId}"`);
      await answerOne(hold, answer);
    },
  };
}
