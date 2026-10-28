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
export function midwayQuestionMessageId(taskId: string, holdId: string): string {
  return `q:${taskId}:${holdId}`;
}

/** Whether `row` was routed to a workstream: its questions are the user's to answer (FIX-2133 ER-4). */
function isRouted(row: Task): boolean {
  return row.target !== undefined || row.targetSessionId !== undefined;
}

/**
 * The text the filer's model reads for one question: the task, the question,
 * and how to answer it, or, for a routed task, that the user answers it.
 */
export function midwayQuestionText(row: Task, hold: RowHold): string {
  const title = row.title ?? row.goal;
  const how = isRouted(row)
    ? "The user answers it from their Inbox; it isn't yours to answer."
    : `Answer it with updateTask({ id: "${row.id}", question: "${hold.id}", message }), or leave it to the user, who sees it in their Inbox.`;
  const head = `Your task "${title}" (${row.id}) asks: "`;
  const space = MAX_MESSAGE_CHARS - head.length - how.length - 2;
  const prompt = hold.ask.prompt.length > space ? `${hold.ask.prompt.slice(0, Math.max(0, space - 1))}…` : hold.ask.prompt;
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
  holds: readonly RowHold[]
): Promise<void> {
  if (row.filer?.sessionId === ctx.session.identity.id) return;
  const filer = filerOf(ctx, row);
  if (filer === undefined) {
    console.warn("[workforce] a task's midway question has no worker to tell: it is in the Inbox only", { taskId: row.id });
    return;
  }
  for (const hold of holds) {
    const sent = await sendMessage(
      ctx,
      sender.installation,
      sender.flowKind,
      { to: filer, text: midwayQuestionText(row, hold) },
      MIDWAY_QUESTION_SENDER,
      { id: midwayQuestionMessageId(row.id, hold.id), exempt: true }
    );
    if (!sent.ok) {
      console.warn("[workforce] a task's midway question couldn't be sent to its filer: it is in the Inbox only", { taskId: row.id, holdId: hold.id, error: sent.error });
    }
  }
}
