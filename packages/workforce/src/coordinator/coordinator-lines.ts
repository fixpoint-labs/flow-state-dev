/**
 * A coordinator conversation's recent lines: what best fit chooses a delegate
 * with beside the post, and what the delegate that takes a post is shown
 * with it.
 *
 * A line is one message a person sees in the conversation: their post, the
 * coordinator's own reply, or a delegate's answer that landed. Lines are read
 * from the conversation's own items, as far back as its request loads them
 * (the session's history window: its last 50 completed turns by default, each
 * request one turn), and the only caller input among them is the person's own
 * posts. Routing records, tool calls and anything kept out of the
 * conversation are not lines.
 *
 * An answer is in the conversation, and on its stream, a moment before the
 * request that landed it finishes, and a request reads only finished ones.
 * So the claim that lands an answer also keeps it in session state
 * ({@link LANDED_STATE}), and a reader adds each kept answer whose request
 * its items don't hold yet.
 *
 * Bounded twice: the last {@link RECENT_LINES} lines, and at most
 * {@link RECENT_CHARS} characters of their text, newest kept first. The line
 * that crosses the cap is cut short, ending `…`, and older ones are left out.
 *
 * A leaf, so the flow and the delegated-post entry share one line shape.
 */
import type { LLMMessage, SessionItem, SessionItemViews } from "@flow-state-dev/core/types";
import { z } from "zod";
import { COORDINATOR_ROUTE, LANDED_STATE } from "./coordinator-keys";

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

/** A post's lines as a delivery carries them: present only when there are any. One rule for every writer. */
export function linesField(recent: readonly ConversationLine[] | undefined): { recent?: ConversationLine[] } {
  return recent === undefined || recent.length === 0 ? {} : { recent: [...recent] };
}

/** An answer kept as it landed, until every reader's items hold the request that landed it. */
export const landedAnswerSchema = z.object({
  /** The request that landed it: its line in the items is this request's message. */
  requestId: z.string(),
  /** The delegate's worker id. */
  from: z.string(),
  text: z.string(),
  /** Epoch milliseconds at the claim. */
  at: z.number()
});

export type LandedAnswer = z.infer<typeof landedAnswerSchema>;

/** The kept answers, oldest first: the last {@link RECENT_LINES}, each cut to {@link RECENT_CHARS}. */
export const landedAnswersSchema = z.array(landedAnswerSchema);

/** Keep one more landed answer. */
export function keepLanded(kept: unknown, answer: LandedAnswer): LandedAnswer[] {
  const parsed = landedAnswersSchema.safeParse(kept ?? []);
  const cut = { ...answer, text: answer.text.slice(0, RECENT_CHARS) };
  return [...(parsed.success ? parsed.data : []), cut].slice(-RECENT_LINES);
}

/** Who a conversation's lines are written by, when no delegate wrote them. */
export interface LineWriters {
  /** The conversation's user: the writer of each of their posts. */
  person: string;
  /** The coordinator's worker id: the writer of each of its own replies. */
  coordinator: string;
  /** The `agentName`s the coordinator's own turn writes under. */
  coordinatorNames: readonly string[];
}

/**
 * The conversation's recent lines before the running request, oldest first,
 * bounded: its own items, and the answers its session state kept that those
 * items don't hold yet.
 */
export function readRecentLines(
  session: { items: Pick<SessionItemViews, "all">; state: Readonly<Record<string, unknown>> },
  writers: LineWriters
): ConversationLine[] {
  const items = session.items.all({
    itemTypes: ["message"],
    itemVisibility: { client: true, history: true },
    includeInFlight: false
  });
  return recentLines(items, writers, session.state[LANDED_STATE]);
}

/**
 * The lines among `items`, with each of `landed` whose request they don't
 * hold, oldest first, bounded by {@link RECENT_LINES} and {@link RECENT_CHARS}.
 * A message with no text, or by neither the person nor the flow, is not a
 * line. A kept answer older than the oldest message the items reach is left
 * out, as its request is.
 */
export function recentLines(items: readonly SessionItem[], writers: LineWriters, landed?: unknown): ConversationLine[] {
  const timed: Array<ConversationLine & { at: number }> = [];
  const held = new Set<string>();
  let oldest = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item.type !== "message") continue;
    held.add(item.requestId);
    oldest = Math.min(oldest, item.ts ?? 0);
    if (typeof item.payload !== "string" || item.payload.trim() === "") continue;
    const from = writerOf(item, writers);
    if (from !== undefined) timed.push({ from, text: item.payload, at: item.ts ?? 0 });
  }
  // With no message in reach there is nothing to be older than.
  const floor = oldest === Number.POSITIVE_INFINITY ? Number.NEGATIVE_INFINITY : oldest;
  const kept = landedAnswersSchema.safeParse(landed ?? []);
  for (const answer of kept.success ? kept.data : []) {
    if (held.has(answer.requestId) || answer.at < floor || answer.text.trim() === "") continue;
    timed.push({ from: answer.from, text: answer.text, at: answer.at });
  }
  // Stable: items keep their order, and a kept answer goes after anything no later than it.
  timed.sort((a, b) => a.at - b.at);
  return withinChars(timed.slice(-RECENT_LINES).map(({ from, text }) => ({ from, text })));
}

