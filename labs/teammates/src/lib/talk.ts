/**
 * What the screen shows of worker talk, from workforce's worker messages view
 * (a worker's open messages, and the rows and answers of the lines on screen)
 * joined with a conversation (`useConversation`), and what the recipient did
 * with one message, read from the turn of its conversation that read it.
 */
import { useView, type ItemLine } from "@flow-state-dev/react";
import { RECEIVED_MESSAGE_DATA_TYPE, workerMessagesViewRef, type WorkerMessageResourceState } from "@flow-state-dev/workforce/browser";
import { useAppClient } from "../app";

type Message = WorkerMessageResourceState;

/** It was refused, or nobody took it in time: it will never land. */
const undelivered = (m: Message) => m.status === "refused" || m.status === "undeliverable";

/** The most lines on screen the worker messages view answers for: the newest ones. An older line shows no status. */
export const ANSWERED_LINES_MAX = 50;

/**
 * `worker`'s open messages, and the row and answer of each of `ids` (lines on
 * screen, at most {@link ANSWERED_LINES_MAX}), oldest first, live. `undefined`
 * until the first read lands.
 */
export function useTalk(worker: string, ids: readonly string[] = []): Message[] | undefined {
  const { client, pollIntervalMs } = useAppClient();
  const input = ids.length === 0 ? { worker } : { worker, ids: [...ids] };
  return useView(workerMessagesViewRef(), input, { client, pollIntervalMs }).value;
}

/**
 * Messages logged to `worker` that its conversation hasn't read yet: each
 * waits for the worker's current answer to end. The log says when one landed,
 * which covers a waited send's answer (no received line ever lands for it)
 * and a received line older than the loaded page. The join by message id
 * covers the moment a line has landed and the log's next read hasn't caught up.
 * `since` is when the conversation's window starts: a message sent before it was
 * read in an older turn the window no longer holds, so it is not waiting.
 */
export function pendingFor(worker: string, rows: readonly Message[], lines: readonly ItemLine[], since?: number): Message[] {
  const read = new Set(lines.flatMap((line) => receivedId(line) ?? []));
  return rows.filter((m) => m.to === worker && m.status === "unconfirmed" && !read.has(m.id) && (since === undefined || m.at >= since));
}

/**
 * The workers `worker` asked for a reply and hasn't heard back from, oldest
 * request first. A message sent without asking owes no answer, and one that never
 * landed gets none.
 */
export function owedRepliesFrom(worker: string, rows: readonly Message[]): string[] {
  const answered = new Set(rows.flatMap((m) => (m.inReplyTo ? [m.inReplyTo] : [])));
  return [...new Set(rows.filter((m) => m.from === worker && m.replyRequested && !undelivered(m) && !answered.has(m.id)).map((m) => m.to))];
}

/** The id of the message a received line read, or `undefined` for any other line. */
function receivedId(line: ItemLine): string | undefined {
  if (line.kind !== "data" || line.item.dataType !== RECEIVED_MESSAGE_DATA_TYPE) return undefined;
  const id = (line.item.value as { id?: unknown } | undefined)?.id;
  return typeof id === "string" ? id : undefined;
}

/**
 * The turn of a conversation that read message `messageId`, as its lines:
 * the message, then all that turn did. The last receipt: a taker that died is
 * taken over, and the turn that took over is the one that answered.
 */
export function exchangeOf(lines: readonly ItemLine[], messageId: string): ItemLine[] {
  const read = [...lines].reverse().find((line) => receivedId(line) === messageId);
  return read === undefined ? [] : lines.filter((line) => line.requestId === read.requestId);
}
