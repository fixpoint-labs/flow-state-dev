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
import { buildResourceSnapshot } from "../src/routes/route-utils";

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
  it("emits an empty anchor with undefined count (no enumeration)", async () => {
    const snapshot = await buildResourceSnapshot({
      configs: { portfolio: buildPositions() as unknown as Record<string, unknown> },
      persisted: {},
    });
    expect(snapshot).toBeDefined();
    expect(snapshot!.portfolio).toEqual({});
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
    // enumerating rows.
    expect(body.resources?.user?.portfolio).toEqual({});
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
