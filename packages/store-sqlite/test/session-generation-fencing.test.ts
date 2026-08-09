/**
 * Goal check for FIX-1000, on a durable store and through the real HTTP path.
 *
 * The claim under test is one sentence: **a session deleted and recreated under
 * the same caller-supplied id starts empty, even when an action was in flight
 * across the delete.** Everything here drives that through `createFlowApiRouter`
 * against a file-backed SQLite registry and a real execution context — no
 * handler is called by hand, no store is stubbed, no model is involved.
 *
 * **The interleaving is the test.** Every assertion below passes trivially if
 * the delete and the create do not overlap, which is exactly why the defect
 * survived FIX-992's suite. The overlap is arranged with a deferred the block
 * parks on, not a sleep: the action signals that it holds a live context, the
 * test drives DELETE and then the re-create while it is parked, and only then
 * releases it. So the straggler's write is issued from a context whose session
 * record no longer exists and whose id has already been handed to someone else.
 *
 * Deliberately no FIX-1000 symbol is imported here. This file asserts only what
 * a client can observe through the router, so reverting the implementation makes
 * it fail on an assertion rather than on a missing export. Address-level
 * assertions (which generation a row actually landed in) live in
 * `packages/engine/test/session-generation-addressing.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { createFlowApiRouter, createFlowRegistry } from "@flow-state-dev/engine";
import type { SessionRecord } from "@flow-state-dev/engine";
import { createSQLiteStores } from "../src";

// ---------------------------------------------------------------------------
// Deferred — the gate. A promise the block parks on so the test, not the
// scheduler, decides when the straggler's write is issued.
// ---------------------------------------------------------------------------

type Deferred<T = void> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Per-test gate wiring. The flow is defined once at module scope (blocks close
 * over this object), so each test swaps the deferreds rather than the flow.
 */
type Gate = {
  /** Resolves once the action holds a live execution context. */
  entered: Deferred;
  /** The test resolves this to let the parked action proceed. */
  release: Deferred;
  /** Resolves when the action's post-gate work has settled, error or not. */
  done: Deferred;
  /** What the post-gate write threw, if anything. `undefined` means it landed. */
  error?: unknown;
};

let gate: Gate;

function freshGate(): Gate {
  return { entered: deferred(), release: deferred(), done: deferred() };
}

// ---------------------------------------------------------------------------
// Flow under test
// ---------------------------------------------------------------------------

const notes = defineResourceCollection({
  scope: "session",
  pattern: "notes/*",
  stateSchema: z.object({ title: z.string().default("") }),
  client: {
    content: { read: true, create: true, update: true, delete: true },
    state: { read: true },
  },
});

/** Writes a note immediately — used to put a key in the scope before a purge. */
const seed = handler({
  name: "seed",
  inputSchema: z.string(),
  resources: { notes },
  execute: async (input: string, ctx: any) => {
    const ref = await ctx.resources.notes.create("kept", { title: input });
    await ref.writeContent(`kept-content:${input}`);
    return "ok";
  },
});

/**
 * Creates a **previously-absent** key after the gate opens. This is the defect's
 * exact shape: `expectedVersion: 0` is satisfied by a key that never existed, so
 * no per-key predicate can refuse it — the write lands, and the only question is
 * whether anything can still address it.
 */
const straggleCreate = handler({
  name: "straggle-create",
  inputSchema: z.string(),
  resources: { notes },
  execute: async (input: string, ctx: any) => {
    gate.entered.resolve();
    await gate.release.promise;
    try {
      const ref = await ctx.resources.notes.create("straggler", { title: input });
      await ref.writeContent(`straggler-content:${input}`);
    } catch (error) {
      gate.error = error;
    } finally {
      gate.done.resolve();
    }
    return "ok";
  },
});

/**
 * Patches a key that **existed** before the purge, from a ref loaded before it.
 * FIX-992's retained tombstone version must still refuse this — FIX-1000 must
 * not have bought its guarantee by weakening that one.
 */
