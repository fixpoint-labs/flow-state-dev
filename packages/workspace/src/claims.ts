/**
 * Who is allowed to write a projected path.
 *
 * The baseline answers "has this path changed since I last wrote it". It
 * cannot answer "is somebody else writing it right now", because a second
 * projection that has never committed the path holds no baseline for it and
 * reads the collection as untouched. Both would write, the later one would
 * win, and neither would be told.
 *
 * A claim is the missing half. It is held for the length of ONE operation —
 * a flush or a put — by that operation and nothing wider, and it is per ENTRY
 * rather than per collection or per mount: two runs sharing a collection while
 * touching disjoint entries is the case this has to keep working, not the case
 * it exists to stop.
 *
 * Both halves of that are load-bearing, and each was wrong once.
 *
 * **Per operation, not per projection.** A session-scoped sandbox is one
 * registry entry, so two requests overlapping in it share one projection.
 * A holder identifying the projection is then the same holder for both, every
 * claim is granted to somebody who already holds it, and the two commit over
 * each other with both told they wrote.
 *
 * **Per durable entry, not per path.** `artifacts/report.md` is a naming
 * convention. Keyed on the path, two sessions writing their own copy refuse
 * each other over a row they do not share, and one collection mounted under
 * two prefixes evades arbitration over a row that is genuinely one. `claimKey`
 * is what a caller passes instead — see `Mount.collectionId`.
 *
 * **In-process, not distributed.** A lease store exists and would reach across
 * processes, but this is the same scope the baseline already has, and a check
 * whose reach exceeded the evidence it guards would be claiming more than it
 * knows. Two servers writing one collection is a larger problem, named in the
 * docs rather than papered over.
 */

/** A holder of claims — one in-flight operation, identified by nothing but itself. */
export type ClaimHolder = symbol;

/**
 * The key one durable entry is claimed under.
 *
 * Length-framed rather than joined on a delimiter, because a raw join is not
 * injective: `(collection "a", key "b/c")` and `(collection "a/b", key "c")`
 * spell one string, and a collision here hands one writer another's claim.
 */
export function claimKey(collectionId: string, entryKey: string): string {
  return `${collectionId.length}:${collectionId}${entryKey.length}:${entryKey}`;
}

export interface ClaimRegistry {
  /**
   * Claim `key` for `holder`.
   *
   * Returns the CURRENT holder either way: `holder` itself when the claim is
   * granted or already held, somebody else when it is refused. Returning the
   * holder rather than a boolean is what lets a refusal name who is writing
   * instead of only that somebody is.
   */
  claim(key: string, holder: ClaimHolder): ClaimHolder;
  /** Drop every claim `holder` holds. */
  releaseAll(holder: ClaimHolder): void;
  /** Who holds `key`, if anyone. For assertions and diagnostics. */
  heldBy(key: string): ClaimHolder | undefined;
}

export function createClaimRegistry(): ClaimRegistry {
  const byKey = new Map<string, ClaimHolder>();

  return {
    claim(key, holder) {
      const current = byKey.get(key);
      if (current !== undefined) return current;
      byKey.set(key, holder);
      return holder;
    },
    releaseAll(holder) {
      for (const [key, current] of [...byKey.entries()]) {
        if (current === holder) byKey.delete(key);
      }
    },
    heldBy: (key) => byKey.get(key),
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
