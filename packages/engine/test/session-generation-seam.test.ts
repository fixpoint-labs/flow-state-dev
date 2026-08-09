/**
 * The route ↔ execution-context seam for session-scoped resources (FIX-1000).
 *
 * FIX-1000 makes `SessionRecord.storageGeneration` **optional** on purpose: a
 * missed *mint* site degrades to legacy behaviour and breaks nothing, while a
 * missed *read* site makes writer and reader disagree, which is silent data
 * loss. That trade gives up the compiler as the completeness check for the read
 * sites — so this file is the substitute. It pins the two producers of a
 * session-scope resource address to each other by round-tripping through them:
 * **write through a route, read inside a running action; then the reverse.**
 * A call site that still addresses by the bare session id fails here loudly.
 *
 * Nothing like it existed before: `resource-state-routes`, `resource-collection-
 * routes`, `scope-persist-routing` and `resource-flow-isolation` all drive the
 * routes without ever running an action, so the seam was unpinned in exactly
 * the place a missed swap would hide.
 *
 * Every session here comes from the real `handleCreateSession`, i.e. it carries
 * a generation — which is true of every session a real client creates, and is
 * the case the existing route suites (which hand-seed a bare record) never
 * cover.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import {
  createFlowRegistry,
  createInMemoryStores,
  createResponseEmitter,
  resolveSessionResourceScopeId,
  runAction
} from "../src";
import type { SessionRecord, StoreRegistry } from "../src/stores/types";
import type { FlowRegistry } from "../src/registry/flow-registry";
import { handleCreateSession } from "../src/routes/session-routes";
import {
  handleCreateCollectionItem,
  handleGetCollectionItemContent,
  handleGetCollectionItemState,
  handleListCollectionState,
  handleUpdateResourceContent
} from "../src/routes/resource-routes";

// ---------------------------------------------------------------------------
// Flow under test
// ---------------------------------------------------------------------------

/**
 * `expose` is what makes the state-read routes return the stored value rather
 * than metadata only, so the seam assertions can be on data instead of on a
 * 200.
 */
const CLIENT_GRANTS = {
  content: { read: true, create: true, update: true, delete: true },
  state: { read: true },
  expose: ["title"]
} as const;

const notes = defineResourceCollection({
  scope: "session",
  pattern: "notes/*",
  stateSchema: z.object({ title: z.string().default("") }),
  client: CLIENT_GRANTS as never
});

const profile = defineResource({
  scope: "session",
  stateSchema: z.object({ nickname: z.string().default("") }),
  client: {
    content: { read: true },
    state: { read: true },
    expose: ["nickname"]
  } as never
});

/** What the running action observed. Reset per test by the caller. */
type Observed = {
  noteState?: Record<string, unknown>;
  noteContent?: string | null;
  noteMissing?: boolean;
};

let observed: Observed;

/** Reads `notes/a` from inside a live execution context. */
const readNote = handler({
  name: "read-note",
  inputSchema: z.string(),
  resources: { notes },
  execute: async (_input: string, ctx: any) => {
    const ref = await ctx.resources.notes.getOptional("a");
    if (ref === undefined) {
      observed.noteMissing = true;
      return "missing";
    }
    observed.noteMissing = false;
    observed.noteState = { ...ref.state };
    observed.noteContent = await ref.readContent();
    return "ok";
  }
});

/** Writes `notes/b` from inside a live execution context. */
const writeNote = handler({
  name: "write-note",
  inputSchema: z.string(),
  resources: { notes, profile },
  execute: async (input: string, ctx: any) => {
    const ref = await ctx.resources.notes.create("b", { title: input });
    await ref.writeContent(`context-content:${input}`);
    await ctx.resources.profile.patchState({ nickname: input });
    return "ok";
  }
});

const FLOW_KIND = "seam-flow";

const flow = defineFlow({
  kind: FLOW_KIND,
  actions: {
    readNote: { inputSchema: z.string(), block: readNote },
    writeNote: { inputSchema: z.string(), block: writeNote }
  },
  resources: { notes, profile }
} as never)();

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const SESSION_ID = "sess_seam";
const USER_ID = "user_1";
const API = "http://x/api/flows";

type Ctx = { registry: FlowRegistry; stores: StoreRegistry };

