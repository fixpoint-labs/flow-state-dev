/**
 * Tests for wrapStateOpsWithEmit and shouldPersistScopeChange in scope-emit.ts.
 *
 * Verifies: emit fires after committed mutation; CAS-loss skips emit;
 * transient-key suppression for block_instance scope; outer-scope emits with
 * no filtering; atomicState diff gating.
 */

import { describe, expect, it, vi } from "vitest";
import {
  wrapStateOpsWithEmit,
  shouldPersistScopeChange,
} from "../../src/context/scope-emit";
import { createScopeStateOps, MemoryStateContainer } from "../../src/stores/state-container";
import type { FlowInstance } from "@flow-state-dev/core/types";

type TestState = {
  count: number;
  name: string;
  _transient: string;
};

function mockResponse() {
  const added: any[] = [];
  const done: any[] = [];
  return {
    emitItemAdded: vi.fn(async (item: any) => { added.push(item); }),
    emitItemDone: vi.fn(async (item: any) => { done.push(item); }),
    added,
    done,
  };
}

function makeProvenance() {
  return {
    blockName: "test-block",
    blockInstanceId: "inst-1",
    phase: "main" as const,
  };
}

function buildOps(
  container: MemoryStateContainer<TestState>,
  response: ReturnType<typeof mockResponse>,
  transientKeys?: Set<string>,
  blockInstanceId?: string,
) {
  const baseOps = createScopeStateOps(container);
  return wrapStateOpsWithEmit<TestState>({
    scope: blockInstanceId ? "block_instance" : "session",
    baseOps,
    container,
    getResponse: () => response,
    requestId: "req-1",
    nextItemIndex: (() => { let i = 0; return () => ++i; })(),
    provenance: makeProvenance,
    transient: false,
    transientKeys,
    blockInstanceId,
  });
}

