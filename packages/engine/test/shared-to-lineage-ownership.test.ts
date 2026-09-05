/**
 * FIX-1068: which DECLARATION owns a storage key decides where that key lives.
 *
 * `sharedToLineage` splits one session scope across two storage addresses,
 * so every read has to agree on which declaration owns a given key. Matching
 * "any shared prefix" is not that rule, and gets two shapes wrong in a way that
 * leaks one session's rows into another:
 *
 * - **A shared collection with an EMPTY prefix.** A parameterized pattern
 *   (`[topic]/observations`) has no static prefix, so "matches a shared prefix"
 *   is true of *every* key in the scope — including a private resource declared
 *   beside it. The child's own rows get discarded and the root's stand in.
 * - **A shared prefix with a private one nested under it.** Shared `tasks/**`
 *   and private `tasks/meta/*` both match `tasks/meta/a`. Only the longer one
 *   owns it, and a bucket scan of the broad prefix at the root pulls in rows the
 *   child owns.
 *
 * The rule both paths resolve is: an exact single wins, then the longest
 * matching collection prefix. These tests pin it on the whole-scope read
 * (`getPersistedData` and the HTTP `/state` route) and on the eager bucket scans
 * that seed a request's cache, for state and content alike.
 *
 * Declaration order is asserted explicitly. The defect these cover produced
 * different answers depending on which collection was declared first, so a fix
 * that is order-sensitive has not resolved anything.
 */
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createExecutionContext, createFlowRegistry, createInMemoryStores } from "../src";
import { getPersistedData } from "../src/resources/internal";
import { handleGetSessionState } from "../src/routes/state-routes";
import {
  handleDeleteCollectionItem,
  handleGetCollectionItemState,
  handleListCollectionState
} from "../src/routes/resource-routes";
import type { FlowInstance } from "@flow-state-dev/core";
import type { SessionRecord, StoreRegistry } from "../src/stores/types";

const noteSchema = z.object({ note: z.string().default("") });

/** Seed a session record the way the dispatch seam mints a child. */
async function seedSession(
  stores: StoreRegistry,
  flow: FlowInstance,
  id: string,
  parent?: string,
  lineage?: string
): Promise<void> {
  const ts = 1_700_000_000_000;
  await stores.session.set(
    id,
    {
      id,
      flowKind: flow.kind,
      userId: "u_1",
      state: {},
      version: 0,
      createdAt: ts,
      updatedAt: ts,
      journal: [],
      ...(parent !== undefined ? { parentSessionId: parent } : {}),
      ...(lineage !== undefined ? { lineageId: lineage } : {})
    } satisfies SessionRecord,
    "any"
  );
}

let requestCounter = 0;
function contextFor(stores: StoreRegistry, flow: FlowInstance, sessionId: string) {
  requestCounter += 1;
  return createExecutionContext({
    flow,
    actionName: "run",
    requestId: `req_own_${requestCounter}`,
    sessionId,
    userId: "u_1",
    stores
  });
}

const noop = handler({ name: "noop", execute: () => "ok" });

describe("FIX-1068: a shared EMPTY-prefix collection must not swallow private keys", () => {
  /**
   * `[topic]/observations` is parameterized, so its storage prefix is empty —
   * it matches every key in the scope. `scratch` is a private single declared
   * beside it and must stay the child's own.
   */
  const observations = defineResourceCollection({
    pattern: "[topic]/observations",
    scope: "session",
    sharedToLineage: true,
    stateSchema: noteSchema
  });
  // `client` so the resource is visible over the wire at all — a single with no
  // client config is invisible to the /state route by design, which would make
  // that assertion pass for the wrong reason.
  const scratch = defineResource({
    scope: "session",
    ref: "scratch",
    stateSchema: noteSchema,
    client: { expose: ["note"] }
  });
  const flow = defineFlow({
    kind: "empty-prefix-flow",
    actions: { run: { inputSchema: z.string(), block: noop } },
    resources: { observations, scratch }
  })();

  async function seeded() {
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(flow);
    await seedSession(stores, flow, "s_root", undefined, "lin_root");
    await seedSession(stores, flow, "s_child", "s_root", "lin_root");

    const root = await contextFor(stores, flow, "s_root");
    await root.resources.scratch.patchState({ note: "root private" });
    const child = await contextFor(stores, flow, "s_child");
    await child.resources.scratch.patchState({ note: "child private" });
    return { stores, registry };
  }

  it("returns the child's own private single from getPersistedData", async () => {
    const { stores, registry } = await seeded();
    const data = await getPersistedData({ registry, stores }, flow, "s_child", "session");
    expect(data?.resources.scratch).toEqual({ note: "child private" });
  });

  it("returns the child's own private single from the /state route", async () => {
    const { stores, registry } = await seeded();
    const res = await handleGetSessionState(
      new Request("http://x/sessions/s_child/state"),
      { kind: "get_session_state", sessionId: "s_child" },
      { registry, stores }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resources?: { session?: Record<string, { clientData?: unknown }> };
    };
    expect(body.resources?.session?.scratch?.clientData).toEqual({ note: "child private" });
  });
});

