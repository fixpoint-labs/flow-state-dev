/**
 * FIX-1154 — characterization POC. Throwaway; never merges.
 *
 * WHAT THIS SETTLES
 * Whether a **checked** state-bag write racing a record delete recreates the
 * record. The write-up's map row 10 said a bag delete "leaves nothing for a
 * version check to see, so a bag write cannot resurrect a deleted record",
 * and treated that as the epic's central asymmetry against the resource side's
 * tombstone revival (D5 / FIX-1258). This file runs it instead of reading it.
 *
 * HOW IT DRIVES THE REAL PATH
 * The ops under test are the shipped ones: `createScopeStateOps` over a real
 * `InMemorySessionStore`, wired through `createScopePersist` exactly as
 * `createExecutionContext` wires session scope (`buildSetRecord` returns
 * `version: expectedVersion + 1`, same as `createExecutionContext.ts:1990`).
 * No mocks, no stubbed store, no hand-rolled CAS.
 *
 * HOW THE RACE IS STAGED
 * `deleteOnce` is handed to the mutator body, which `runWithCAS` awaits
 * between `container.read()` and `persist(...)`. `InMemorySessionStore.delete`
 * has no `await` before its `Map.delete`, so the record is gone the moment it
 * is called — a genuine mid-flight delete, once, on the first attempt only.
 * That models a concurrent session-delete route landing between our read and
 * our write. Everything after that is the driver's own behaviour.
 *
 * WHAT TO READ OFF IT
 * The observable is the store, not the return value: does a row exist at the
 * id afterwards, and at what version.
 *
 * RUN IT
 *   pnpm install
 *   cd spec-poc/FIX-1154-bag-resurrection && ../../node_modules/.bin/vitest run
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemorySessionStore } from "../../packages/engine/src/stores/memory/session-store";
import { createScopePersist } from "../../packages/engine/src/stores/scope-persist";
import {
  createScopeStateOps,
  createStateContainer
} from "../../packages/engine/src/stores/state-container";
import type { SessionRecord } from "../../packages/engine/src/stores/types";

type BagState = Record<string, unknown>;

const SESSION_ID = "sess-1";

function seedRecord(state: BagState, version: number): SessionRecord {
  return {
    id: SESSION_ID,
    state: state as SessionRecord["state"],
    version,
    createdAt: 1,
    updatedAt: 1,
    flowKind: "demo",
    userId: "user-1"
  };
}

/**
 * Wires the shipped session-scope ops over a real store, the same way
 * `createExecutionContext` does. Returns the ops plus a `deleteOnce` the
 * mutator body can fire to stage the mid-flight delete.
 */
function wireSession(store: InMemorySessionStore, seeded: SessionRecord) {
  const sessionRef = { current: seeded };
  const container = createStateContainer<BagState>(
    seeded.state as BagState,
    seeded.version
  );

  let deleted = false;
  const deleteOnce = () => {
    if (deleted) return;
    deleted = true;
    // No `await` before the Map.delete inside the store, so the row is gone
    // synchronously here — mid-flight, between the read and the persist.
    void store.delete(SESSION_ID);
  };

  const ops = createScopeStateOps<BagState>(container, {
    persist: createScopePersist<BagState, SessionRecord>(
      sessionRef,
      store,
      (expectedVersion, state) => ({
        ...sessionRef.current,
        state: state as SessionRecord["state"],
        version: expectedVersion + 1,
        updatedAt: Date.now()
      })
    )
  });

  return { ops, deleteOnce, container };
}

