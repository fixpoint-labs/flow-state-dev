/**
 * FIX-735: per-resource `flowIsolation` must control the storage key at the
 * resource granularity the API advertises — not collapse to a flow-wide OR.
 *
 * A resource declared `flowIsolation: false` keys at the bare `{userId}`
 * (shared across flows) even when a sibling user-scoped resource on the same
 * flow declares `flowIsolation: true`. The isolated sibling keys at
 * `{userId}:{flowKind}`; the shared resource is not dragged into isolation.
 */
import { defineFlow, defineResource, defineResourceCollection, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createExecutionContext, createFlowRegistry, createInMemoryStores } from "../src";
import type { SessionRecord } from "../src/stores/types";
import { getPersistedData } from "../src/resources/internal";

/**
 * Two user-scoped single resources on one flow: `accounts` is shared
 * (`flowIsolation: false`), `notes` is isolated (`flowIsolation: true`).
 * `ref` is set explicitly so the storage key is stable for cross-flow reads.
 */
function makeMixedFlow(kind: string) {
  const accounts = defineResource({
    scope: "user",
    flowIsolation: false,
    ref: "accounts",
    stateSchema: z.object({ balance: z.number().default(0) }),
  });
  const notes = defineResource({
    scope: "user",
    flowIsolation: true,
    ref: "notes",
    stateSchema: z.object({ text: z.string().default("") }),
  });
  const block = handler({
    name: "noop",
    execute: () => "ok",
  });
  return defineFlow({
    kind,
    actions: { run: { inputSchema: z.string(), block } },
    resources: { accounts, notes },
  })();
}

