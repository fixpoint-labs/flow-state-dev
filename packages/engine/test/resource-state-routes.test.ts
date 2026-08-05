/**
 * Route-level tests for the FIX-427 list-state, get-state, and manifest
 * endpoints. Builds a real flow + in-memory stores; invokes the handlers
 * directly without spinning up an HTTP server.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import { createInMemoryStores, createFlowRegistry } from "../src";
import type { JsonObject } from "@flow-state-dev/core/types";
import type { StoreRegistry, SessionRecord, UserRecord } from "../src/stores/types";
import { resolveResourceScopeId, resolveUserStorageKey } from "../src/stores/scope-keys";
import {
  handleListCollectionState,
  handleGetCollectionItemState,
  handleGetResourceManifest
} from "../src/routes/resource-routes";
import { handleDeleteSession } from "../src/routes/session-routes";
import type { FlowRegistry } from "../src/registry/flow-registry";

// ---------------------------------------------------------------------------
// Test flow
// ---------------------------------------------------------------------------

const artifactsCollection = defineResourceCollection({
  pattern: "artifacts/*",
  scope: "session",
  stateSchema: z.object({ title: z.string().optional() }),
  prefetchWindow: 0,
  client: {
    content: { read: true, create: true, update: true, delete: true },
    state: { read: true },
    expose: ["title"],
  },
});

const privateCollection = defineResourceCollection({
  pattern: "private/*",
  scope: "session",
  stateSchema: z.object({}),
  client: {
    content: { read: true },
    // state.read intentionally omitted
  },
});

const internalCollection = defineResourceCollection({
  pattern: "internal/*",
  scope: "session",
  stateSchema: z.object({}),
  // No client config — server-internal.
});

// User-scoped + flowIsolation: mirrors the trading-desk portfolio collections
// (must persist across sessions). Exercises the user-scope read branch.
const accountsCollection = defineResourceCollection({
  pattern: "accounts/*",
  scope: "user",
  flowIsolation: true,
  stateSchema: z.object({ name: z.string().optional() }),
  client: { state: { read: true } },
});

const profileResource = defineResource({
  scope: "session",
  stateSchema: z.object({ name: z.string().default("anon") }),
  client: { data: (s) => ({ name: (s as { name: string }).name }) },
});

function buildFlow() {
  const block = handler({
    name: "noop",
    resources: {
      artifacts: artifactsCollection,
      private: privateCollection,
      internal: internalCollection,
      profile: profileResource,
      accounts: accountsCollection,
    },
    execute: () => "ok",
  });
  return defineFlow({
    kind: "test-flow",
    actions: { run: { inputSchema: z.string(), block } },
  })();
}

/** Scope-record (`ctx.user.state`) storage key — keys on the flow-level flag. */
function userKeyFor(flow: ReturnType<typeof buildFlow>, userId: string): string {
  return resolveUserStorageKey(userId, {
    kind: flow.kind,
    isolateUserState: flow.isolateUserState ?? false,
  });
}

