/**
 * Which mount owns a path, and what the path is called inside it.
 *
 * Kept apart from the projection because it is the one piece with no I/O in
 * it: given the mounts and a path, the answer is a pure function, and a pure
 * function is what a test can pin every branch of cheaply.
 */
import type { Mount } from "./types";

/** A path routed to its mount, with the key the collection knows it by. */
export interface Routed {
  mount: Mount;
  /** The path relative to the mount's prefix — the collection's own key. */
  key: string;
}

/**
 * Normalise a projected path for comparison: no leading slash, no `./`, and
 * `/` throughout.
 *
 * A place is free to hand back whatever separator its host uses, and the
 * baseline is keyed by this form, so both ends of a comparison must pass
 * through here or a Windows place contests every path with itself.
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * The mount owning `path`, **longest prefix first**.
 *
 * Longest-first is not a tie-break detail: a collection mounted at
 * `artifacts/drafts` nested inside one at `artifacts` is a supported shape,
 * and shortest-first would route every draft to the outer collection.
 *
 * Returns `undefined` when no mount claims the path — which the caller
 * reports as an orphan rather than resolving to a default.
 */
export function routePath(
  mounts: readonly Mount[],
  path: string,
): Routed | undefined {
  const normalized = normalizePath(path);
  let best: Routed | undefined;
  for (const mount of mounts) {
    const prefix = normalizePath(mount.prefix);
    // A bare prefix match is not enough: `artifacts-old/x` starts with
    // `artifacts` and belongs to neither that mount nor, silently, its
    // collection. The boundary has to be a separator.
    //
    // The path EQUAL to the prefix is excluded for a different reason: that
    // is the mount's own root, and a collection entry needs a key. Routing it
    // anyway produces an entry under the empty key — which a test caught the
    // first version doing, quietly, in the collection.
    if (!normalized.startsWith(`${prefix}/`)) continue;
    if (best !== undefined && normalizePath(best.mount.prefix).length >= prefix.length) {
      continue;
    }
    best = { mount, key: normalized.slice(prefix.length + 1) };
  }
  return best;
}

/**
 * Is this a collection's own metadata rather than a projected file?
 *
 * Entries whose key starts with `_` are the collection's bookkeeping. They are
 * never hydrated into a place, so a flush must never conclude from their
 * absence there that they were deleted.
 *
 * The BARE key only. A `_` deeper in the path is an ordinary file name —
 * `src/_helpers.ts`, `public/_redirects`, `app/_layout.tsx` are all names
 * people actually use — and matching those dropped them from hydrate and
 * silently refused to persist them.
 */
export function isMetadataKey(key: string): boolean {
  return key.startsWith("_");
}