const stragglePatchExisting = handler({
  name: "straggle-patch-existing",
  inputSchema: z.string(),
  resources: { notes },
  execute: async (input: string, ctx: any) => {
    // Load before the gate: the ref (and its version) is captured while the
    // session is still alive, which is what makes the later write stale.
    const ref = await ctx.resources.notes.get("kept");
    gate.entered.resolve();
    await gate.release.promise;
    try {
      await ref.patchState({ title: input });
    } catch (error) {
      gate.error = error;
    } finally {
      gate.done.resolve();
    }
    return "ok";
  },
});

const FLOW_KIND = "notes-flow";

const flow = defineFlow({
  kind: FLOW_KIND,
  actions: {
    seed: { inputSchema: z.string(), block: seed },
    straggleCreate: { inputSchema: z.string(), block: straggleCreate },
    stragglePatchExisting: { inputSchema: z.string(), block: stragglePatchExisting },
  },
})();

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const SESSION_ID = "user-123-main";
const USER_ID = "user_1";

let dir: string;
let file: string;
let stores: ReturnType<typeof createSQLiteStores>;
let router: ReturnType<typeof createFlowApiRouter>;

function openStores(): void {
  stores = createSQLiteStores({ filename: file });
  const registry = createFlowRegistry();
  registry.register(flow);
  router = createFlowApiRouter({ registry, stores });
}

/** Close and reopen the database file, so every read after it is a durable read. */
function restart(): void {
  stores.close?.();
  openStores();
}

beforeEach(() => {
  gate = freshGate();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-gen-fence-"));
  file = path.join(dir, "store.db");
  openStores();
});

afterEach(() => {
  stores.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
});

const API = "http://x/api/flows";

/** POST /:flowKind/sessions — the production session mint path. */
async function createSession(): Promise<SessionRecord> {
  const response = await router.POST(
    new Request(`${API}/${FLOW_KIND}/sessions`, {
      method: "POST",
      body: JSON.stringify({ sessionId: SESSION_ID, userId: USER_ID }),
    }),
    { params: { path: [FLOW_KIND, "sessions"] } }
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { session: SessionRecord }).session;
}

/** DELETE /sessions/:sessionId — the route whose purge the straggler outlives. */
function deleteSession(): Promise<Response> {
  return router.DELETE(new Request(`${API}/sessions/${SESSION_ID}`, { method: "DELETE" }), {
    params: { path: ["sessions", SESSION_ID] },
  });
}

/** POST /:flowKind/:sessionId/actions/:actionName — returns 202 and runs on. */
async function startAction(actionName: string, input: string): Promise<string> {
  const segments = [FLOW_KIND, SESSION_ID, "actions", actionName];
  const response = await router.POST(
    new Request(`${API}/${segments.join("/")}`, {
      method: "POST",
      body: JSON.stringify({ input, userId: USER_ID }),
    }),
    { params: { path: segments } }
  );
  expect(response.status).toBe(202);
  return ((await response.json()) as { request: { id: string } }).request.id;
}

/** Drive an action to completion (the non-contended path). */
async function runActionToEnd(actionName: string, input: string): Promise<void> {
  await waitForTerminal(await startAction(actionName, input));
}

