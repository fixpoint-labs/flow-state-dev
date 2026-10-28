/**
 * A task's midway question, told to its filer (FIX-2241). `askMidway` calls
 * this with the row's open midway holds, including when that turn is replayed.
 * The id is `q:<task>:<hold>`, so the row's take keeps a replay to one message.
 * It costs no budget. The Inbox item stays the one stop.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { RowHold, Task } from "@flow-state-dev/orchestration/tasks";
import { FILING_WORKER_STATE_KEY } from "../workers/keys";
import { MAX_MESSAGE_CHARS } from "./log-row";
import { messageSenderOf } from "./message-received-entry";
import type { MessageTarget } from "./message-target";
import { sendMessage } from "./send-message";

/** The block a question's dispatch names as its sender. */
const MIDWAY_QUESTION_SENDER = "midway-question";

/** One id per task and question, so a replayed turn writes the same row. */
export function midwayQuestionMessageId(taskId: string, holdId: string): string {
  return `q:${taskId}:${holdId}`;
}

/** The text the filer reads. A routed task's question is the user's to answer (FIX-2133 ER-4). */
export function midwayQuestionText(row: Task, hold: RowHold): string {
  const title = row.title ?? row.goal;
  const routed = row.target !== undefined || row.targetSessionId !== undefined;
  const how = routed
    ? "The user answers it from their Inbox; it isn't yours to answer."
    : `Answer it with updateTask({ id: "${row.id}", question: "${hold.id}", message }), or leave it to the user, who sees it in their Inbox.`;
  const head = `Your task "${title}" (${row.id}) asks: "`;
  const space = MAX_MESSAGE_CHARS - head.length - how.length - 2;
  const prompt = hold.ask.prompt.length > space ? `${hold.ask.prompt.slice(0, Math.max(0, space - 1))}…` : hold.ask.prompt;
  return `${head}${prompt}"\n${how}`;
}

/**
 * One message per hold. Nothing is sent when this session is the filer, when
 * no filer is named, or when this flow has no `messageReceivedEntry`. A refused
 * send is logged; the question stays in the Inbox.
 */
export async function sendQuestionToFiler(ctx: BlockContext, row: Task, holds: readonly RowHold[]): Promise<void> {
  if (row.filer?.sessionId === ctx.session.identity.id) return;
  const sender = messageSenderOf((ctx as { readonly flow?: unknown }).flow);
  // A task session names the filing worker (`sendMessage` lands that in the
  // filing session). A workstream's session names none, so the row's filer
  // session is the address.
  const named = ((ctx.session.state ?? {}) as Record<string, unknown>)[FILING_WORKER_STATE_KEY];
  const filer: MessageTarget | undefined =
    typeof named === "string" ? named : row.filer === undefined ? undefined : { session: row.filer.sessionId };
  if (sender === undefined || filer === undefined) {
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