describe("wrapStateOpsWithEmit", () => {
  describe("outer scope (no transientKeys)", () => {
    it("patchState commits and emits a state_change item", async () => {
      const container = new MemoryStateContainer<TestState>({ count: 0, name: "a", _transient: "x" }, 0);
      const res = mockResponse();
      const ops = buildOps(container, res);

      const committed = await ops.patchState({ count: 1 });

      expect(committed).toBe(true);
      expect(res.emitItemAdded).toHaveBeenCalledOnce();
      expect(res.emitItemDone).toHaveBeenCalledOnce();

      const item = res.added[0];
      expect(item.type).toBe("state_change");
      expect(item.scope).toBe("session");
      expect(item.operation).toBe("patch");
      expect(item.delta).toEqual({ count: 1 });
    });

    it("emits for every field including fields that would be transient in block_instance scope", async () => {
      const container = new MemoryStateContainer<TestState>({ count: 0, name: "a", _transient: "x" }, 0);
      const res = mockResponse();
      const ops = buildOps(container, res);

      await ops.patchState({ _transient: "y" });

      // No transient filtering in outer scope — emit should fire
      expect(res.emitItemAdded).toHaveBeenCalledOnce();
    });
  });

  describe("CAS loss skips emit", () => {
    it("no-op write (same value) does not emit", async () => {
      const container = new MemoryStateContainer<TestState>({ count: 5, name: "a", _transient: "x" }, 0);
      const res = mockResponse();
      const ops = buildOps(container, res);

      // Writing the same value — deepEqual short-circuits, committed = false
      const committed = await ops.patchState({ count: 5 });

      expect(committed).toBe(false);
      expect(res.emitItemAdded).not.toHaveBeenCalled();
    });

    it("setState no-op does not emit", async () => {
      const initial: TestState = { count: 1, name: "hello", _transient: "t" };
      const container = new MemoryStateContainer<TestState>(initial, 0);
      const res = mockResponse();
      const ops = buildOps(container, res);

      const committed = await ops.setState({ ...initial });

      expect(committed).toBe(false);
      expect(res.emitItemAdded).not.toHaveBeenCalled();
    });
  });

  describe("block_instance with transientKeys", () => {
    const transientKeys = new Set(["_transient"]);

    it("patchState with only transient key suppresses emit", async () => {
      const container = new MemoryStateContainer<TestState>({ count: 0, name: "a", _transient: "x" }, 0);
      const res = mockResponse();
      const ops = buildOps(container, res, transientKeys, "block-inst-1");

      const committed = await ops.patchState({ _transient: "new-val" });

      expect(committed).toBe(true);
      // State was persisted to the container
      expect((container.read() as any)._transient).toBe("new-val");
      // But no SSE emit
      expect(res.emitItemAdded).not.toHaveBeenCalled();
    });

    it("patchState with non-transient key emits", async () => {
      const container = new MemoryStateContainer<TestState>({ count: 0, name: "a", _transient: "x" }, 0);
      const res = mockResponse();
      const ops = buildOps(container, res, transientKeys, "block-inst-1");

      await ops.patchState({ count: 99 });

      expect(res.emitItemAdded).toHaveBeenCalledOnce();
      expect(res.added[0].delta).toEqual({ count: 99 });
    });

    it("patchState with mixed keys emits only non-transient delta", async () => {
      const container = new MemoryStateContainer<TestState>({ count: 0, name: "a", _transient: "x" }, 0);
      const res = mockResponse();
      const ops = buildOps(container, res, transientKeys, "block-inst-1");

      await ops.patchState({ count: 1, _transient: "y" } as any);

      expect(res.emitItemAdded).toHaveBeenCalledOnce();
      const delta = res.added[0].delta;
      expect(delta).toEqual({ count: 1 });
      expect(delta).not.toHaveProperty("_transient");
    });

    it("pushState on a transient field suppresses emit", async () => {
      type S = { items: string[]; _transient: string[] };
      const container = new MemoryStateContainer<S>({ items: [], _transient: [] }, 0);
      const baseOps = createScopeStateOps(container);
      const res = mockResponse();
      const ops = wrapStateOpsWithEmit<S>({
        scope: "block_instance",
        baseOps,
        container,
        getResponse: () => res,
        requestId: "req-1",
        nextItemIndex: (() => { let i = 0; return () => ++i; })(),
        provenance: makeProvenance,
        transient: false,
        transientKeys: new Set(["_transient"]),
        blockInstanceId: "b1",
      });

      const committed = await ops.pushState("_transient", "hello");

      expect(committed).toBe(true);
      expect(res.emitItemAdded).not.toHaveBeenCalled();
    });

    it("setStateRecord on a transient field suppresses emit", async () => {
      type S = { map: Record<string, string>; _transient: Record<string, string> };
      const container = new MemoryStateContainer<S>({ map: {}, _transient: {} }, 0);
      const baseOps = createScopeStateOps(container);
      const res = mockResponse();
      const ops = wrapStateOpsWithEmit<S>({
        scope: "block_instance",
        baseOps,
        container,
        getResponse: () => res,
        requestId: "req-1",
        nextItemIndex: (() => { let i = 0; return () => ++i; })(),
        provenance: makeProvenance,
        transient: false,
        transientKeys: new Set(["_transient"]),
        blockInstanceId: "b1",
      });

      const committed = await ops.setStateRecord("_transient", "k1", "v1");

      expect(committed).toBe(true);
      expect(res.emitItemAdded).not.toHaveBeenCalled();
    });

    it("deleteStateRecord on a transient field suppresses emit", async () => {
      type S = { map: Record<string, string>; _transient: Record<string, string> };
      const container = new MemoryStateContainer<S>({ map: {}, _transient: { k: "v" } }, 0);
      const baseOps = createScopeStateOps(container);
      const res = mockResponse();
      const ops = wrapStateOpsWithEmit<S>({
        scope: "block_instance",
        baseOps,
        container,
        getResponse: () => res,
        requestId: "req-1",
        nextItemIndex: (() => { let i = 0; return () => ++i; })(),
        provenance: makeProvenance,
        transient: false,
        transientKeys: new Set(["_transient"]),
        blockInstanceId: "b1",
      });

      const committed = await ops.deleteStateRecord("_transient", "k");

      expect(committed).toBe(true);
      expect(res.emitItemAdded).not.toHaveBeenCalled();
    });
  });

  describe("atomicState diff path", () => {
    const transientKeys = new Set(["_transient"]);

    it("suppresses emit when only transient keys changed", async () => {
      const container = new MemoryStateContainer<TestState>({ count: 0, name: "a", _transient: "x" }, 0);
      const res = mockResponse();
      const ops = buildOps(container, res, transientKeys, "block-inst-1");

      const committed = await ops.atomicState((s) => ({ _transient: "changed" }));

      expect(committed).toBe(true);
      expect(res.emitItemAdded).not.toHaveBeenCalled();
    });

    it("emits when at least one non-transient key changed", async () => {
      const container = new MemoryStateContainer<TestState>({ count: 0, name: "a", _transient: "x" }, 0);
      const res = mockResponse();
      const ops = buildOps(container, res, transientKeys, "block-inst-1");

      await ops.atomicState((s) => ({ count: 10, _transient: "changed" }));

      expect(res.emitItemAdded).toHaveBeenCalledOnce();
      expect(res.added[0].operation).toBe("atomic");
    });

    it("no-op atomicState (same state) does not emit", async () => {
      const container = new MemoryStateContainer<TestState>({ count: 5, name: "a", _transient: "x" }, 0);
      const res = mockResponse();
      const ops = buildOps(container, res, transientKeys, "block-inst-1");

      const committed = await ops.atomicState((s) => ({}));

      expect(committed).toBe(false);
      expect(res.emitItemAdded).not.toHaveBeenCalled();
    });
  });
});

describe("shouldPersistScopeChange", () => {
  it("returns true when persistStateChanges is set on the flow", () => {
    const flow = { persistStateChanges: true } as unknown as FlowInstance;
    expect(shouldPersistScopeChange(flow)).toBe(true);
  });

  it("returns false in production without persistStateChanges", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const flow = {} as unknown as FlowInstance;
      expect(shouldPersistScopeChange(flow)).toBe(false);
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it("returns true in non-production without persistStateChanges", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      const flow = {} as unknown as FlowInstance;
      expect(shouldPersistScopeChange(flow)).toBe(true);
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
