/**
 * The user's message log (FIX-1989): Workforce's `workforce/messages/*`,
 * read through the user's roster session. Another user's messages are not in it.
 */
import { useCallback, useEffect, useState } from "react";
import { readEveryCollectionPage } from "@flow-state-dev/client";
import { WORKER_MESSAGES_RESOURCE, workerMessageRowSchema, type WorkerMessageRow } from "@flow-state-dev/workforce/browser";
import { useLab } from "./lab-data";
import { describeFailure, type Failure } from "./reads";

export type { WorkerMessageRow };

/** How often the view reads the log again while it is open. */
export const MESSAGES_POLL_MS = 5_000;

/** One exchange: a first message and every answer to it, newest first. */
export type MessageExchange = {
  id: string;
  messages: WorkerMessageRow[];
  latest: number;
};

/** The rows a log read returned, each parsed by Workforce's own schema: a row that doesn't parse is left out. */
export function toMessageRows(items: readonly { clientData?: unknown }[]): WorkerMessageRow[] {
  const rows: WorkerMessageRow[] = [];
  for (const item of items) {
    const parsed = workerMessageRowSchema.safeParse(item.clientData);
    if (parsed.success) rows.push(parsed.data);
  }
  return rows;
}

/** The log as exchanges, the exchange with the newest message first, and each exchange's messages newest first. */
export function exchangesOf(rows: readonly WorkerMessageRow[]): MessageExchange[] {
  const byExchange = new Map<string, WorkerMessageRow[]>();
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
 */
export function useMessages(
  readerSessionId: string | null,
  readAt: number,
): { rows: WorkerMessageRow[] | undefined; failure: Failure | undefined; reread: () => void } {
  const { client } = useLab();
  const [rows, setRows] = useState<WorkerMessageRow[] | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (readerSessionId === null) return;
    let closed = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    readEveryCollectionPage(client.resources, readerSessionId, WORKER_MESSAGES_RESOURCE)
      .then(toMessageRows)
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
  }, [client, readerSessionId, readAt, reads]);
  const reread = useCallback(() => setReads((n) => n + 1), []);
  return { rows, failure: rows === undefined ? failure : undefined, reread };
}
