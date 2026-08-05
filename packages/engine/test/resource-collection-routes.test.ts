/**
 * Route-level tests for the two collection-item write routes (FIX-992 D12).
 *
 * Both routes follow one rule: **win the state key first, then touch content.**
 * The create route inserts at `expectedVersion: 0` and writes content only
 * after that commits; the delete route reads the version, deletes state
 * conditionally on it, and deletes content only after that commits. A loser
 * therefore never touches `ContentStore` on either route.
 *
 * Every assertion here is on the **persisted artifact**, not the status code.
 * That is deliberate: the rejected designs returned exactly the same 201/409
 * and 200/409 as the accepted one while storing the wrong thing, so a
 * status-code test passes against the bug it exists to catch. The delete
 * route's ordering assertion is the sharpest case — a version-checked state
 * delete left inside the original `Promise.all` produces identical status
 * codes and still clobbers content.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { createInMemoryStores, createFlowRegistry } from "../src";
import type { StoreRegistry, SessionRecord } from "../src/stores/types";
import type { FlowRegistry } from "../src/registry/flow-registry";
import {
  handleCreateCollectionItem,
  handleDeleteCollectionItem,
  handleUpdateResourceContent,
  handleListCollectionState,
} from "../src/routes/resource-routes";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const noteSchema = z.object({ title: z.string().default("") });

/** Full CRUD grants — the collection shape most flows declare. */
const FULL_GRANTS = {
  content: { read: true, create: true, update: true, delete: true },
  state: { read: true },
} as const;

/**
 * The create-only shape D12 names: `content.create` without `update` or
 * `delete`, so an item whose content write failed has no repair route.
 */
const CREATE_ONLY_GRANTS = {
  content: { read: true, create: true },
  state: { read: true },
} as const;

type Ctx = {
  registry: FlowRegistry;
  stores: StoreRegistry;
  sessionId: string;
};

async function setupCtx(client: Record<string, unknown> = FULL_GRANTS): Promise<Ctx> {
  const notes = defineResourceCollection({
    scope: "session",
    pattern: "notes/*",
    stateSchema: noteSchema,
    client: client as never,
  });
  const block = handler({ name: "noop", resources: { notes }, execute: () => "ok" });
  const flow = defineFlow({
    kind: "notes-flow",
    actions: { run: { inputSchema: z.string(), block } },
  })();

  const registry = createFlowRegistry();
  registry.register(flow);

  const stores = createInMemoryStores();
  const sessionId = "sess_1";
  const session: SessionRecord = {
    id: sessionId,
    flowKind: "notes-flow",
    userId: "user_1",
    state: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    journal: [],
  };
  await stores.session.set(sessionId, session, "any");
  return { registry, stores, sessionId };
}

function create(ctx: Ctx, topic: string, content?: string): Promise<Response> {
  return handleCreateCollectionItem(
    new Request("http://x/sessions/sess_1/resources/notes", {
      method: "POST",
      body: JSON.stringify(content === undefined ? { topic } : { topic, content }),
    }),
    { kind: "create_collection_item", sessionId: ctx.sessionId, ref: "notes" },
    { registry: ctx.registry, stores: ctx.stores }
  );
}

function del(ctx: Ctx, topic: string): Promise<Response> {
  return handleDeleteCollectionItem(
    new Request(`http://x/sessions/sess_1/resources/notes/${topic}`, { method: "DELETE" }),
    { kind: "delete_collection_item", sessionId: ctx.sessionId, ref: "notes", topic },
    { registry: ctx.registry, stores: ctx.stores }
  );
}

function patchContent(ctx: Ctx, topic: string, content: string): Promise<Response> {
  return handleUpdateResourceContent(
    new Request(`http://x/sessions/sess_1/resources/notes/${topic}/content`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),
    { kind: "update_resource_content", sessionId: ctx.sessionId, ref: "notes", topic },
    { registry: ctx.registry, stores: ctx.stores }
  );
}

function list(ctx: Ctx): Promise<Response> {
  return handleListCollectionState(
    new Request("http://x/sessions/sess_1/resources/notes/state"),
    { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "notes" },
    { registry: ctx.registry, stores: ctx.stores }
  );
}

const KEY = "notes/a";

