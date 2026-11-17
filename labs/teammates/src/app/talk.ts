/**
 * The messages workers send each other: the user's message log, and what the
 * recipient did with one message, read from the turn that read it.
 */
import { readEveryCollectionPage, topic } from "@flow-state-dev/client";
import { getPatternPrefix } from "@flow-state-dev/core/types";
import {
  RECEIVED_MESSAGE_DATA_TYPE,
  WORKER_MESSAGES_PATTERN,
  WORKER_MESSAGES_RESOURCE,
  workerMessageResourceStateSchema,
} from "@flow-state-dev/workforce/browser";
import { stableList } from "../lib/stable";
import type { Item } from "./items";
import { logFailedRead, POLL_MS, type Unsubscribe } from "./reads";
import type { AppState } from "./state";
import { toSteps, type SessionStep } from "./steps";

/** One row of the message log: one message from one worker to another. */
export interface AppTalk {
  id: string;
  from: string;
  to: string;
  text: string;
  /** The message this one answers. */
  inReplyTo?: string;
  /** When it was sent, in ms. */
  at: number;
  /** It was refused, or nobody took it in time: it will never land. */
  undelivered?: boolean;
  /** It landed: as a received line in one of the recipient's conversations, or as a waited send's result, which lands as no line. */
  delivered?: boolean;
  /** The sender asked for a reply: one answer comes back, as a message or as a waited send's result. */
  replyRequested?: boolean;
  /** The framework's "no answer" to the message it replies to: the recipient's turn gave none. */
  noAnswer?: boolean;
}

/** The session a message was delivered to, from the message log; undefined while the log doesn't hold it. */
export function destinationOf(rows: readonly unknown[], messageId: string): string | undefined {
  for (const row of rows) {
    const parsed = workerMessageResourceStateSchema.safeParse(row);
    if (parsed.success && parsed.data.id === messageId) return parsed.data.toSession;
  }
  return undefined;
}

/**
 * The turn of a conversation that read message `messageId`, as steps: the
 * message, then all that turn did. The last receipt: a taker that died is
 * taken over, and the turn that took over is the one that answered.
 */
export function exchangeOf(items: readonly Item[], messageId: string): SessionStep[] {
  const read = [...items].reverse().find((i) => i.type === "data" && i.dataType === RECEIVED_MESSAGE_DATA_TYPE && i.value?.id === messageId);
  return read === undefined ? [] : toSteps(items.filter((i) => i.requestId === read.requestId));
}

/** The message log and one message's exchange, watched. */
export interface TalkCalls {
  /** Every message to or from `worker`, oldest first. */
  watchTalk(worker: string, onChange: (rows: AppTalk[]) => void): Unsubscribe;
  /**
   * What `worker` did with one message it was sent: the turn in its own
   * conversation that read it, from the message to the turn's end, live.
   * Empty until the message is read.
   */
  watchExchange(worker: string, messageId: string, onChange: (steps: SessionStep[]) => void): Unsubscribe;
}

/** {@link TalkCalls} over the app's shared state. */
export function talkCalls(state: AppState): TalkCalls {
  const { client, watchFeed, conversationOf, anyConversation } = state;
  return {
    watchTalk(worker, onChange) {
      // The log is the user's: a message sent from any session writes its row under the user's scope.
      return client.live([topic.user()], {
        read: async () => {
          const { sessionId } = await anyConversation();
          const rows = await readEveryCollectionPage(client.resources, sessionId, WORKER_MESSAGES_RESOURCE);
          return rows
            .map((row) => workerMessageResourceStateSchema.safeParse(row.clientData))
            .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
            .filter((m) => m.from === worker || m.to === worker)
            .sort((a, b) => a.at - b.at)
            .map((m) => ({
              id: m.id,
              from: m.from,
              to: m.to,
              text: m.text,
              at: m.at,
              ...(m.inReplyTo === undefined ? {} : { inReplyTo: m.inReplyTo }),
              ...(m.replyRequested === true ? { replyRequested: true } : {}),
              ...(m.noAnswer === true ? { noAnswer: true } : {}),
              ...(m.status === "refused" || m.status === "undeliverable" ? { undelivered: true } : {}),
              ...(m.status === "delivered" ? { delivered: true } : {}),
            }));
        },
        onValue: onChange,
        hear: (notice) => notice.kind === "resource",
        paths: [getPatternPrefix(WORKER_MESSAGES_PATTERN)],
        pollIntervalMs: POLL_MS,
        onError: logFailedRead,
      }).close;
    },
    watchExchange(worker, messageId, onChange) {
      let stop: Unsubscribe | undefined;
      let live = true;
      void (async () => {
        // A reply lands where the message it answers was sent from, a task's session included: the log row says where.
        // A failed log read falls back to the recipient's conversation rather than leaving the popup unwatched.
        const rows = await anyConversation()
          .then(({ sessionId: logSession }) => readEveryCollectionPage(client.resources, logSession, WORKER_MESSAGES_RESOURCE))
          .catch(() => []);
        const sessionId = destinationOf(rows.map((row) => row.clientData), messageId) ?? (await conversationOf(worker)).sessionId;
        if (!live) return;
        stop = watchFeed(sessionId, (items) => exchangeOf(items, messageId), stableList(onChange));
      })();
      return () => {
        live = false;
        stop?.();
      };
    },
  };
}
