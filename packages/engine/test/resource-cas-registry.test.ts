/**
 * FIX-992 sub-PR b — the registry's read/mutate seam is compare-and-swap.
 *
 * This is the file that holds the issue's headline goal: two concurrent
 * execution contexts patching one durable resource both land. Every case here
 * drives the REAL path — `createExecutionContext` over `createInMemoryStores`,
 * two contexts sharing one store, exactly as two concurrent HTTP requests in
 * one Node process do. Nothing about the concurrency is mocked, because the
 * defect only exists between contexts: `serializeResourceWrite` is a `const`
 * inside each registry, so it orders one context's writes and cannot see the
 * other's.
 *
 * The different-field detail in the headline case is load-bearing. A same-field
 * race passes under the value-only design this issue rejected, so a test that
 * only patched one field would go green against code that still loses writes.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import type { JsonObject } from "@flow-state-dev/core/types";
import {
  createExecutionContext,
  createInMemoryStores,
  type StoreRegistry
} from "../src";

const spine = defineResource({
  scope: "session",
  stateSchema: z.object({}).passthrough(),
  default: {}
});

const tasks = defineResourceCollection({
  scope: "session",
  pattern: "tasks/**",
  stateSchema: z.object({}).passthrough()
});

/** A capped collection, for the eviction-ordering case. */
const capped = defineResourceCollection({
  scope: "session",
  pattern: "capped/**",
  stateSchema: z.object({}).passthrough(),
  maxInstances: 2,
  eviction: "lru"
});

function makeFlow() {
  return defineFlow({
    kind: "fix992-cas",
    actions: {
      run: {
        inputSchema: z.string(),
        block: handler({
          name: "noop",
          resources: { spine, tasks, capped },
          execute: () => "ok"
        })
      }
    }
  })();
}

/**
 * One execution context over a shared store — i.e. one in-flight request.
 * Each call builds its own registry, caches and version map, so two of them
 * are genuinely two concurrent contexts rather than two handles on one.
 */
async function makeCtx(stores: StoreRegistry, requestId: string) {
  return createExecutionContext({
    flow: makeFlow(),
    actionName: "run",
    requestId,
    sessionId: "sess_1",
    userId: "user_1",
    stores
  });
}

async function readStored(
  stores: StoreRegistry,
  key: string
): Promise<JsonObject | undefined> {
  const row = await stores.resourceState.get("session", "sess_1", key);
  return row?.state;
}

