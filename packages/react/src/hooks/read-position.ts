// FIX-2625.
/**
 * The order the reads of one page start in, so a hook can tell whether a
 * snapshot was read before or after one of its own reads. Positions come from
 * one counter, so they only grow; the session view marks each snapshot it
 * shows with the position its read started at. A snapshot no read marked (one
 * a live change merged into, or one built by hand) has no position: it may be
 * newer than any read.
 *
 * Internal to the package: not on its root.
 */

let latest = 0;

/** The next position: later than every one handed out before. */
export function nextReadPosition(): number {
  latest += 1;
  return latest;
}

const snapshotPositions = new WeakMap<object, number>();

/** Mark `snapshot` as read by a read that started at `position`. Returns it. */
export function markSnapshotRead<T extends object | null>(snapshot: T, position: number): T {
  if (snapshot !== null) snapshotPositions.set(snapshot, position);
  return snapshot;
}

/** Where `snapshot`'s read started, or `undefined` when no read marked it. */
export function snapshotReadPosition(snapshot: object | null | undefined): number | undefined {
  return snapshot == null ? undefined : snapshotPositions.get(snapshot);
}
