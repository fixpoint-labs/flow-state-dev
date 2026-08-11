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
 */
import type { SessionRecord, StoreRegistry } from "../stores/types";
import { generateId } from "../utils/generate-id";

/** Everything a caller supplies; `lineageId` and the write predicate are not theirs. */
export type SessionRecordSeed = Omit<SessionRecord, "lineageId">;

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
  stores: Pick<StoreRegistry, "session">,
  storageKey: string,
  build: () => SessionRecordSeed
): Promise<SessionRecord> {
  const existing = await stores.session.get(storageKey);
  if (existing !== undefined) return existing;

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
