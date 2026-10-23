/**
 * What the screen shows of worker talk, joined from two reads: the message
 * log (`watchTalk`) and a conversation (`watchConversation`). Plain functions
 * over adapter shapes, so the joins are UI, not package logic.
 */
import type { ConversationEntry, TalkRow } from "../adapter";

/**
 * Messages logged to `worker` that its conversation hasn't read yet: each
 * waits for the worker's current answer to end. Joined by message id, so it
 * needs the received entry to carry one.
 */
export function pendingFor(worker: string, rows: TalkRow[], entries: ConversationEntry[]): TalkRow[] {
  const read = new Set(entries.flatMap((e) => (e.kind === "received" ? [e.messageId] : [])));
  return rows.filter((m) => m.to === worker && !read.has(m.id));
}

/** The workers `worker` has messaged and not heard back from, oldest ask first. */
export function waitingOn(worker: string, rows: TalkRow[]): string[] {
  const answered = new Set(rows.flatMap((m) => (m.inReplyTo ? [m.inReplyTo] : [])));
  return [...new Set(rows.filter((m) => m.from === worker && !m.inReplyTo && !answered.has(m.id)).map((m) => m.to))];
}

/** One other worker's exchanges with `worker`. */
export interface TalkGroup {
  with: string;
  rows: TalkRow[];
  lastAt: number;
}

/** `worker`'s exchanges grouped by the other worker, the most recent group first. */
export function groupTalk(worker: string, rows: TalkRow[]): TalkGroup[] {
  const groups = new Map<string, TalkRow[]>();
  for (const m of rows) {
    const other = m.from === worker ? m.to : m.from;
    groups.set(other, [...(groups.get(other) ?? []), m]);
  }
  return [...groups].map(([other, of]) => ({ with: other, rows: of, lastAt: Math.max(...of.map((m) => m.at)) })).sort((a, b) => b.lastAt - a.lastAt);
}
