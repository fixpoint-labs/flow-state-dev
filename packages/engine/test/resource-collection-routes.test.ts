/**
 * Route-level tests for the two collection-item write routes: both win the
 * state key first, then touch content, so a loser never reaches `ContentStore`.
 * The contract itself is in `docs/architecture/resources-and-client-data.md`.
 *
 * Every assertion here is on the **persisted artifact**, not the status code,
 * and that is the point: the rejected designs answered exactly the same
 * 201/409 and 200/409 as the accepted one while storing the wrong thing, so a
 * status-code test passes against the bug it exists to catch.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { parseResourceTemplate } from "@flow-state-dev/core/resource-template";
import { createInMemoryStores, createFlowRegistry } from "../src";
import { gateNextStateRead } from "../src/testing";
import type { StoreRegistry, SessionRecord } from "../src/stores/types";
import type { FlowRegistry } from "../src/registry/flow-registry";
import {
  handleCreateCollectionItem,
  handleDeleteCollectionItem,
  handleUpdateResourceContent,
  handleListCollectionState,
  handleGetCollectionItemContent,
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

async function setupCtx(
  client: Record<string, unknown> = FULL_GRANTS,
  extra: Record<string, unknown> = {}
): Promise<Ctx> {
  const notes = defineResourceCollection({
    scope: "session",
    pattern: "notes/*",
    stateSchema: noteSchema,
    client: client as never,
    ...extra,
  } as never);
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

/**
 * Read an item's content back through the route, which is where the rendered
 * shape is decided — `storedContent` below reads the row underneath it, and the
 * two do not agree when there is no row.
 */
