/**
 * The projection's vocabulary: where files live, what owns them, and what a
 * flush decided about each one.
 *
 * A projection moves file content between **resource collections** — the
 * durable store — and a **place**, which is wherever an agent actually works.
 * The two consumers today are a bash sandbox and a host directory a coding run
 * is pointed at; neither of them appears in these types, which is the point.
 */
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";

/**
 * What a projection needs from wherever it puts files. Three operations, and
 * deliberately **not** a `Sandbox`: the projection never executes a command,
 * so a place that cannot run one is a first-class place rather than a
 * degraded one.
 *
 * `list` is the operation that decides whether a flush may proceed at all, so
 * its failure mode is load-bearing: **an unreadable place must throw, never
 * return an empty list.** A flush that reads "no files" from a broken place
 * and believes it would delete the collection's entire contents — which is
 * precisely how the machinery this replaces lost data.
 */
export interface Place {
  /** The content at `path`, or `null` if the place does not hold it. */
  read(path: string): Promise<string | null>;
  /** Put `content` at `path`, creating any intermediate structure. */
  write(path: string, content: string): Promise<void>;
  /**
   * Every path the place currently holds under any of `prefixes`.
   *
   * Throws if the place cannot be read. Returning `[]` asserts the place is
   * readable and empty, which a flush acts on by deleting.
   */
  list(prefixes: readonly string[]): Promise<readonly string[]>;
}

/**
 * The state a projected file carries in its collection.
 *
 * Structurally identical to the bash tool's `FileEntryState`, and declared
 * here rather than imported from it so the dependency runs the right way: the
 * projection is what the tools use, not the reverse.
 */
export type ProjectedEntryState = {
  /** Path relative to the mount, e.g. `"src/index.ts"`. */
  path: string;
  /** Content hash, for diffing at flush. */
  hash: string;
  /** ISO timestamp of the last sync. */
  updatedAt: string;
  [key: string]: string;
};

/** One collection, projected at one prefix inside the place. */
export interface Mount {
  /**
   * Where this collection's entries appear in the place, e.g. `"artifacts"`.
   *
   * Derived from the collection's pattern by the caller rather than
   * configured here — `discoverMounts` in the bash tool already computes it
   * the same way.
   */
  prefix: string;
  /** The durable side. */
  collection: ResourceCollectionRef<ProjectedEntryState>;
  /**
   * Whether a flush may write back. A read-only mount is hydrated and then
   * left alone — its paths are skipped, never reported as orphans.
   */
  writable: boolean;
  /**
   * Extra state to stamp on an entry this projection commits, keyed by the
   * entry's own key.
   *
   * The projection sets `path`, `hash` and `updatedAt` because it needs them
   * to do its job. Anything else an application shows about a file — a title,
   * an author, a timestamp in the shape its UI expects — is the application's
   * to decide, and it applies last so a mount can override what the
   * projection chose.
   */
  entryState?: (key: string) => Record<string, unknown>;
}

/**
 * What a flush decided about one path.
 *
 * **A conflict is not an error.** It is an outcome of a flush that succeeded:
 * everything uncontested still landed, and the contested path was left exactly
 * as both writers left it, with the three hashes needed to say why.
 */
export type FlushOutcome =
  /** Local content matches the baseline — the run never touched it. */
  | { kind: "unchanged"; path: string }
  /** We hold no baseline and the collection holds nothing: a clean create. */
  | { kind: "created"; path: string }
  /** The collection still holds what we last put there: a clean write. */
  | { kind: "written"; path: string }
  /**
   * The collection already holds exactly what we would have written. Nothing
   * is written, and the baseline still advances — see `Projection.flush`.
   */
  | { kind: "converged"; path: string }
  /** We held a baseline, the place no longer holds the path, nobody else touched it. */
  | { kind: "deleted"; path: string }
  /**
   * A write landed under no writable mount. Reported rather than guessed into
   * a default collection, and never silently dropped.
   *
   * Comes from `put`, where the caller names a path the projection then finds
   * no home for — which is how the tools that write one file at a time reach
   * it. A **flush** sees this only for a path inside a mount prefix that
   * nothing owns: it lists the place BY prefix, so a file the run dropped
   * outside every prefix is never walked and never reported. If you need those
   * seen, the place has to be listed wider than the mounts.
   */
  | { kind: "orphan"; path: string }
  /**
   * Two writers, and we cannot tell which is wanted. `ours: null` is the
   * delete half — the path left the place while somebody else changed it.
   */
  | {
      kind: "conflict";
      path: string;
      /** What we last committed, or `null` if we never laid this path down. */
      base: string | null;
      /** What the collection holds now, or `null` if it holds nothing. */
      theirs: string | null;
      /** What the place holds now, or `null` if the path was deleted. */
      ours: string | null;
    };

/** Everything one flush decided. */
export interface FlushReport {
  /** Every path the flush reached, in the order it reached them. */
  outcomes: readonly FlushOutcome[];
  /** The contested subset, so a caller need not filter to find the bad news. */
  conflicts: readonly Extract<FlushOutcome, { kind: "conflict" }>[];
}

/**
 * The place could not be listed, so the flush decided nothing.
 *
 * The one failure a flush can reject with that a caller may safely swallow:
 * nothing was read, nothing was written, and the run's files are still where
 * the run left them. Every other rejection — a collection read, a write, a
 * delete — means the opposite, that work did not reach the store, and a caller
 * catching both alike reports success for a run whose files went nowhere.
 *
 * Thrown only by `flush`, and only for `Place.list`.
 */
export class PlaceUnreadableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PlaceUnreadableError";
  }
}
