/**
 * The one path that brings a session record into existence (FIX-1068).
 *
 * Every creator used to do this itself, and they disagreed in two ways that
 * only show up later:
 *
 * - **Minting.** A session's `lineageId` is the address its `sharedToLineage`
 *   resources store under. A creator that omits it leaves the session falling
 *   back to a value derived from its own key — so deleting that session and
 *   recreating it under the same id lands on the same address, which is the
 *   collision the minted id exists to prevent. Three of the six creators omitted
 *   it, two of them production entry points.
 * - **Racing.** `get`-then-`set` is not create-if-absent. Two callers both find
 *   nothing and both write, and the loser silently overwrites the winner — with
 *   a *different* minted id, so the loser's shared writes land at an address
 *   nothing reads again.
 *
 * Both are the same underlying mistake: re-deriving a decision at each call site
 * instead of carrying one answer. So this carries it — callers describe the
 * record they want and never choose the id or the write predicate.
 *
 * A third decision joined them for the same reason (FIX-1258): **a session
 * record coming into existence is what starts a resource-state incarnation**,
 * and the previous one's tombstones have to go with it. See
 * {@link purgeStaleResourceState}.
 */
import type { SessionRecord, StoreRegistry } from "../stores/types";
import { generateId } from "../utils/generate-id";

/** Everything a caller supplies; `lineageId` and the write predicate are not theirs. */
export type SessionRecordSeed = Omit<SessionRecord, "lineageId">;

/** The stores a session's birth touches: its own record, and its resource state. */
type SessionBirthStores = Pick<StoreRegistry, "session" | "resourceState">;

/**
 * Release a newborn session from the resource-state tombstones a previous
 * session under the same id left behind.
 *
 * Session ids are caller-supplied, so `chat-42` or a document id can be
 * deleted and used again — an ordinary pattern, not an exotic one. The two
 * stores treat that differently on purpose. `SessionStore.delete` is a hard
 * delete with no tombstone, so the id is genuinely free. `ResourceStateStore`
 * tombstones instead, and a tombstone refuses a write from a context that
 * never saw the key live. That refusal is exactly what keeps a delete deleted
 * while the session is gone — and exactly what would make every **static**
 * resource of the next session under that id permanently unwritable, since a
 * static `ResourceRef` has no create-if-absent verb to escape through, unlike
 * a collection instance.
 *
 * So a tombstone belongs to the incarnation that made it, and this is the
 * moment it stops applying: not when the old session died, but when a new one
 * was born in its place. That is why the reclamation lives here and not in the
 * delete route — while the session is merely gone, the tombstones are still
 * doing their job.
 *
 * ## Run this BEFORE the create, never after
 *
 * There is no transaction across the two stores, so one of them commits first
 * and the other can fail behind it. That makes the order the whole design, and
 * only one order has a recoverable failure:
 *
 *  - **Create, then reclaim** leaves a committed session record above intact
 *    tombstones when the reclamation fails or the process dies between the two.
 *    Nothing downstream retries it — a second create returns 409 before
 *    reaching here, and an action-driven create adopts the record and skips it
 *    — so that session's static resources are bricked for its whole life. The
 *    fix would reproduce the exact bug it exists to close, permanently.
 *  - **Reclaim, then create** commits nothing until the reclamation has
 *    succeeded. A failure at either step leaves no record, so the caller's
 *    retry starts clean, and reclaiming twice is a no-op.
 *
 * ## KNOWN LIMIT: the reclamation is unfenced against a concurrent creator
 *
 * Reclaiming first means a caller that then LOSES the create has reclaimed
 * under a session it does not own, and **that can resurrect a deleted
 * resource**:
 *
 *  1. Two creators both read the session id and both find nothing.
 *  2. The winner creates it; its session runs and deletes resource `R`,
 *     leaving a tombstone.
 *  3. The delayed loser reaches the reclamation and removes the winner's
 *     tombstone.
 *  4. The loser then loses the session CAS and goes away.
 *  5. The next ordinary `patchState` on `R` holds no version, so it writes at
 *     `"absent"`; no row exists any more, so **the write lands and `R` is
 *     back**.
 *
 * State it plainly: step 5 is not a straggler or any other rare actor. Every
 * fresh request legitimately holds no version, so the exposure is the deleted
 * resource returning on the next normal write — the very failure this change
 * exists to close, reached through a different door.
 *
 * The existence check above is a narrowing, not a fence: it keeps a create
 * against a session that plainly already exists from reclaiming at all, so
 * only a genuine create race can reach step 3. It cannot close the race,
 * because there is no transaction across the two stores. Closing it needs a
 * **scope generation**, which is tracked and specced as FIX-1000 ("A create
 * racing session deletion lands in a purged, caller-reusable scope — fence the
 * scope generation") and deliberately not attempted here. Reach for that, not
 * for a second primitive: `lineageId` is a workstream address (FIX-1068) and
 * answers a different question.
 *
 * The one thing the narrowing to tombstones does buy: a losing reclaimer can
 * touch no live row, so it can destroy no data. What it can do is remove a
 * refusal.
 *
 * (An earlier revision of this ran after the create, on the reasoning that a
 * loser must not touch the winner's scope. That reasoning was written when this
 * removed every row in the scope, live ones included, where a loser really
 * could destroy the winner's data. Narrowing it to tombstones retired the
 * objection, and the ordering it justified with it.)
 *
 * Two residuals stay open, both far narrower than the permanent brick this
 * replaces and neither closable without a scope generation:
 *
 *  - A reclaimed key's version restarts at 1, so a straggler from the old
 *    incarnation holding version N can match a row in the new one.
 *    `purgeTombstones` in `stores/types.ts` carries this.
 *  - A reclamation that succeeds while the create then fails leaves the dead
 *    incarnation's keys with no tombstone and no session, so a straggler can
 *    write orphan rows under an id nothing owns. That is a leak rather than a
 *    revival, and the same one `deleteAll` already documents for a create of a
 *    never-existed key.
 */
export async function purgeStaleResourceState(
  stores: SessionBirthStores,
  storageKey: string
): Promise<void> {
  await stores.resourceState.purgeTombstones("session", storageKey);
}

/**
 * Return the session record at `storageKey`, creating it if absent.
 *
 * The returned record is **authoritative**: on a lost create race it is the
 * winner's, not the one this caller built. Callers that go on to read
 * `lineageId` (or anything else) must use what comes back rather than what they
 * passed in, or they are back to two answers for one question.
 *
 * @throws when the key is tombstoned — the store contract requires a caller to
 * treat that as deleted and stop, never as "reuse my copy".
 */
export async function ensureSessionRecord(
  stores: SessionBirthStores,
  storageKey: string,
  build: () => SessionRecordSeed
): Promise<SessionRecord> {
  const existing = await stores.session.get(storageKey);
  if (existing !== undefined) return existing;

  // Before the create, so nothing is committed until it has succeeded — the
  // `get` above is what keeps this off an already-existing session. See
  // `purgeStaleResourceState` for why this order and no other.
  await purgeStaleResourceState(stores, storageKey);

  const record: SessionRecord = { ...build(), lineageId: generateId("lin") };
  const created = await stores.session.set(storageKey, record, "absent");
  if (created.ok) return record;

  const winner = created.conflict.currentValue ?? (await stores.session.get(storageKey));
  if (winner === undefined) {
    throw new Error(
      `Session "${storageKey}" was deleted while this request was creating it`
    );
  }
  return winner;
}
