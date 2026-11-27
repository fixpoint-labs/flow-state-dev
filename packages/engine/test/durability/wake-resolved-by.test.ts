/**
 * A wake's run carries the resolver identity its wake names.
 *
 * Why it matters: a write into another session can start a turn there, as a
 * wake. That turn reaches the own-resolver sessions its writer's resolver
 * admits only if the wake carried the writer's `resolvedBy`; a wake with
 * none (one stored before the field, or one two resolvers folded into)
 * must run with none, so it admits no own-resolver session.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "../../src/host";
import { fireWakeThrough } from "../../src/durability/request-wakes";
import type { WakeRecord } from "../../src/stores/types";

/**
 * Fire the wake `extra` describes as the sweeper does: owed into the store,
 * listed, then `between` (another writer joining after the list), then fired
 * from the listed snapshot. The principal the run was dispatched with.
 */
async function fire(extra: Partial<WakeRecord>, between?: (stores: ReturnType<typeof createInMemoryStores>) => Promise<void>) {
  const stores = createInMemoryStores();
  const now = Date.now();
  await stores.session.set(
    "s1",
    { id: "s1", state: {}, version: 0, createdAt: now, updatedAt: now, flowKind: "desk", flowId: "desk", userId: "alice", orgId: "acme", journal: [], principalKind: "person" },
    "absent"
  );
  const seen: Array<{ principal: unknown }> = [];
  const host = {
    stores,
    dispatch: (envelope: { principal: unknown }) => {
      seen.push(envelope);
      return { requestId: "r1", finished: Promise.resolve(undefined), accepted: Promise.resolve() };
    }
  };
  await stores.wakes!.owe({
    sessionId: "s1",
    entry: "notesChanged",
    flowKind: "desk",
    userId: "alice",
    orgId: "acme",
    dueAt: now,
    landBy: now,
    ...extra
  });
  const [listed] = await stores.wakes!.listDue(now, 10);
  await between?.(stores);
  await fireWakeThrough(host as never, listed!);
  return seen[0]!.principal as { kind: string; resolvedBy?: string };
}

describe("fireWakeThrough", () => {
  it("runs as the session's owner with the resolver identity the wake names", async () => {
    expect(await fire({ resolvedBy: "flow:vault" })).toMatchObject({ userId: "alice", kind: "person", resolvedBy: "flow:vault" });
  });

  it("a wake that names none runs with none", async () => {
    expect((await fire({})).resolvedBy).toBeUndefined();
  });

  // The sweeper lists a wake, then fires it: a writer under another resolver
  // that joins in between folds its write into the turn, so the turn must not
  // keep the first resolver's reach the coalescing just withdrew.
  it("a wake another resolver owed into after it was listed runs with none", async () => {
    const principal = await fire({ resolvedBy: "flow:vault" }, async (stores) => {
      const [current] = await stores.wakes!.listDue(Number.MAX_SAFE_INTEGER, 10);
      const { version: _v, createdAt: _c, updatedAt: _u, ...owed } = current!;
      await stores.wakes!.owe({ ...owed, resolvedBy: "flow:other" });
    });
    expect(principal).toMatchObject({ userId: "alice", kind: "person" });
    expect(principal.resolvedBy).toBeUndefined();
  });

  it("a wake the same resolver owed into after it was listed keeps it", async () => {
    const principal = await fire({ resolvedBy: "flow:vault" }, async (stores) => {
      const [current] = await stores.wakes!.listDue(Number.MAX_SAFE_INTEGER, 10);
      const { version: _v, createdAt: _c, updatedAt: _u, ...owed } = current!;
      await stores.wakes!.owe({ ...owed });
    });
    expect(principal.resolvedBy).toBe("flow:vault");
  });
});
