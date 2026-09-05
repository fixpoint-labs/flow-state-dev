/**
 * FIX-1068: a session-scoped resource marked `sharedToLineage` has ONE
 * identity across a session lineage, so a session and the child sessions it dispatches
 * reach the same resource through the ordinary resource API.
 *
 * What each test here is defending:
 *
 * - **Sharing works in both directions** because there is no direction: the
 *   parent and the child resolve the same address, so "the child reads what the
 *   parent wrote" and "the parent reads what the child wrote" are one fact.
 * - **An unshared session resource stays private.** This is the regression that
 *   would break every existing app silently — every session-scoped resource in
 *   the world is unshared, and if the new resolution leaked them to a lineage
 *   root, two sessions in one chain would start overwriting each other.
 * - **Session STATE never crosses**, shared resources or not. Isolation of state
 *   is what makes a child session a child session.
 * - **The root, not the parent.** A grandchild shares with the top of the chain,
 *   not with its immediate parent, so a three-deep lineage holds one resource
 *   rather than two.
 * - **A record with no stamped root is its own root** (BP-030), which is exactly
 *   the pre-FIX-1068 behaviour for every session persisted before the field.
 */
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createExecutionContext,
  createFlowRegistry,
  createInMemoryStores,
  toBareStates
} from "../src";
import { getPersistedData } from "../src/resources/internal";
import {
  handleCreateCollectionItem,
  handleListCollectionState
} from "../src/routes/resource-routes";
import type { SessionRecord, StoreRegistry } from "../src/stores/types";

/**
 * The lineage a seeded session belongs to. A literal now — the address IS the
 * stored id, so there is nothing to compute and nothing that could disagree
 * with what the engine derives.
 */
function lineageAddr(rootId: string): string {
  return `lin_${rootId}`;
}

/** Shared across the lineage — the resource under test. */
const board = defineResource({
  scope: "session",
  sharedToLineage: true,
  ref: "board",
  stateSchema: z.object({ note: z.string().default("") })
});

/** Ordinary session-scoped resource: must stay private to each session. */
const scratch = defineResource({
  scope: "session",
  ref: "scratch",
  stateSchema: z.object({ note: z.string().default("") })
});

/**
 * Shared collection — instances have to follow the same address as singles.
 * Full client grants so the HTTP collection routes are reachable below.
 */
const tasks = defineResourceCollection({
  pattern: "tasks/*",
  scope: "session",
  sharedToLineage: true,
  stateSchema: z.object({ title: z.string().default("") }),
  client: {
    content: { read: true, create: true, update: true, delete: true },
    state: { read: true }
  } as never
});

const flow = defineFlow({
  kind: "lineage-flow",
  session: { stateSchema: z.object({ turn: z.number().default(0) }) },
  actions: {
    run: { inputSchema: z.string(), block: handler({ name: "noop", execute: () => "ok" }) }
  },
  resources: { board, scratch, tasks }
})();

/**
 * Seed a session record the way the dispatch seam mints a child. `root` is the
 * bare id of the lineage root; omit it for a top-level session, and omit it
 * *with* a parent to reproduce a child persisted before the field existed.
 */
async function seedSession(
  stores: StoreRegistry,
  id: string,
  parent?: string,
  lineage?: string
): Promise<void> {
  const ts = 1_700_000_000_000;
  const record: SessionRecord = {
    id,
    flowKind: flow.kind,
    userId: "u_1",
    state: { turn: 0 },
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    journal: [],
    ...(parent !== undefined ? { parentSessionId: parent } : {}),
    ...(lineage !== undefined ? { lineageId: lineage } : {})
  };
  await stores.session.set(id, record, "any");
}

/** A context for `sessionId`, with a fresh request id each time. */
let requestCounter = 0;
function contextFor(stores: StoreRegistry, sessionId: string) {
  requestCounter += 1;
  return createExecutionContext({
    flow,
    actionName: "run",
    requestId: `req_${requestCounter}`,
    sessionId,
    userId: "u_1",
    stores
  });
}

