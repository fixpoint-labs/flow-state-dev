/**
 * FIX-1068: which DECLARATION owns a storage key decides where that key lives.
 *
 * `sharedToWorkstream` splits one session scope across two storage addresses,
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
import type { FlowInstance } from "@flow-state-dev/core";
import type { SessionRecord, StoreRegistry } from "../src/stores/types";

const noteSchema = z.object({ note: z.string().default("") });

/** Seed a session record the detached-start writer's way. */
async function seedSession(
  stores: StoreRegistry,
  flow: FlowInstance,
  id: string,
  parent?: string,
  root?: string
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
      ...(root !== undefined ? { lineageRootSessionId: root } : {})
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
    sharedToWorkstream: true,
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
    await seedSession(stores, flow, "s_root");
    await seedSession(stores, flow, "s_child", "s_root", "s_root");

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
      sharedToWorkstream: true,
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
    await seedSession(stores, flow, "s_root");
    await seedSession(stores, flow, "s_child", "s_root", "s_root");

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
