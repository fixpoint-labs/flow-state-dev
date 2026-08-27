/**
 * The one path that brings a session record into existence (FIX-1068).
 *
 * Every creator used to do this itself, and they disagreed in two ways that
 * only show up later:
 *
 * - **Minting.** A session's `lineageId` is the address its `sharedToWorkstream`
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
 * Only the caller that WON the create may run this. A loser reclaiming would
 * be operating on a scope the winner already owns.
 *
 * Two residuals stay open, both far narrower than the permanent brick this
 * replaces and neither closable without a scope generation:
 *
 *  - A reclaimed key's version restarts at 1, so a straggler from the old
 *    incarnation holding version N can match a row in the new one.
 *    `purgeTombstones` in `stores/types.ts` carries this.
 *  - The reclamation lands just after the record becomes visible, so a request
 *    that sees the newborn record and writes a since-deleted key inside that
 *    window can have that write refused. Reclaiming first instead would be
 *    worse, not better: a loser of the create race would then reclaim under a
 *    scope the winner is already writing to, on a wider window and with no
 *    winner to bound it.
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

  const record: SessionRecord = { ...build(), lineageId: generateId("lin") };
  const created = await stores.session.set(storageKey, record, "absent");
  if (created.ok) {
    // Only the winner purges, and only after winning. See
    // `purgeStaleResourceState` for why that order and no other.
    await purgeStaleResourceState(stores, storageKey);
    return record;
  }

  const winner = created.conflict.currentValue ?? (await stores.session.get(storageKey));
  if (winner === undefined) {
    throw new Error(
      `Session "${storageKey}" was deleted while this request was creating it`
    );
  }
  return winner;
}
