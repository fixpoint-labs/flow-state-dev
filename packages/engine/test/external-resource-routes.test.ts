/**
 * Route-level tests for FIX-858 external collections: the client read paths
 * (snapshot anchor, item-state, content) resolve through the app-supplied
 * `read` hook, and every write route is closed.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineExternalResourceCollection, defineFlow, handler } from "@flow-state-dev/core";
import { parseResourceTemplate } from "@flow-state-dev/core/resource-template";
import { createInMemoryStores, createFlowRegistry } from "../src";
import type { StoreRegistry, SessionRecord } from "../src/stores/types";
import type { FlowRegistry } from "../src/registry/flow-registry";
import {
  handleGetCollectionItemState,
  handleGetCollectionItemContent,
  handleCreateCollectionItem,
  handleListCollectionState,
} from "../src/routes/resource-routes";
import { handleGetSessionState } from "../src/routes/state-routes";
import { buildResourceSnapshot, createScopeResources } from "../src/routes/route-utils";
import type { ExternalResourceContext } from "@flow-state-dev/core/types";

const positionSchema = z.object({ ticker: z.string(), shares: z.number() });

// The app's source of truth — never copied into FSD storage.
const APP_STORE: Record<string, { ticker: string; shares: number }> = {
  AAPL: { ticker: "AAPL", shares: 10 },
  MSFT: { ticker: "MSFT", shares: 5 },
};

function buildPositions(read = async ({ key }: { key: string }) => APP_STORE[key] ?? null) {
  return defineExternalResourceCollection({
    pattern: "positions/*",
    scope: "user",
    stateSchema: positionSchema,
    read,
    search: async () => ({ hits: [] }),
    contentTemplate: parseResourceTemplate(`<system>{{ state.ticker }}: {{ state.shares }}</system>`),
    client: { content: { read: true }, state: { read: true } },
  });
}

function buildFlow(coll: ReturnType<typeof buildPositions>) {
  const block = handler({ name: "noop", resources: { portfolio: coll }, execute: () => "ok" });
  return defineFlow({
    kind: "ext-flow",
    actions: { run: { inputSchema: z.string(), block } },
  })();
}

async function setupCtx(coll = buildPositions()): Promise<{
  registry: FlowRegistry;
  stores: StoreRegistry;
  sessionId: string;
}> {
  const stores = createInMemoryStores();
  const flow = buildFlow(coll);
  const registry = createFlowRegistry();
  registry.register(flow);
  const sessionId = "sess_1";
  const session: SessionRecord = {
    id: sessionId,
    flowKind: "ext-flow",
    userId: "user_1",
    state: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    journal: [],
  };
  await stores.session.set(sessionId, session, "any");
  return { registry, stores, sessionId };
}

function makeReq(url: string, method = "GET"): Request {
  return new Request(url, { method });
}

describe("external collection — item-state route", () => {
  it("projects hook state (not store defaults)", async () => {
    const ctx = await setupCtx();
    const res = await handleGetCollectionItemState(
      makeReq("http://x/sessions/sess_1/resources/portfolio/AAPL"),
      { kind: "get_collection_item_state", sessionId: ctx.sessionId, ref: "portfolio", topic: "AAPL" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.storageKey).toBe("positions/AAPL");
    // expose is absent → identity projection of the full read-through record.
    expect(body.clientData).toEqual({ ticker: "AAPL", shares: 10 });
  });

  it("returns 200 + null when the app has no such record", async () => {
    const ctx = await setupCtx();
    const res = await handleGetCollectionItemState(
      makeReq("http://x/sessions/sess_1/resources/portfolio/NONE"),
      { kind: "get_collection_item_state", sessionId: ctx.sessionId, ref: "portfolio", topic: "NONE" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("hands read a trusted server-derived context", async () => {
    const read = vi.fn(async ({ key }: { key: string }) => APP_STORE[key] ?? null);
    const ctx = await setupCtx(buildPositions(read));
    await handleGetCollectionItemState(
      makeReq("http://x/sessions/sess_1/resources/portfolio/AAPL"),
      { kind: "get_collection_item_state", sessionId: ctx.sessionId, ref: "portfolio", topic: "AAPL" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(read).toHaveBeenCalledWith({
      key: "AAPL",
      ctx: expect.objectContaining({ userId: "user_1", scope: "user", flowKind: "ext-flow" }),
    });
  });
});

describe("external collection — content route", () => {
  it("renders content from the template against the read-through state", async () => {
    const ctx = await setupCtx();
    const res = await handleGetCollectionItemContent(
      makeReq("http://x/sessions/sess_1/resources/portfolio/AAPL/content"),
      { kind: "get_collection_item_content", sessionId: ctx.sessionId, ref: "portfolio", topic: "AAPL" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("AAPL: 10");
  });
});

describe("external collection — snapshot anchor", () => {
  it("emits a serializable empty anchor (prefetched: [], no false count) classifiable as a collection", async () => {
    const snapshot = await buildResourceSnapshot({
      configs: { portfolio: buildPositions() as unknown as Record<string, unknown> },
      persisted: {},
    });
    expect(snapshot).toBeDefined();
    // `prefetched: []` survives JSON.stringify (unlike `count: undefined` → `{}`),
    // so the client classifies it as a collection, not a single resource. No
    // `count` key → honest unknown cardinality (never a false 0).
    expect(snapshot!.portfolio).toEqual({ prefetched: [] });
    expect("count" in (snapshot!.portfolio as object)).toBe(false);
  });

  it("appears in the /state snapshot with no enumerated instances", async () => {
    const ctx = await setupCtx();
    const res = await handleGetSessionState(
      makeReq("http://x/sessions/sess_1/state"),
      { kind: "get_session_state", sessionId: ctx.sessionId },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // The external collection surfaces (empty anchor) under its scope, without
    // enumerating rows — and stays classifiable as a collection over the wire.
    expect(body.resources?.user?.portfolio).toEqual({ prefetched: [] });
  });
});

describe("external collection — list route", () => {
  it("returns 501 (not a false empty page) since list pushdown is a follow-up", async () => {
    const ctx = await setupCtx();
    const res = await handleListCollectionState(
      makeReq("http://x/sessions/sess_1/resources/portfolio"),
      { kind: "list_collection_state", sessionId: ctx.sessionId, ref: "portfolio" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(501);
    expect((await res.json()).error).toMatch(/not supported yet/i);
  });
});

describe("external collection — scope clientData handle (createScopeResources)", () => {
  const ctx: ExternalResourceContext = {
    scope: "user",
    scopeId: "user_1",
    userId: "user_1",
    flowKind: "ext-flow",
  };

  it("renders content from the collection's template (shared ref builder — no drift)", async () => {
    const handles = createScopeResources({
      scope: "user",
      configs: { portfolio: buildPositions() as unknown as Record<string, unknown> },
      persisted: {},
      externalContext: ctx,
    });
    const portfolio = handles.portfolio as unknown as {
      get(k: string): Promise<{ readContent(): Promise<string | null> }>;
      getOptional(k: string): Promise<unknown>;
      list(): Promise<unknown>;
      count(): Promise<unknown>;
    };
    const ref = await portfolio.get("AAPL");
    // The registry ref renders the template; this scope handle must too.
    expect(await ref.readContent()).toBe("AAPL: 10");
    expect(await portfolio.getOptional("NONE")).toBeUndefined();
  });

  it("throws on list()/count() rather than lying with []/0", async () => {
    const handles = createScopeResources({
      scope: "user",
      configs: { portfolio: buildPositions() as unknown as Record<string, unknown> },
      persisted: {},
      externalContext: ctx,
    });
    const portfolio = handles.portfolio as unknown as {
      list(): Promise<unknown>;
      count(): Promise<unknown>;
    };
    await expect(portfolio.list()).rejects.toThrow(/not supported/i);
    await expect(portfolio.count()).rejects.toThrow(/not supported/i);
  });
});

describe("external collection — org read without org binding", () => {
  it("returns 200 + null (never queries an unscoped org bucket) for a session with no org", async () => {
    const read = vi.fn(async ({ key }: { key: string }) => APP_STORE[key] ?? null);
    // An org-scoped external collection...
    const orgColl = defineExternalResourceCollection({
      pattern: "positions/*",
      scope: "org",
      stateSchema: positionSchema,
      read,
      search: async () => ({ hits: [] }),
      client: { state: { read: true } },
    });
    const stores = createInMemoryStores();
    const block = handler({ name: "noop", resources: { portfolio: orgColl }, execute: () => "ok" });
    const flow = defineFlow({
      kind: "ext-flow",
      actions: { run: { inputSchema: z.string(), block } },
    })();
    const registry = createFlowRegistry();
    registry.register(flow);
    // ...read for a session with NO orgId.
    await stores.session.set(
      "sess_1",
      {
        id: "sess_1",
        flowKind: "ext-flow",
        userId: "user_1",
        state: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
        journal: [],
      },
      "any"
    );
    const res = await handleGetCollectionItemState(
      makeReq("http://x/sessions/sess_1/resources/portfolio/AAPL"),
      { kind: "get_collection_item_state", sessionId: "sess_1", ref: "portfolio", topic: "AAPL" },
      { registry, stores }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});

describe("external collection — write routes closed", () => {
  it("rejects a client create with a read-only error", async () => {
    const ctx = await setupCtx();
    const res = await handleCreateCollectionItem(
      makeReq("http://x/sessions/sess_1/resources/portfolio", "POST"),
      { kind: "create_collection_item", sessionId: ctx.sessionId, ref: "portfolio" },
      { registry: ctx.registry, stores: ctx.stores }
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/read-only external collection/i);
  });
});
