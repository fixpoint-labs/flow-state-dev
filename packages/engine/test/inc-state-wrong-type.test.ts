/**
 * `incState` refuses a target that holds something other than a number, on
 * every path it takes: the container's own mutator (no store, and the
 * multi-field call that persists as a full-record `set`) and the store's
 * `incField` (the single-field call). Absent or null still starts from 0.
 * The per-adapter `incField` contract lives in the scope-store conformance
 * suite.
 */
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import {
  createInMemorySessionStore,
  createScopeStateOps,
  createStateContainer,
  type SessionRecord
} from "../src";
import type { CASPersist } from "../src/stores/cas";
import { createScopePersist } from "../src/stores/scope-persist";

type State = Record<string, unknown>;

describe("incState on a non-numeric target", () => {
  describe("scope with no store", () => {
    it("refuses a string target and leaves it intact", async () => {
      const container = createStateContainer<State>({ count: "hello" }, 0);
      const ops = createScopeStateOps<State>(container);

      await expect(ops.incState({ count: 1 })).rejects.toThrow(
        /incState target "count" is not a number/
      );

      expect(container.read()).toEqual({ count: "hello" });
      expect(container.getVersion()).toBe(0);
    });

    it("starts a missing field from 0", async () => {
      const container = createStateContainer<State>({}, 0);
      const ops = createScopeStateOps<State>(container);

      await ops.incState({ count: 2 });

      expect(container.read()).toEqual({ count: 2 });
    });

    it("starts a null field from 0", async () => {
      // BP-023 state fields default to null, so an untouched counter reads as
      // null. That is the field's empty state, not a value to protect.
      const container = createStateContainer<State>({ count: null }, 0);
      const ops = createScopeStateOps<State>(container);

      await ops.incState({ count: 2 });

      expect(container.read()).toEqual({ count: 2 });
    });
  });

  describe("multi-field call (persists as a full-record set)", () => {
    it("refuses the whole call when one field is wrong-typed, persisting nothing", async () => {
      const container = createStateContainer<State>({ calls: 1, label: "keep me" }, 0);
      const persist = vi.fn<CASPersist<State>>(async (_state, expectedVersion) => ({
        ok: true,
        version: expectedVersion + 1
      }));
      const ops = createScopeStateOps<State>(container, { persist });

      await expect(ops.incState({ calls: 1, label: 1 })).rejects.toThrow(
        /incState target "label" is not a number/
      );

      expect(persist).not.toHaveBeenCalled();
      expect(container.read()).toEqual({ calls: 1, label: "keep me" });
    });
  });

  describe("single-field call against a real store", () => {
    function makeRecord(state: State): SessionRecord {
      const ts = Date.now();
      return {
        orgId: DEFAULT_ORG_ID,
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

    it("refuses when the STORE holds a non-number the local copy has not seen", async () => {
      // The container is stale (it read a number); another writer has since
      // patched the field to a string. The commutative path applies the
      // delta store-side against "any", so only the adapter can see this.
      const store = createInMemorySessionStore();
      await store.set("s1", makeRecord({ count: "written elsewhere" }), "absent");

      const ref = { current: makeRecord({ count: 3 }) };
      const container = createStateContainer<State>({ count: 3 }, 0);
      const persist = createScopePersist<State, SessionRecord>(ref, store, (version, state) => ({
        ...ref.current,
        state: state as SessionRecord["state"],
        version: version + 1,
        updatedAt: Date.now()
      }));
      const ops = createScopeStateOps<State>(container, { persist });

      await expect(ops.incState({ count: 1 })).rejects.toThrow(/not a number/);

      const stored = await store.get("s1");
      expect(stored?.state).toEqual({ count: "written elsewhere" });
      expect(stored?.version).toBe(0);
    });
  });
});
