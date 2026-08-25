/**
 * Route-level tests for the FIX-579 debug inspection surface
 * (`/api/flows/sessions/:id/debug/resources*`). Builds a real flow + in-memory
 * stores; invokes the handlers directly without spinning up an HTTP server.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import { createInMemoryStores, createFlowRegistry } from "../src";
import type { JsonObject } from "@flow-state-dev/core/types";
import type { SessionRecord, StoreRegistry } from "../src/stores/types";
import type { FlowRegistry } from "../src/registry/flow-registry";
import {
  assertDebugAllowed,
  handleDebugGetCollectionItemContent,
  handleDebugGetResourceContent,
  handleDebugListCollectionItems,
  handleDebugListResources,
  resolveDebugConfig,
  type ResolvedDebugConfig
} from "../src/routes/debug-routes";
import { computeClientView } from "../src/routes/debug-snapshot";

// ---------------------------------------------------------------------------
// Test flow
// ---------------------------------------------------------------------------

const memos = defineResourceCollection({
  pattern: "memos/[topic]",
  scope: "session",
  stateSchema: z.object({
    title: z.string(),
    body: z.string(),
    secret: z.string().optional()
  }),
  client: {
    state: { read: true },
    content: { read: true },
    data: (s) => ({ title: s.title })
  }
});

const internalNotes = defineResourceCollection({
  pattern: "internalNotes/[topic]",
  scope: "session",
  stateSchema: z.object({ note: z.string().optional() })
  // no client config
});

const gated = defineResourceCollection({
  pattern: "gated/[topic]",
  scope: "session",
  stateSchema: z.object({ v: z.string().optional() }),
  client: {
    content: { read: false }
    // state.read intentionally omitted -> defaults false
  }
});

const profile = defineResource({
  scope: "session",
  stateSchema: z.object({ name: z.string().default("anon") }),
  client: { data: (s) => ({ name: (s as { name: string }).name }) }
});

const metrics = defineResource({
  scope: "session",
  stateSchema: z.object({ count: z.number().default(0) })
  // no client config
});

const crashing = defineResource({
  scope: "session",
  stateSchema: z.object({ x: z.string().optional() }),
  client: {
    data: () => {
      throw new Error("boom!");
    }
  }
});

const sharedCollection = defineResourceCollection({
  pattern: "contributions/[topic]",
  scope: "session",
  stateSchema: z.object({}),
  client: {
    state: { read: true },
    content: { read: true },
    data: (s) => s
  }
});

function buildFlow() {
  const block = handler({
    name: "noop",
    resources: {
      memos,
      internalNotes,
      gated,
      profile,
      metrics,
      crashing,
      contributions: sharedCollection,
      p2Contributions: sharedCollection
    },
    execute: () => "ok"
  });
  return defineFlow({
    kind: "debug-flow",
    actions: { run: { inputSchema: z.string(), block } }
  })();
}

interface Ctx {
  registry: FlowRegistry;
  stores: StoreRegistry;
  sessionId: string;
  debug: ResolvedDebugConfig;
}

async function setupCtx(opts: {
  resources?: Record<string, unknown>;
  debugConfig?: Parameters<typeof resolveDebugConfig>[0];
} = {}): Promise<Ctx> {
  const stores = createInMemoryStores();
  const flow = buildFlow();
  const registry = createFlowRegistry();
  registry.register(flow);
  const sessionId = "sess_1";
  const session: SessionRecord = {
    id: sessionId,
    flowKind: "debug-flow",
    userId: "user_1",
    state: {},
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  await stores.session.set(sessionId, session, "any");
  // Resource state is canonical in the ResourceStateStore (FIX-689).
  for (const [key, state] of Object.entries(opts.resources ?? {})) {
    await stores.resourceState.set("session", sessionId, key, state as JsonObject, "any");
  }
  const debug = resolveDebugConfig(
    opts.debugConfig ?? { debugEndpointsEnabled: true }
  );
  return { registry, stores, sessionId, debug };
}

function makeReq(
  url: string,
  init?: { method?: string; headers?: Record<string, string> }
): Request {
  return new Request(url, {
    method: init?.method ?? "GET",
    headers: init?.headers
  });
}

const BASE = "http://localhost/api/flows/sessions/sess_1/debug/resources";

// ---------------------------------------------------------------------------
// Gate: assertDebugAllowed / resolveDebugConfig
// ---------------------------------------------------------------------------

describe("assertDebugAllowed (gate)", () => {
  const ORIG = process.env.FSDEV_DEBUG_ENDPOINTS;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.FSDEV_DEBUG_ENDPOINTS;
    else process.env.FSDEV_DEBUG_ENDPOINTS = ORIG;
  });

  it("403s with debug_endpoints_disabled when enabled=false", async () => {
    const ctx = await setupCtx({ debugConfig: { debugEndpointsEnabled: false } });
    const res = await handleDebugListResources(
      makeReq(BASE),
      { kind: "debug_list_resources", sessionId: ctx.sessionId },
      ctx
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "debug_endpoints_disabled" });
  });

  it("allows loopback origin (http://localhost:3000)", async () => {
    const ctx = await setupCtx();
    const res = await handleDebugListResources(
      makeReq(BASE, { headers: { origin: "http://localhost:3000" } }),
      { kind: "debug_list_resources", sessionId: ctx.sessionId },
      ctx
    );
    expect(res.status).toBe(200);
  });

  it("403s with debug_endpoints_origin_rejected for off-host origin", async () => {
    const ctx = await setupCtx();
    const res = await handleDebugListResources(
      makeReq(BASE, { headers: { origin: "https://evil.example" } }),
      { kind: "debug_list_resources", sessionId: ctx.sessionId },
      ctx
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("debug_endpoints_origin_rejected");
    expect(body.origin).toBe("https://evil.example");
  });

  it("permits anonymous (no Origin) when allowAnonymousLocal is default-true", async () => {
    const ctx = await setupCtx();
    const res = await handleDebugListResources(
      makeReq(BASE),
      { kind: "debug_list_resources", sessionId: ctx.sessionId },
      ctx
    );
    expect(res.status).toBe(200);
  });

  it("403s anonymous (no Origin) when allowAnonymousLocal is false", async () => {
    const ctx = await setupCtx({
      debugConfig: {
        debugEndpointsEnabled: true,
        debugAllowAnonymousLocal: false
      }
    });
    const res = await handleDebugListResources(
      makeReq(BASE),
      { kind: "debug_list_resources", sessionId: ctx.sessionId },
      ctx
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "debug_endpoints_origin_rejected",
      origin: null
    });
  });

  it("falls back to FSDEV_DEBUG_ENDPOINTS=1 when enabled is undefined", () => {
    process.env.FSDEV_DEBUG_ENDPOINTS = "1";
    const cfg = resolveDebugConfig({});
    expect(cfg.enabled).toBe(true);
    const denied = assertDebugAllowed(new Request("http://localhost/x"), cfg);
    expect(denied).toBeNull();
  });

  it("env flag absent + enabled undefined -> disabled", () => {
    delete process.env.FSDEV_DEBUG_ENDPOINTS;
    const cfg = resolveDebugConfig({});
    expect(cfg.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleDebugListResources (tree)
// ---------------------------------------------------------------------------

describe("handleDebugListResources", () => {
  it("returns one entry per resource group with itemCount for collections", async () => {
    const ctx = await setupCtx({
      resources: {
        "memos/a": { title: "A", body: "ba", secret: "s1" },
        "memos/b": { title: "B", body: "bb" },
        "internalNotes/x": { note: "n" },
        profile: { name: "Alice" }
      }
    });
    const res = await handleDebugListResources(
      makeReq(BASE),
      { kind: "debug_list_resources", sessionId: ctx.sessionId },
      ctx
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe("sess_1");
    expect(body.flowKind).toBe("debug-flow");
    const memosEntry = body.resources.find(
      (r: { primaryName: string }) => r.primaryName === "memos"
    );
    expect(memosEntry.isCollection).toBe(true);
    expect(memosEntry.itemCount).toBe(2);
    expect(memosEntry.itemCountTruncated).toBe(false);
    const internalEntry = body.resources.find(
      (r: { primaryName: string }) => r.primaryName === "internalNotes"
    );
    expect(internalEntry.itemCount).toBe(1);
  });

  it("collapses dual-registered collections into one entry with aliases", async () => {
    const ctx = await setupCtx({
      resources: { "contributions/foo": {} }
    });
    const res = await handleDebugListResources(
      makeReq(BASE),
      { kind: "debug_list_resources", sessionId: ctx.sessionId },
      ctx
    );
    const body = await res.json();
    const contribEntries = body.resources.filter((r: { aliases: string[] }) =>
      r.aliases.includes("contributions")
    );
    expect(contribEntries).toHaveLength(1);
    const entry = contribEntries[0];
    expect(entry.aliases).toEqual(["contributions", "p2Contributions"]);
    expect(entry.primaryName).toBe("contributions");
    expect(typeof entry.definitionId).toBe("string");
    // The p2Contributions alias does not get its own row.
    expect(
      body.resources.filter(
        (r: { primaryName: string }) => r.primaryName === "p2Contributions"
      )
    ).toHaveLength(0);
  });

  it("populates clientConfig (hasClient/data/stateRead/contentRead/prefetchWindow) for memos", async () => {
    const ctx = await setupCtx();
    const res = await handleDebugListResources(
      makeReq(BASE),
      { kind: "debug_list_resources", sessionId: ctx.sessionId },
      ctx
    );
    const body = await res.json();
    const memosEntry = body.resources.find(
      (r: { primaryName: string }) => r.primaryName === "memos"
    );
    expect(memosEntry.clientConfig).toEqual({
      hasClient: true,
      data: true,
      stateRead: true,
      contentRead: true,
      prefetchWindow: null
    });
  });

  it("emits raw state and clientView projection for single resources", async () => {
    const ctx = await setupCtx({
      resources: { profile: { name: "Bob" } }
    });
    const res = await handleDebugListResources(
      makeReq(BASE),
      { kind: "debug_list_resources", sessionId: ctx.sessionId },
      ctx
    );
    const body = await res.json();
    const profileEntry = body.resources.find(
      (r: { primaryName: string }) => r.primaryName === "profile"
    );
    expect(profileEntry.isCollection).toBe(false);
    expect(profileEntry.state).toEqual({ name: "Bob" });
    expect(profileEntry.clientView).toEqual({
      ok: true,
      value: { name: "Bob" }
    });
  });

  it("truncates itemCount per debugCountLimit", async () => {
    const ctx = await setupCtx({
      resources: {
        "memos/a": { title: "A", body: "" },
        "memos/b": { title: "B", body: "" },
        "memos/c": { title: "C", body: "" },
        "memos/d": { title: "D", body: "" },
        "memos/e": { title: "E", body: "" }
      },
      debugConfig: { debugEndpointsEnabled: true, debugCountLimit: 3 }
    });
    const res = await handleDebugListResources(
      makeReq(BASE),
      { kind: "debug_list_resources", sessionId: ctx.sessionId },
      ctx
    );
    const body = await res.json();
    const memosEntry = body.resources.find(
      (r: { primaryName: string }) => r.primaryName === "memos"
    );
    expect(memosEntry.itemCount).toBe(3);
    expect(memosEntry.itemCountTruncated).toBe(true);
  });

  it("404s with session_not_found for unknown session", async () => {
    const ctx = await setupCtx();
    const res = await handleDebugListResources(
      makeReq(BASE),
      { kind: "debug_list_resources", sessionId: "missing" },
      ctx
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "session_not_found" });
  });
});

// ---------------------------------------------------------------------------
// handleDebugListCollectionItems
// ---------------------------------------------------------------------------

describe("handleDebugListCollectionItems", () => {
  async function setupMemos(): Promise<Ctx> {
    return setupCtx({
      resources: {
        "memos/aaa": { title: "TA", body: "BA", secret: "s" },
        "memos/bbb": { title: "TB", body: "BB" },
        "memos/ccc": { title: "TC", body: "BC" },
        "memos/ddd": { title: "TD", body: "BD" },
        "memos/eee": { title: "TE", body: "BE" },
        "memos/foo-1": { title: "TF1", body: "BF1" },
        "memos/foo-2": { title: "TF2", body: "BF2" }
      }
    });
  }

  it("paginates items in lex order with a non-null nextCursor", async () => {
    const ctx = await setupCtx({
      resources: {
        "memos/aaa": { title: "TA", body: "BA" },
        "memos/bbb": { title: "TB", body: "BB" },
        "memos/ccc": { title: "TC", body: "BC" },
        "memos/ddd": { title: "TD", body: "BD" },
        "memos/eee": { title: "TE", body: "BE" }
      }
    });
    const page1 = await handleDebugListCollectionItems(
      makeReq(`${BASE}/memos/items?limit=2`),
      {
        kind: "debug_list_collection_items",
        sessionId: ctx.sessionId,
        ref: "memos"
      },
      ctx
    );
    expect(page1.status).toBe(200);
    const b1 = await page1.json();
    expect(b1.items.map((i: { topic: string }) => i.topic)).toEqual([
      "aaa",
      "bbb"
    ]);
    expect(b1.nextCursor).not.toBeNull();

    const page2 = await handleDebugListCollectionItems(
      makeReq(
        `${BASE}/memos/items?limit=2&cursor=${encodeURIComponent(b1.nextCursor)}`
      ),
      {
        kind: "debug_list_collection_items",
        sessionId: ctx.sessionId,
        ref: "memos"
      },
      ctx
    );
    const b2 = await page2.json();
    expect(b2.items.map((i: { topic: string }) => i.topic)).toEqual([
      "ccc",
      "ddd"
    ]);
    expect(b2.nextCursor).not.toBeNull();

    const page3 = await handleDebugListCollectionItems(
      makeReq(
        `${BASE}/memos/items?limit=2&cursor=${encodeURIComponent(b2.nextCursor)}`
      ),
      {
        kind: "debug_list_collection_items",
        sessionId: ctx.sessionId,
        ref: "memos"
      },
      ctx
    );
    const b3 = await page3.json();
    expect(b3.items.map((i: { topic: string }) => i.topic)).toEqual(["eee"]);
    expect(b3.nextCursor).toBeNull();
  });

  it("filters by topic substring", async () => {
    const ctx = await setupMemos();
    const res = await handleDebugListCollectionItems(
      makeReq(`${BASE}/memos/items?topic=foo`),
      {
        kind: "debug_list_collection_items",
        sessionId: ctx.sessionId,
        ref: "memos"
      },
      ctx
    );
    const body = await res.json();
    expect(body.items.map((i: { topic: string }) => i.topic).sort()).toEqual([
      "foo-1",
      "foo-2"
    ]);
  });

  it("400s on a malformed cursor", async () => {
    const ctx = await setupMemos();
    const res = await handleDebugListCollectionItems(
      makeReq(`${BASE}/memos/items?cursor=%00not%20base64%21`),
      {
        kind: "debug_list_collection_items",
        sessionId: ctx.sessionId,
        ref: "memos"
      },
      ctx
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("bad_request");
    expect(body.details).toBe("invalid_cursor");
  });

  it("400s on non-numeric limit", async () => {
    const ctx = await setupMemos();
    const res = await handleDebugListCollectionItems(
      makeReq(`${BASE}/memos/items?limit=abc`),
      {
        kind: "debug_list_collection_items",
        sessionId: ctx.sessionId,
        ref: "memos"
      },
      ctx
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
  });

  it("400s on negative limit", async () => {
    const ctx = await setupMemos();
    const res = await handleDebugListCollectionItems(
      makeReq(`${BASE}/memos/items?limit=-1`),
      {
        kind: "debug_list_collection_items",
        sessionId: ctx.sessionId,
        ref: "memos"
      },
      ctx
    );
    expect(res.status).toBe(400);
  });

  it("400s on absurd limit", async () => {
    const ctx = await setupMemos();
    const res = await handleDebugListCollectionItems(
      makeReq(`${BASE}/memos/items?limit=10000`),
      {
        kind: "debug_list_collection_items",
        sessionId: ctx.sessionId,
        ref: "memos"
      },
      ctx
    );
    expect(res.status).toBe(400);
  });

  it("per-item clientView projects only title (drops body and secret)", async () => {
    const ctx = await setupCtx({
      resources: {
        "memos/aaa": { title: "Hello", body: "BODY", secret: "SECRET" }
      }
    });
    const res = await handleDebugListCollectionItems(
      makeReq(`${BASE}/memos/items`),
      {
        kind: "debug_list_collection_items",
        sessionId: ctx.sessionId,
        ref: "memos"
      },
      ctx
    );
    const body = await res.json();
    expect(body.items[0].clientView).toEqual({
      ok: true,
      value: { title: "Hello" }
    });
    // Raw state should still carry the unprojected fields.
    expect(body.items[0].state).toEqual({
      title: "Hello",
      body: "BODY",
      secret: "SECRET"
    });
  });

  it("404s with resource_not_found for an unknown ref", async () => {
    const ctx = await setupMemos();
    const res = await handleDebugListCollectionItems(
      makeReq(`${BASE}/nope/items`),
      {
        kind: "debug_list_collection_items",
        sessionId: ctx.sessionId,
        ref: "nope"
      },
      ctx
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("resource_not_found");
  });

  it("400s with bad_request when ref is a single resource (not_collection)", async () => {
    const ctx = await setupMemos();
    const res = await handleDebugListCollectionItems(
      makeReq(`${BASE}/profile/items`),
      {
        kind: "debug_list_collection_items",
        sessionId: ctx.sessionId,
        ref: "profile"
      },
      ctx
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
  });
});

// ---------------------------------------------------------------------------
// handleDebugGetResourceContent / handleDebugGetCollectionItemContent
// ---------------------------------------------------------------------------

describe("handleDebugGetResourceContent", () => {
  it("returns 200 with the body and a text/plain content-type for a single resource", async () => {
    const ctx = await setupCtx({
      resources: { profile: { name: "Alice" } }
    });
    await ctx.stores.content.set("session", ctx.sessionId, "profile", "hi there");
    const res = await handleDebugGetResourceContent(
      makeReq(`${BASE}/profile/content`),
      {
        kind: "debug_get_resource_content",
        sessionId: ctx.sessionId,
        ref: "profile"
      },
      ctx
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await res.text()).toBe("hi there");
  });

  it("404s with content_not_found when no content exists", async () => {
    const ctx = await setupCtx({
      resources: { profile: { name: "Alice" } }
    });
    const res = await handleDebugGetResourceContent(
      makeReq(`${BASE}/profile/content`),
      {
        kind: "debug_get_resource_content",
        sessionId: ctx.sessionId,
        ref: "profile"
      },
      ctx
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("content_not_found");
  });

  it("404s with resource_not_found for an unknown ref", async () => {
    const ctx = await setupCtx();
    const res = await handleDebugGetResourceContent(
      makeReq(`${BASE}/ghost/content`),
      {
        kind: "debug_get_resource_content",
        sessionId: ctx.sessionId,
        ref: "ghost"
      },
      ctx
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("resource_not_found");
  });

  it("400s with bad_request when ref is a collection (is_collection)", async () => {
    const ctx = await setupCtx({
      resources: { "memos/a": { title: "T", body: "B" } }
    });
    const res = await handleDebugGetResourceContent(
      makeReq(`${BASE}/memos/content`),
      {
        kind: "debug_get_resource_content",
        sessionId: ctx.sessionId,
        ref: "memos"
      },
      ctx
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
  });
});

describe("handleDebugGetCollectionItemContent", () => {
  it("returns 200 with the body for a collection item", async () => {
    const ctx = await setupCtx({
      resources: { "memos/abc": { title: "T", body: "B" } }
    });
    await ctx.stores.content.set(
      "session",
      ctx.sessionId,
      "memos/abc",
      "memo body"
    );
    const res = await handleDebugGetCollectionItemContent(
      makeReq(`${BASE}/memos/items/abc/content`),
      {
        kind: "debug_get_collection_item_content",
        sessionId: ctx.sessionId,
        ref: "memos",
        topic: "abc"
      },
      ctx
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("memo body");
  });

  it("resolves a multi-segment topic via the pattern prefix", async () => {
    const ctx = await setupCtx({
      resources: { "memos/nested/key": { title: "T", body: "B" } }
    });
    await ctx.stores.content.set(
      "session",
      ctx.sessionId,
      "memos/nested/key",
      "deep body"
    );
    const res = await handleDebugGetCollectionItemContent(
      makeReq(`${BASE}/memos/items/nested/key/content`),
      {
        kind: "debug_get_collection_item_content",
        sessionId: ctx.sessionId,
        ref: "memos",
        topic: "nested/key"
      },
      ctx
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("deep body");
  });

  it("404s with content_not_found when the item has no content", async () => {
    const ctx = await setupCtx({
      resources: { "memos/abc": { title: "T", body: "B" } }
    });
    const res = await handleDebugGetCollectionItemContent(
      makeReq(`${BASE}/memos/items/abc/content`),
      {
        kind: "debug_get_collection_item_content",
        sessionId: ctx.sessionId,
        ref: "memos",
        topic: "abc"
      },
      ctx
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("content_not_found");
  });

  it("400s with bad_request when ref is a single resource (not_collection)", async () => {
    const ctx = await setupCtx({
      resources: { profile: { name: "Alice" } }
    });
    const res = await handleDebugGetCollectionItemContent(
      makeReq(`${BASE}/profile/items/anything/content`),
      {
        kind: "debug_get_collection_item_content",
        sessionId: ctx.sessionId,
        ref: "profile",
        topic: "anything"
      },
      ctx
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
  });
});

// ---------------------------------------------------------------------------
// clientView permutations (via tree + items)
// ---------------------------------------------------------------------------

describe("clientView projections", () => {
  it("profile (single, projection): ok with projected value", async () => {
    const ctx = await setupCtx({
      resources: { profile: { name: "Carol" } }
    });
    const res = await handleDebugListResources(
      makeReq(BASE),
      { kind: "debug_list_resources", sessionId: ctx.sessionId },
      ctx
    );
    const body = await res.json();
    const entry = body.resources.find(
      (r: { primaryName: string }) => r.primaryName === "profile"
    );
    expect(entry.clientView).toEqual({ ok: true, value: { name: "Carol" } });
    expect((entry.state as { name: string }).name).toBe("Carol");
  });

  it("metrics (single, no client config): no_client_data", async () => {
    const ctx = await setupCtx({ resources: { metrics: { count: 3 } } });
    const res = await handleDebugListResources(
      makeReq(BASE),
      { kind: "debug_list_resources", sessionId: ctx.sessionId },
      ctx
    );
    const body = await res.json();
    const entry = body.resources.find(
      (r: { primaryName: string }) => r.primaryName === "metrics"
    );
    expect(entry.clientView).toEqual({ ok: false, reason: "no_client_data" });
  });

  it("gated collection (no state.read): per-item clientView is state_read_false", async () => {
    const ctx = await setupCtx({
      resources: { "gated/one": { v: "value" } }
    });
    const res = await handleDebugListCollectionItems(
      makeReq(`${BASE}/gated/items`),
      {
        kind: "debug_list_collection_items",
        sessionId: ctx.sessionId,
        ref: "gated"
      },
      ctx
    );
    const body = await res.json();
    expect(body.items[0].clientView).toEqual({
      ok: false,
      reason: "state_read_false"
    });
  });

  it("crashing single resource: ok=false, reason=threw, error=boom!", async () => {
    const ctx = await setupCtx({
      resources: { crashing: { x: "irrelevant" } }
    });
    const res = await handleDebugListResources(
      makeReq(BASE),
      { kind: "debug_list_resources", sessionId: ctx.sessionId },
      ctx
    );
    const body = await res.json();
    const entry = body.resources.find(
      (r: { primaryName: string }) => r.primaryName === "crashing"
    );
    expect(entry.clientView).toMatchObject({
      ok: false,
      reason: "threw",
      error: "boom!"
    });
  });

  it("computeClientView returns null for absent state", () => {
    const view = computeClientView(profile, null);
    expect(view).toBeNull();
  });
});