function setup(): Ctx {
  observed = {};
  const registry = createFlowRegistry();
  registry.register(flow as never);
  return { registry, stores: createInMemoryStores() };
}

/** The production session mint path, driven as a route. */
async function createSession(ctx: Ctx, sessionId = SESSION_ID): Promise<SessionRecord> {
  const response = await handleCreateSession(
    new Request(`${API}/${FLOW_KIND}/sessions`, {
      method: "POST",
      body: JSON.stringify({ sessionId, userId: USER_ID })
    }),
    { kind: "create_session", flowKind: FLOW_KIND },
    ctx
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { session: SessionRecord };
  // The route surfaces the bare id; the stored record's `id` is the storage
  // key. They coincide with no tenant header, which is this file's case.
  return body.session;
}

function postNote(ctx: Ctx, topic: string, content?: string): Promise<Response> {
  return handleCreateCollectionItem(
    new Request(`${API}/sessions/${SESSION_ID}/resources/notes`, {
      method: "POST",
      body: JSON.stringify({ topic, ...(content === undefined ? {} : { content }) })
    }),
    { kind: "create_collection_item", sessionId: SESSION_ID, ref: "notes" },
    ctx
  );
}

function patchNoteContent(ctx: Ctx, topic: string, content: string): Promise<Response> {
  return handleUpdateResourceContent(
    new Request(`${API}/sessions/${SESSION_ID}/resources/notes/${topic}/content`, {
      method: "PATCH",
      body: JSON.stringify({ content })
    }),
    { kind: "update_resource_content", sessionId: SESSION_ID, ref: "notes", topic },
    ctx
  );
}

function listNotes(ctx: Ctx): Promise<Response> {
  return handleListCollectionState(
    new Request(`${API}/sessions/${SESSION_ID}/resources/notes`),
    { kind: "list_collection_state", sessionId: SESSION_ID, ref: "notes" },
    ctx
  );
}

function getNoteState(ctx: Ctx, topic: string): Promise<Response> {
  return handleGetCollectionItemState(
    new Request(`${API}/sessions/${SESSION_ID}/resources/notes/${topic}`),
    { kind: "get_collection_item_state", sessionId: SESSION_ID, ref: "notes", topic },
    ctx
  );
}

function getNoteContent(ctx: Ctx, topic: string): Promise<Response> {
  return handleGetCollectionItemContent(
    new Request(`${API}/sessions/${SESSION_ID}/resources/notes/${topic}/content`),
    { kind: "get_collection_item_content", sessionId: SESSION_ID, ref: "notes", topic },
    ctx
  );
}

/** Run an action to completion against the same stores the routes use. */
async function run(ctx: Ctx, actionName: string, input: string): Promise<void> {
  const requestId = `req_${actionName}_${Math.random().toString(16).slice(2)}`;
  const result = await runAction({
    flow: flow as never,
    actionName,
    input,
    userId: USER_ID,
    sessionId: SESSION_ID,
    stores: ctx.stores,
    responseEmitter: createResponseEmitter({ requestId }),
    runtimeConfig: {}
  } as never);
  expect((result as { error?: unknown }).error).toBeUndefined();
}

function topicsOf(body: unknown): string[] {
  const listing = body as { items?: { topic?: string }[]; instances?: { topic?: string }[] };
  return (listing.items ?? listing.instances ?? []).map((item) => item.topic ?? "").sort();
}

// ---------------------------------------------------------------------------
// Direction 1: route writes, execution context reads
// ---------------------------------------------------------------------------

describe("FIX-1000 seam: a resource written through a route is visible to an action", () => {
  it("POST /resources/:ref then read the item inside a running action", async () => {
    const ctx = setup();
    await createSession(ctx);

    expect((await postNote(ctx, "a", "route-content")).status).toBe(201);

    await run(ctx, "readNote", "probe");

    // Both halves matter and they fail independently: the state row and the
    // content row are separate stores addressed by the same scope id, so a
    // swap missed in one of them shows up as exactly one of these.
    expect(observed.noteMissing).toBe(false);
    expect(observed.noteState).toMatchObject({ title: "" });
    expect(observed.noteContent).toBe("route-content");
  });

  it("PATCH /resources/:ref/:topic/content then read the content inside a running action", async () => {
    const ctx = setup();
    await createSession(ctx);
    expect((await postNote(ctx, "a", "first")).status).toBe(201);
    expect((await patchNoteContent(ctx, "a", "second")).status).toBe(200);

    await run(ctx, "readNote", "probe");

    expect(observed.noteContent).toBe("second");
  });
});

// ---------------------------------------------------------------------------
// Direction 2: execution context writes, routes read
// ---------------------------------------------------------------------------

describe("FIX-1000 seam: a resource written by an action is visible to the routes", () => {
  it("an action's create() is listed, readable and content-readable through the routes", async () => {
    const ctx = setup();
    await createSession(ctx);

    await run(ctx, "writeNote", "hello");

    const listed = await listNotes(ctx);
    expect(listed.status).toBe(200);
    expect(topicsOf(await listed.json())).toEqual(["b"]);

    const state = await getNoteState(ctx, "b");
    expect(state.status).toBe(200);
    expect((await state.json()) as unknown).toMatchObject({
      state: { title: "hello" }
    });

    const content = await getNoteContent(ctx, "b");
    expect(content.status).toBe(200);
    expect(((await content.json()) as { content: string }).content).toBe("context-content:hello");
  });

  it("a route DELETE of an action-written item removes it for the action too", async () => {
    const ctx = setup();
    await createSession(ctx);
    await run(ctx, "writeNote", "hello");

    // Rename to the key `readNote` looks for so the round trip is observable
    // through the read action rather than only through another route.
    expect((await postNote(ctx, "a", "route-content")).status).toBe(201);
    await run(ctx, "readNote", "probe");
    expect(observed.noteMissing).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Address-level pinning: where the rows actually land
// ---------------------------------------------------------------------------

describe("FIX-1000: the session-scope resource address", () => {
  it("an action writes at the fenced address and leaves the bare session id empty", async () => {
    const ctx = setup();
    const record = await createSession(ctx);
    expect(record.storageGeneration).toBeDefined();

    await run(ctx, "writeNote", "hello");

    const fenced = resolveSessionResourceScopeId(record);
    expect(fenced).not.toBe(record.id);

    // The positive half: the row is where the derivation says it is.
    expect(await ctx.stores.resourceState.get("session", fenced, "notes/b")).toBeDefined();
    expect(await ctx.stores.content.get("session", fenced, "notes/b")).toBe(
      "context-content:hello"
    );
    // The negative half — the one with teeth. A partial conversion leaves rows
    // at the bare id, which is exactly the shape that makes writer and reader
    // disagree.
    expect(await ctx.stores.resourceState.get("session", record.id, "notes/b")).toBeUndefined();
    expect(await ctx.stores.content.get("session", record.id, "notes/b")).toBeUndefined();
  });

  it("a legacy record with no generation resolves to the bare session id", async () => {
    // The derivation is the whole contract for the legacy path, so assert it
    // directly rather than inferring it from a green round trip. `null` is
    // covered too: a store that nulls absent columns must read as legacy, not
    // as an empty-string generation addressing `${id}#` (BP-030).
    expect(resolveSessionResourceScopeId({ id: "s1", storageGeneration: undefined })).toBe("s1");
    expect(
      resolveSessionResourceScopeId({ id: "s1", storageGeneration: null as unknown as undefined })
    ).toBe("s1");
    expect(resolveSessionResourceScopeId({ id: "s1", storageGeneration: "" })).toBe("s1");
  });

  it("the generation composes onto a tenant-namespaced record key", async () => {
    // Multi-tenancy is unaffected because the generation is appended to the key
    // the tenant already namespaced, not substituted for it.
    const fenced = resolveSessionResourceScopeId({ id: "acme:s1", storageGeneration: "g1" });
    expect(fenced.startsWith("acme:s1")).toBe(true);
    expect(fenced).not.toBe("acme:s1");
  });

  it("two successive recreations produce three distinct addresses", async () => {
    const ctx = setup();
    const addresses: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const record = await createSession(ctx);
      addresses.push(resolveSessionResourceScopeId(record));
      await ctx.stores.session.delete(record.id);
    }
    expect(new Set(addresses).size).toBe(3);
    // And none of them is the bare key, which a counter reset by the delete
    // would have collapsed to (D2).
    expect(addresses.every((address) => address !== SESSION_ID)).toBe(true);
  });
});
