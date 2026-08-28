/**
 * A place that holds files in a `Map`.
 *
 * Exported rather than kept in the test folder, because both consumers need
 * it to test their own wiring without standing up a sandbox — and because the
 * projection's whole behaviour set is reachable through it, which is what
 * makes those behaviours tracer bullets rather than integration tests.
 */
import type { Place } from "./types";
import { normalizePath } from "./routing";

export interface MemoryPlace extends Place {
  /** Everything the place holds, for assertions. */
  snapshot(): Record<string, string>;
  /** Remove a path, the way a run deleting a file would. */
  remove(path: string): void;
  /**
   * Make every subsequent `list` throw.
   *
   * The failure a flush must survive without deleting anything, and the one
   * a place that returned `[]` on error would hide.
   */
  breakListing(reason?: string): void;
}

export function createMemoryPlace(initial: Record<string, string> = {}): MemoryPlace {
  const files = new Map<string, string>(
    Object.entries(initial).map(([p, c]) => [normalizePath(p), c]),
  );
  let listingError: string | undefined;

  return {
    async read(path) {
      return files.get(normalizePath(path)) ?? null;
    },
    async write(path, content) {
      files.set(normalizePath(path), content);
    },
    async list(prefixes) {
      if (listingError !== undefined) throw new Error(listingError);
      const normalized = prefixes.map(normalizePath);
      return [...files.keys()].filter((path) =>
        normalized.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
      );
    },
    snapshot: () => Object.fromEntries(files),
    remove: (path) => {
      files.delete(normalizePath(path));
    },
    breakListing: (reason = "the place is unreadable") => {
      listingError = reason;
    },
  };
}
