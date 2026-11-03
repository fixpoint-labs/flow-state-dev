/**
 * A task's midway question, told to its filer (FIX-2241): the conversation
 * board's `onMidwayQuestion` delivery. Orchestration's `askMidway` calls it in
 * the asking request, in the task's session, with the row's open midway
 * questions read from the committed row, and again when a durable replay of
 * that turn asks again.
 *
 * Each question is one message from the task's worker to the worker that
 * filed the task, landing in the session that filed it (`sendMessage`'s
 * rule for a task's session; a workstream's session names that session by
 * the row's filer). The message is the server's, so it costs no
 * budget, and its id is derived from the task and the question, so a replay
 * writes nothing new: the row's take keeps it one message. The text names
 * the task and the question's id, so the filer can answer it with
 * `updateTask({ id, question, message })` without reading the task first.
 * A routed task's question is the user's alone: its filer is told the user
 * answers it from their Inbox.
 *
 * A message never stops anything: the Inbox item the hold opens stays the
 * one stop, and a filer that can't be told leaves the question there.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { WorkerInstallation } from "../workers/installation";
import type { RowHold, Task } from "@flow-state-dev/orchestration/tasks";
import { FILING_WORKER_STATE_KEY } from "../workers/keys";
import { MAX_MESSAGE_CHARS } from "./log-row";
import type { MessageTarget } from "./message-target";
import { sendMessage } from "./send-message";

/** The block a question's dispatch names as its sender. */
const MIDWAY_QUESTION_SENDER = "midway-question";

/** The id a question's message is sent under: one per task and question, whichever turn tells it. */
export function midwayQuestionMessageId(taskId: string, questionId: string): string {
  return `q:${taskId}:${questionId}`;
}

/** Whether `row` was routed to a workstream: its questions are the user's to answer (FIX-2133 ER-4). */
function isRouted(row: Task): boolean {
  return row.target !== undefined || row.targetSessionId !== undefined;
}

/** The most of a task's title (or goal) a question's text names it by, so the question always fits. */
const TASK_LABEL_CHARS = 200;

/** `text` cut to `max` characters, the last one an ellipsis when it was cut. */
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

/**
 * The text the filer's model reads for one question: the task, the question,
 * and how to answer it (a confirm's answer is `done`), or, for a routed task,
 * that the user answers it.
 */
export function midwayQuestionText(row: Task, hold: RowHold): string {
  const title = clip(row.title ?? row.goal, TASK_LABEL_CHARS);
  const how = isRouted(row)
    ? "The user answers it from their Inbox; it isn't yours to answer."
    : `Answer it with updateTask({ id: "${row.id}", answers: "${hold.id}", ${hold.ask.kind === "confirm" ? "done: true or false, " : ""}message }), or leave it to the user, who sees it in their Inbox.`;
  const head = `Your task "${title}" (${row.id}) asks: "`;
  const space = MAX_MESSAGE_CHARS - head.length - how.length - 2;
  const prompt = clip(hold.ask.prompt, space);
  return `${head}${prompt}"\n${how}`;
}

/**
 * Where the question goes: the filing worker, which a task's session names and
 * `sendMessage` lands in the session that filed it; or, in a workstream's
 * session, which names no filer, the conversation the row was filed from.
 */
function filerOf(ctx: BlockContext, row: Task): MessageTarget | undefined {
  const worker = ((ctx.session.state ?? {}) as Record<string, unknown>)[FILING_WORKER_STATE_KEY];
  if (typeof worker === "string") return worker;
  return row.filer === undefined ? undefined : { session: row.filer.sessionId };
}

/**
 * Tell `row`'s filer each of `holds`, one message per question. Runs in the
 * asking request: its session is the task's, its worker the task's. Nothing
 * is told when the filer is this session, when neither the session nor the
 * row names a filer, or when the running flow mounts no `onMessageReceived`
 * built by `messageReceivedEntry`. A send refused is said in the log: the
 * question stands in the Inbox.
 */
export async function sendQuestionToFiler(
  ctx: BlockContext,
  sender: { readonly installation: WorkerInstallation; readonly flowKind: string },
  row: Task,
  questions: readonly RowHold[]
): Promise<void> {
  if (row.filer?.sessionId === ctx.session.identity.id) return;
  const filer = filerOf(ctx, row);
  if (filer === undefined) {
    console.warn("[workforce] a task's midway question has no worker to tell: it is in the Inbox only", { taskId: row.id });
    return;
  }
  for (const hold of questions) {
    const sent = await sendMessage(
      ctx,
      sender.installation,
      sender.flowKind,
      { to: filer, text: midwayQuestionText(row, hold) },
      MIDWAY_QUESTION_SENDER,
      { id: midwayQuestionMessageId(row.id, hold.id), exempt: true }
    );
    if (!sent.ok) {
      console.warn("[workforce] a task's midway question couldn't be sent to its filer: it is in the Inbox only", { taskId: row.id, questionId: hold.id, error: sent.error });
    }
  }
}