/** GET /sessions/:sessionId/resources/notes — what the client sees. */
async function listNotes(): Promise<Record<string, unknown>> {
  const segments = ["sessions", SESSION_ID, "resources", "notes"];
  const response = await router.GET(new Request(`${API}/${segments.join("/")}`), {
    params: { path: segments },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

/** POST /sessions/:sessionId/resources/notes — the client-side create route. */
function postNote(topic: string, content: string): Promise<Response> {
  const segments = ["sessions", SESSION_ID, "resources", "notes"];
  return router.POST(
    new Request(`${API}/${segments.join("/")}`, {
      method: "POST",
      body: JSON.stringify({ topic, content }),
    }),
    { params: { path: segments } }
  );
}

/** GET /sessions/:sessionId/resources/notes/:topic/content. */
function getNoteContent(topic: string): Promise<Response> {
  const segments = ["sessions", SESSION_ID, "resources", "notes", topic, "content"];
  return router.GET(new Request(`${API}/${segments.join("/")}`), {
    params: { path: segments },
  });
}

/**
 * Poll the request record until it leaves `in_progress`. The action route acks
 * with 202 and keeps running, so nothing else marks the end of the run — and a
 * fixed sleep would be the timing harness this file exists to avoid.
 */
async function waitForTerminal(requestId: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress" && record.status !== "queued") {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`request ${requestId} never reached a terminal status`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

function topicsOf(listing: Record<string, unknown>): string[] {
  const items = (listing.items ?? listing.instances ?? []) as { topic?: string; key?: string }[];
  return items.map((item) => item.topic ?? item.key ?? "").sort();
}

// ---------------------------------------------------------------------------
// The goal check
// ---------------------------------------------------------------------------

describe("FIX-1000: a recreated session does not inherit a straggler's write", () => {
  it("delete + recreate with an action parked across both: the new session is empty", async () => {
    const first = await createSession();

    // The action holds a live execution context bound to the first generation.
    const requestId = await startAction("straggleCreate", "written-after-the-delete");
    await gate.entered.promise;

    // Both of these land while the action is still parked — that overlap is the
    // whole point. Ordered delete-then-create, the reset idiom.
    expect((await deleteSession()).status).toBe(204);
    const second = await createSession();

    // Release the straggler into a world where its session id belongs to
    // someone else.
    gate.release.resolve();
    await gate.done.promise;
    await waitForTerminal(requestId);

    // Discrimination: the write must actually have committed, or this test
    // would pass against a harness that simply failed to reach the store.
    // Nothing refuses a straggler — that is D6, and it is deliberate.
    expect(gate.error).toBeUndefined();

    // Durable read: close the file and reopen it, so nothing below can be an
    // in-process cache artifact.
    restart();

    // The observable claim.
    expect(topicsOf(await listNotes())).toEqual([]);
    expect((await getNoteContent("straggler")).status).toBe(404);

    // Corroboration that the two sessions really are distinct records sharing
    // one caller-supplied id.
    expect(second.id).toBe(first.id);
    expect(second.storageGeneration).toBeDefined();
    expect(second.storageGeneration).not.toBe(first.storageGeneration);
  });

  it("the straggler's CONTENT is fenced too, not just its resource state", async () => {
    await createSession();
    const requestId = await startAction("straggleCreate", "content-probe");
    await gate.entered.promise;

    expect((await deleteSession()).status).toBe(204);
    await createSession();

    gate.release.resolve();
    await gate.done.promise;
    await waitForTerminal(requestId);
    expect(gate.error).toBeUndefined();

    restart();

    // `ContentStore` is last-write-wins and carries no version, so no predicate
    // could ever have fenced this one — an address can, and that is why the fix
    // is an address. A content row surfacing here is the failure mode a
    // generation-column design would have shipped with.
    const response = await getNoteContent("straggler");
    expect(response.status).toBe(404);
  });

  it("two successive delete+recreate cycles: the third session inherits from neither", async () => {
    const first = await createSession();
    await runActionToEnd("seed", "one");
    expect((await deleteSession()).status).toBe(204);

    const second = await createSession();
    await runActionToEnd("seed", "two");
    expect((await deleteSession()).status).toBe(204);

    const third = await createSession();

    restart();
    expect(topicsOf(await listNotes())).toEqual([]);

    // A counter would have produced `1` twice here, because deleting the record
    // deletes the thing that held the previous value (D2). Three independent
    // nonces cannot collide.
    const generations = [first, second, third].map((s) => s.storageGeneration);
    expect(new Set(generations).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// FIX-992's guarantee is not regressed
// ---------------------------------------------------------------------------

describe("FIX-1000: the retained-version fence still holds within a generation", () => {
  it("a key that existed before the purge is refused, not silently rewritten", async () => {
    await createSession();
    await runActionToEnd("seed", "original");

    // A context that loaded `kept` at its live version, then outlived the purge.
    const requestId = await startAction("stragglePatchExisting", "stale-overwrite");
    await gate.entered.promise;

    expect((await deleteSession()).status).toBe(204);

    gate.release.resolve();
    await gate.done.promise;
    await waitForTerminal(requestId);

    // FIX-992: the purge retains each key's version on a tombstone, so a write
    // predicated on the pre-purge version conflicts. Unlike the create above,
    // this one is refused rather than merely unreachable — the two mechanisms
    // are complementary and this asserts the older one survived.
    expect(gate.error).toBeDefined();
    // The retained tombstone is what the writer sees: not "your version is
    // stale" but "this key was deleted", which is the strictly more useful
    // answer and the one FIX-992 shipped.
    expect(String(gate.error)).toMatch(/deleted by another writer/i);

    restart();

    // And the recreated session still starts clean.
    await createSession();
    expect(topicsOf(await listNotes())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Legacy records (no generation) — the "flag off" state (BP-035)
// ---------------------------------------------------------------------------

describe("FIX-1000: a session record with no storageGeneration", () => {
  /** Write a record the way a pre-FIX-1000 build would have: no generation. */
  async function seedLegacySession(): Promise<void> {
    const record: SessionRecord = {
      id: SESSION_ID,
      flowKind: FLOW_KIND,
      userId: USER_ID,
      state: {},
      version: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      journal: [],
    };
    await stores.session.set(SESSION_ID, record, "any");
  }

  it("reads and writes at the bare scope id, unchanged across the upgrade", async () => {
    await seedLegacySession();
    await runActionToEnd("seed", "legacy");

    restart();

    // Round-trips through the route, and lands at the bare id on disk — the
    // byte-identical-to-before claim, checked against the store rather than
    // inferred from a green route read.
    expect(topicsOf(await listNotes())).toEqual(["kept"]);
    expect(await stores.resourceState.get("session", SESSION_ID, "notes/kept")).toBeDefined();
    expect(await stores.content.get("session", SESSION_ID, "notes/kept")).toBe(
      "kept-content:legacy"
    );
  });

  it("deleted and recreated, it does NOT inherit — the successor is fenced", async () => {
    await seedLegacySession();

    const requestId = await startAction("straggleCreate", "legacy-straggler");
    await gate.entered.promise;

    expect((await deleteSession()).status).toBe(204);
    // The recreated record comes from the production mint path, so it HAS a
    // generation even though its predecessor did not. The hole closes on
    // recreation rather than on deploy (D7) — this is that claim.
    const recreated = await createSession();
    expect(recreated.storageGeneration).toBeDefined();

    gate.release.resolve();
    await gate.done.promise;
    await waitForTerminal(requestId);
    expect(gate.error).toBeUndefined();

    restart();

    expect(topicsOf(await listNotes())).toEqual([]);
    // The straggler is where a legacy context puts things: the bare id. Present,
    // and unreachable from the fenced successor.
    expect(await stores.resourceState.get("session", SESSION_ID, "notes/straggler")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// The client-side write routes against a fenced session
// ---------------------------------------------------------------------------

describe("FIX-1000: the collection-item routes on a fenced session", () => {
  it("an item created through POST is visible through GET on the same session", async () => {
    // A session from the production mint path, i.e. one that carries a
    // generation — which is every session a real client creates. The existing
    // route suites seed a bare record by hand, so this combination has no
    // coverage anywhere.
    await createSession();

    expect((await postNote("a", "body-a")).status).toBe(201);

    restart();

    expect(topicsOf(await listNotes())).toEqual(["a"]);
    const content = await getNoteContent("a");
    expect(content.status).toBe(200);
    expect(((await content.json()) as { content: string }).content).toBe("body-a");
  });

  it("an item deleted through DELETE is gone from the same session", async () => {
    await createSession();
    expect((await postNote("a", "body-a")).status).toBe(201);

    const segments = ["sessions", SESSION_ID, "resources", "notes", "a"];
    const removed = await router.DELETE(
      new Request(`${API}/${segments.join("/")}`, { method: "DELETE" }),
      { params: { path: segments } }
    );
    expect(removed.status).toBe(200);

    restart();

    expect(topicsOf(await listNotes())).toEqual([]);
    expect((await getNoteContent("a")).status).toBe(404);
  });
});