describe("FIX-1068: a private prefix nested under a shared one owns its keys", () => {
  /**
   * Shared `tasks/**` and private `tasks/meta/*`. `tasks/meta/a` matches both;
   * only the longer prefix owns it. Built as a factory so the same shapes can
   * be declared in either order — the resolver must not care.
   */
  function makeFlow(kind: string, order: "shared-first" | "private-first") {
    const shared = defineResourceCollection({
      pattern: "tasks/**",
      scope: "session",
      sharedToLineage: true,
      stateSchema: noteSchema
    });
    const priv = defineResourceCollection({
      pattern: "tasks/meta/*",
      scope: "session",
      stateSchema: noteSchema
    });
    return defineFlow({
      kind,
      actions: { run: { inputSchema: z.string(), block: noop } },
      resources:
        order === "shared-first" ? { shared, priv } : { priv, shared }
    })();
  }

  /**
   * Put a row at `tasks/meta/a` in BOTH the root's scope and the child's, with
   * different values, then read as the child. The child owns that key, so the
   * child's value is the only correct answer either way round.
   */
  async function seeded(flow: FlowInstance) {
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(flow);
    await seedSession(stores, flow, "s_root", undefined, "lin_root");
    await seedSession(stores, flow, "s_child", "s_root", "lin_root");

    // Written directly so both sessions genuinely hold the same key — the
    // scan is what is under test, not the write routing.
    await stores.resourceState.set("session", "s_root", "tasks/meta/a", { note: "root meta" }, "any");
    await stores.content.set("session", "s_root", "tasks/meta/a", "root body");
    await stores.resourceState.set("session", "s_child", "tasks/meta/a", { note: "child meta" }, "any");
    await stores.content.set("session", "s_child", "tasks/meta/a", "child body");
    return { stores, registry };
  }

  for (const order of ["shared-first", "private-first"] as const) {
    it(`the child's own row wins in the eager bucket scan (state, ${order})`, async () => {
      const flow = makeFlow(`nested-state-${order}`, order);
      const { stores } = await seeded(flow);

      const child = await contextFor(stores, flow, "s_child");
      const instance = await (
        child.resources.priv as unknown as {
          get(key: string): Promise<{ state: { note: string } }>;
        }
      ).get("a");
      expect(instance.state.note).toBe("child meta");
    });

    it(`the child's own row wins in the eager bucket scan (content, ${order})`, async () => {
      const flow = makeFlow(`nested-content-${order}`, order);
      const { stores } = await seeded(flow);

      const child = await contextFor(stores, flow, "s_child");
      const instance = await (
        child.resources.priv as unknown as {
          get(key: string): Promise<{ readContent(): Promise<string | null> }>;
        }
      ).get("a");
      expect(await instance.readContent()).toBe("child body");
    });

    it(`the whole-scope read returns the child's own row (${order})`, async () => {
      const flow = makeFlow(`nested-scope-${order}`, order);
      const { stores, registry } = await seeded(flow);

      const data = await getPersistedData({ registry, stores }, flow, "s_child", "session");
      expect(data?.resources["tasks/meta/a"]).toEqual({ note: "child meta" });
      expect(data?.content["tasks/meta/a"]).toBe("child body");
    });
  }
});


/**
 * The collection CRUD routes address storage themselves, and they picked the
 * bucket from the ADDRESSED COLLECTION'S declaration rather than from the
 * concrete key. A key can be addressed through a broader collection than the one
 * that owns it — `tasks/meta/a` reached through `tasks/**` — so the declaration
 * says "shared" while the longest-prefix rule assigns the key to the child.
 *
 * The same defect as the whole-scope read, one layer out: `get` and `list`
 * exposed the root's row, and `delete` removed it.
 */
