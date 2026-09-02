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
import type { FlowInstance } from "@flow-state-dev/core";
import { createRequestHost } from "../src/context/create-request-host";
import { ensureSessionRecord } from "../src/context/ensure-session-record";
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

/** Only `kind` and `internal` are read by the dispatch verb. */
const SPAWN_FLOW = {
  kind: "fix1258-spawn",
  internal: { core: { block: { name: "core" } } }
} as unknown as FlowInstance;

/**
 * Dispatch a detached child from one fixed key, and return its session id.
 *
 * The key is constant on purpose: the child id is derived from it, so every
 * call targets the same child id — which is what makes the delete/re-spawn
 * case below reachable at all.
 */
async function spawnChild(stores: StoreRegistry): Promise<string> {
  const { seam } = createRequestHost({
    stores,
    flow: SPAWN_FLOW,
    identity: {
      userId: "user_1",
      tenantId: undefined,
      orgId: undefined,
      sessionId: "sess_parent",
      lineageId: "lin_1"
    },
    dispatchOperation: async () => ({ requestId: "req_child" }),
    liveness: {}
  });

  const result = await seam({
    type: "internal",
    target: "core",
    session: { key: "review" },
    payload: {},
    from: "spawn"
  });
  if (!result.ok) throw new Error(`spawn refused: ${result.refused}`);
  return result.sessionId;
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

  it("still writes static resources after the session id is deleted and recreated", async () => {
    // The other half of the refusals above, and the one that decides whether
    // this store's `"absent"` is a guard or a brick. Session ids are
    // caller-supplied (`session-routes.ts` falls back to a generated one only
    // when the body omits `sessionId`), so `chat-42` or a document id being
    // deleted and used again is ordinary, not exotic.
    //
    // Teardown here is what the delete route does, in its order: tombstone the
    // scope's resource rows, then HARD-delete the session record — the session
    // store keeps no tombstone, so the id is genuinely free afterwards. What
    // follows is therefore a NEW incarnation, not a straggler from the dead
    // one: it re-creates the session record before it writes.
    //
    // A static `ResourceRef` has no `create()` to escape through, so if its
    // first mutation is refused the resource is unwritable for the rest of the
    // session's life.
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    await (ctxA.resources.spine as any).setState({ generation: 1 });

    await stores.resourceState.deleteAll("session", "sess_1");
    await stores.session.delete("sess_1");
    expect(await stores.session.get("sess_1")).toBeUndefined();

    const ctxB = await makeCtx(stores, "req_b");
    await (ctxB.resources.spine as any).patchState({ generation: 2 });

    expect(await readStored(stores, "spine")).toEqual({ generation: 2 });
  });

  it("keeps refusing a straggler when the session id was NOT recreated", async () => {
    // The discriminator, stated as its own case so the control above cannot be
    // satisfied by simply readmitting every write. Same teardown, same fresh
    // context — but the session record is put back by hand at its OLD identity
    // rather than born again, so nothing here is a new incarnation and the
    // tombstone must still hold.
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    await (ctxA.resources.spine as any).setState({ generation: 1 });

    const record = await stores.session.get("sess_1");
    await stores.resourceState.deleteAll("session", "sess_1");
    await stores.session.set("sess_1", record!, "any");

    const ctxB = await makeCtx(stores, "req_b");
    await expect(
      (ctxB.resources.spine as any).setState({ revived: true })
    ).rejects.toBeInstanceOf(ResourceDeletedError);

    expect(await readStored(stores, "spine")).toBeUndefined();
  });

  it("still writes resources after a detached child is deleted and re-spawned", async () => {
    // The same brick at the other session-birth site, and the one where id
    // reuse is the norm rather than the exception: a child's key is DERIVED
    // from its seed, so the same seed always lands on the same key — which is
    // why adoption exists on that path at all.
    //
    // The assertion is at the store, on the expectation a static resource's
    // first mutation carries. The cases above already pin that a static ref's
    // `setState` sends `"absent"` through the real path; what is in question
    // here is only whether the re-spawn cleared what would refuse it.
    const stores = createInMemoryStores();
    const first = await spawnChild(stores);
    await stores.resourceState.set("session", first, "spine", { generation: 1 }, 0);

    // Teardown, as the delete route performs it.
    await stores.resourceState.deleteAll("session", first);
    await stores.session.delete(first);

    const second = await spawnChild(stores);
    expect(second).toBe(first); // same seed, same derived key — the whole point

    const write = await stores.resourceState.set(
      "session",
      second,
      "spine",
      { generation: 2 },
      "absent"
    );
    expect(write.ok).toBe(true);
  });

  it("leaves a live child's resources alone when the key is merely adopted", async () => {
    // The control for the case above. A spawn that ADOPTS an existing child
    // must reclaim nothing — it is the same incarnation continuing, and a
    // reclamation there would be operating on a session already running.
    const stores = createInMemoryStores();
    const child = await spawnChild(stores);
    await stores.resourceState.set("session", child, "spine", { generation: 1 }, 0);
    await stores.resourceState.delete("session", child, "spine", 1);

    // Re-spawn with the record still in place, so this adopts rather than creates.
    expect(await spawnChild(stores)).toBe(child);

    const revival = await stores.resourceState.set(
      "session",
      child,
      "spine",
      { revived: true },
      "absent"
    );
    expect(revival.ok).toBe(false);
  });

  it("creates no session record when the tombstone reclamation fails", async () => {
    // The ordering, pinned as behaviour rather than left to a comment. There is
    // no transaction across the session and resource-state stores, so whichever
    // commits first can be left standing when the second fails. Creating first
    // would strand a live session on the dead one's tombstones with nothing to
    // retry the cleanup — a second create answers 409, and an action-driven
    // create adopts the record instead — which is this very bug made permanent.
    //
    // Reclaiming first makes the failure recoverable: nothing is committed, so
    // the caller's retry starts from a clean slate.
    const stores = createInMemoryStores();
    const boom = new Error("resource store unavailable");
    const failing: StoreRegistry = {
      ...stores,
      resourceState: {
        ...stores.resourceState,
        purgeTombstones: async () => {
          throw boom;
        }
      }
    };

    await expect(
      ensureSessionRecord(failing, "sess_ordering", () => ({
        id: "sess_ordering",
        flowKind: "fix1258-revival",
        userId: "user_1",
        state: {},
        version: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        journal: []
      }))
    ).rejects.toBe(boom);

    // The record must not stand. If it did, the session would be permanently
    // unwritable and no later call would reach the reclamation again.
    expect(await stores.session.get("sess_ordering")).toBeUndefined();
  });

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
