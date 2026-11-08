/**
 * What the screen shows of worker talk, joined from two reads: the message
 * log (`watchTalk`) and a conversation (`watchConversation`). Plain functions
 * over adapter shapes, so the joins are UI, not package logic.
 */
import type { ConversationEntry, LabTalk } from "../adapter";

/**
 * Messages logged to `worker` that its conversation hasn't read yet: each
 * waits for the worker's current answer to end. The log says when one landed,
 * which covers a waited send's answer (no received line ever lands for it)
 * and a received line older than the loaded page. The join by message id
 * covers the moment a line has landed and the log's next read hasn't caught up.
 * `since` is when the conversation's window starts: a message sent before it was
 * read in an older turn the window no longer holds, so it is not waiting.
 */
export function pendingFor(worker: string, rows: LabTalk[], entries: ConversationEntry[], since?: number): LabTalk[] {
  const read = new Set(entries.flatMap((e) => (e.kind === "received" ? [e.messageId] : [])));
  return rows.filter((m) => m.to === worker && !m.undelivered && !m.delivered && !read.has(m.id) && (since === undefined || m.at >= since));
}

/**
 * The workers `worker` asked for a reply and hasn't heard back from, oldest
 * request first. A message sent without asking owes no answer, and one that never
 * landed gets none.
 */
export function owedRepliesFrom(worker: string, rows: LabTalk[]): string[] {
  const answered = new Set(rows.flatMap((m) => (m.inReplyTo ? [m.inReplyTo] : [])));
  return [...new Set(rows.filter((m) => m.from === worker && m.replyRequested && !m.undelivered && !answered.has(m.id)).map((m) => m.to))];
}
