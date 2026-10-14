/**
 * The user's message log (FIX-1989): every message one of their workers sent
 * another, as Workforce's `workforce/messages/*` collection holds it, read
 * through the user's own roster session (the one Shift Manager reads
 * projects through), whose flow declares it with a browser read. The log is the user's: another user's messages are never in it.
 *
 * Read when the Messages view opens, each time the Lab is read again, and
 * every {@link MESSAGES_POLL_MS} while it is on screen, since messages are
 * sent by worker turns the page didn't start.
 */
import { useCallback, useEffect, useState } from "react";
import { readEveryCollectionPage } from "@flow-state-dev/client";
import { WORKER_MESSAGES_RESOURCE, workerMessageRowSchema, type WorkerMessageRow } from "@flow-state-dev/workforce/browser";
import type { LabClients } from "./connection";
import { useLab } from "./lab-data";
import { describeFailure, type Failure } from "./reads";

export type { WorkerMessageRow };

/** How often the view reads the log again while it is open. */
export const MESSAGES_POLL_MS = 5_000;

/** One thread: a first message and every answer to it, newest first. */
export type MessageThread = {
  /** The first message's id. */
  id: string;
  /** Its messages, newest first. */
  messages: WorkerMessageRow[];
  /** When its newest message was sent, epoch ms. */
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

/** The log as threads, the thread with the newest message first, and each thread's messages newest first. */
export function threadsOf(rows: readonly WorkerMessageRow[]): MessageThread[] {
  const byThread = new Map<string, WorkerMessageRow[]>();
  for (const row of rows) byThread.set(row.thread, [...(byThread.get(row.thread) ?? []), row]);
  return [...byThread.entries()]
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

/** Read the whole log, through the user's roster session `readerSessionId`. */
export async function readMessages(clients: LabClients, readerSessionId: string): Promise<WorkerMessageRow[]> {
  return toMessageRows(await readEveryCollectionPage(clients.resources, readerSessionId, WORKER_MESSAGES_RESOURCE));
}

/**
 * The log, read when the view opens, again on each Lab read (`readAt`), and
 * every {@link MESSAGES_POLL_MS}. A read again keeps the last one on screen
 * until it lands, and keeps it if it fails; only a failed first read shows.
 */
export function useMessages(
  readerSessionId: string | null,
  readAt: number,
): { rows: WorkerMessageRow[] | undefined; failure: Failure | undefined; reread: () => void } {
  const { clients } = useLab();
  const [rows, setRows] = useState<WorkerMessageRow[] | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (readerSessionId === null) return;
    let closed = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    readMessages(clients, readerSessionId)
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
  }, [clients, readerSessionId, readAt, reads]);
  const reread = useCallback(() => setReads((n) => n + 1), []);
  return { rows, failure: rows === undefined ? failure : undefined, reread };
}
