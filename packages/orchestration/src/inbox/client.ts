/**
 * The Inbox's browser client: its one answer call, routed by each hold's
 * source (the epic FIX-2058's ER-7). A suspension goes to the engine's answer
 * route (FIX-2129), with the answer its ask takes mapped to the engine's
 * resume action there; a row hold, a question or a confirm, goes to the
 * board's `updateTask` action on the session that holds the board, as the
 * signed-in user (FIX-2133 D1). The routing lives here and nowhere else.
 *
 * It also holds a board's task actions (FIX-2381): cancel, steer, release and
 * re-file, bound to a board with `board(at)`, through the same send-and-read
 * routine the row answers use, so an app names no board action and builds no
 * payload of its own.
 */
import { ClientHttpError, type Client } from "@flow-state-dev/client";
import type { RequestStatus, ResumeAction } from "@flow-state-dev/core/types";
import { taskActionName } from "../skills/task-tool-names";
import type { InboxAnswer, InboxAskKind, InboxHold, InboxItem, RowHoldSource } from "./types";

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
/** Requests listed per page, and pages at most, while looking for the action's answer. */
const REQUEST_PAGE = 100;
const REQUEST_PAGES = 20;

/**
 * Run one of a board's actions on the session that holds it, as the signed-in
 * user, and read what it said back. The board answers `{ ok: false, error }`
 * for a refusal (a finished task, a locked field, a question already
 * answered), which rejects here with its words; so does a failed request or a
 * 4xx. Every board action and every row answer goes through here.
 */
async function sendBoardAction(client: Client, flowId: string, sessionId: string, action: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const flow = client.flow(flowId);
  let requestId: string;
  try {
    requestId = (await flow.send(action, input, { sessionId })).id;
  } catch (error) {
    if (error instanceof ClientHttpError && error.status >= 400 && error.status < 500) throw new Error(error.message);
    throw error;
  }
  let status: RequestStatus;
  try {
    status = (await flow.request(requestId).wait({ pollMs: ANSWER_POLL_MS, timeoutMs: ANSWER_TIMEOUT_MS })).status;
  } catch (error) {
    if (error instanceof ClientHttpError && error.status === 0) throw new Error("The action was sent, and the board didn't say in time whether it took it.");
    throw error;
  }
  // The status carries no output: the session's listing does, a page at a time on a busy session.
  let found: Awaited<ReturnType<Client["sessions"]["requests"]>>[number] | undefined;
  for (let page = 0; page < REQUEST_PAGES && found === undefined; page += 1) {
    const listed = await client.sessions.requests(sessionId, { status, includeResultOutput: true, limit: REQUEST_PAGE, offset: page * REQUEST_PAGE });
    found = listed.find((request) => request.id === requestId);
    if (listed.length < REQUEST_PAGE) break;
  }
  if (status !== "completed") throw new Error(found?.result?.error?.message ?? `The board's ${action} ended ${status}.`);
  // Done, with no answer to read: never taken as a yes.
  if (found === undefined) throw new Error(`The board's ${action} finished, and its answer isn't in the session's requests.`);
  const output = (found.result?.output ?? {}) as Record<string, unknown>;
  if (output.ok === false) throw new Error(typeof output.error === "string" ? output.error : "The board refused it.");
  return output;
}

/** Answer a row hold through the board's `updateTask` action. */
async function answerRowQuestion(client: Client, source: RowHoldSource, questionId: string, update: { message?: string; done?: boolean }): Promise<void> {
  const { flowId, sessionId, action } = source;
  if (flowId === null || sessionId === null || action === null) throw new Error(`Inbox question "${questionId}" names no board to answer through`);
  await sendBoardAction(client, flowId, sessionId, action, { id: source.taskId, answers: questionId, ...update });
}

/**
 * Where a board's actions run: the flow and the session that hold it, and the
 * board's collection id (Workforce's conversation board is `"tasks"`).
 */
export type TaskBoardAt = {
  readonly flowId: string;
  readonly sessionId: string;
  readonly board: string;
};

/**
 * The row a re-file copies from: as much of a task as a browser's row carries.
 * A server's `Task` fits too.
 */
export type RefileRow = {
  readonly goal: string;
  readonly title?: string | null;
  readonly context?: string | null;
  readonly assignee?: string | null;
  readonly labels?: readonly string[] | null;
  readonly priority?: number | null;
};