describe("FIX-992: two concurrent contexts patching one resource", () => {
  it("both land — distinct fields survive a cross-context race", async () => {
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    const ctxB = await makeCtx(stores, "req_b");

    await Promise.all([
      (ctxA.resources.spine as any).patchState({ a: 1 }),
      (ctxB.resources.spine as any).patchState({ b: 2 })
    ]);

    // The durable row is the thing under test: both contexts' fields must be
    // present. Under last-write-wins whichever context commits second
    // overwrites the other's field with its own pre-race snapshot.
    expect(await readStored(stores, "spine")).toEqual({ a: 1, b: 2 });
  });

  it("a write equal to a stale cache lands rather than reporting a silent no-op", async () => {
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    await (ctxA.resources.spine as any).setState({ mode: "old" });

    // B loads {mode:"old"}, then A moves it. B deliberately writes {mode:"old"}.
    const ctxB = await makeCtx(stores, "req_b");
    await (ctxA.resources.spine as any).setState({ mode: "new" });
    await (ctxB.resources.spine as any).setState({ mode: "old" });

    expect(await readStored(stores, "spine")).toEqual({ mode: "old" });
  });

  it("a patch racing another context's delete is terminal, not a resurrection", async () => {
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    await (ctxA.resources.tasks as any).create("t1", { claimedBy: null });

    // B has t1 loaded; A deletes it; B then patches what it still holds.
    const ctxB = await makeCtx(stores, "req_b");
    await (ctxA.resources.tasks as any).delete("t1");

    const instance = await (ctxB.resources.tasks as any).get("t1");
    await expect(instance.patchState({ claimedBy: "worker-b" })).rejects.toThrow(
      /deleted/i
    );

    expect(await readStored(stores, "tasks/t1")).toBeUndefined();
  });

  it("a losing create raises already-exists instead of overwriting the winner", async () => {
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    const ctxB = await makeCtx(stores, "req_b");

    await (ctxA.resources.tasks as any).create("t1", { owner: "a" });
    await expect(
      (ctxB.resources.tasks as any).create("t1", { owner: "b" })
    ).rejects.toThrow(/already exists/i);

    expect(await readStored(stores, "tasks/t1")).toEqual({ owner: "a" });
  });

  it("a delete chosen from a stale snapshot conflicts instead of tombstoning the replacement", async () => {
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    await (ctxA.resources.tasks as any).create("t1", { generation: 1 });

    // B loads generation 1. A deletes and recreates it.
    const ctxB = await makeCtx(stores, "req_b");
    await (ctxA.resources.tasks as any).delete("t1");
    await (ctxA.resources.tasks as any).create("t1", { generation: 2 });

    // B's delete carries the version it observed, which the tombstone retained
    // and the recreated row moved past — so it must not remove generation 2.
    await expect((ctxB.resources.tasks as any).delete("t1")).rejects.toThrow();

    expect(await readStored(stores, "tasks/t1")).toEqual({ generation: 2 });
  });

  it("first touch of a defaulted resource is a no-op, not a deletion", async () => {
    // The seed-block path: a declared single resource that has never been
    // persisted, written with a value equal to its default. This is the
    // regression that took trading-desk's seed-session blocks red — the driver
    // read "no row" as "someone deleted it" and threw at every flow's first
    // touch of a defaulted resource.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");

    await expect(
      (ctx.resources.spine as any).patchState({})
    ).resolves.toBeUndefined();

    // Nothing was written, and nothing claimed to have been deleted.
    expect(await readStored(stores, "spine")).toBeUndefined();

    // And a real change on the same never-persisted key still creates it.
    await (ctx.resources.spine as any).patchState({ seeded: true });
    expect(await readStored(stores, "spine")).toEqual({ seeded: true });
  });

  it("a stale delete against a RECREATED row reports a concurrent modification, not a deletion", async () => {
    // The row demonstrably exists — it was deleted and recreated under us — so
    // `resource_deleted` would report the opposite of what happened.
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    await (ctxA.resources.tasks as any).create("t1", { generation: 1 });

    const ctxB = await makeCtx(stores, "req_b");
    await (ctxA.resources.tasks as any).delete("t1");
    await (ctxA.resources.tasks as any).create("t1", { generation: 2 });

    const err = await (ctxB.resources.tasks as any)
      .delete("t1")
      .catch((e: unknown) => e);

    expect((err as Error).name).toBe("ConcurrentModificationError");
    expect((err as Error).message).not.toMatch(/deleted/i);
    expect(await readStored(stores, "tasks/t1")).toEqual({ generation: 2 });
  });

  it("getOrCreate returns the winner's instance when its create loses", async () => {
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    const ctxB = await makeCtx(stores, "req_b");

    await (ctxA.resources.tasks as any).create("t1", { owner: "a" });

    // B never saw the row, so its getOrCreate takes the create path and loses.
    // Its contract is get-or-create; it must hand back the instance.
    const ref = await (ctxB.resources.tasks as any).getOrCreate("t1", { owner: "b" });
    expect(ref.state).toEqual({ owner: "a" });
    expect(await readStored(stores, "tasks/t1")).toEqual({ owner: "a" });
  });

  it("upsert applies its update when its create loses", async () => {
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    const ctxB = await makeCtx(stores, "req_b");

    await (ctxA.resources.tasks as any).create("t1", { owner: "a", note: "first" });

    // B loses the create, so the upsert becomes the patch it would have been
    // had it seen the row: `update` lands over the winner's state, and
    // `createOnly` is correctly dropped since B did not create anything.
    await (ctxB.resources.tasks as any).upsert(
      "t1",
      { note: "second" },
      { scaffold: "should-not-appear" }
    );

    expect(await readStored(stores, "tasks/t1")).toEqual({
      owner: "a",
      note: "second"
    });
  });

  it("a losing create does not evict an unrelated instance", async () => {
    // Eviction tombstones a real instance. A create that loses is terminal, so
    // evicting first leaves the caller with an exception AND an unrelated
    // instance permanently gone — a net loss from an operation that never
    // happened. The losing context must genuinely be AT the cap for this to
    // exercise anything, so it loads both instances before the race.
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    await (ctxA.resources.capped as any).create("c1", { n: 1 });
    await (ctxA.resources.capped as any).create("c2", { n: 2 });

    // B starts here, so it loads c1 and c2 and is at maxInstances.
    const ctxB = await makeCtx(stores, "req_b");

    // A third writer creates c3 — B cannot see it.
    await stores.resourceState.set("session", "sess_1", "capped/c3", { n: 3 }, "any");

    // B's create is over the cap (so it wants to evict) and also loses the key.
    await expect(
      (ctxB.resources.capped as any).create("c3", { n: 99 })
    ).rejects.toThrow(/already exists/i);

    // Every pre-existing instance must survive: the failed create must not have
    // paid for itself with somebody else's row.
    expect(await readStored(stores, "capped/c1")).toEqual({ n: 1 });
    expect(await readStored(stores, "capped/c2")).toEqual({ n: 2 });
    expect(await readStored(stores, "capped/c3")).toEqual({ n: 3 });
  });

  it("does not bump the version for a verified no-op write", async () => {
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    await (ctx.resources.tasks as any).create("t1", { status: "open" });
    const afterCreate = await stores.resourceState.get("session", "sess_1", "tasks/t1");

    const instance = await (ctx.resources.tasks as any).get("t1");
    await instance.patchState({ status: "open" });

    // A genuine no-op writes nothing, so the version is untouched — which is
    // what makes `committed: false` safe to gate a change notification on.
    const afterNoop = await stores.resourceState.get("session", "sess_1", "tasks/t1");
    expect(afterNoop!.version).toBe(afterCreate!.version);

    await instance.patchState({ status: "done" });
    const afterChange = await stores.resourceState.get("session", "sess_1", "tasks/t1");
    expect(afterChange!.version).toBe(afterCreate!.version + 1);
  });
});
