// FIX-1989; FIX-2624.
/**
 * The user's message log: Workforce's `workforce/messages/*`, read by user
 * scope with no session. Another user's messages are not in it.
 */
import { useCallback, useEffect, useState } from "react";
import { WORKER_MESSAGES_PATTERN, workerMessageResourceStateSchema, type WorkerMessageResourceState } from "@flow-state-dev/workforce/browser";
import { useLab } from "./lab-data";
import { describeFailure, readEveryScopeEntry, type Failure } from "./reads";

export type { WorkerMessageResourceState };

/** How often the view reads the log again while it is open. */
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

/**
 * The log, read when the view opens, again on each Lab read (`readAt`), and
 * every {@link MESSAGES_POLL_MS}. A later read keeps the last rows until it
 * lands, and a failed later read keeps them; only a failed first read shows.
 * `rows` is `null` when no flow of the Lab declares the log (a 404): it keeps
 * no roster for the user.
 */
export function useMessages(
  readAt: number,
): { rows: WorkerMessageResourceState[] | null | undefined; failure: Failure | undefined; reread: () => void } {
  const { client } = useLab();
  const [rows, setRows] = useState<WorkerMessageResourceState[] | null | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let closed = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    readEveryScopeEntry(client, "user", WORKER_MESSAGES_PATTERN)
      .then(toMessages)
      .then(
        (value): WorkerMessageResourceState[] | null => value,
        (error: unknown) => {
          if (describeFailure(error).httpStatus === 404) return null;
          throw error;
        },
      )
      .then((value) => {
        if (closed) return;
        setRows(value);
        setFailure(undefined);
      })
      .catch((error: unknown) => {
        if (!closed) setFailure(describeFailure(error));
      })
      .finally(() => {
        if (!closed) next = setTimeout(() => setReads((n) => n + 1), MESSAGES_POLL_MS);
      });
    return () => {
      closed = true;
      if (next !== undefined) clearTimeout(next);
    };
  }, [client, readAt, reads]);
  const reread = useCallback(() => setReads((n) => n + 1), []);
  return { rows, failure: rows === undefined ? failure : undefined, reread };
}
