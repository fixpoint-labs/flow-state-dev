/**
 * Where a board row sits in the design's five columns (BR-12).
 *
 * The task substrate has seven statuses and the design draws five columns, so
 * several statuses share one. The row keeps its own status word on its card;
 * the column only groups. IN REVIEW is drawn and stays empty: no shipped
 * status means "in review" yet, and what does is FIX-1651's call.
 *
 * A row persisted before `parked` replaced `awaiting_review` still carries the
 * old word. Collection reads hand rows back as stored, so it is read here as
 * parked rather than dropped (BP-030). Any other unknown word is QUEUED with
 * the word on the card, never hidden.
 */

/** The five columns, in the order the board draws them: design v2's (v2:1327). */
export const COLUMNS = ["QUEUED", "RUNNING", "IN REVIEW", "NEEDS YOU", "DONE"] as const;

/** One of the five. */
export type Column = (typeof COLUMNS)[number];

/** The status a row is read as: the stored word, with the legacy one mapped forward. */
export function readStatus(stored: string): string {
  return stored === "awaiting_review" ? "parked" : stored;
}

/** Which column a stored status belongs in. */
export function columnFor(stored: string): Column {
  switch (readStatus(stored)) {
    case "in_progress":
      return "RUNNING";
    case "parked":
    case "errored":
      return "NEEDS YOU";
    case "completed":
    case "cancelled":
      return "DONE";
    default:
      return "QUEUED";
  }
}

/** Whether the row carries the *blocked* tag in QUEUED. */
export function isBlocked(stored: string): boolean {
  return stored === "blocked";
}

/** Whether a row is done: Tasks leaves these out (BR-15). */
export function isDone(stored: string): boolean {
  return columnFor(stored) === "DONE";
}