/**
 * Who wrote a message: the person for theirs; for the flow's, the coordinator
 * when its own turn wrote it, or when nothing named a writer (what it says
 * when nobody took a post), else the delegate its answer landed under.
 */
function writerOf(item: SessionItem, writers: LineWriters): string | undefined {
  if (item.role === "user") return writers.person;
  if (item.role !== "assistant") return undefined;
  if (item.agentName === undefined || writers.coordinatorNames.includes(item.agentName)) return writers.coordinator;
  return item.agentName;
}

/**
 * The coordinator turn's history, read so the turn knows what it did and
 * what its delegates did. A history read as `history: true` holds the
 * conversation's messages by role alone, which misleads the coordinator's
 * model in two ways once posts reach delegates without its turn:
 *
 * - **A delegate's answer** lands as an assistant message under the
 *   delegate's name, so the model reads it as a reply of its own. It is said
 *   instead as a line from that delegate: `<delegate>, a delegate in this
 *   conversation, answered:` and the answer. Data from the conversation, never
 *   system text. It stays on the assistant side: as a user-role message it
 *   would run into the person's next post, and the model would read the
 *   person's words as the delegate's.
 * - **A person's post the routing handed to delegates** has no reply of the
 *   turn's after it, so the model reads it as still waiting on it, and acts
 *   on it again. Right after it comes the coordinator's own account of what
 *   happened, as an assistant message: `Handed this post to <delegates> by
 *   its routing, with no turn of mine. …`, what its `handOff` would have said.
 *
 * `history` holds no writers or requests, so its messages are matched, in
 * order, to the items with the same role and text. Anything unmatched is kept
 * as it is.
 *
 * @param history The turn's history, oldest first.
 * @param items The conversation's items, oldest first, as far back as `history`
 *   reaches: its messages, and its routing records (`coordinator-route` components).
 * @param coordinatorNames The `agentName`s the coordinator's own turn writes under.
 */
export function coordinatorHistory(
  history: readonly LLMMessage[],
  items: readonly SessionItem[],
  coordinatorNames: readonly string[]
): LLMMessage[] {
  const messages = (role: "user" | "assistant") =>
    items.filter((item) => item.type === "message" && item.role === role && typeof item.payload === "string" && item.payload !== "");
  const byRole = { user: messages("user"), assistant: messages("assistant") };
  const next = { user: 0, assistant: 0 };
  /** The item a history message came from: the next of its role with its text. */
  const itemOf = (message: LLMMessage): SessionItem | undefined => {
    if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") return undefined;
    const role = message.role;
    const at = byRole[role].findIndex((item, index) => index >= next[role] && item.payload === message.content);
    if (at === -1) return undefined;
    next[role] = at + 1;
    return byRole[role][at];
  };
  const routed = routedPosts(items);
  const writers: LineWriters = { person: "", coordinator: "", coordinatorNames };
  return history.flatMap((message): LLMMessage[] => {
    const item = itemOf(message);
    if (item === undefined) return [message];
    if (item.role === "user") {
      const to = routed.get(item.requestId);
      if (to === undefined) return [message];
      const answers = to.length === 1 ? "Its answer lands" : "Their answers land";
      return [
        message,
        { role: "assistant", content: `Handed this post to ${to.join(", ")} by its routing, with no turn of mine. ${answers} in this conversation under ${to.length === 1 ? "its name" : "their names"}.` }
      ];
    }
    const delegate = writerOf(item, writers);
    if (delegate === undefined || delegate === writers.coordinator) return [message];
    return [{ role: "assistant", content: `${delegate}, a delegate in this conversation, answered:\n${message.content as string}` }];
  });
}

/** Each person's post the routing delivered without the coordinator's turn, by its request id: the delegates it reached. */
function routedPosts(items: readonly SessionItem[]): Map<string, string[]> {
  const routed = new Map<string, string[]>();
  for (const item of items) {
    const record = (item.payload as { component?: unknown; data?: unknown } | null | undefined) ?? undefined;
    if (item.type !== "component" || record?.component !== COORDINATOR_ROUTE) continue;
    const data = record.data as { postId?: unknown; round?: unknown; by?: unknown; delegates?: unknown } | undefined;
    if (data?.round !== 0 || data.by === "judgment" || data.by === "unplaced" || typeof data.postId !== "string") continue;
    const reached = (Array.isArray(data.delegates) ? data.delegates : [])
      .filter((d: { outcome?: unknown; worker?: unknown }) => d?.outcome === "delivered" && typeof d.worker === "string")
      .map((d: { worker: string }) => d.worker);
    if (reached.length > 0) routed.set(data.postId, reached);
  }
  return routed;
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
