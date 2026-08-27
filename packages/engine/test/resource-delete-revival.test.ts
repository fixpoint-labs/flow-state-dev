/**
 * FIX-1258 — a deleted resource stays deleted.
 *
 * A resource write that begins from the absent-row seed (`version === 0`) used
 * to be admitted over a tombstone, so it wrote a fresh live generation and the
 * delete was silently undone. Two distinguishable histories produce that seed —
 * a key that was never persisted, and one that was persisted and then deleted —
 * and the store could not tell them apart, because `expectedVersion: 0` means
 * "no LIVE row" and a tombstone satisfies it.
 *
 * Every case here drives the real path: `createExecutionContext` over
 * `createInMemoryStores`, exactly as an in-flight request does. The two
 * `ResourceRef` factories are covered separately (`resource-registry.ts` builds
 * one for a single resource and a different one for a collection instance), and
 * the controls are as load-bearing as the refusals: a fix that refused the
 * ordinary first touch, or refused `create()` after a delete (FIX-992), would
 * pass a file that only asserted the refusals.
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
  ResourceDeletedError,
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

function makeFlow() {
  return defineFlow({
    kind: "fix1258-revival",
    actions: {
      run: {
        inputSchema: z.string(),
        block: handler({
          name: "noop",
          resources: { spine, tasks },
          execute: () => "ok"
        })
      }
    }
  })();
}

/** One execution context over a shared store — i.e. one in-flight request. */
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

describe("FIX-1258: a write after a delete does not revive the resource", () => {
  it("refuses a single resource's write from a context that never saw it", async () => {
    // The session-delete story. A request writes the resource, the session's
    // resources are deleted (`deleteAll` is what the session-delete route
    // calls), and a request that started afterwards writes the same key. That
    // second request holds no version for it — the same seed a genuine first
    // touch begins from.
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    await (ctxA.resources.spine as any).setState({ secret: "user content" });

    await stores.resourceState.deleteAll("session", "sess_1");

    const ctxB = await makeCtx(stores, "req_b");
    await expect(
      (ctxB.resources.spine as any).setState({ revived: true })
    ).rejects.toBeInstanceOf(ResourceDeletedError);

    expect(await readStored(stores, "spine")).toBeUndefined();
  });

  it("refuses a write through a collection ref this context deleted", async () => {
    // The held-then-lost path, and the reason the condition is the cache state
    // at write time rather than the request's observation history: this context
    // DID observe `t1` live. Its own `delete` evicted the cached version, so
    // the retained ref's next write begins from the absent-row seed too.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    await (ctx.resources.tasks as any).create("t1", { claimedBy: null });
    const held = await (ctx.resources.tasks as any).get("t1");

    await (ctx.resources.tasks as any).delete("t1");

    await expect(held.patchState({ claimedBy: "worker-a" })).rejects.toBeInstanceOf(
      ResourceDeletedError
    );

    expect(await readStored(stores, "tasks/t1")).toBeUndefined();
  });

  it("refuses updateState on a tombstoned resource, like the other two verbs", async () => {
    // The third mutation verb. All three reach the same driver, so this is a
    // seam check rather than three separate behaviours — but `updateState` is
    // the one whose updater runs before the refusal, and a caller must not see
    // its computed value land.
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    await (ctxA.resources.spine as any).setState({ generation: 1 });

    await stores.resourceState.deleteAll("session", "sess_1");

    const ctxB = await makeCtx(stores, "req_b");
    await expect(
      (ctxB.resources.spine as any).updateState((state: JsonObject) => ({
        ...state,
        generation: 2
      }))
    ).rejects.toBeInstanceOf(ResourceDeletedError);

    expect(await readStored(stores, "spine")).toBeUndefined();
  });

  // --- Controls: what must NOT start failing ---

  it("still creates a never-written resource on its first touch", async () => {
    // The common path, and the probe's own control: if this went red the
    // refusals above would prove nothing about tombstones.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");

    await (ctx.resources.spine as any).patchState({ first: true });

    expect(await readStored(stores, "spine")).toEqual({ first: true });
  });

  it("still recreates through upsert() and getOrCreate() after a delete", async () => {
    // The "or create" APIs branch on the cached view, so a tombstoned key sends
    // them down their create path rather than the mutation path this change
    // tightened. Pinned because it is the first thing a reader will worry
    // about, and because the two families are one `if` apart in the registry.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    await (ctx.resources.tasks as any).create("t1", { generation: 1 });
    await (ctx.resources.tasks as any).delete("t1");

    await (ctx.resources.tasks as any).upsert("t1", { generation: 2 });
    expect(await readStored(stores, "tasks/t1")).toEqual({ generation: 2 });

    await (ctx.resources.tasks as any).delete("t1");
    await (ctx.resources.tasks as any).getOrCreate("t1", { generation: 3 });
    expect(await readStored(stores, "tasks/t1")).toEqual({ generation: 3 });
  });

  it("still recreates an instance through create() after a delete (FIX-992)", async () => {
    // Explicit recreation is intentional prior art, not an edge case to close.
    // It reaches the store with the same "no live row" expectation the refused
    // writes above carry, and must stay admitted.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    await (ctx.resources.tasks as any).create("t1", { generation: 1 });
    await (ctx.resources.tasks as any).delete("t1");

    await (ctx.resources.tasks as any).create("t1", { generation: 2 });

    expect(await readStored(stores, "tasks/t1")).toEqual({ generation: 2 });
  });
});
