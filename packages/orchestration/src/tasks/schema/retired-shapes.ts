// BP-030.
/**
 * The one read of a task row stored in a shape a published version wrote and
 * the current one does not.
 *
 * A row in a persistent store is a user's open work. It is read here, at the
 * collection's read boundary; no other module reads a retired shape.
 *
 * One shape is read: status `blocked`, which orchestration 0.5.0 and earlier
 * stored, reads as `held`. Its parse-path half is `persistedTaskStatusSchema`
 * (`./task-status`), where dropping it would reset a parsed resource holding
 * such a row to its default.
 *
 * The read is a **fixed point**: a row it has read is returned unchanged by a
 * second read, and a row in no retired shape is returned as the same object,
 * so the common path allocates nothing.
 */

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
  if (!isObject(row) || row.status !== "blocked") return row;
  const { error, ...rest } = row;
  // `heldFromBlocked` marks the row for the one release a started held row may take.
  const held = { ...rest, status: "held", heldFromBlocked: true };
  if (typeof error !== "string") return held as T;
  const metadata = isObject(row.metadata) ? row.metadata : {};
  return { ...held, metadata: { ...metadata, heldReason: error } } as T;
}
