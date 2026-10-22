/**
 * A coordinator conversation's routed tasks, read as rows on its task board
 * from an install's SQLite store file.
 *
 * A coordinator hands a user's message to each delegate by filing one routed
 * task on the conversation's board (FIX-2083): an ordinary task whose sealed
 * brief carries the message, its round, and the delegate it was routed to. The
 * task is the record of that hand-off. Goals that grade hand-offs
 * (`routes-each-message-as-a-task`, `hands-each-post-to-its-delegates`,
 * `a-shared-project-has-one-owner-per-workstream`,
 * `two-users-share-a-project-and-nothing-else`) read the tasks through this
 * and give each one the same shape: the message and its round, the delegate,
 * where it was worked, and how it went. A row stored before FIX-2083 as a
 * post carries the same brief, so it reads here the same way.
 *
 * Read straight from the file, as the user who owns the conversation: no route
 * sends a client a board's rows with their server-written brief. Read-only,
 * and closed after each read.
 */
import { DatabaseSync } from "node:sqlite";

/** One message routed to one delegate, as a goal grades it. */
export type RoutedDelivery = {
  /** The id of the message the coordinator routed (the brief's `postId`). */
  postId: string;
  round: number;
  delegate: { worker: string; target?: string };
  /** `delivered` once the task was worked in a session; `failed` when it ended before one; else `pending`. */
  status: "delivered" | "failed" | "pending";
  /** The session the delegate worked the task in. */
  sessionId?: string;
  /** Whether the delegate's answer ended the task. */
  answered: boolean;
  /** Why the task failed, when it did. */
  reason?: string;
  /** The task's own id and status, for a failure message. */
  taskId: string;
  rowStatus: string;
};

/** A storage-key segment, as the framework writes one: `[a-z0-9-]` kept, every other byte `%XX`. */
function keySegment(value: string): string {
  let out = "";
  for (const char of value) {
    if (/[a-z0-9-]/.test(char)) out += char;
    else for (const byte of new TextEncoder().encode(char)) out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** The key prefix of conversation `sessionId`'s rows on its board. */
export function boardRowPrefix(sessionId: string): string {
  return `tasks/${keySegment(`${sessionId}~`)}`;
}

/**
 * Whether a board row is a routed task: one whose sealed brief names the
 * message it carries and the delegate it went to.
 */
export function isRoutedTask(row: { sealed?: unknown } | null | undefined): boolean {
  const sealed = row?.sealed as { postId?: unknown; delegate?: unknown } | undefined;
  return typeof sealed?.postId === "string" && typeof sealed.delegate === "object" && sealed.delegate !== null;
}

/** Board rows as graded deliveries: the routed tasks among them, oldest first. */
export function toRoutedDeliveries(rows: ReadonlyArray<Record<string, any>>): RoutedDelivery[] {
  return rows
    .filter(isRoutedTask)
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt))
    .map((row): RoutedDelivery => {
      const sessionWorked = row.run?.sessionId as string | undefined;
      return {
        postId: row.sealed.postId,
        round: row.sealed.round,
        delegate: row.sealed.delegate,
        status: sessionWorked !== undefined ? "delivered" : row.status === "errored" ? "failed" : "pending",
        ...(sessionWorked === undefined ? {} : { sessionId: sessionWorked }),
        answered: row.status === "completed",
        ...(typeof row.error === "string" ? { reason: row.error } : {}),
        taskId: row.id,
        rowStatus: row.status,
      };
    });
}

/**
 * Every routed task on conversation `sessionId`'s board, oldest first, from
 * the rows `userId` owns in `file`.
 */
export function routedDeliveries(file: string, userId: string, sessionId: string): RoutedDelivery[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    // `LIKE` treats `%` and `_` as wildcards; the key's own `%XX` escapes match themselves either way.
    const rows = db
      .prepare("SELECT state FROM resource_state WHERE scope_type = 'user' AND scope_id LIKE ? AND resource_key LIKE ? AND lifecycle = 'live'")
      .all(`${userId}:%`, `${boardRowPrefix(sessionId)}%`) as Array<{ state: string }>;
    return toRoutedDeliveries(rows.map((row) => JSON.parse(row.state) as Record<string, any>));
  } finally {
    db.close();
  }
}
