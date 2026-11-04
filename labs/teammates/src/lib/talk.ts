/**
 * What the screen shows of worker talk, joined from two reads: the message
 * log (`watchTalk`) and a conversation (`watchConversation`). Plain functions
 * over adapter shapes, so the joins are UI, not package logic.
 */
import type { ConversationEntry, TalkRow } from "../adapter";

/**
 * Messages logged to `worker` that its conversation hasn't read yet: each
 * waits for the worker's current answer to end. The log says when one landed,
 * which covers a waited send's answer (no received line ever lands for it)
 * and a received line older than the loaded page. The join by message id
 * covers the moment a line has landed and the log's next read hasn't caught up.
 */
export function pendingFor(worker: string, rows: TalkRow[], entries: ConversationEntry[]): TalkRow[] {
  const read = new Set(entries.flatMap((e) => (e.kind === "received" ? [e.messageId] : [])));
  return rows.filter((m) => m.to === worker && !m.undelivered && !m.delivered && !read.has(m.id));
}

/**
 * The workers `worker` asked for a reply and hasn't heard back from, oldest
 * request first. A message sent without asking owes no answer, and one that never
 * landed gets none.
 */
export function waitingOn(worker: string, rows: TalkRow[]): string[] {
  const answered = new Set(rows.flatMap((m) => (m.inReplyTo ? [m.inReplyTo] : [])));
  return [...new Set(rows.filter((m) => m.from === worker && m.replyRequested && !m.undelivered && !answered.has(m.id)).map((m) => m.to))];
}
