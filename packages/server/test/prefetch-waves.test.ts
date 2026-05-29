/**
 * FIX-688: three-wave resource loading.
 *
 * Verifies that a request loads only the resources its dispatched action and
 * blocks need, in three waves:
 *   Wave 1 — flow-level resources at request start.
 *   Wave 2 — the dispatched action's block-tree eager resources at context
 *            creation (a context is bound to exactly one action).
 *   Wave 3 — a block's own `prefetchMode: 'lazy'` single resources at block
 *            dispatch, kept synchronously readable via `.state`.
 *
 * Store reads are observed via spies so we assert *what* loaded *when*, not
 * just the end state.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, defineResource, defineResourceCollection, handler } from "@flow-state-dev/core";
import { createExecutionContext, createInMemoryStores, runAction } from "../src";

// Flow-level single resource — always loaded at request start.
const flowRes = defineResource({
  scope: "session",
  ref: "flowRes",
  stateSchema: z.object({ v: z.number().default(0) }),
  writable: true
});

// Lazy single resource declared on action A's block — deferred to Wave 3.
const lazyS = defineResource({
  scope: "session",
  ref: "lazyS",
  prefetchMode: "lazy",
  stateSchema: z.object({ v: z.number().default(0) }),
  writable: true
});

const collA = defineResourceCollection({
  scope: "session",
  pattern: "colA/**",
  stateSchema: z.object({ n: z.number().default(0) })
});

const collB = defineResourceCollection({
  scope: "session",
  pattern: "colB/**",
  stateSchema: z.object({ n: z.number().default(0) })
});

const blockA = handler({
  name: "a",
  resources: { collA, lazyS },
  execute: (_input, ctx) => ({ lazyV: (ctx.resources.lazyS.state as { v: number }).v })
});

const blockB = handler({
  name: "b",
  resources: { collB },
  execute: () => ({ ok: true })
});

const flow = defineFlow({
  kind: "waves",
  resources: { flowRes },
  actions: {
    a: { inputSchema: z.object({}), block: blockA },
    b: { inputSchema: z.object({}), block: blockB }
  }
})();

function spyStores() {
  const stores = createInMemoryStores();
  const getByPrefix = vi.spyOn(stores.resourceState, "getByPrefix");
  const get = vi.spyOn(stores.resourceState, "get");
  return { stores, getByPrefix, get };
}

describe("FIX-688: three-wave loading", () => {
  it("Wave 2: loads only the dispatched action's collections, not siblings'", async () => {
    const { stores, getByPrefix } = spyStores();
    await createExecutionContext({
      flow,
      actionName: "a",
      requestId: "r1",
      sessionId: "s1",
      userId: "u1",
      stores
    });
    const prefixes = getByPrefix.mock.calls.map((c) => c[2]);
    expect(prefixes).toContain("colA/");
    expect(prefixes).not.toContain("colB/");
  });

  it("Wave 2: dispatching the sibling action loads its collection, not the other", async () => {
    const { stores, getByPrefix } = spyStores();
    await createExecutionContext({
      flow,
      actionName: "b",
      requestId: "r1",
      sessionId: "s1",
      userId: "u1",
      stores
    });
    const prefixes = getByPrefix.mock.calls.map((c) => c[2]);
    expect(prefixes).toContain("colB/");
    expect(prefixes).not.toContain("colA/");
  });

  it("Wave 1: loads the flow-level single resource regardless of action", async () => {
    const { stores, get } = spyStores();
    await createExecutionContext({
      flow,
      actionName: "b",
      requestId: "r1",
      sessionId: "s1",
      userId: "u1",
      stores
    });
    expect(get.mock.calls.map((c) => c[2])).toContain("flowRes");
  });

  it("Wave 3: a lazy single is not loaded at context creation", async () => {
    const { stores, get } = spyStores();
    await stores.resourceState.set("session", "s1", "lazyS", { v: 42 });
    get.mockClear();
    await createExecutionContext({
      flow,
      actionName: "a",
      requestId: "r1",
      sessionId: "s1",
      userId: "u1",
      stores
    });
    expect(get.mock.calls.map((c) => c[2])).not.toContain("lazyS");
  });

  it("Wave 3: loads a lazy single once at block dispatch, readable synchronously", async () => {
    const { stores, get } = spyStores();
    await stores.resourceState.set("session", "s1", "lazyS", { v: 42 });
    get.mockClear();
    const result = await runAction({
      flow,
      actionName: "a",
      input: {},
      requestId: "r2",
      sessionId: "s1",
      userId: "u1",
      stores,
      runtimeConfig: {}
    });
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ lazyV: 42 });
    expect(get.mock.calls.filter((c) => c[2] === "lazyS").length).toBe(1);
  });

  it("single-flights concurrent loads of the same resource", async () => {
    const { stores, get } = spyStores();
    await stores.resourceState.set("session", "s1", "lazyS", { v: 9 });
    const ctx = await createExecutionContext({
      flow,
      actionName: "a",
      requestId: "r1",
      sessionId: "s1",
      userId: "u1",
      stores
    });
    get.mockClear();
    await Promise.all([
      (ctx as unknown as {
        _loadDeclaredResources: (d: unknown, o: { loadLazySingles: boolean }) => Promise<void>;
      })._loadDeclaredResources({ lazyS }, { loadLazySingles: true }),
      (ctx as unknown as {
        _loadDeclaredResources: (d: unknown, o: { loadLazySingles: boolean }) => Promise<void>;
      })._loadDeclaredResources({ lazyS }, { loadLazySingles: true })
    ]);
    expect(get.mock.calls.filter((c) => c[2] === "lazyS").length).toBe(1);
  });
});
