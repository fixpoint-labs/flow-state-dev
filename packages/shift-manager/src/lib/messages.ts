// FIX-1989; FIX-2624; FIX-2845.
/**
 * The user's message log: Workforce's `workforce/messages/*`, read by user
 * scope with no session. Another user's messages are not in it.
 *
 * The screen reads the newest page and asks for older pages as it scrolls.
 * A notice that names messages merges those messages in.
 */
import { useEffect, useRef } from "react";
import { useResource } from "@flow-state-dev/react";
import { WORKER_MESSAGES_PATTERN, workerMessageResourceStateSchema, type WorkerMessageResourceState } from "@flow-state-dev/workforce/browser";
import { useLab } from "./lab-data";
import type { Failure } from "./reads";

export type { WorkerMessageResourceState };

/** The pace the view reads the log at while it is open, wherever push can miss a change. */
const MESSAGES_POLL_MS = 5_000;

/** One exchange: a first message and every answer to it, newest first. */
export type MessageExchange = {
  id: string;
  messages: WorkerMessageResourceState[];
  latest: number;
};

/** The messages a log read returned, each parsed by Workforce's own schema: one that doesn't parse is left out. */
export function toMessages(items: readonly { clientData?: unknown }[]): WorkerMessageResourceState[] {
  const rows: WorkerMessageResourceState[] = [];
  for (const item of items) {
    const parsed = workerMessageResourceStateSchema.safeParse(item.clientData);
    if (parsed.success) rows.push(parsed.data);
  }
  return rows;
}

/** The log as exchanges, the exchange with the newest message first, and each exchange's messages newest first. */
export function exchangesOf(rows: readonly WorkerMessageResourceState[]): MessageExchange[] {
  const byExchange = new Map<string, WorkerMessageResourceState[]>();
  for (const row of rows) {
    const bucket = byExchange.get(row.exchange);
    if (bucket === undefined) byExchange.set(row.exchange, [row]);
    else bucket.push(row);
  }
  return [...byExchange.entries()]
    .map(([id, messages]) => {
      const sorted = [...messages].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
      return { id, messages: sorted, latest: sorted[0]!.at };
    })
    .sort((a, b) => b.latest - a.latest || b.id.localeCompare(a.id));
}

/** The text's first line, for a one-line view. */
export function firstLine(text: string): string {
  const line = text.split("\n").find((part) => part.trim() !== "") ?? "";
  return line.trim();
}

/** The log, as `useResource` reads it: newest page first, at user scope. */
const workerMessages = { scope: "user" as const, pattern: WORKER_MESSAGES_PATTERN };

/**
 * The log, read when the view opens, again on each Lab read (`readAt`), and on
 * each notice of a message under the user's scope; wherever push can miss a
 * change, every {@link MESSAGES_POLL_MS}. The newest page comes first.
 * `loadOlder()` fetches the next older page. A notice that names messages
 * merges those messages in. A later read keeps the last rows until it lands,
 * and a failed later read keeps them; only a failed first read shows.
 * `rows` is `null` when no flow of the Lab declares the log (a 404): it keeps
 * no roster for the user.
 */
export function useMessages(readAt: number): {
  rows: WorkerMessageResourceState[] | null | undefined;
  failure: Failure | undefined;
  reread: () => void;
  /** Whether an older page of the log can be loaded. */
  hasOlder: boolean;
  /** Fetch the next older page. No-op when `hasOlder` is false. */
  loadOlder: () => void;
} {
  const { client } = useLab();
  // The log is the user's: a message sent from any session writes its row under the user's scope.
  const log = useResource(workerMessages, { newest: true, client, pollIntervalMs: MESSAGES_POLL_MS });
  // A Lab read reads the open window again; the hook's own first read covers the one it opened on.
  const readAtSeen = useRef(readAt);
  useEffect(() => {
    if (readAtSeen.current === readAt) return;
    readAtSeen.current = readAt;
    log.refresh();
  }, [readAt, log.refresh]);
  const rows =
    log.value === null
      ? log.failure?.httpStatus === 404
        ? null
        : undefined
      : toMessages(log.value.map((entry) => ({ clientData: entry.value })));
  return {
    rows,
    failure: rows === undefined ? log.failure : undefined,
    reread: log.refresh,
    hasOlder: log.hasOlder,
    loadOlder: log.loadOlder
  };
}
