/**
 * A coordinator conversation's posts, read as rows on its task board from an
 * install's SQLite store file.
 *
 * A coordinator hands each post to each delegate as one row on the
 * conversation's board, and the row is the record of that hand-off. Three
 * goals grade those hand-offs (`hands-each-post-to-its-delegates`,
 * `a-shared-project-has-one-owner-per-workstream`,
 * `two-users-share-a-project-and-nothing-else`), each in the shape it graded
 * before posts were rows, so this reads the rows and gives each one that shape:
 * the post and its round, the delegate, where it was worked, and how it went.
 *
 * Read straight from the file, as the user who owns the conversation: no route
 * sends a client a board's rows with their server-written payload. Read-only,
 * and closed after each read.
 */
import { DatabaseSync } from "node:sqlite";

/** One post to one delegate, as a goal grades it. */
export type PostDelivery = {
  postId: string;
  round: number;
  delegate: { worker: string; target?: string };
  /** `delivered` once the row was worked in a session; `failed` when it ended before one; else `pending`. */
  status: "delivered" | "failed" | "pending";
  /** The session the delegate worked the row in. */
  sessionId?: string;
  /** Whether the delegate's answer ended the row. */
  answered: boolean;
  /** Why the row failed, when it did. */
  reason?: string;
  /** The row's own id and status, for a failure message. */
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
export function postRowPrefix(sessionId: string): string {
  return `tasks/${keySegment(`${sessionId}~`)}`;
}

/** Whether a board row is a post handed to a delegate, not a filed task. */
export function isPostRow(row: { sealed?: { kind?: string } } | null | undefined): boolean {
  return row?.sealed?.kind === "post";
}

/** Board rows as graded deliveries: the post rows among them, oldest first. */
export function toPostDeliveries(rows: ReadonlyArray<Record<string, any>>): PostDelivery[] {
  return rows
    .filter(isPostRow)
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt))
    .map((row): PostDelivery => {
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
 * Every post row on conversation `sessionId`'s board, oldest first, from the
 * rows `userId` owns in `file`.
 */
export function postDeliveries(file: string, userId: string, sessionId: string): PostDelivery[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    // `LIKE` treats `%` and `_` as wildcards; the key's own `%XX` escapes match themselves either way.
    const rows = db
      .prepare("SELECT state FROM resource_state WHERE scope_type = 'user' AND scope_id LIKE ? AND resource_key LIKE ? AND lifecycle = 'live'")
      .all(`${userId}:%`, `${postRowPrefix(sessionId)}%`) as Array<{ state: string }>;
    return toPostDeliveries(rows.map((row) => JSON.parse(row.state) as Record<string, any>));
  } finally {
    db.close();
  }
}