describe("FIX-1068: collection routes address the key's owner, not the route's declaration", () => {
  // `expose` so the read routes return a projection rather than the
  // "no client.data configured" hint — otherwise the assertions below could not
  // see WHICH row came back, which is the whole question.
  const grants = {
    content: { read: true, create: true, update: true, delete: true },
    state: { read: true },
    expose: ["note"]
  } as never;

  const shared = defineResourceCollection({
    pattern: "tasks/**",
    scope: "session",
    sharedToLineage: true,
    stateSchema: noteSchema,
    client: grants
  });
  const priv = defineResourceCollection({
    pattern: "tasks/meta/*",
    scope: "session",
    stateSchema: noteSchema,
    client: grants
  });
  const routeFlow = defineFlow({
    kind: "route-ownership-flow",
    actions: { run: { inputSchema: z.string(), block: noop } },
    resources: { shared, priv }
  })();

  async function seeded() {
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(routeFlow);
    await seedSession(stores, routeFlow, "s_root", undefined, "lin_root");
    await seedSession(stores, routeFlow, "s_child", "s_root", "lin_root");

    const lineage = "lin_root";
    // The root's private row sits at the root's own session key, the child's at
    // the child's. Only the child's is the child's to see.
    await stores.resourceState.set("session", "s_root", "tasks/meta/a", { note: "root meta" }, "any");
    await stores.resourceState.set("session", "s_child", "tasks/meta/a", { note: "child meta" }, "any");
    // A genuinely shared row, so the fix has to stay correct rather than just
    // stop reading the root.
    await stores.resourceState.set("lineage", lineage, "tasks/open", { note: "shared row" }, "any");
    return { stores, registry };
  }

  it("get-state on a broad route returns the child's own row", async () => {
    const r = await seeded();
    const res = await handleGetCollectionItemState(
      new Request("http://x/sessions/s_child/resources/shared/state"),
      {
        kind: "get_collection_item_state",
        sessionId: "s_child",
        ref: "shared",
        topic: "tasks/meta/a"
      } as never,
      { registry: r.registry, stores: r.stores }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { storageKey?: string; clientData?: unknown };
    expect(body.storageKey).toBe("tasks/meta/a");
    expect(body.clientData).toEqual({ note: "child meta" });
  });

  it("delete on a broad route removes the child's row and leaves the root's", async () => {
    const r = await seeded();
    const res = await handleDeleteCollectionItem(
      new Request("http://x/sessions/s_child/resources/shared/x", { method: "DELETE" }),
      {
        kind: "delete_collection_item",
        sessionId: "s_child",
        ref: "shared",
        topic: "tasks/meta/a"
      } as never,
      { registry: r.registry, stores: r.stores }
    );
    expect(res.status).toBe(200);
    expect(await r.stores.resourceState.get("session", "s_child", "tasks/meta/a")).toBeUndefined();
    // The root's row is another session's data and must be untouched.
    expect(await r.stores.resourceState.get("session", "s_root", "tasks/meta/a")).toBeDefined();
  });

  it("list returns the lineage-merged view execution reads", async () => {
    const r = await seeded();
    const res = await handleListCollectionState(
      new Request("http://x/sessions/s_child/resources/shared/state"),
      { kind: "list_collection_state", sessionId: "s_child", ref: "shared" } as never,
      { registry: r.registry, stores: r.stores }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ storageKey: string; clientData?: unknown }>;
    };
    const keys = body.items.map((i) => i.storageKey).sort();
    // The shared row from the lineage, and the child's OWN private row — never
    // the root's private one.
    expect(keys).toEqual(["tasks/meta/a", "tasks/open"]);
    expect(body.items.find((i) => i.storageKey === "tasks/meta/a")?.clientData).toEqual({
      note: "child meta"
    });
  });
});


/**
 * A filtered scan is not authoritative coverage for the keys it filtered out.
 *
 * Ownership filtering made the eager scans correct about what they RETURN, and
 * left the bookkeeping claiming what they COVER. A shared `tasks/**` scan reads
 * only the lineage bucket, but recorded `tasks/` as materialized outright — so a
 * later lazy read of `tasks/meta/a`, which the child owns in its own bucket, saw
 * the key under a loaded prefix and returned an authoritative miss without ever
 * querying. A row that exists reads as absent.
 */
describe("FIX-1068: a filtered scan does not cover another bucket's keys", () => {
  const shared = defineResourceCollection({
    pattern: "tasks/**",
    scope: "session",
    sharedToLineage: true,
    stateSchema: noteSchema
  });
  // Lazy, so it is NOT part of the eager wave — its rows are fetched on first
  // access, which is the read the stale coverage suppresses.
  const priv = defineResourceCollection({
    pattern: "tasks/meta/*",
    scope: "session",
    prefetchMode: "lazy",
    stateSchema: noteSchema
  });
  const coverageFlow = defineFlow({
    kind: "coverage-flow",
    actions: { run: { inputSchema: z.string(), block: noop } },
    resources: { shared, priv }
  })();

  it("still finds a lazily-read row the child owns under a shared prefix", async () => {
    const stores = createInMemoryStores();
    await seedSession(stores, coverageFlow, "s_root", undefined, "lin_root");
    await seedSession(stores, coverageFlow, "s_child", "s_root", "lin_root");

    // The child's own row, in the child's own bucket.
    await stores.resourceState.set(
      "session",
      "s_child",
      "tasks/meta/a",
      { note: "child meta" },
      "any"
    );

    const child = await contextFor(stores, coverageFlow, "s_child");
    const instance = await (
      child.resources.priv as unknown as {
        getOptional(key: string): Promise<{ state: { note: string } } | undefined>;
      }
    ).getOptional("a");

    expect(instance).toBeDefined();
    expect(instance?.state.note).toBe("child meta");
  });
});
