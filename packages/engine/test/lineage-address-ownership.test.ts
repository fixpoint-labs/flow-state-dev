/**
 * FIX-1068: a lineage address must not be reachable by another owner.
 *
 * A shared resource is addressed by the lineage ROOT, and the child carries only
 * the root's bare session id. Session ids are caller-chosen, and a session can
 * be deleted — so the id a surviving child points at can be created again, by
 * someone else. Nothing reloads the root record on the read path (deliberately:
 * that is what makes the lookup O(1)), so whatever now sits at that address is
 * what the child reads and writes.
 *
 * The collision is not between two shared addresses. It is between a child's
 * shared address and an ORDINARY session-scoped resource belonging to whoever
 * holds the recreated id, because both resolved to the same bare session key.
 * Matching refs then read, and write, the new owner's rows.
 *
 * The fix is structural rather than a check: the lineage address carries the
 * authoritative owner (tenant + user) alongside the root id, and lives in its
 * own key namespace. A reused id under a different owner therefore names a
 * different address — the collision stops being expressible instead of being
 * caught.
 *
 * The sequence below is the real one: sessions created and deleted through the
 * public routes, and the child stamped by the actual detached-spawn writer. No
 * root id is hand-forged, because a hand-forged one would prove only that the
 * address is derived from what it says it is derived from.
 */
import { defineFlow, defineResource, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createExecutionContext, createFlowRegistry, createInMemoryStores } from "../src";
import { createRequestHost } from "../src/context/create-request-host";
import { handleCreateSession, handleDeleteSession } from "../src/routes/session-routes";
import type { StoreRegistry } from "../src/stores/types";

/** One session-scoped resource, shared down the lineage. */
const notes = defineResource({
  scope: "session",
  sharedToWorkstream: true,
  ref: "notes",
  stateSchema: z.object({ body: z.string().default("") })
});

/**
 * A private session-scoped resource under the SAME ref is not expressible — the
 * flow builder refuses two session declarations on one ref. So the collision
 * this test reproduces is the realistic one: the recreated session is the same
 * flow, and its own ordinary copy of `notes` sits at the bare session key that
 * the surviving child's shared address also resolves to.
 */
const flow = defineFlow({
  kind: "lineage-owner-flow",
  actions: { run: { inputSchema: z.string(), block: handler({ name: "noop", execute: () => "ok" }) } },
  resources: { notes }
})();

/** The flow, plus the workstream core `startDetached` admits against. */
const spawnableFlow = {
  ...flow,
  workstream: { block: { name: "noop" } }
} as unknown as FlowInstance;

const ROOT_ID = "sess_shared_root";

function contextFor(stores: StoreRegistry, sessionId: string, userId: string, requestId: string) {
  return createExecutionContext({
    flow,
    actionName: "run",
    requestId,
    sessionId,
    userId,
    stores
  });
}

/** Create a session through the public route — a caller-chosen id, as in production. */
async function createSession(
  stores: StoreRegistry,
  registry: ReturnType<typeof createFlowRegistry>,
  sessionId: string,
  userId: string
): Promise<void> {
  const res = await handleCreateSession(
    new Request("http://x/sessions", {
      method: "POST",
      body: JSON.stringify({ sessionId, userId })
    }),
    { kind: "create_session", flowKind: flow.kind },
    { registry, stores }
  );
  expect(res.status).toBe(201);
}