/** What a re-file may set beside or over the copied row: any field the board's `createTask` takes. */
export type RefileOverrides = Record<string, unknown>;

/**
 * One board's task actions, bound to where it runs. Each runs the board's own
 * action as the signed-in user, resolves on the board's `ok: true`, and
 * rejects with the board's words when it refuses. What the board allows is
 * the board's rule, not this client's.
 */
export type TaskActions = {
  /** Cancel task `id` (any time until it finishes). Resolves to the dependents the cancel took along. */
  cancel(id: string): Promise<string[]>;
  /** Steer task `id` with `message` until it finishes: the words join its brief, and use none of its tries. */
  steer(id: string, message: string): Promise<void>;
  /** Release held task `id`, so it may start. */
  release(id: string): Promise<void>;
  /**
   * File `row` again as a new task: its goal, title, context, assignee,
   * labels and priority, with `overrides` winning. For a task that should run
   * again changed. Resolves to the new task's id.
   */
  refile(row: RefileRow, overrides?: RefileOverrides): Promise<string>;
};

/** The fields a re-file copies from its row, when the row has them. */
function refiled(row: RefileRow, overrides: RefileOverrides): Record<string, unknown> {
  const copied: Record<string, unknown> = { goal: row.goal };
  if (row.title != null) copied.title = row.title;
  if (row.context != null) copied.context = row.context;
  if (row.assignee != null) copied.assignee = row.assignee;
  if (row.labels != null) copied.labels = [...row.labels];
  if (row.priority != null) copied.priority = row.priority;
  return { ...copied, ...overrides };
}

/** The task actions over one board. */
function taskActionsAt(client: Client, at: TaskBoardAt): TaskActions {
  const update = taskActionName("updateTask", at.board);
  const send = (action: string, input: Record<string, unknown>) => sendBoardAction(client, at.flowId, at.sessionId, action, input);
  return {
    async cancel(id) {
      const output = await send(update, { id, status: "cancelled" });
      return Array.isArray(output.cancelled) ? (output.cancelled as string[]) : [];
    },
    async steer(id, message) {
      await send(update, { id, message });
    },
    async release(id) {
      await send(update, { id, status: "pending" });
    },
    async refile(row, overrides = {}) {
      const output = await send(taskActionName("createTask", at.board), refiled(row, overrides));
      if (typeof output.taskId !== "string") throw new Error("The board filed the task and named no id for it.");
      return output.taskId;
    },
  };
}

/** The Inbox's client: its one answer call, and a board's task actions. */
export type InboxClient = {
  /**
   * Answer `item`'s hold `questionId` (its first when omitted) with the answer
   * its ask takes. Rejects when the hold isn't answerable, or the route refuses.
   */
  answer(item: InboxItem<unknown>, answer: InboxAnswer, questionId?: string): Promise<void>;
  /** Answer one hold, as an item's are answered: for a hold drawn on its own, such as an ask in a task's session view. */
  answerOne(hold: InboxHold<unknown>, answer: InboxAnswer): Promise<void>;
  /**
   * A board's task actions (cancel, steer, release, re-file), bound to where
   * the board runs. Answering a task's question stays {@link answerOne}'s.
   */
  board(at: TaskBoardAt): TaskActions;
};

/** The Inbox's client over one connection. */
export function createInboxClient(client: Client): InboxClient {
  const answerOne: InboxClient["answerOne"] = async (hold, answer) => {
    if (hold.unanswerable !== null) throw new Error(hold.unanswerable);
    if (hold.source.kind === "row") {
      await answerRowQuestion(client, hold.source, hold.id, updateOf(hold.ask.kind, answer));
      return;
    }
    const { flowId, requestId, suspensionId } = hold.source;
    if (flowId === null) throw new Error(`Inbox question "${hold.id}" names no flow`);
    const resume = resumeOf(hold.ask.kind, answer);
    await client.flow(flowId).request(requestId).answer({ suspensionId, ...resume });
  };
  return {
    answerOne,
    board: (at) => taskActionsAt(client, at),
    async answer(item, answer, questionId) {
      const hold = questionId === undefined ? item.holds[0] : item.holds.find((h) => h.id === questionId);
      if (hold === undefined) throw new Error(`Inbox item "${item.id}" holds no "${questionId}"`);
      await answerOne(hold, answer);
    },
  };
}
