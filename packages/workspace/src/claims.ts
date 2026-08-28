/**
 * Who is allowed to write a projected path.
 *
 * The baseline answers "has this path changed since I last wrote it". It
 * cannot answer "is somebody else writing it right now", because a second
 * projection that has never committed the path holds no baseline for it and
 * reads the collection as untouched. Both would write, the later one would
 * win, and neither would be told.
 *
 * A claim is the missing half. It is held by a projection for as long as that
 * projection is open, and it is per PATH rather than per collection or per
 * mount — deliberately, because two runs sharing a collection while touching
 * disjoint paths is the case this has to keep working, not the case it exists
 * to stop.
 *
 * **In-process, not distributed.** A lease store exists and would reach across
 * processes, but this is the same scope the baseline already has, and a check
 * whose reach exceeded the evidence it guards would be claiming more than it
 * knows. Two servers writing one collection is a larger problem, named in the
 * docs rather than papered over.
 */

/** A holder of claims — one projection, identified by nothing but itself. */
export type ClaimHolder = symbol;

export interface ClaimRegistry {
  /**
   * Claim `path` for `holder`.
   *
   * Returns the CURRENT holder either way: `holder` itself when the claim is
   * granted or already held, somebody else when it is refused. Returning the
   * holder rather than a boolean is what lets a refusal name who is writing
   * instead of only that somebody is.
   */
  claim(path: string, holder: ClaimHolder): ClaimHolder;
  /** Drop every claim `holder` holds. */
  releaseAll(holder: ClaimHolder): void;
  /** Who holds `path`, if anyone. For assertions and diagnostics. */
  heldBy(path: string): ClaimHolder | undefined;
}

export function createClaimRegistry(): ClaimRegistry {
  const byPath = new Map<string, ClaimHolder>();

  return {
    claim(path, holder) {
      const current = byPath.get(path);
      if (current !== undefined) return current;
      byPath.set(path, holder);
      return holder;
    },
    releaseAll(holder) {
      for (const [path, current] of [...byPath.entries()]) {
        if (current === holder) byPath.delete(path);
      }
    },
    heldBy: (path) => byPath.get(path),
  };
}

/**
 * The registry projections share when none is supplied.
 *
 * Module-level, so two projections built anywhere in one process arbitrate
 * against each other without being introduced. That is the point: the runs
 * this protects against are the ones nobody wired together.
 */
export const sharedClaimRegistry: ClaimRegistry = createClaimRegistry();
