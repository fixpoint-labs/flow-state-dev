/**
 * The Inbox's browser client: its one answer call, routed by each hold's
 * source (the epic FIX-2058's ER-7). A suspension goes to the engine's answer
 * route (FIX-2129), with the answer its ask takes mapped to the engine's
 * resume action there; a row hold, a question or a confirm, goes to the
 * board's `updateTask` action on the session that holds the board, as the
 * signed-in user (FIX-2133 D1). The routing lives here and nowhere else.
 *
 * The same client carries each board's task actions (FIX-2381): `board(at)`
 * binds one board, and cancel, steer, release, retry and re-file go to that
 * board's own actions through the routine a row answer goes through.
 */
import { ClientHttpError, type Client, type RequestResult } from "@flow-state-dev/client";
import type { ResumeAction } from "@flow-state-dev/core/types";
import { taskToolSuffix } from "../skills/task-tool-suffix";
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

/** The task tools a board takes from outside a run, each an action on the flow that holds the board. */
export type TaskActionTool = "createTask" | "getTask" | "listTasks" | "updateTask" | "retryTask";

/**
 * The name of board `board`'s action for `tool`: `<tool>_<suffix>`, the one
 * place an app gets it. `board` is the collection id (Workforce's `"tasks"`),
 * not a row's board ref. For a reader that builds an `InboxRow.holder`, or a
 * test that acts on the board directly; an app that changes a task calls
 * {@link InboxClient.board}.
 */
export function taskActionName(tool: TaskActionTool, board: string): string {
  return `${tool}_${taskToolSuffix(board)}`;
}

/** Where a board's action is sent: its flow, the session that holds the board, and the action. */
type BoardRoute = { flowId: string; sessionId: string; action: string };

/** What a board action answers: `ok`, and on a refusal the rule's words. */
type BoardOutput = { ok?: boolean; error?: string } & Record<string, unknown>;

/**
 * Send one board action and read what it said back: the one routine every
 * board action and every row answer goes through. Resolves to the action's
 * output when the board said `ok: true`. Rejects with the board's own words
 * on `ok: false`, with the request's error when it failed, with the reason on
 * a 4xx, and when the action finished but its answer couldn't be read (an
 * answer not read is never a yes, though the board may have written).
 */
