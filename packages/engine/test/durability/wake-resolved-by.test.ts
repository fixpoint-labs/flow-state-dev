/**
 * A wake's run carries the resolver identity its wake names.
 *
 * Why it matters: a write into another session can start a turn there, as a
 * wake. That turn reaches the own-resolver sessions its writer's resolver
 * admits only if the wake carried the writer's `resolvedBy`; a wake with
 * none (one stored before the field, or a writer that held none) must run
 * with none, so it admits no own-resolver session. A wake is kept per
 * resolver, so the row a fire names is owed only by that resolver's writers,
 * and its resolver is the turn's for the whole turn.
 */
import { describe, expect, it, vi } from "vitest";
import { createInMemoryStores } from "../../src/host";
import { fireWakeThrough } from "../../src/durability/request-wakes";
import type { WakeRecord } from "../../src/stores/types";

/** What the last {@link fire} dispatched. */
let dispatched: { principal: unknown; metadata?: unknown } | undefined;
/** The stores the last {@link fire} ran on. */
let dispatchedStores: ReturnType<typeof createInMemoryStores> | undefined;

/** Owe on the kept wake's session and entry as a writer under `resolvedBy` would. */
async function oweAs(stores: ReturnType<typeof createInMemoryStores>, resolvedBy?: string) {
  const [current] = await stores.wakes!.listDue(Number.MAX_SAFE_INTEGER, 10);
  const { version: _v, createdAt: _c, updatedAt: _u, resolvedBy: _r, ...owed } = current!;
  await stores.wakes!.owe({ ...owed, ...(resolvedBy !== undefined ? { resolvedBy } : {}) });
}

/**
 * Fire the wake `extra` describes as the sweeper does: owed into the store,
 * listed, then `between` (another writer joining after the list), then fired
 * from the listed snapshot. The principal the run was dispatched with.
 */
async function fire(
  extra: Partial<WakeRecord>,
  between?: (stores: ReturnType<typeof createInMemoryStores>) => Promise<void>,
  duringSessionRead?: (stores: ReturnType<typeof createInMemoryStores>) => Promise<void>
) {
  const stores = createInMemoryStores();
  const now = Date.now();
  await stores.session.set(
    "s1",
    { id: "s1", state: {}, version: 0, createdAt: now, updatedAt: now, flowKind: "desk", flowId: "desk", userId: "alice", orgId: "acme", journal: [], principalKind: "person" },
    "absent"
  );
  const seen: Array<{ principal: unknown; metadata?: unknown }> = [];
  const host = {
    stores,
    dispatch: (envelope: { principal: unknown; metadata?: unknown }) => {
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
  if (duringSessionRead !== undefined) {
    const get = stores.session.get.bind(stores.session);
    vi.spyOn(stores.session, "get").mockImplementationOnce(async (key) => {
      const record = await get(key);
      await duringSessionRead(stores);
      return record;
    });
  }
  await fireWakeThrough(host as never, listed!);
  dispatched = seen[0]!;
  dispatchedStores = stores;
  return seen[0]!.principal as { kind: string; resolvedBy?: string };
}

describe("fireWakeThrough", () => {
  it("runs as the session's owner with the resolver identity the wake names", async () => {
    expect(await fire({ resolvedBy: "flow:vault" })).toMatchObject({ userId: "alice", kind: "person", resolvedBy: "flow:vault" });
  });

  it("a wake that names none runs with none", async () => {
    expect((await fire({})).resolvedBy).toBeUndefined();
  });

  // The sweeper lists a wake, then fires it. A writer under another resolver
  // that owes in between owes its own row, which fires its own turn: this
  // fire keeps the listed row's resolver.
  it("another resolver's owe after the list is a row of its own; the fire keeps its row's resolver and names its row", async () => {
    const principal = await fire({ resolvedBy: "flow:vault" }, (stores) => oweAs(stores, "flow:other"));
    expect(principal).toMatchObject({ userId: "alice", kind: "person", resolvedBy: "flow:vault" });
    expect(dispatched!.metadata).toEqual({ wake: { entry: "notesChanged", dueAt: expect.any(Number) } });
    const kept = await dispatchedStores!.wakes!.listDue(Number.MAX_SAFE_INTEGER, 10);
    expect(kept.map((wake) => wake.resolvedBy).sort()).toEqual(["flow:other", "flow:vault"]);
  });

  // The same, while the fire waits on the session's record.
  it("another resolver's owe while the fire reads the session leaves the fire's resolver as its row's", async () => {
    const principal = await fire({ resolvedBy: "flow:vault" }, undefined, (stores) => oweAs(stores, "flow:other"));
    expect(principal.resolvedBy).toBe("flow:vault");
  });

  // Only the vault's writers owe the vault's row, so the row's resolver is
  // the turn's to hold even when a pass cleared the row before the fire: the
  // turn finds nothing owed there, and reaches nothing it couldn't before.
  it("a listed row a pass cleared before the fire still runs under its row's resolver", async () => {
    const principal = await fire({ resolvedBy: "flow:vault" }, async (stores) => {
      const [current] = await stores.wakes!.listDue(Number.MAX_SAFE_INTEGER, 10);
      await stores.wakes!.clear(current!, current!.version);
    });
    expect(principal.resolvedBy).toBe("flow:vault");
  });
});