/** Read what is actually stored — what every assertion below is about. */
function storedContent(ctx: Ctx): Promise<string | undefined> {
  return ctx.stores.content.get("session", ctx.sessionId, KEY);
}

function storedState(ctx: Ctx) {
  return ctx.stores.resourceState.get("session", ctx.sessionId, KEY);
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * Hold a route open between its resource-state read and whatever it does next,
 * so a test can move the key underneath it.
 *
 * `whenRead` deliberately races a timeout rather than waiting outright: a route
 * that never reads (the un-fixed delete route does not) must fail its
 * assertions, not hang the suite on a gate nothing will ever reach.
 */
function gateNextStateRead(ctx: Ctx) {
  let release!: () => void;
  const released = new Promise<void>((r) => {
    release = r;
  });
  let markRead!: () => void;
  const read = new Promise<void>((r) => {
    markRead = r;
  });

  let armed = true;
  const real = ctx.stores.resourceState.get.bind(ctx.stores.resourceState);
  vi.spyOn(ctx.stores.resourceState, "get").mockImplementation(async (...args) => {
    const value = await real(...args);
    if (!armed) return value;
    armed = false;
    markRead();
    await released;
    return value;
  });

  return {
    /** Resolves once the route has read, or after a turn if it never does. */
    whenRead: async () => {
      await Promise.race([read, tick().then(tick)]);
      armed = false;
    },
    release,
  };
}

// ---------------------------------------------------------------------------
// Create route — D12: win the key, then write content
// ---------------------------------------------------------------------------

describe("create collection item route — the winner owns the content", () => {
  it("two concurrent creates: one 201, one 409, and the loser wrote no content at all", async () => {
    const ctx = await setupCtx();
    const contentSet = vi.spyOn(ctx.stores.content, "set");

    const [first, second] = await Promise.all([
      create(ctx, "a", "from-first"),
      create(ctx, "a", "from-second"),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);

    // The assertion that matters: the persisted content belongs to the racer
    // that won the key, and the loser never reached `ContentStore`. A design
    // that writes content before winning returns these same two status codes
    // and stores the loser's body.
    const winnerContent = first.status === 201 ? "from-first" : "from-second";
    expect(await storedContent(ctx)).toBe(winnerContent);
    expect(contentSet).toHaveBeenCalledTimes(1);
  });

  it("a losing create leaves the winner's row untouched and writes no content", async () => {
    const ctx = await setupCtx();
    expect((await create(ctx, "a", "first")).status).toBe(201);
    const afterWin = await storedState(ctx);

    const contentSet = vi.spyOn(ctx.stores.content, "set");
    expect((await create(ctx, "a", "second")).status).toBe(409);

    expect((await storedState(ctx))?.version).toBe(afterWin?.version);
    expect(contentSet).not.toHaveBeenCalled();
    expect(await storedContent(ctx)).toBe("first");
  });

  it("a content write that fails after the state insert leaves a visible, repairable item", async () => {
    const ctx = await setupCtx();
    vi.spyOn(ctx.stores.content, "set").mockRejectedValueOnce(new Error("content store down"));

    await expect(create(ctx, "a", "never-lands")).rejects.toThrow("content store down");

    // The state row committed, so the item exists — with empty content. This
    // is D12's accepted residual, pinned by a test rather than carried as prose.
    expect(await storedState(ctx)).toBeDefined();
    expect(await storedContent(ctx)).toBeUndefined();

    // The retry's 409 is honest: the item really does exist.
    expect((await create(ctx, "a", "retry")).status).toBe(409);

    // On a collection granting `content.update`, PATCH repairs it.
    expect((await patchContent(ctx, "a", "repaired")).status).toBe(200);
    expect(await storedContent(ctx)).toBe("repaired");
  });

  it("on a create-only collection the half-written item cannot be repaired, but stays visible", async () => {
    const ctx = await setupCtx(CREATE_ONLY_GRANTS);
    vi.spyOn(ctx.stores.content, "set").mockRejectedValueOnce(new Error("content store down"));

    await expect(create(ctx, "a", "never-lands")).rejects.toThrow("content store down");

    // No repair route: PATCH and DELETE are both ungranted on this collection.
    expect((await patchContent(ctx, "a", "repaired")).status).toBe(403);
    expect((await del(ctx, "a")).status).toBe(403);

    // Never silently lost — the item is reachable in the listing, so the gap a
    // create-only grant leaves is visible rather than invisible.
    const body = (await (await list(ctx)).json()) as { items: Array<{ topic: string }> };
    expect(body.items.map((i) => i.topic)).toContain("a");
  });
});

// ---------------------------------------------------------------------------
// Delete route — D12 mirrored: conflict before ContentStore is touched
// ---------------------------------------------------------------------------

describe("delete collection item route — conflict before ContentStore is touched", () => {
  it("a stale DELETE against a recreated item 409s and never calls ContentStore", async () => {
    const ctx = await setupCtx();
    expect((await create(ctx, "a", "first-generation")).status).toBe(201);

    const contentDelete = vi.spyOn(ctx.stores.content, "delete");

    // Hold the route between its version read and its state delete, then let
    // the item be deleted and recreated underneath it. What the route holds is
    // now a pre-delete version.
    const gate = gateNextStateRead(ctx);
    const inFlight = del(ctx, "a");
    await gate.whenRead();

    await ctx.stores.resourceState.delete("session", ctx.sessionId, KEY, "any");
    await ctx.stores.content.delete("session", ctx.sessionId, KEY);
    contentDelete.mockClear();
    expect((await create(ctx, "a", "second-generation")).status).toBe(201);

    gate.release();
    expect((await inFlight).status).toBe(409);

    // The assertion that matters. A version-checked state delete left inside
    // the `Promise.all` returns this same 409 and still deletes the content —
    // which is exactly the bug.
    expect(contentDelete).not.toHaveBeenCalled();
    expect(await storedContent(ctx)).toBe("second-generation");
    expect(await storedState(ctx)).toBeDefined();
  });

  it("a DELETE observing absence 409s rather than tombstoning an item created since", async () => {
    const ctx = await setupCtx();
    const contentDelete = vi.spyOn(ctx.stores.content, "delete");

    // The route reads "no live row"; a create lands before it can act on that.
    // `expectedVersion: 0` is what makes the difference visible — `"any"` would
    // tombstone the new generation and delete its content.
    const gate = gateNextStateRead(ctx);
    const inFlight = del(ctx, "a");
    await gate.whenRead();

    expect((await create(ctx, "a", "created-since")).status).toBe(201);
    contentDelete.mockClear();

    gate.release();
    expect((await inFlight).status).toBe(409);
    expect(contentDelete).not.toHaveBeenCalled();
    expect(await storedState(ctx)).toBeDefined();
    expect(await storedContent(ctx)).toBe("created-since");
  });

  it("a DELETE holding the current version removes state first, and content only after", async () => {
    const ctx = await setupCtx();
    expect((await create(ctx, "a", "doomed")).status).toBe(201);

    // Start/end markers, not invocation order: `Promise.all` invokes both
    // functions in array order too, so only completion sequencing separates a
    // sequence from a race.
    const order: string[] = [];
    const realStateDelete = ctx.stores.resourceState.delete.bind(ctx.stores.resourceState);
    vi.spyOn(ctx.stores.resourceState, "delete").mockImplementation(async (...args) => {
      order.push("state:start");
      await tick();
      const result = await realStateDelete(...args);
      order.push("state:end");
      return result;
    });
    const realContentDelete = ctx.stores.content.delete.bind(ctx.stores.content);
    vi.spyOn(ctx.stores.content, "delete").mockImplementation(async (...args) => {
      order.push("content:start");
      return await realContentDelete(...args);
    });

    expect((await del(ctx, "a")).status).toBe(200);
    expect(order).toEqual(["state:start", "state:end", "content:start"]);
    expect(await storedState(ctx)).toBeUndefined();
    expect(await storedContent(ctx)).toBeUndefined();
  });

  /**
   * What this pins, stated because it is not what the tests above pin: that
   * adding a conflict path did not cost DELETE its idempotent 200. It cannot
   * fail by weakening any guard — the store answers an absent key before it
   * ever consults `expectedVersion`, so no route-side version change reaches
   * it. It fails if a not-found branch is introduced, which is the regression
   * it exists for.
   */
  it("a DELETE of an item that never existed still succeeds", async () => {
    const ctx = await setupCtx();
    expect((await del(ctx, "ghost")).status).toBe(200);
  });
});