async function sendBoardAction(client: Client, route: BoardRoute, input: Record<string, unknown>, what: string): Promise<BoardOutput> {
  const { flowId, sessionId, action } = route;
  const flow = client.flow(flowId);
  let requestId: string;
  try {
    requestId = (await flow.send(action, input, { sessionId })).id;
  } catch (error) {
    if (error instanceof ClientHttpError && error.status >= 400 && error.status < 500) throw new Error(error.message);
    throw error;
  }
  let settled: RequestResult;
  try {
    settled = await flow.request(requestId).result({ pollMs: ANSWER_POLL_MS, timeoutMs: ANSWER_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof ClientHttpError && error.status === 0) throw new Error(`The ${what} was sent, and the board didn't say in time whether it took it.`);
    throw error;
  }
  if (settled.status !== "completed") throw new Error(settled.error?.message ?? `The board's ${what} ended ${settled.status}.`);
  if (settled.outputNotRecorded === true) throw new Error(`The board finished the ${what}, but its answer couldn't be read, so check the board before trying again.`);
  const output = settled.output as BoardOutput | undefined;
  if (output?.ok === false) throw new Error(output.error ?? `The board refused the ${what}.`);
  return output ?? {};
}

/**
 * Answer a row hold through the board's `updateTask` action, and read what it
 * said back: the action answers `{ ok: false, error }` for a refusal (the
 * question already answered, the task finished), which rejects here with its
 * words.
 */
async function answerRowQuestion(client: Client, source: RowHoldSource, questionId: string, update: { message?: string; done?: boolean }): Promise<void> {
  const { flowId, sessionId, action } = source;
  if (flowId === null || sessionId === null || action === null) throw new Error(`Inbox question "${questionId}" names no board to answer through`);
  await sendBoardAction(client, { flowId, sessionId, action }, { id: source.taskId, answers: questionId, ...update }, "answer");
}

/**
 * The board a task screen works: the flow and the session that hold it, and
 * its collection id (Workforce's `"tasks"`, not a row's `<sessionId>.tasks`
 * ref). Its actions run there, as the signed-in user.
 */
export type BoardAt = { flowId: string; sessionId: string; board: string };

/**
 * What a re-file copies from a row: the brief and where it goes. A browser's
 * row or a server's `Task` fits. `input`, `metadata` and `deps` aren't copied
 * (a browser's row doesn't carry the first two, and old `deps` may name
 * finished rows); an override sets any of them.
 */
export type RefileRow = {
  goal: string;
  title?: string | null;
  context?: string | null;
  assignee?: string | null;
  labels?: readonly string[] | null;
  priority?: number | null;
};

/** What a re-file sets over the copied row: any copied field, and the ones a re-file doesn't copy. */
export type RefileOverrides = Partial<RefileRow> & {
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  deps?: readonly string[];
};

/**
 * One board's actions, bound by {@link InboxClient.board}. Each resolves on
 * the board's `ok: true`, and rejects with the board's own words on a refusal
 * (a finished task, a locked field), with nothing written. One rejection may
 * follow a write: the board finished the action but its answer couldn't be
 * read, so check the board before trying again.
 */
export type BoardActions = {
  /** Cancel a task. Resolves to the ids of the dependents the board cancelled with it. */
  cancel(id: string): Promise<string[]>;
  /** Send words to an open task: they join its brief. Uses no try, never cancels. */
  steer(id: string, message: string): Promise<void>;
  /** Release a held task: it goes back to pending. */
  release(id: string): Promise<void>;
  /** Retry a failed or cancelled task as the same task: its id, history and spend kept, one more try counted. */
  retry(id: string): Promise<void>;
  /**
   * File `row`'s task again as a new one: its goal, title, context, assignee,
   * labels and priority, `overrides` winning. Resolves to the new task's id.
   * For a task that should run again changed; {@link retry} keeps the task.
   */
  refile(row: RefileRow, overrides?: RefileOverrides): Promise<string>;
};

/** `row`'s copied fields with `overrides` over them, as `createTask` takes them: unset and `null` fields left out. */
function refileInput(row: RefileRow, overrides: RefileOverrides): Record<string, unknown> {
  const copied = { goal: row.goal, title: row.title, context: row.context, assignee: row.assignee, labels: row.labels, priority: row.priority };
  return Object.fromEntries(Object.entries({ ...copied, ...overrides }).filter(([, value]) => value !== undefined && value !== null));
}

/** The Inbox's client: its one answer call, and each board's task actions. */
export type InboxClient = {
  /**
   * Answer `item`'s hold `questionId` (its first when omitted) with the answer
   * its ask takes. Rejects when the hold isn't answerable, or the route refuses.
   */
  answer(item: InboxItem<unknown>, answer: InboxAnswer, questionId?: string): Promise<void>;
  /** Answer one hold, as an item's are answered: for a hold drawn on its own, such as an ask in a task's session view. */
  answerOne(hold: InboxHold<unknown>, answer: InboxAnswer): Promise<void>;
  /**
   * Board `at`'s task actions: cancel, steer, release, retry and re-file, each
   * sent to the board's own action on the session that holds it. Answering a
   * task's question stays {@link answerOne}.
   */
  board(at: BoardAt): BoardActions;
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
    async answer(item, answer, questionId) {
      const hold = questionId === undefined ? item.holds[0] : item.holds.find((h) => h.id === questionId);
      if (hold === undefined) throw new Error(`Inbox item "${item.id}" holds no "${questionId}"`);
      await answerOne(hold, answer);
    },
    board({ flowId, sessionId, board }) {
      const send = (tool: TaskActionTool, input: Record<string, unknown>, what: string) =>
        sendBoardAction(client, { flowId, sessionId, action: taskActionName(tool, board) }, input, what);
      return {
        async cancel(id) {
          const output = await send("updateTask", { id, status: "cancelled" }, "cancel");
          // The board leaves `cancelled` out when no dependent went with it; anything else there is a protocol bug, not a "none".
          if (output.cancelled === undefined) return [];
          if (!Array.isArray(output.cancelled) || !output.cancelled.every((id) => typeof id === "string")) {
            throw new Error("The board cancelled the task, and its answer names its cancelled dependents in a shape it doesn't take.");
          }
          return output.cancelled as string[];
        },
        async steer(id, message) {
          await send("updateTask", { id, message }, "message");
        },
        async release(id) {
          await send("updateTask", { id, status: "pending" }, "release");
        },
        async retry(id) {
          await send("retryTask", { id }, "retry");
        },
        async refile(row, overrides = {}) {
          const output = await send("createTask", refileInput(row, overrides), "re-file");
          if (typeof output.taskId !== "string") throw new Error("The board filed the task again, and its answer names no task id.");
          return output.taskId;
        },
      };
    },
  };
}
