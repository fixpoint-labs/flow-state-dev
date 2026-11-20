// FIX-1989; FIX-2624.
/**
 * The user's message log: Workforce's `workforce/messages/*`, read whole by
 * user scope with no session through `react`'s `useResource`, and kept
 * current by its notices: a new message is one entry read, never the whole
 * log again. Another user's messages are not in it.
 */
import { useMemo } from "react";
import { useResource } from "@flow-state-dev/react";
import { workerMessageResourceStateSchema, workerMessagesResource, type WorkerMessageResourceState } from "@flow-state-dev/workforce/browser";
import { useLab } from "./lab-data";
import { useReadAgainOnR } from "./page-reads";
import type { Failure } from "./failure";

export type { WorkerMessageResourceState };

/** One exchange: a first message and every answer to it, newest first. */
export type MessageExchange = {
  id: string;
  messages: WorkerMessageResourceState[];
  latest: number;
};

/** The messages a log read returned, each parsed by Workforce's own schema: one that doesn't parse is left out. */
export function toMessages(values: readonly unknown[]): WorkerMessageResourceState[] {
  const rows: WorkerMessageResourceState[] = [];
  for (const value of values) {
    const parsed = workerMessageResourceStateSchema.safeParse(value);
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
 * The log, read whole when the view opens and kept current by its notices.
 * A later read that fails keeps the rows already drawn; only a failed first
 * read shows. `rows` is `null` when no flow of the Lab declares the log (a
 * 404): it keeps no roster for the user.
 */
export function useMessages(): { rows: WorkerMessageResourceState[] | null | undefined; failure: Failure | undefined; reread: () => void } {
  const { client } = useLab();
  const { value, failure, refresh } = useResource(workerMessagesResource, { client, all: true });
  useReadAgainOnR(refresh);
  const rows = useMemo(() => (value === null ? undefined : toMessages(value.map((entry) => entry.value))), [value]);
  if (rows !== undefined) return { rows, failure: undefined, reread: refresh };
  if (failure?.httpStatus === 404) return { rows: null, failure: undefined, reread: refresh };
  return { rows: undefined, failure, reread: refresh };
}
