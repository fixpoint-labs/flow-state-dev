/**
 * Where a board row sits in the design's five columns (BR-12).
 *
 * The task substrate has six statuses and the design draws five columns, so
 * several statuses share one. The row keeps its own status word on its card;
 * the column only groups. IN REVIEW is drawn and stays empty: no shipped
 * status means "in review" yet, and what does is FIX-1651's call. A task
 * waiting on you is running: it shows through its open holds and its Inbox
 * item, not a column of its own (FIX-2131). An unknown word is QUEUED with
 * the word on the card, never hidden.
 */

/** The five columns, in the order the board draws them: design v2's (v2:1327). */
export const COLUMNS = ["QUEUED", "RUNNING", "IN REVIEW", "NEEDS YOU", "DONE"] as const;

/** One of the five. */
export type Column = (typeof COLUMNS)[number];

/** Which column a stored status belongs in. */
export function columnFor(stored: string): Column {
  switch (stored) {
    case "in_progress":
      return "RUNNING";
    case "errored":
      return "NEEDS YOU";
    case "completed":
    case "cancelled":
      return "DONE";
    default:
      return "QUEUED";
  }
}

/** Whether the row carries the *held* tag in QUEUED: filed, and not to start until released. */
export function isHeld(stored: string): boolean {
  return stored === "held";
}

/** Whether a row is done: Tasks leaves these out (BR-15). */
export function isDone(stored: string): boolean {
  return columnFor(stored) === "DONE";
}
