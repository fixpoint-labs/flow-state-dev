/**
 * Decision-tree routing tests for `createScopePersist` (FIX-405).
 *
 * Drives the scope-state ops layer against a spy store and asserts which
 * underlying method (`set` / `patchField` / `incField` / `pushToArray`) the
 * persist callback dispatched to for each shape category in the decision
 * tree. Also verifies capability advertisement: an adapter that doesn't
 * implement a delta verb continues to receive `set` calls.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createScopeStateOps,
  createStateContainer,
  type SessionRecord
} from "../src";
import { createScopePersist } from "../src/stores/scope-persist";
import type {
  DeltaStoreOps,
  ExpectedVersion,
  SetResult
} from "../src/stores/types";

type SpyStore = {
  set: ReturnType<typeof vi.fn>;
  patchField?: ReturnType<typeof vi.fn>;
  incField?: ReturnType<typeof vi.fn>;
  pushToArray?: ReturnType<typeof vi.fn>;
};

function makeRecord(
  state: Record<string, unknown> = {}
): SessionRecord {
  const ts = Date.now();
  return {
    id: "s1",
    flowKind: "f",
    userId: "u",
    state,
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    journal: []
  };
}

/**
 * Build a spy store and a ScopeStateOps wired to `createScopePersist`. The
 * spy returns `ok: true` for every call so the CAS loop terminates after a
 * single attempt and the dispatched method is unambiguous.
 *
 * `methods` selects which delta verbs the spy advertises. Omitting a verb
 * leaves the property `undefined` so `createScopePersist`'s feature-detect
 * falls back to `set`.
 */
function setup(
  methods: ("patchField" | "incField" | "pushToArray")[] = [
    "patchField",
    "incField",
    "pushToArray"
  ],
  initialState: Record<string, unknown> = {}
) {
  let nextVersion = 1;
  const initial = makeRecord(initialState);
  const ref = { current: initial };

  const set = vi.fn(
    async (
      _id: string,
      _value: SessionRecord,
      _expectedVersion: ExpectedVersion
    ): Promise<SetResult<SessionRecord>> => ({
      ok: true,
      version: nextVersion++
    })
  );

  const spy: SpyStore & DeltaStoreOps<SessionRecord> & {
    set: typeof set;
  } = { set };

  if (methods.includes("patchField")) {
    spy.patchField = vi.fn(async () => ({ ok: true, version: nextVersion++ }));
  }
  if (methods.includes("incField")) {
    spy.incField = vi.fn(async () => ({ ok: true, version: nextVersion++ }));
  }
  if (methods.includes("pushToArray")) {
    spy.pushToArray = vi.fn(async () => ({ ok: true, version: nextVersion++ }));
  }

  const container = createStateContainer<Record<string, unknown>>(
    initial.state as Record<string, unknown>,
    0
  );

  const persist = createScopePersist<
    Record<string, unknown>,
    SessionRecord
  >(
    ref,
    spy as DeltaStoreOps<SessionRecord> & {
      set: typeof set;
    },
    (expectedVersion, state) => ({
      ...ref.current,
      state: state as Record<string, unknown>,
      version: expectedVersion + 1,
      updatedAt: Date.now()
    })
  );

  const ops = createScopeStateOps<Record<string, unknown>>(container, {
    persist,
    cas: { maxRetries: 0, baseDelayMs: 0 }
  });

  return { spy, ops, ref };
}

