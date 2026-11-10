// BP-030.
/**
 * The one read of a task stored in a shape a published version wrote and
 * the current one does not.
 *
 * A row in a persistent store is a user's open work. It is read here, at the
 * collection's read boundary; no other module reads a retired shape.
 *
 * Two shapes are read. Status `blocked`, which orchestration 0.5.0 and earlier
 * stored, reads as `held`; its parse-path half is `persistedTaskStatusSchema`
 * (`./task-status`), where dropping it would reset a parsed resource holding
 * such a row to its default. And a task's own hold marked `source.kind:
 * "row"`, which earlier versions stored, reads as `"task"`; its
 * parse-path half is `taskHoldSchema` (`./hold`), and both call
 * `withCurrentHoldMarker`.
 *
 * The read is a **fixed point**: a row it has read is returned unchanged by a
 * second read, and a row in no retired shape is returned as the same object,
 * so the common path allocates nothing.
 */

import { withCurrentHoldMarker } from "./hold";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * A stored row read in the current shape. Call it once, at the read boundary,
 * so every consumer downstream (the transition guard, a filter, the claim, a
 * screen) sees one vocabulary. A row in no retired shape is returned as the
 * same object.
 *
 * `blocked` and `held` mean the same: filed, not started, until someone says
 * go. The reason `block` stored as `error` moves to `metadata.heldReason`: an
 * `error` on a row that never ended reads as a failure.
 */
export function withRetiredShapes<T>(row: T): T {
  if (!isObject(row)) return row;
  return withRetiredStatus(withRetiredHoldMarkers(row));
}

/** `holds` with each hold's retired `"row"` marker read as `"task"`; the same row when none says `"row"`. */
function withRetiredHoldMarkers(row: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(row.holds) || row.holds.every((hold) => withCurrentHoldMarker(hold) === hold)) return row;
  return { ...row, holds: row.holds.map(withCurrentHoldMarker) };
}

function withRetiredStatus<T>(row: Record<string, unknown>): T {
  if (row.status !== "blocked") return row as T;
  const { error, ...rest } = row;
  // `heldFromBlocked` marks the row for the one release a started held row may take.
  const held = { ...rest, status: "held", heldFromBlocked: true };
  if (typeof error !== "string") return held as T;
  const metadata = isObject(row.metadata) ? row.metadata : {};
  return { ...held, metadata: { ...metadata, heldReason: error } } as T;
}