describe("FIX-1068: a recreated root id under a different owner is a different address", () => {
  it("does not let a surviving child read or write the new owner's session resources", async () => {
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(flow);

    // 1. User A opens a conversation and puts something in the shared resource.
    await createSession(stores, registry, ROOT_ID, "u_alice");
    const parent = await contextFor(stores, ROOT_ID, "u_alice", "req_1");
    await parent.resources.notes.patchState({ body: "alice's private notes" });

    // 2. It spawns background work. The child is stamped by the real writer, so
    //    its lineage root is genuinely this session's id.
    const { host } = createRequestHost({
      stores,
      flow: spawnableFlow,
      identity: {
        userId: "u_alice",
        tenantId: undefined,
        orgId: undefined,
        sessionId: ROOT_ID,
        lineageRootSessionId: undefined
      },
      startOperation: async () => ({ requestId: "req_child" }),
      liveness: {}
    });
    const spawned = await host.startDetached({ seed: { topic: "research" }, input: {} });
    if (!spawned.ok) throw new Error(`spawn refused: ${spawned.refused}`);
    const childId = spawned.sessionId;

    // 3. Alice's conversation is deleted. The child outlives it — which is the
    //    whole point of a workstream — and still points at the deleted id.
    const deleted = await handleDeleteSession(
      new Request(`http://x/sessions/${ROOT_ID}`, { method: "DELETE" }),
      { kind: "delete_session", flowKind: flow.kind, sessionId: ROOT_ID },
      { registry, stores }
    );
    expect(deleted.status).toBe(204);

    // 4. Someone else creates a session and picks the same id — ids are the
    //    caller's to choose, and this one is now free.
    await createSession(stores, registry, ROOT_ID, "u_mallory");
    const mallory = await contextFor(stores, ROOT_ID, "u_mallory", "req_2");
    await mallory.resources.notes.patchState({ body: "mallory's private notes" });

    // 5. Alice's surviving child resolves its shared resource.
    const child = await contextFor(stores, childId, "u_alice", "req_3");

    // It must not be able to READ Mallory's row...
    expect(child.resources.notes.state.body).not.toBe("mallory's private notes");

    // ...and it must not be able to WRITE over it either. The write below is the
    // more serious half: a read leaks, a write corrupts.
    await child.resources.notes.patchState({ body: "written by alice's workstream" });
    const malloryAgain = await contextFor(stores, ROOT_ID, "u_mallory", "req_4");
    expect(malloryAgain.resources.notes.state.body).toBe("mallory's private notes");
  });

  it("keeps one owner's lineage working across the whole chain", async () => {
    // The address change must not cost the feature: a parent and its child still
    // resolve the same resource, which is the thing the owner asked for.
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(flow);

    await createSession(stores, registry, ROOT_ID, "u_alice");
    const parent = await contextFor(stores, ROOT_ID, "u_alice", "req_1");
    await parent.resources.notes.patchState({ body: "from the conversation" });

    const { host } = createRequestHost({
      stores,
      flow: spawnableFlow,
      identity: {
        userId: "u_alice",
        tenantId: undefined,
        orgId: undefined,
        sessionId: ROOT_ID,
        lineageRootSessionId: undefined,
        lineageRootGeneration: (await stores.session.get(ROOT_ID))?.lineageGeneration
      },
      startOperation: async () => ({ requestId: "req_child" }),
      liveness: {}
    });
    const spawned = await host.startDetached({ seed: { topic: "research" }, input: {} });
    if (!spawned.ok) throw new Error(`spawn refused: ${spawned.refused}`);

    const child = await contextFor(stores, spawned.sessionId, "u_alice", "req_3");
    expect(child.resources.notes.state.body).toBe("from the conversation");

    await child.resources.notes.patchState({ body: "from the workstream" });
    const parentAgain = await contextFor(stores, ROOT_ID, "u_alice", "req_4");
    expect(parentAgain.resources.notes.state.body).toBe("from the workstream");
  });
});


/**
 * FIX-1068: two incarnations of one session id are two lineages.
 *
 * Deleting a session frees its id, and the same account can create it again. The
 * address is derived from the root's id, so without something separating
 * incarnations the new conversation lands on the deleted one's bucket. Same
 * owner, so nothing leaks across accounts — but the OLD lineage's descendants
 * are still alive and still writing there, and two live lineages sharing one
 * bucket corrupt each other rather than merely surprising someone.
 *
 * The incarnation nonce is minted per record and inherited by descendants, so
 * the surviving child keeps addressing the lineage it was spawned into.
 */
describe("FIX-1068: a recreated session id is a new lineage", () => {
  it("keeps a surviving descendant off the recreated session's bucket", async () => {
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(flow);

    await createSession(stores, registry, ROOT_ID, "u_alice");
    const first = await contextFor(stores, ROOT_ID, "u_alice", "req_1");
    await first.resources.notes.patchState({ body: "first conversation" });

    const { host } = createRequestHost({
      stores,
      flow: spawnableFlow,
      identity: {
        userId: "u_alice",
        tenantId: undefined,
        orgId: undefined,
        sessionId: ROOT_ID,
        lineageRootSessionId: undefined,
        lineageRootGeneration: (await stores.session.get(ROOT_ID))?.lineageGeneration
      },
      startOperation: async () => ({ requestId: "req_child" }),
      liveness: {}
    });
    const spawned = await host.startDetached({ seed: { topic: "research" }, input: {} });
    if (!spawned.ok) throw new Error(`spawn refused: ${spawned.refused}`);
    const childId = spawned.sessionId;

    // The conversation is deleted; its background work keeps running.
    const deleted = await handleDeleteSession(
      new Request(`http://x/sessions/${ROOT_ID}`, { method: "DELETE" }),
      { kind: "delete_session", flowKind: flow.kind, sessionId: ROOT_ID },
      { registry, stores }
    );
    expect(deleted.status).toBe(204);

    // The same person starts a new conversation and reuses the id.
    await createSession(stores, registry, ROOT_ID, "u_alice");
    const second = await contextFor(stores, ROOT_ID, "u_alice", "req_2");

    // The new conversation must start empty — it is not a continuation of the
    // deleted one, and the old lineage's rows are not its to read.
    expect(second.resources.notes.state.body).toBe("");

    await second.resources.notes.patchState({ body: "second conversation" });

    // The surviving descendant writes into the lineage it belongs to, and that
    // write must not land on the new conversation's rows.
    const child = await contextFor(stores, childId, "u_alice", "req_3");
    await child.resources.notes.patchState({ body: "from the old lineage" });

    const secondAgain = await contextFor(stores, ROOT_ID, "u_alice", "req_4");
    expect(secondAgain.resources.notes.state.body).toBe("second conversation");
  });
});