async function setupCtx(opts: {
  artifacts?: Record<string, { title?: string }>;
  privateItems?: Record<string, unknown>;
  /** Seed a user-scoped `accounts/*` collection. Undefined → no user record at all. */
  accounts?: Record<string, { name?: string }>;
} = {}): Promise<{
  registry: FlowRegistry;
  stores: StoreRegistry;
  sessionId: string;
}> {
  const stores = createInMemoryStores();
  const flow = buildFlow();
  const registry = createFlowRegistry();
  registry.register(flow);
  const sessionId = "sess_1";
  const userId = "user_1";

  const resources: Record<string, unknown> = {};
  for (const [topic, state] of Object.entries(opts.artifacts ?? {})) {
    resources[`artifacts/${topic}`] = state;
  }
  for (const [topic, state] of Object.entries(opts.privateItems ?? {})) {
    resources[`private/${topic}`] = state;
  }

  const session: SessionRecord = {
    id: sessionId,
    flowKind: "test-flow",
    userId,
    state: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await stores.session.set(sessionId, session, "any");
  // Resource state is canonical in the ResourceStateStore (FIX-689).
  for (const [key, state] of Object.entries(resources)) {
    await stores.resourceState.set("session", sessionId, key, state as JsonObject, "any");
  }

  // Seed user-scope data only when accounts are provided. Omitting `accounts`
  // leaves NO user record — exercising the "missing user record reads as empty"
  // path that getPersistedData returns `undefined` for.
  if (opts.accounts !== undefined) {
    const userKey = userKeyFor(flow, userId);
    const userRecord: UserRecord = {
      id: userKey,
      userId,
      state: {},
      version: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await stores.user.set(userKey, userRecord, "any");
    // FIX-735: `accountsCollection` declares `flowIsolation: true`, so its
    // instances key per-resource at the isolated bucket `{userId}:{flowKind}` —
    // independent of the (flow-flag) scope-record key above.
    const accountsScopeId = resolveResourceScopeId(userId, flow.kind, true);
    for (const [topic, state] of Object.entries(opts.accounts)) {
      await stores.resourceState.set("user", accountsScopeId, `accounts/${topic}`, state as JsonObject, "any");
    }
  }

  return { registry, stores, sessionId };
}

function makeReq(url: string, method = "GET"): Request {
  return new Request(url, { method });
}

// ---------------------------------------------------------------------------
// delete_session cascade (FIX-689): resource state must be cleaned up too
// ---------------------------------------------------------------------------

describe("handleDeleteSession resource-state cleanup", () => {
  it("deletes the session's resource state, not just its content", async () => {
    const { registry, stores, sessionId } = await setupCtx({
      artifacts: { "doc.md": { title: "Doc" } },
    });
    await stores.content.set("session", sessionId, "artifacts/doc.md", "body");

    // Sanity: both stores hold the instance before delete.
    expect(Object.keys(await stores.resourceState.getAll("session", sessionId))).toContain(
      "artifacts/doc.md"
    );

    const res = await handleDeleteSession(
      makeReq(`http://x/api/flows/sessions/${sessionId}`, "DELETE"),
      { kind: "delete_session", sessionId },
      { registry, stores }
    );
    expect(res.status).toBe(204);

    // No orphaned state (or content) rows remain.
    expect(await stores.resourceState.getAll("session", sessionId)).toEqual({});
    expect(await stores.content.getAll("session", sessionId)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// list_collection_state
// ---------------------------------------------------------------------------

describe("handleListCollectionState", () => {
  it("returns a page in lex order with an opaque nextCursor when more remain", async () => {
    const ctx = await setupCtx({
      artifacts: {
        "z.md": { title: "Z" },
        "a.md": { title: "A" },
        "m.md": { title: "M" },
      },
    });
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/sess_1/resources/artifacts?limit=2"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "artifacts" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((i: { topic: string }) => i.topic)).toEqual([
      "a.md",
      "m.md",
    ]);
    expect(body.items.map((i: { storageKey: string }) => i.storageKey)).toEqual([
      "artifacts/a.md",
      "artifacts/m.md",
    ]);
    expect(body.items[0].clientData).toEqual({ title: "A" });
    // Keyset cursor = last storage key of the page; more rows remain.
    expect(body.nextCursor).toBe("artifacts/m.md");
  });

  it("paginates the second page by cursor and omits nextCursor on the last page", async () => {
    const ctx = await setupCtx({
      artifacts: {
        "a.md": {}, "b.md": {}, "c.md": {}, "d.md": {},
      },
    });
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/sess_1/resources/artifacts?limit=2&cursor=artifacts/b.md"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "artifacts" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    const body = await res.json();
    expect(body.items.map((i: { topic: string }) => i.topic)).toEqual([
      "c.md",
      "d.md",
    ]);
    expect(body.nextCursor).toBeUndefined();
  });

  it("filters by topicPrefix", async () => {
    const ctx = await setupCtx({
      artifacts: {
        "alpha-1": {}, "alpha-2": {}, "beta-1": {},
      },
    });
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/sess_1/resources/artifacts?topicPrefix=artifacts/alpha"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "artifacts" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    const body = await res.json();
    expect(body.items.map((i: { topic: string }) => i.topic)).toEqual([
      "alpha-1",
      "alpha-2",
    ]);
    expect(body.nextCursor).toBeUndefined();
  });

  it("returns an empty page with no nextCursor when the cursor is past the end", async () => {
    const ctx = await setupCtx({ artifacts: { "a": {} } });
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/sess_1/resources/artifacts?cursor=artifacts/zzz"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "artifacts" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeUndefined();
  });

  it("returns 403 when client.state.read is not true", async () => {
    const ctx = await setupCtx({ privateItems: { "x": {} } });
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/sess_1/resources/private"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "private" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when ref is not a collection", async () => {
    const ctx = await setupCtx();
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/sess_1/resources/profile"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "profile" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown ref", async () => {
    const ctx = await setupCtx();
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/sess_1/resources/nope"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "nope" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown session", async () => {
    const ctx = await setupCtx();
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/missing/resources/artifacts"),
      { kind: "list_collection_state", sessionId: "missing", ref: "artifacts" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for limit > 200", async () => {
    const ctx = await setupCtx();
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/sess_1/resources/artifacts?limit=500"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "artifacts" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for limit < 1", async () => {
    const ctx = await setupCtx();
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/sess_1/resources/artifacts?limit=0"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "artifacts" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(400);
  });

  it("walks a 60-item collection page-by-page via cursor", async () => {
    const artifacts: Record<string, { title?: string }> = {};
    for (let i = 0; i < 60; i++) {
      artifacts[`item-${String(i).padStart(3, "0")}`] = { title: `Item ${i}` };
    }
    const ctx = await setupCtx({ artifacts });

    const fetchPage = async (cursor?: string) => {
      const q = `limit=20${cursor !== undefined ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await handleListCollectionState(
        makeReq(`http://localhost/sessions/sess_1/resources/artifacts?${q}`),
        { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "artifacts" },
        { registry: ctx.registry, stores: ctx.stores }
      );
      return res.json();
    };

    const body1 = await fetchPage();
    expect(body1.items).toHaveLength(20);
    expect(body1.items[0].topic).toBe("item-000");
    expect(body1.nextCursor).toBe("artifacts/item-019");

    const body2 = await fetchPage(body1.nextCursor);
    expect(body2.items).toHaveLength(20);
    expect(body2.items[0].topic).toBe("item-020");
    expect(body2.items[0].storageKey).toBe("artifacts/item-020");
    expect(body2.nextCursor).toBe("artifacts/item-039");

    const body3 = await fetchPage(body2.nextCursor);
    expect(body3.items).toHaveLength(20);
    expect(body3.items[0].topic).toBe("item-040");
    // Last page — no cursor remains.
    expect(body3.nextCursor).toBeUndefined();
  });

  it("returns items: [] with no nextCursor for an empty collection", async () => {
    const ctx = await setupCtx();
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/sess_1/resources/artifacts"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "artifacts" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// get_collection_item_state
// ---------------------------------------------------------------------------

describe("handleGetCollectionItemState", () => {
  it("returns the item by storage key", async () => {
    const ctx = await setupCtx({ artifacts: { "spec.md": { title: "Spec" } } });
    const res = await handleGetCollectionItemState(
      makeReq("http://localhost/sessions/sess_1/resources/artifacts/artifacts%2Fspec.md"),
      { kind: "get_collection_item_state", sessionId: ctx.sessionId, ref: "artifacts", topic: "artifacts/spec.md" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    const body = await res.json();
    expect(body).toEqual({
      topic: "spec.md",
      storageKey: "artifacts/spec.md",
      clientData: { title: "Spec" },
    });
  });

  it("resolves bare topic to full storage key", async () => {
    const ctx = await setupCtx({ artifacts: { "spec.md": { title: "Spec" } } });
    const res = await handleGetCollectionItemState(
      makeReq("http://localhost/sessions/sess_1/resources/artifacts/spec.md"),
      { kind: "get_collection_item_state", sessionId: ctx.sessionId, ref: "artifacts", topic: "spec.md" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    const body = await res.json();
    expect(body.topic).toBe("spec.md");
    expect(body.storageKey).toBe("artifacts/spec.md");
  });

  it("returns 200 + null body when topic is not present", async () => {
    const ctx = await setupCtx({ artifacts: {} });
    const res = await handleGetCollectionItemState(
      makeReq("http://localhost/sessions/sess_1/resources/artifacts/missing"),
      { kind: "get_collection_item_state", sessionId: ctx.sessionId, ref: "artifacts", topic: "missing" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("returns 403 without state.read", async () => {
    const ctx = await setupCtx({ privateItems: { "x": {} } });
    const res = await handleGetCollectionItemState(
      makeReq("http://localhost/sessions/sess_1/resources/private/x"),
      { kind: "get_collection_item_state", sessionId: ctx.sessionId, ref: "private", topic: "x" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// user-scope reads (portfolio collections persist across sessions)
// ---------------------------------------------------------------------------

describe("user-scoped collection reads", () => {
  it("lists persisted user-scope items (was 501)", async () => {
    const ctx = await setupCtx({
      accounts: { acct_a: { name: "Brokerage A" }, acct_b: { name: "Brokerage B" } },
    });
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/sess_1/resources/accounts"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "accounts" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((i: { topic: string }) => i.topic)).toEqual(["acct_a", "acct_b"]);
    expect(body.items.map((i: { storageKey: string }) => i.storageKey)).toEqual([
      "accounts/acct_a",
      "accounts/acct_b",
    ]);
    expect(body.items[0].clientData).toEqual({ name: "Brokerage A" });
  });

  it("filters user-scope items by topicPrefix", async () => {
    const ctx = await setupCtx({
      accounts: {
        acct_a__AAPL: { name: "x" },
        acct_a__MSFT: { name: "y" },
        acct_b__AAPL: { name: "z" },
      },
    });
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/sess_1/resources/accounts?topicPrefix=accounts/acct_a"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "accounts" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    const body = await res.json();
    expect(body.items.map((i: { topic: string }) => i.topic)).toEqual([
      "acct_a__AAPL",
      "acct_a__MSFT",
    ]);
  });

  it("returns 200 + empty list when the user record is missing (not 500)", async () => {
    // No `accounts` opt → no user record seeded at all.
    const ctx = await setupCtx();
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/sess_1/resources/accounts"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "accounts" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });

  it("returns a single user-scope item state (was 501)", async () => {
    const ctx = await setupCtx({ accounts: { acct_a: { name: "Brokerage A" } } });
    const res = await handleGetCollectionItemState(
      makeReq("http://localhost/sessions/sess_1/resources/accounts/acct_a"),
      { kind: "get_collection_item_state", sessionId: ctx.sessionId, ref: "accounts", topic: "acct_a" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      topic: "acct_a",
      storageKey: "accounts/acct_a",
      clientData: { name: "Brokerage A" },
    });
  });

  it("returns 200 + null for a missing user-scope item (no user record)", async () => {
    const ctx = await setupCtx();
    const res = await handleGetCollectionItemState(
      makeReq("http://localhost/sessions/sess_1/resources/accounts/acct_a"),
      { kind: "get_collection_item_state", sessionId: ctx.sessionId, ref: "accounts", topic: "acct_a" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// get_resource_manifest
// ---------------------------------------------------------------------------

describe("handleGetResourceManifest", () => {
  let ctx: Awaited<ReturnType<typeof setupCtx>>;
  beforeEach(async () => {
    ctx = await setupCtx();
  });

  it("returns flowKind and resources for client-visible entries only", async () => {
    const res = await handleGetResourceManifest(
      makeReq("http://localhost/sessions/sess_1/manifest"),
      { kind: "get_resource_manifest", sessionId: ctx.sessionId },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.flowKind).toBe("test-flow");
    const refs = body.resources.map((r: { ref: string }) => r.ref).sort();
    expect(refs).toEqual(["accounts", "artifacts", "private", "profile"]);
  });

  it("omits resources with no client config", async () => {
    const res = await handleGetResourceManifest(
      makeReq("http://localhost/sessions/sess_1/manifest"),
      { kind: "get_resource_manifest", sessionId: ctx.sessionId },
      { registry: ctx.registry, stores: ctx.stores }
    );
    const body = await res.json();
    const refs = body.resources.map((r: { ref: string }) => r.ref);
    expect(refs).not.toContain("internal");
  });

  it("includes pattern, prefetchWindow, hasClientData on collection entries", async () => {
    const res = await handleGetResourceManifest(
      makeReq("http://localhost/sessions/sess_1/manifest"),
      { kind: "get_resource_manifest", sessionId: ctx.sessionId },
      { registry: ctx.registry, stores: ctx.stores }
    );
    const body = await res.json();
    const artifacts = body.resources.find((r: { ref: string }) => r.ref === "artifacts");
    expect(artifacts).toMatchObject({
      ref: "artifacts",
      kind: "collection",
      scope: "session",
      pattern: "artifacts/*",
      prefetchWindow: 0,
      hasClientData: true,
      client: {
        content: { read: true, create: true, update: true, delete: true },
        state: { read: true },
      },
    });
  });

  it("flags single resources with hasClientData and includes client.content only", async () => {
    const res = await handleGetResourceManifest(
      makeReq("http://localhost/sessions/sess_1/manifest"),
      { kind: "get_resource_manifest", sessionId: ctx.sessionId },
      { registry: ctx.registry, stores: ctx.stores }
    );
    const body = await res.json();
    const profile = body.resources.find((r: { ref: string }) => r.ref === "profile");
    expect(profile).toMatchObject({
      ref: "profile",
      kind: "single",
      scope: "session",
      hasClientData: true,
    });
    expect(profile.pattern).toBeUndefined();
  });

  it("returns 404 for unknown session", async () => {
    const res = await handleGetResourceManifest(
      makeReq("http://localhost/sessions/missing/manifest"),
      { kind: "get_resource_manifest", sessionId: "missing" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// FIX-580: client projection shapes (identity, expose, exclude, data)
// ---------------------------------------------------------------------------

describe("client projection shapes (FIX-580)", () => {
  const itemStateSchema = z.object({
    title: z.string(),
    body: z.string(),
    secret: z.string(),
  });

  function buildProjectionCtx(client: Parameters<typeof defineResourceCollection>[0]["client"]) {
    const items = defineResourceCollection({
      pattern: "items/*",
      scope: "session",
      stateSchema: itemStateSchema,
      client: {
        ...(client as object),
      },
    });
    const block = handler({
      name: "noop",
      resources: { items },
      execute: () => "ok",
    });
    const flow = defineFlow({
      kind: "projection-flow",
      actions: { run: { inputSchema: z.string(), block } },
    })();
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(flow);
    const sessionId = "sess_proj";
    const session: SessionRecord = {
      id: sessionId,
      flowKind: "projection-flow",
      userId: "user_1",
      state: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return stores.session
      .set(sessionId, session, "any")
      .then(() =>
        stores.resourceState.set("session", sessionId, "items/one", {
          title: "T",
          body: "B",
          secret: "S",
        }, "any")
      )
      .then(() => ({
        registry,
        stores,
        sessionId,
      }));
  }

  it("ships identity state when state.read: true and no projection is set", async () => {
    const ctx = await buildProjectionCtx({ state: { read: true } });
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/sess_proj/resources/items"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "items" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    const body = await res.json();
    expect(body.items[0].clientData).toEqual({ title: "T", body: "B", secret: "S" });
  });

  it("ships only `expose` fields", async () => {
    const ctx = await buildProjectionCtx({
      state: { read: true },
      expose: ["title"],
    });
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/sess_proj/resources/items"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "items" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    const body = await res.json();
    expect(body.items[0].clientData).toEqual({ title: "T" });
  });

  it("omits `exclude` fields and keeps the rest", async () => {
    const ctx = await buildProjectionCtx({
      state: { read: true },
      exclude: ["secret"],
    });
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/sess_proj/resources/items"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "items" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    const body = await res.json();
    expect(body.items[0].clientData).toEqual({ title: "T", body: "B" });
  });

  it("invokes `data` when set (escape hatch still works)", async () => {
    const ctx = await buildProjectionCtx({
      state: { read: true },
      data: (s) => ({ summary: `${s.title}/${s.body}` }),
    });
    const res = await handleListCollectionState(
      makeReq("http://localhost/sessions/sess_proj/resources/items"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "items" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    const body = await res.json();
    expect(body.items[0].clientData).toEqual({ summary: "T/B" });
  });
});