describe("FIX-1154 — a checked bag write racing a record delete", () => {
  let store: InMemorySessionStore;

  beforeEach(async () => {
    store = new InMemorySessionStore();
    await store.set(
      SESSION_ID,
      seedRecord({ a: 5, b: 5, keep: "DO-NOT-LOSE" }, 3),
      "absent"
    );
  });

  it("CURRENT BEHAVIOUR: multi-field incState recreates the deleted record on retry", async () => {
    const { ops, deleteOnce } = wireSession(store, seedRecord({ a: 5, b: 5, keep: "DO-NOT-LOSE" }, 3));

    expect(await store.get(SESSION_ID)).toBeDefined();

    // `incState` takes no callback, so the delete is staged just before the
    // call — after the container was seeded at version 3, which is the
    // condition that matters: the writer holds a version the store no longer
    // has. Multi-field increment emits no commutative hint
    // (state-container.ts:350-360), so this is the checked CAS path.
    deleteOnce();
    const committed = await ops.incState({ a: 1, b: 1 });

    const after = await store.get(SESSION_ID);

    expect(committed).toBe(true);
    // The row is BACK, after a delete that had already removed it.
    expect(after).toBeDefined();
    // And it is back at version 1, not the 4 the first attempt tried to write:
    // the conflict refreshed the container to `currentVersion: 0`, so the retry
    // persisted at expectedVersion 0 and `buildSetRecord` stamped 0 + 1.
    expect(after?.version).toBe(1);
    // Carrying the pre-delete state the container had cached, incremented.
    expect(after?.state).toEqual({ a: 6, b: 6, keep: "DO-NOT-LOSE" });
  });

  it("CURRENT BEHAVIOUR: atomicState recreates the deleted record on retry", async () => {
    const { ops, deleteOnce } = wireSession(store, seedRecord({ a: 5, b: 5, keep: "DO-NOT-LOSE" }, 3));

    const committed = await ops.atomicState((state) => {
      deleteOnce();
      return { a: (state.a as number) + 1 };
    });

    const after = await store.get(SESSION_ID);

    expect(committed).toBe(true);
    expect(after).toBeDefined();
    expect(after?.version).toBe(1);
    expect(after?.state).toEqual({ a: 6, b: 5, keep: "DO-NOT-LOSE" });
  });

  it("CURRENT BEHAVIOUR: setState recreates the deleted record on retry", async () => {
    const { ops, deleteOnce } = wireSession(store, seedRecord({ a: 5, b: 5, keep: "DO-NOT-LOSE" }, 3));

    // `setState` takes no callback, so the delete is staged just before it —
    // still after the container was seeded at version 3, which is the
    // condition that matters: the writer holds a version the store no longer has.
    deleteOnce();
    const committed = await ops.setState({ a: 9 });

    const after = await store.get(SESSION_ID);

    expect(committed).toBe(true);
    expect(after).toBeDefined();
    expect(after?.version).toBe(1);
    expect(after?.state).toEqual({ a: 9 });
  });

  it("CONTROL: single-field incState (native delta path) refuses the missing record", async () => {
    const { ops, deleteOnce } = wireSession(store, seedRecord({ a: 5, b: 5, keep: "DO-NOT-LOSE" }, 3));

    deleteOnce();
    const committed = await ops.incState({ a: 1 });

    const after = await store.get(SESSION_ID);

    // `runCommutative` reports a no-op on conflict and never retries, and
    // `checkVersion` in memory/shared.ts refuses an absent row before the
    // version is compared — even at "any".
    expect(committed).toBe(false);
    expect(after).toBeUndefined();
  });

  it("MECHANISM: the retry persists at expectedVersion 0, which absent-reads-as-0 admits", async () => {
    // Same race, with the store instrumented to record what each attempt asked
    // for. This is the row that names the defect rather than its symptom.
    const attempts: Array<{ expectedVersion: unknown; ok: boolean }> = [];
    const realSet = store.set.bind(store);
    (store as { set: InMemorySessionStore["set"] }).set = async (
      id,
      value,
      expectedVersion
    ) => {
      const result = await realSet(id, value, expectedVersion);
      attempts.push({ expectedVersion, ok: result.ok });
      return result;
    };

    const { ops, deleteOnce } = wireSession(store, seedRecord({ a: 5, b: 5, keep: "DO-NOT-LOSE" }, 3));

    let goneMidFlight: unknown;
    await ops.atomicState((state) => {
      deleteOnce();
      // Proves the row really was absent at the moment of the first persist,
      // rather than merely at a different version.
      goneMidFlight = (store as unknown as { records: Map<string, unknown> })
        .records.get(SESSION_ID);
      return { a: (state.a as number) + 1 };
    });

    expect(goneMidFlight).toBeUndefined();
    expect(attempts).toEqual([
      { expectedVersion: 3, ok: false },
      { expectedVersion: 0, ok: true }
    ]);
  });

  it("NEGATIVE CONTROL: with no delete, the same write lands once at version 4", async () => {
    // Without this row the version-1 assertions above prove nothing — a wiring
    // that always wrote version 1 would satisfy them too.
    const { ops } = wireSession(store, seedRecord({ a: 5, b: 5, keep: "DO-NOT-LOSE" }, 3));

    const committed = await ops.atomicState((state) => ({
      a: (state.a as number) + 1
    }));
    const after = await store.get(SESSION_ID);

    expect(committed).toBe(true);
    expect(after?.version).toBe(4);
    expect(after?.state).toEqual({ a: 6, b: 5, keep: "DO-NOT-LOSE" });
  });

  it("NEGATIVE CONTROL: the delete alone, with no write, leaves no row", async () => {
    // And without this one, "the row exists afterwards" could be a row the
    // delete never removed.
    const { deleteOnce } = wireSession(store, seedRecord({ a: 5 }, 3));

    deleteOnce();

    expect(await store.get(SESSION_ID)).toBeUndefined();
  });

  it("BOUNDARY: a never-stored record takes the same path, and that one is a create", async () => {
    // The distinction the coordinator flagged: a FIRST-TOUCH writer landing at
    // version 0 into an empty slot is a create, not a revival. Shown here so
    // the two are not conflated — this row is not a defect.
    const fresh = new InMemorySessionStore();
    const { ops } = wireSession(fresh, seedRecord({}, 0));

    const committed = await ops.setState({ a: 1 });
    const after = await fresh.get(SESSION_ID);

    expect(committed).toBe(true);
    expect(after?.version).toBe(1);
  });
});
