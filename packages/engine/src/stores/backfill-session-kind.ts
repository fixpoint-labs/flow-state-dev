/**
 * The one-time repair that classifies session records written before
 * `sessionKind` existed (FIX-1230).
 *
 * Relay refuses a record whose `sessionKind` is absent — the fail-closed side
 * of BP-030, because here the tolerant reading is the exploitable one. That
 * refusal is correct and it is also a cost: until this sweep has run, every
 * pre-existing session is one nobody can relay to or from. This is what pays
 * that cost off.
 *
 * ## It classifies by `parentSessionId`, which the runtime door may not
 *
 * The asymmetry is the point rather than an inconsistency. The door has to
 * survive sibling sessions — parented *and* caller-addressable — so it cannot
 * read a parent link as "workstream". The sweep runs once over rows that all
 * predate siblings, so the ambiguity that disqualifies the field at runtime
 * provably does not exist here.
 *
 * ## Three properties it would be easy to ship without
 *
 * - **It enumerates with `parentage: "all"`.** `SessionListOptions.parentage`
 *   **narrows when omitted** — an unqualified `list()` returns only top-level
 *   sessions, which is exactly the set that does *not* need repairing, and skips
 *   every legacy detached child, the set that does. The option's own doc
 *   predicts this reader error, noting the asymmetry with `tenantId` in the same
 *   object: an absent `tenantId` widens, an absent `parentage` narrows.
 * - **It writes under CAS with retry, re-reading between attempts.** An
 *   unconditional `set` clobbers state a running request wrote, and a single CAS
 *   attempt can simply lose. Because the reader refuses on absent, a lost race
 *   is not "repaired next time" — it is a permanently unreachable session.
 * - **It is re-runnable.** An older instance still rolling can create another
 *   unstamped row after the scan has passed it, so this has to be safe to run
 *   again. A row that already carries the field is skipped without a write, so a
 *   second run over a repaired store costs reads and nothing else.
 *
 * ## Paging
 *
 * Pages by `orderBy: "createdAt"` rather than the default `"updatedAt"`, which
 * a live writer mutates — under `updated_at DESC` a row that is written mid-walk
 * jumps to the front and one row crosses the offset boundary unseen. Under
 * `created_at DESC` a *newly created* row lands at the front and shifts later
 * pages back by one, so a row is re-examined rather than skipped; re-examining
 * is free (it is idempotent) and every new row carries the field anyway.
 *
 * ## How it is activated
 *
 * By an operator, explicitly: `fsdev migrate session-kind`. Not a startup hook,
 * which would scan the whole session store on every cold start for one deploy's
 * worth of benefit; and not a lazy stamp on load, which would have to classify
 * by `parentSessionId` at *runtime* and so reintroduce the very ambiguity the
 * persisted field exists to remove.
 */
import type { SessionKind, SessionRecord, StoreRegistry } from "./types";

/** What a sweep did, so an operator can tell "repaired" from "found nothing". */
export type BackfillSessionKindResult = {
  /** Rows the enumeration returned. */
  examined: number;
  /** Rows that were missing `sessionKind` and now carry one. */
  stamped: number;
  /** Rows that already carried one. A re-run over a repaired store is all of these. */
  alreadyStamped: number;
  /**
   * Storage keys that lost their CAS on every attempt and are STILL unstamped.
   *
   * Non-zero is not a partial success to shrug at: each one is a session relay
   * still refuses. Run the sweep again — it is idempotent, and a row that lost
   * to a live writer usually wins on the next pass.
   */
  unrepaired: string[];
};

export type BackfillSessionKindOptions = {
  /**
   * Rows fetched per page. Smaller keeps each read cheap at the cost of more of
   * them.
   */
  pageSize?: number;
  /** CAS attempts per row before it is reported unrepaired. */
  maxAttemptsPerRecord?: number;
  /**
   * Tenant filter. Absent **widens** to every tenant, matching the store
   * option's own semantics — which is what a whole-deployment repair wants.
   */
  tenantId?: string;
};

const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Classify a legacy row.
 *
 * A parented row is a detached child: nothing else wrote `parentSessionId`
 * before this field existed. Everything else is a session a caller named.
 * Guarded with `== null` because a store that nulls absent keys hands back
 * `null` rather than `undefined` (BP-030).
 */
function classify(record: SessionRecord): SessionKind {
  return record.parentSessionId == null ? "top-level" : "workstream";
}

/**
 * Stamp `sessionKind` onto every session record that lacks one.
 *
 * @param stores Registry whose `session` store is swept.
 * @param options Paging, retry budget, and an optional tenant filter.
 */
export async function backfillSessionKind(
  stores: Pick<StoreRegistry, "session">,
  options: BackfillSessionKindOptions = {}
): Promise<BackfillSessionKindResult> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxAttempts = options.maxAttemptsPerRecord ?? DEFAULT_MAX_ATTEMPTS;

  const result: BackfillSessionKindResult = {
    examined: 0,
    stamped: 0,
    alreadyStamped: 0,
    unrepaired: []
  };

  for (let offset = 0; ; offset += pageSize) {
    const page = await stores.session.list({
      // WITHOUT THIS the sweep enumerates only top-level rows and silently does
      // the opposite of its job — see the file header.
      parentage: "all",
      ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
      orderBy: "createdAt",
      limit: pageSize,
      offset
    });
    if (page.length === 0) break;

    for (const listed of page) {
      result.examined += 1;
      if (listed.sessionKind != null) {
        result.alreadyStamped += 1;
        continue;
      }
      if (await stampWithRetry(stores, listed.id, maxAttempts)) {
        result.stamped += 1;
      } else {
        result.unrepaired.push(listed.id);
      }
    }

    if (page.length < pageSize) break;
  }

  return result;
}

/**
 * Re-read the row and write it back at its own version, so a concurrent writer
 * loses the CAS instead of losing its state.
 *
 * The re-read is what makes the retry meaningful: retrying against the *listed*
 * copy would write back a snapshot taken before the writer we just lost to, and
 * would clobber exactly the state the CAS exists to protect.
 *
 * Returns `false` when the row is still unstamped after `maxAttempts`, so the
 * caller can report it rather than treat a lost race as done.
 */
async function stampWithRetry(
  stores: Pick<StoreRegistry, "session">,
  storageKey: string,
  maxAttempts: number
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const current = await stores.session.get(storageKey);
    // Deleted under us, or a live writer already stamped it. Nothing is left to
    // repair either way, and both are successes rather than failures.
    if (current === undefined) return true;
    if (current.sessionKind != null) return true;

    const written = await stores.session.set(
      storageKey,
      {
        ...current,
        sessionKind: classify(current),
        version: current.version + 1,
        updatedAt: Date.now()
      },
      current.version
    );
    if (written.ok) return true;
  }
  return false;
}