describe("FIX-1068: sharedToLineage resources across a session lineage", () => {
  it("resolves a shared resource to the same address in parent and child", async () => {
    const stores = createInMemoryStores();
    await seedSession(stores, "s_root", undefined, lineageAddr("s_root"));
    await seedSession(stores, "s_child", "s_root", lineageAddr("s_root"));

    const parent = await contextFor(stores, "s_root");
    await parent.resources.board.patchState({ note: "from parent" });

    // The child reads the parent's write through the ordinary resource API —
    // no cross-session verb, no direction.
    const child = await contextFor(stores, "s_child");
    expect(child.resources.board.state.note).toBe("from parent");

    // And the same address going the other way.
    await child.resources.board.patchState({ note: "from child" });
    const parentAgain = await contextFor(stores, "s_root");
    expect(parentAgain.resources.board.state.note).toBe("from child");

    // Physically one row, at the lineage's address — and at neither session's
    // own key, which is what keeps it out of reach of a recreated id.
    expect(
      toBareStates(await stores.resourceState.getAll("lineage", lineageAddr("s_root")))
    ).toHaveProperty("board");
    expect(
      toBareStates(await stores.resourceState.getAll("session", "s_root"))
    ).not.toHaveProperty("board");
    expect(
      toBareStates(await stores.resourceState.getAll("session", "s_child"))
    ).not.toHaveProperty("board");
  });

  it("keeps an unshared session resource private to each session", async () => {
    const stores = createInMemoryStores();
    await seedSession(stores, "s_root", undefined, lineageAddr("s_root"));
    await seedSession(stores, "s_child", "s_root", lineageAddr("s_root"));

    const parent = await contextFor(stores, "s_root");
    await parent.resources.scratch.patchState({ note: "parent only" });

    const child = await contextFor(stores, "s_child");
    expect(child.resources.scratch.state.note).toBe("");

    // The child's own write does not reach the parent either.
    await child.resources.scratch.patchState({ note: "child only" });
    const parentAgain = await contextFor(stores, "s_root");
    expect(parentAgain.resources.scratch.state.note).toBe("parent only");

    // Two rows, one per session — the shared resource's collapse is opt-in.
    expect(toBareStates(await stores.resourceState.getAll("session", "s_root"))).toHaveProperty(
      "scratch"
    );
    expect(toBareStates(await stores.resourceState.getAll("session", "s_child"))).toHaveProperty(
      "scratch"
    );
  });

  it("keeps session state isolated even when the lineage shares a resource", async () => {
    const stores = createInMemoryStores();
    await seedSession(stores, "s_root", undefined, lineageAddr("s_root"));
    await seedSession(stores, "s_child", "s_root", lineageAddr("s_root"));

    const parent = await contextFor(stores, "s_root");
    await parent.resources.board.patchState({ note: "shared" });
    await parent.session.setState({ turn: 7 });

    const child = await contextFor(stores, "s_child");
    // The resource crossed; the state did not.
    expect(child.resources.board.state.note).toBe("shared");
    expect(child.session.state.turn).toBe(0);

    await child.session.setState({ turn: 99 });
    const parentAgain = await contextFor(stores, "s_root");
    expect(parentAgain.session.state.turn).toBe(7);
  });

  it("resolves a nested child to the lineage root, not its immediate parent", async () => {
    const stores = createInMemoryStores();
    await seedSession(stores, "s_root", undefined, lineageAddr("s_root"));
    await seedSession(stores, "s_child", "s_root", lineageAddr("s_root"));
    // A child dispatched from inside a child inherits its parent's root.
    await seedSession(stores, "s_grandchild", "s_child", lineageAddr("s_root"));

    const grandchild = await contextFor(stores, "s_grandchild");
    await grandchild.resources.board.patchState({ note: "from depth 2" });

    const parent = await contextFor(stores, "s_root");
    expect(parent.resources.board.state.note).toBe("from depth 2");

    // One row for the lineage — not one per layer.
    expect(
      toBareStates(await stores.resourceState.getAll("lineage", lineageAddr("s_root")))
    ).toHaveProperty("board");
    for (const id of ["s_child", "s_grandchild"]) {
      expect(
        toBareStates(await stores.resourceState.getAll("lineage", lineageAddr(id)))
      ).not.toHaveProperty("board");
    }
  });

  it("shares collection instances across the lineage", async () => {
    const stores = createInMemoryStores();
    await seedSession(stores, "s_root", undefined, lineageAddr("s_root"));
    await seedSession(stores, "s_child", "s_root", lineageAddr("s_root"));

    const parent = await contextFor(stores, "s_root");
    await (
      parent.resources.tasks as unknown as {
        create(key: string, init: { title: string }): Promise<unknown>;
      }
    ).create("t1", { title: "review" });

    const child = await contextFor(stores, "s_child");
    const seen = await (
      child.resources.tasks as unknown as {
        list(): Promise<Array<{ state: { title: string } }>>;
      }
    ).list();
    expect(seen.map((t) => t.state.title)).toEqual(["review"]);

    const atLineage = toBareStates(
      await stores.resourceState.getByPrefix("lineage", lineageAddr("s_root"), "tasks/")
    );
    expect(Object.keys(atLineage)).toContain("tasks/t1");
  });

  it("treats a child persisted before the root field existed as its own root", async () => {
    // BP-030: absent `lineageRootSessionId` means "I am the root". A legacy
    // child therefore keeps the isolation it has always had rather than
    // silently adopting its parent's rows.
    const stores = createInMemoryStores();
    await seedSession(stores, "s_root", undefined, lineageAddr("s_root"));
    await seedSession(stores, "s_legacy", "s_root");

    const parent = await contextFor(stores, "s_root");
    await parent.resources.board.patchState({ note: "parent" });

    const legacy = await contextFor(stores, "s_legacy");
    expect(legacy.resources.board.state.note).toBe("");

    await legacy.resources.board.patchState({ note: "legacy" });
    // Its own lineage, not its parent's — two rows at two addresses, and the
    // parent's is untouched by the child's write.
    expect(
      toBareStates(await stores.resourceState.getAll("lineage", "lin_s_legacy")).board
    ).toEqual({ note: "legacy" });
    expect(
      toBareStates(await stores.resourceState.getAll("lineage", lineageAddr("s_root"))).board
    ).toEqual({ note: "parent" });
  });

  it("keeps a shared resource out of the session's own key even at the root", async () => {
    // The lineage address is its own namespace, deliberately: a session key is
    // reachable by anyone who recreates that id, so a shared resource must not
    // live at one even when the session IS the root. An UNSHARED resource is
    // untouched by that and still keys exactly where it always did — which is
    // what makes this change free for every flow already in production.
    const stores = createInMemoryStores();
    await seedSession(stores, "s_solo", undefined, lineageAddr("s_solo"));

    const ctx = await contextFor(stores, "s_solo");
    await ctx.resources.board.patchState({ note: "solo" });
    await ctx.resources.scratch.patchState({ note: "private" });

    const atSessionKey = toBareStates(await stores.resourceState.getAll("session", "s_solo"));
    expect(atSessionKey).not.toHaveProperty("board");
    expect(atSessionKey).toHaveProperty("scratch");

    expect(
      toBareStates(await stores.resourceState.getAll("lineage", lineageAddr("s_solo")))
    ).toHaveProperty("board");
  });

  it("reads a child's session scope over HTTP the way execution resolves it", async () => {
    // The state and resource routes read the session scope directly, so they
    // have to apply the same addressing. A child reading its own scope must see
    // the shared resource AND must not pick up the root's private one.
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(flow);
    await seedSession(stores, "s_root", undefined, lineageAddr("s_root"));
    await seedSession(stores, "s_child", "s_root", lineageAddr("s_root"));

    const parent = await contextFor(stores, "s_root");
    await parent.resources.board.patchState({ note: "shared" });
    await parent.resources.scratch.patchState({ note: "root private" });

    const child = await contextFor(stores, "s_child");
    await child.resources.scratch.patchState({ note: "child private" });

    const asChild = await getPersistedData({ registry, stores }, flow, "s_child", "session");
    expect(asChild?.resources.board).toEqual({ note: "shared" });
    expect(asChild?.resources.scratch).toEqual({ note: "child private" });

    const asRoot = await getPersistedData({ registry, stores }, flow, "s_root", "session");
    expect(asRoot?.resources.board).toEqual({ note: "shared" });
    expect(asRoot?.resources.scratch).toEqual({ note: "root private" });
  });

  it("writes and lists a shared collection over HTTP at the lineage root", async () => {
    // The collection routes hold the config and address storage themselves.
    // A create issued against the CHILD has to land where the root reads it,
    // and state and content have to land at the same address as each other.
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(flow);
    await seedSession(stores, "s_root", undefined, lineageAddr("s_root"));
    await seedSession(stores, "s_child", "s_root", lineageAddr("s_root"));
    const routeCtx = { registry, stores };

    const created = await handleCreateCollectionItem(
      new Request("http://x/sessions/s_child/resources/tasks", {
        method: "POST",
        body: JSON.stringify({ topic: "t1", content: "the body" })
      }),
      { kind: "create_collection_item", sessionId: "s_child", ref: "tasks" },
      routeCtx
    );
    expect(created.status).toBe(201);

    // Both halves of the instance landed at the lineage address, together.
    const addr = lineageAddr("s_root");
    expect(await stores.resourceState.get("lineage", addr, "tasks/t1")).toBeDefined();
    expect(await stores.content.get("lineage", addr, "tasks/t1")).toBe("the body");
    expect(await stores.resourceState.get("session", "s_child", "tasks/t1")).toBeUndefined();

    // And listing from either session returns it.
    for (const sessionId of ["s_child", "s_root"]) {
      const listed = await handleListCollectionState(
        new Request(`http://x/sessions/${sessionId}/resources/tasks/state`),
        { kind: "list_collection_state", sessionId, ref: "tasks" },
        routeCtx
      );
      const body = (await listed.json()) as { items: Array<{ storageKey: string }> };
      expect(body.items.map((i) => i.storageKey)).toEqual(["tasks/t1"]);
    }
  });

  it("rejects same-prefix session collections with conflicting sharedToLineage", async () => {
    // Collections sharing a storage prefix share one storage slot, so they
    // cannot resolve to two different sessions. Same rule as flowIsolation.
    const sharedNotes = defineResourceCollection({
      pattern: "[t]/notes",
      scope: "session",
      sharedToLineage: true,
      stateSchema: z.object({ n: z.number().default(0) })
    });
    const privateEvents = defineResourceCollection({
      pattern: "[t]/events",
      scope: "session",
      stateSchema: z.object({ n: z.number().default(0) })
    });
    const conflicting = defineFlow({
      kind: "lineage-conflict",
      actions: {
        run: { inputSchema: z.string(), block: handler({ name: "noop", execute: () => "ok" }) }
      },
      resources: { sharedNotes, privateEvents }
    })();

    await expect(
      createExecutionContext({
        flow: conflicting,
        actionName: "run",
        requestId: "req_conflict",
        sessionId: "s_conflict",
        userId: "u_1",
        stores: createInMemoryStores()
      })
    ).rejects.toThrow(/conflicting sharedToLineage/);
  });
});
