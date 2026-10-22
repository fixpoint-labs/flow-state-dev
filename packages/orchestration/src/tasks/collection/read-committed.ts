/**
 * The one read of a task as stored now (FIX-2086).
 *
 * A request's collection ref reads rows as the request first saw them, so a
 * steer another request wrote is invisible to `get`. The late-steer check and
 * a coding run's steer watch read the stored row instead, through
 * `getCommitted`. A ref without it falls back to `get` here, once per board
 * with a warning, since a late steer can then go unseen.
 */
import type { Task } from "../schema/task";
import type { TaskCollectionRef } from "./types";

/** Boards already warned about, by collection id, so the warning is said once. */
const warned = new Set<string>();

/**
 * The row `id` as stored now, or as this request read it when the ref can't
 * read the store.
 */
export async function readCommittedTask(ref: TaskCollectionRef, id: string): Promise<Task | undefined> {
  if (ref.getCommitted !== undefined) return (await ref.getCommitted(id)) ?? ref.get(id);
  if (!warned.has(ref.collectionId)) {
    warned.add(ref.collectionId);
    console.warn(
      `[tasks] board "${ref.collectionId}" can't read a row as stored (no getCommitted): a steer written by another ` +
        "request may go unseen until this request ends."
    );
  }
  return ref.get(id);
}
