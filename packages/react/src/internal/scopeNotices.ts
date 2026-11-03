/**
 * What `useSession({ live })` and the live workforce panels share when they
 * act on another session's change notice (FIX-1506): the timer's pace, and
 * the one rule for whether a notice's resource path may belong to a resource
 * a view holds. Internal.
 */

/**
 * The pace a live view reads again wherever push can miss a change: a host
 * with no push, a socket that is down, or a bus that doesn't cross processes
 * (`client.subscribe`'s timer).
 */
export const LIVE_POLL_MS = 3_000;

/**
 * Whether a change at storage path `path` may belong to the resource held
 * under key `ref`, stored under the static prefix `prefix`.
 *
 * A key and its storage path can differ (`roster` stores under
 * `workforce/workers/…`, and a single may declare its own storage `ref`), so
 * the key alone rules nothing out. `prefix` is `undefined` when the storage
 * path isn't known, and `""` for a pattern with no static prefix: either way
 * no path can be ruled out. `null` means the key is the storage path. A
 * false yes costs one read; a false no leaves a view stale, so every doubt
 * answers yes.
 */
export function mayBelongTo(path: string, ref: string, prefix: string | null | undefined): boolean {
  const under = (root: string): boolean => path === root || path.startsWith(`${root}/`);
  if (under(ref)) return true;
  if (prefix === undefined || prefix === "") return true;
  return prefix !== null && under(prefix);
}