describe("createScopePersist — decision tree", () => {
  describe("patchState routing", () => {
    it("single own-property literal patch routes to patchField", async () => {
      const { spy, ops } = setup();

      await ops.patchState({ count: 5 });

      expect(spy.patchField).toHaveBeenCalledTimes(1);
      expect(spy.patchField).toHaveBeenCalledWith(
        "s1",
        ["count"],
        5,
        0,
        expect.any(Number)
      );
      expect(spy.set).not.toHaveBeenCalled();
    });

    it("multi-field patch falls back to set", async () => {
      const { spy, ops } = setup();

      await ops.patchState({ count: 5, mode: "running" });

      expect(spy.set).toHaveBeenCalledTimes(1);
      expect(spy.patchField).not.toHaveBeenCalled();
    });

    it("keyed-updater form routes to patchField", async () => {
      const { spy, ops } = setup(undefined, { count: 10 });

      await ops.patchState("count", (current) => (current as number) + 1);

      expect(spy.patchField).toHaveBeenCalledTimes(1);
      expect(spy.patchField).toHaveBeenCalledWith(
        "s1",
        ["count"],
        11,
        0,
        expect.any(Number)
      );
    });

    it("patch with a function value falls back to set", async () => {
      const { spy, ops } = setup();
      // A function value can't survive serialization; fall back to set so
      // the underlying store's normal serialization rules apply.
      await ops.patchState({ cb: (() => 1) as unknown } as never);

      expect(spy.set).toHaveBeenCalledTimes(1);
      expect(spy.patchField).not.toHaveBeenCalled();
    });
  });

  describe("setState routing", () => {
    it("setState always routes to set", async () => {
      const { spy, ops } = setup();

      await ops.setState({ count: 5 });

      expect(spy.set).toHaveBeenCalledTimes(1);
      expect(spy.patchField).not.toHaveBeenCalled();
    });
  });

  describe("incState routing", () => {
    it("single-field increment routes to incField with the user-provided delta", async () => {
      const { spy, ops } = setup(undefined, { count: 0 });

      await ops.incState({ count: 3 });

      expect(spy.incField).toHaveBeenCalledTimes(1);
      expect(spy.incField).toHaveBeenCalledWith(
        "s1",
        ["count"],
        3,
        0,
        expect.any(Number)
      );
    });

    it("multi-field increment falls back to set (single-version semantics)", async () => {
      const { spy, ops } = setup();

      await ops.incState({ a: 1, b: 1 });

      expect(spy.set).toHaveBeenCalledTimes(1);
      expect(spy.incField).not.toHaveBeenCalled();
    });
  });

  describe("pushState routing", () => {
    it("pushState always routes to pushToArray", async () => {
      const { spy, ops } = setup(undefined, { log: [] });

      await ops.pushState("log", "first");

      expect(spy.pushToArray).toHaveBeenCalledTimes(1);
      expect(spy.pushToArray).toHaveBeenCalledWith(
        "s1",
        ["log"],
        ["first"],
        0,
        expect.any(Number)
      );
    });
  });

  describe("setStateRecord / deleteStateRecord routing", () => {
    it("setStateRecord routes to set (depth-2 path, v1 fallback)", async () => {
      const { spy, ops } = setup(undefined, { bag: {} });

      await ops.setStateRecord("bag", "key", "value");

      expect(spy.set).toHaveBeenCalledTimes(1);
      expect(spy.patchField).not.toHaveBeenCalled();
    });

    it("deleteStateRecord routes to set", async () => {
      const { spy, ops } = setup(undefined, { bag: { x: 1 } });

      await ops.deleteStateRecord("bag", "x");

      expect(spy.set).toHaveBeenCalledTimes(1);
    });
  });

  describe("atomicState routing", () => {
    it("atomicState always routes to set", async () => {
      const { spy, ops } = setup();

      await ops.atomicState((state) => ({
        count: (state.count as number | undefined ?? 0) + 1
      }));

      expect(spy.set).toHaveBeenCalledTimes(1);
      expect(spy.patchField).not.toHaveBeenCalled();
    });
  });

  describe("CAS retry invariants", () => {
    it("incField delta is invariant across retries (re-applies same delta on conflict)", async () => {
      // Simulates a concurrent writer: incField is called, returns conflict
      // once with a fresh version, then the next attempt returns ok. Assert
      // the spy received the same delta value both times.
      let calls = 0;
      let nextVersion = 2;
      const incField = vi.fn(
        async (
          _id: string,
          _path: string[],
          _delta: number,
          _ev: ExpectedVersion,
          _updatedAt: number
        ): Promise<SetResult<SessionRecord>> => {
          calls += 1;
          if (calls === 1) {
            // Conflict on first attempt — pretend another writer landed.
            const stored = makeRecord({ count: 99 });
            stored.version = 1;
            return {
              ok: false,
              conflict: { currentValue: stored, currentVersion: 1 }
            };
          }
          return { ok: true, version: nextVersion++ };
        }
      );

      const initial = makeRecord({ count: 0 });
      const ref = { current: initial };
      const set = vi.fn(
        async (
          _id: string,
          _value: SessionRecord,
          _ev: ExpectedVersion
        ): Promise<SetResult<SessionRecord>> => ({ ok: true, version: 1 })
      );

      const container = createStateContainer<Record<string, unknown>>(
        { count: 0 },
        0
      );
      const persist = createScopePersist<
        Record<string, unknown>,
        SessionRecord
      >(
        ref,
        { set, incField } as DeltaStoreOps<SessionRecord> & {
          set: typeof set;
        },
        (expectedVersion, state) => ({
          ...ref.current,
          state: state as Record<string, unknown>,
          version: expectedVersion + 1,
          updatedAt: Date.now()
        })
      );
      const ops = createScopeStateOps<Record<string, unknown>>(container, {
        persist,
        cas: { maxRetries: 3, baseDelayMs: 0 }
      });

      await ops.incState({ count: 5 });

      expect(incField).toHaveBeenCalledTimes(2);
      // Both calls carry delta = 5 — the user intent, not derived from state.
      expect(incField.mock.calls[0][2]).toBe(5);
      expect(incField.mock.calls[1][2]).toBe(5);
      // Second call uses the refreshed expectedVersion from the conflict.
      expect(incField.mock.calls[1][3]).toBe(1);
    });
  });

  describe("capability advertisement", () => {
    it("falls back to set when the adapter does not advertise patchField", async () => {
      const { spy, ops } = setup([]); // no delta verbs

      await ops.patchState({ count: 5 });

      expect(spy.set).toHaveBeenCalledTimes(1);
      expect(spy.patchField).toBeUndefined();
    });

    it("falls back to set when the adapter does not advertise incField", async () => {
      const { spy, ops } = setup(["patchField", "pushToArray"]);

      await ops.incState({ count: 1 });

      expect(spy.set).toHaveBeenCalledTimes(1);
      expect(spy.incField).toBeUndefined();
    });

    it("falls back to set when the adapter does not advertise pushToArray", async () => {
      const { spy, ops } = setup(["patchField", "incField"]);

      await ops.pushState("log", "a");

      expect(spy.set).toHaveBeenCalledTimes(1);
      expect(spy.pushToArray).toBeUndefined();
    });
  });
});
