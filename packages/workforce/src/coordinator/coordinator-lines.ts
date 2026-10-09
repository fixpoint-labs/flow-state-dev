/**
 * A coordinator conversation's recent lines: what best fit chooses a delegate
 * with beside the post, and what the delegate that takes a post is shown
 * with it.
 *
 * A line is one message a person sees in the conversation: their post, the
 * coordinator's own reply, or a delegate's answer that landed. Lines are read
 * from the conversation's own items, as far back as its request loads them
 * (the session's history window, 50 requests by default), and the only
 * caller input among them is the person's own posts. Routing records, tool
 * calls and anything kept out of the conversation are not lines.
 *
 * Bounded twice: the last {@link RECENT_LINES} lines, and at most
 * {@link RECENT_CHARS} characters of their text, newest kept first. The line
 * that crosses the cap is cut short, ending `…`, and older ones are left out.
 *
 * A leaf, so the flow and the delegated-post entry share one line shape.
 */
import type { SessionItem, SessionItemViews } from "@flow-state-dev/core/types";
import { z } from "zod";
import { COORDINATOR_JUDGMENT } from "./coordinator-keys";

/** The most lines a post is routed and delivered with. */
export const RECENT_LINES = 10;

/** The most characters of line text a post is routed and delivered with. */
export const RECENT_CHARS = 4_000;

/** One line of a coordinator conversation: who wrote it, and what it says. */
export const conversationLineSchema = z.object({
  /** The person's user id, the coordinator's worker id, or the answering delegate's worker id. */
  from: z.string(),
  text: z.string()
});

export type ConversationLine = z.infer<typeof conversationLineSchema>;

/** Who a conversation's lines are written by, when no delegate wrote them. */
export interface LineWriters {
  /** The conversation's user: the writer of each of their posts. */
  person: string;
  /** The coordinator's worker id: the writer of each of its own replies. */
  coordinator: string;
}

/**
 * The conversation's recent lines before the running request, oldest first,
 * bounded. Read from the session's own items only.
 */
export function readRecentLines(session: { items: Pick<SessionItemViews, "all"> }, writers: LineWriters): ConversationLine[] {
  return recentLines(
    session.items.all({
      itemTypes: ["message"],
      itemVisibility: { client: true, history: true },
      includeInFlight: false
    }),
    writers
  );
}

/**
 * The lines among `items`, oldest first, bounded by {@link RECENT_LINES} and
 * {@link RECENT_CHARS}. A message with no text, or by neither the person nor
 * the flow, is not a line.
 */
export function recentLines(items: readonly SessionItem[], writers: LineWriters): ConversationLine[] {
  const lines: ConversationLine[] = [];
  for (const item of items) {
    if (item.type !== "message" || typeof item.payload !== "string" || item.payload.trim() === "") continue;
    const from = writerOf(item, writers);
    if (from !== undefined) lines.push({ from, text: item.payload });
  }
  return withinChars(lines.slice(-RECENT_LINES));
}

/**
 * Who wrote a message: the person for theirs; for the flow's, the delegate
 * its answer landed under, else the coordinator (its judgment turn's replies,
 * and what it says when nobody took a post).
 */
function writerOf(item: SessionItem, writers: LineWriters): string | undefined {
  if (item.role === "user") return writers.person;
  if (item.role !== "assistant") return undefined;
  if (item.agentName === undefined || item.agentName.startsWith(COORDINATOR_JUDGMENT)) return writers.coordinator;
  return item.agentName;
}

/** The newest lines whose text fits {@link RECENT_CHARS}, the one that crosses it cut short. */
function withinChars(lines: readonly ConversationLine[]): ConversationLine[] {
  const kept: ConversationLine[] = [];
  let left = RECENT_CHARS;
  for (let index = lines.length - 1; index >= 0 && left > 0; index -= 1) {
    const line = lines[index]!;
    if (line.text.length <= left) {
      kept.unshift(line);
      left -= line.text.length;
      continue;
    }
    kept.unshift({ from: line.from, text: `${line.text.slice(0, left)}…` });
    break;
  }
  return kept;
}