async function readContent(ctx: Ctx, topic: string): Promise<unknown> {
  const response = await handleGetCollectionItemContent(
    new Request(`http://x/sessions/sess_1/resources/notes/${topic}/content`),
    { kind: "get_collection_item_content", sessionId: ctx.sessionId, ref: "notes", topic },
    { registry: ctx.registry, stores: ctx.stores }
  );
  return ((await response.json()) as { content: unknown }).content;
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
 * Park the create route between its state insert and its content write, so a
 * test can act on an item that is live but whose content has not landed.
 *
 * That window is what the two residual tests below are about, and it is only
 * reachable from inside the request — the route answers 201 either way.
 */
function gateNextContentWrite(ctx: Ctx) {
  let release!: () => void;
  const released = new Promise<void>((r) => {
    release = r;
  });
  let markReached!: () => void;
  const reached = new Promise<void>((r) => {
    markReached = r;
  });

  const real = ctx.stores.content.set.bind(ctx.stores.content);
  vi.spyOn(ctx.stores.content, "set").mockImplementationOnce(async (...args) => {
    markReached();
    await released;
    return await real(...args);
  });

  return {
    /** Resolves once the route is parked, or after a turn if it never writes. */
    whenReached: () => Promise.race([reached, tick().then(tick)]),
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

  /**
   * A guard rather than a change detector for the sequential case: the pre-read
   * this change removes already turned a second create away, so this passes
   * before and after. What it pins is that the CAS insert kept that behaviour —
   * the loser bumps no version and writes no content. The concurrent case above
   * is the detector.
   */
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

    // The state row committed, so the item exists — with no content row at all.
    // D12's accepted residual, pinned by a test rather than carried as prose.
    expect(await storedState(ctx)).toBeDefined();
    expect(await storedContent(ctx)).toBeUndefined();

    // The shape an adapter or client author branches on, and the one the
    // architecture reference promises: **absent, not empty**. The line above
    // only says the row is missing; this says what the route makes of that. A
    // `renderContent` that coerced the missing row to `""` would satisfy the
    // line above and break every caller that distinguishes the two.
    expect(await readContent(ctx, "a")).toBeNull();

    // The retry's 409 is honest: the item really does exist.
    expect((await create(ctx, "a", "retry")).status).toBe(409);

    // On a collection granting `content.update`, PATCH repairs it.
    expect((await patchContent(ctx, "a", "repaired")).status).toBe(200);
    expect(await storedContent(ctx)).toBe("repaired");
  });

  /**
   * A template-backed collection splits the residual rather than escaping it,
   * which is the part that is easy to state too strongly in either direction.
   *
   * `renderContent` checks `contentTemplate` / `contentTemplateRef` before it
   * ever reads `rawContent`, so **readability** costs nothing — the item renders
   * from state whether or not a content row exists. But the create route writes
   * content whenever the caller sends any, with no template guard, so the
   * **partial commit** is exactly as real here: the request fails, the item is
   * live, and the retry 409s. This test asserts both halves so neither claim
   * can drift into the other.
   */
  it("a template-backed collection still reads fully, but its failed create still half-commits", async () => {
    const ctx = await setupCtx(FULL_GRANTS, {
      contentTemplate: parseResourceTemplate("# Rendered from state, not the content row"),
    });
    const contentSet = vi
      .spyOn(ctx.stores.content, "set")
      .mockRejectedValueOnce(new Error("content store down"));

    // The route does not skip the content write for a template-backed
    // collection: the rejection could not surface otherwise.
    await expect(create(ctx, "a", "never-lands")).rejects.toThrow("content store down");
    expect(contentSet).toHaveBeenCalledTimes(1);

    // Same starting point as the test above — no content row at all.
    expect(await storedContent(ctx)).toBeUndefined();

    // Readability half: nothing to repair, because nothing reads the row.
    expect(await readContent(ctx, "a")).toBe("# Rendered from state, not the content row");

    // Partial-commit half: the item exists all the same, so the failed create
    // was not a no-op here either.
    expect(await storedState(ctx)).toBeDefined();
    expect((await create(ctx, "a", "retry")).status).toBe(409);
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
// Create route — the window between "live" and "content final"
// ---------------------------------------------------------------------------

/**
 * Winning the key before writing content is what makes the two races above
 * come out right, and it has a price: the state row is live while the content
 * write is still in flight, so the item is briefly reachable with content that
 * is not yet its own.
 *
 * These two tests assert the **wrong** outcome on purpose. They are not guards
 * — they pin residuals D12 accepts, so the cost is falsifiable rather than
 * prose, and so closing it (cross-record atomicity, FIX-854) turns them red
 * instead of passing silently. Read a failure here as "the residual closed",
 * and delete the test.
 *
 * Neither is closable with a version. A create that won at version 1 and looks
 * back cannot tell its own row after a block wrote state (version 2) from a
 * successor generation created after a delete (also version 2) — the counter is
 * per key, not per generation. Abandoning the write on "version moved" would
 * silently drop the caller's content on the ordinary path. Telling those apart
 * needs an owner token, and a token still cannot fence a write to an unversioned
 * `ContentStore`.
 */
describe("create collection item route — residuals of the live-before-final window", () => {
  it("RESIDUAL: a DELETE in the window orphans the body, and a later create surfaces it", async () => {
    const ctx = await setupCtx();

    const gate = gateNextContentWrite(ctx);
    const inFlight = create(ctx, "a", "deleted-generation-body");
    await gate.whenReached();

    // The item is already live, so this DELETE is a normal, uncontended one:
    // it removes the state row and finds no content to remove.
    expect((await del(ctx, "a")).status).toBe(200);
    expect(await storedState(ctx)).toBeUndefined();

    // The parked write now lands behind the tombstone.
    gate.release();
    expect((await inFlight).status).toBe(201);
    expect(await storedContent(ctx)).toBe("deleted-generation-body");
    expect(await storedState(ctx)).toBeUndefined();

    // The sharp part: a later create carrying no content revives the row over
    // the orphan, so a deleted generation's body reads as the current one.
    expect((await create(ctx, "a")).status).toBe(201);
    expect(await storedState(ctx)).toBeDefined();
    expect(await storedContent(ctx)).toBe("deleted-generation-body");
  });

  it("RESIDUAL: a PATCH in the window is acknowledged 200 and then overwritten", async () => {
    const ctx = await setupCtx();

    const gate = gateNextContentWrite(ctx);
    const inFlight = create(ctx, "a", "create-body");
    await gate.whenReached();

    // The item is live, so PATCH is reachable and commits for real.
    expect((await patchContent(ctx, "a", "newer-committed-update")).status).toBe(200);
    expect(await storedContent(ctx)).toBe("newer-committed-update");

    // The parked create write then clobbers an update the client was told
    // succeeded. Ordering content before state instead loses the create's own
    // body to the same window, so this is a trade, not a regression to undo.
    gate.release();
    expect((await inFlight).status).toBe(201);
    expect(await storedContent(ctx)).toBe("create-body");
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
    const gate = gateNextStateRead(ctx.stores.resourceState);
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
    const gate = gateNextStateRead(ctx.stores.resourceState);
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