describe("FIX-735: per-resource flowIsolation", () => {
  it("keys a flowIsolation:false resource at the bare userId when a sibling is isolated", async () => {
    const flow = makeMixedFlow("flow-a");
    const stores = createInMemoryStores();

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_a",
      sessionId: "sess_a",
      userId: "user_1",
      stores,
    });

    await ctx.resources.accounts.patchState({ balance: 100 });
    await ctx.resources.notes.patchState({ text: "private" });

    // Shared resource lives at the bare identity key; isolated one does not.
    const bare = await stores.resourceState.getAll("user", "user_1");
    expect(bare).toHaveProperty("accounts");
    expect(bare).not.toHaveProperty("notes");
    expect((bare.accounts as { balance: number }).balance).toBe(100);

    // Isolated resource lives at the flow-namespaced key; shared one does not.
    const isolated = await stores.resourceState.getAll("user", "user_1:flow-a");
    expect(isolated).toHaveProperty("notes");
    expect(isolated).not.toHaveProperty("accounts");
    expect((isolated.notes as { text: string }).text).toBe("private");
  });

  it("shares a flowIsolation:false resource across flows even when each flow isolates a sibling", async () => {
    const flowA = makeMixedFlow("flow-a");
    const flowB = makeMixedFlow("flow-b");
    const stores = createInMemoryStores();

    const ctxA = await createExecutionContext({
      flow: flowA,
      actionName: "run",
      requestId: "req_a",
      sessionId: "sess_a",
      userId: "user_1",
      stores,
    });
    await ctxA.resources.accounts.patchState({ balance: 250 });

    // A different flow that declares the same shared resource must read it.
    const ctxB = await createExecutionContext({
      flow: flowB,
      actionName: "run",
      requestId: "req_b",
      sessionId: "sess_b",
      userId: "user_1",
      stores,
    });
    expect((ctxB.resources.accounts.state as { balance: number }).balance).toBe(250);
  });

  it("routes content writes per-resource by isolation bucket", async () => {
    const readme = defineResource({
      scope: "user",
      flowIsolation: false,
      ref: "readme",
      stateSchema: z.object({}),
      client: { content: { read: true, update: true } },
    });
    const secret = defineResource({
      scope: "user",
      flowIsolation: true,
      ref: "secret",
      stateSchema: z.object({}),
      client: { content: { read: true, update: true } },
    });
    const flow = defineFlow({
      kind: "flow-content",
      actions: { run: { inputSchema: z.string(), block: handler({ name: "noop", execute: () => "ok" }) } },
      resources: { readme, secret },
    })();
    const stores = createInMemoryStores();

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_c",
      sessionId: "sess_c",
      userId: "user_1",
      stores,
    });
    await ctx.resources.readme.writeContent("shared body");
    await ctx.resources.secret.writeContent("private body");

    const bare = await stores.content.getAll("user", "user_1");
    expect(bare.readme).toBe("shared body");
    expect(bare).not.toHaveProperty("secret");

    const isolated = await stores.content.getAll("user", "user_1:flow-content");
    expect(isolated.secret).toBe("private body");
    expect(isolated).not.toHaveProperty("readme");
  });

  it("keys collection instances per-resource by isolation bucket", async () => {
    const shared = defineResourceCollection({
      pattern: "shared/*",
      scope: "user",
      flowIsolation: false,
      stateSchema: z.object({ n: z.number().default(0) }),
    });
    const isolatedColl = defineResourceCollection({
      pattern: "iso/*",
      scope: "user",
      flowIsolation: true,
      stateSchema: z.object({ n: z.number().default(0) }),
    });
    const flow = defineFlow({
      kind: "flow-coll",
      actions: { run: { inputSchema: z.string(), block: handler({ name: "noop", execute: () => "ok" }) } },
      resources: { shared, isolatedColl },
    })();
    const stores = createInMemoryStores();

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_d",
      sessionId: "sess_d",
      userId: "user_1",
      stores,
    });
    const sharedColl = ctx.resources.shared as unknown as {
      create(key: string, init: { n: number }): Promise<unknown>;
    };
    const isoColl = ctx.resources.isolatedColl as unknown as {
      create(key: string, init: { n: number }): Promise<unknown>;
    };
    await sharedColl.create("a", { n: 1 });
    await isoColl.create("b", { n: 2 });

    const bare = await stores.resourceState.getByPrefix("user", "user_1", "shared/");
    expect(Object.keys(bare)).toContain("shared/a");
    const bareIso = await stores.resourceState.getByPrefix("user", "user_1", "iso/");
    expect(Object.keys(bareIso)).toHaveLength(0);

    const isolated = await stores.resourceState.getByPrefix("user", "user_1:flow-coll", "iso/");
    expect(Object.keys(isolated)).toContain("iso/b");
  });

  it("reads shared user resources without requiring a scope record", async () => {
    // FIX-735 review: the HTTP read path must not gate resource reads on the
    // scope record. A shared resource lives at the bare `{userId}`, which can
    // differ from the (flow-flag) scope-record key — gating would hide it.
    const flow = makeMixedFlow("flow-a");
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(flow);

    // Shared resource present at the bare userId, but NO user scope record.
    await stores.resourceState.set("user", "user_1", "accounts", { balance: 42 });
    const session: SessionRecord = {
      id: "sess_a",
      flowKind: "flow-a",
      userId: "user_1",
      state: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await stores.session.set("sess_a", session, "any");
    expect(await stores.user.get("user_1")).toBeUndefined();

    const data = await getPersistedData({ registry, stores }, flow, "sess_a", "user");
    expect(data?.resources.accounts).toEqual({ balance: 42 });
  });

  it("routes nested collection prefixes to the longest-matching bucket", async () => {
    // FIX-735 review: `a/b/1` belongs to `a/b/*`, not the first-declared `a/*`.
    const shallow = defineResourceCollection({
      pattern: "a/*",
      scope: "user",
      flowIsolation: false,
      stateSchema: z.object({ n: z.number().default(0) })
    });
    const deep = defineResourceCollection({
      pattern: "a/b/*",
      scope: "user",
      flowIsolation: true,
      stateSchema: z.object({ n: z.number().default(0) })
    });
    const flow = defineFlow({
      kind: "flow-nested",
      actions: { run: { inputSchema: z.string(), block: handler({ name: "noop", execute: () => "ok" }) } },
      // `shallow` declared first, so a first-match resolver would mis-route `a/b/*`.
      resources: { shallow, deep }
    })();
    const stores = createInMemoryStores();

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_e",
      sessionId: "sess_e",
      userId: "user_1",
      stores
    });
    const deepColl = ctx.resources.deep as unknown as {
      create(key: string, init: { n: number }): Promise<unknown>;
    };
    const shallowColl = ctx.resources.shallow as unknown as {
      create(key: string, init: { n: number }): Promise<unknown>;
    };
    await deepColl.create("1", { n: 1 });
    await shallowColl.create("2", { n: 2 });

    // The deep instance lands in the isolated bucket, not the shallow shared one.
    const isolated = await stores.resourceState.getByPrefix("user", "user_1:flow-nested", "a/b/");
    expect(Object.keys(isolated)).toContain("a/b/1");
    // The shallow shared instance stays at the bare id, and the deep one is not there.
    const bare = await stores.resourceState.getByPrefix("user", "user_1", "a/");
    expect(Object.keys(bare)).toContain("a/2");
    expect(Object.keys(bare)).not.toContain("a/b/1");
  });
});
