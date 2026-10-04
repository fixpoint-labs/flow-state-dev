/**
 * A resource whose `stateSchema` parses a non-null write to `null` must refuse
 * that write, on every path that reaches the store. The unit cases live on
 * `parseResourceWriteState` in `normalize-resource-state.test.ts`; these drive
 * the real paths — `createExecutionContext` over `createInMemoryStores`, and
 * the client create route — because the defect was a write that reported
 * success. So the assertions are on the stored row, not only on the error.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import {
  createExecutionContext,
  createFlowRegistry,
  createInMemoryStores,
  type StoreRegistry
} from "../src";
import { ValidationError } from "../src/errors/flow-error";
import { handleCreateCollectionItem } from "../src/routes/resource-routes";
import type { SessionRecord } from "../src/stores/types";

/** `{}` (no `phase`) parses to `null`; `{ phase: 1 }` parses to an object. */
const phaseless = z
  .object({ phase: z.number().optional(), tag: z.string().optional() })
  .transform((value) => (value.phase === undefined ? null : value));

const single = defineResource({
  scope: "session",
  stateSchema: phaseless,
  writable: true
});

const items = defineResourceCollection({
  scope: "session",
  pattern: "items/*",
  stateSchema: phaseless,
  client: { content: { read: true, create: true }, state: { read: true } }
} as never);

function makeFlow() {
  return defineFlow({
    kind: "null-collapse",
    actions: {
      run: {
        inputSchema: z.string(),
        block: handler({ name: "noop", resources: { single, items }, execute: () => "ok" })
      }
    }
  })();
}

async function makeCtx(stores: StoreRegistry) {
  return createExecutionContext({
    orgId: DEFAULT_ORG_ID,
    flow: makeFlow(),
    actionName: "run",
    requestId: "req_1",
    sessionId: "sess_1",
    userId: "user_1",
    stores
  });
}

function stored(stores: StoreRegistry, key: string) {
  return stores.resourceState.get("session", "sess_1", key);
}

describe("a write the state schema parses to null", () => {
  it("single setState is refused, and no row is written", async () => {
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores);

    await expect((ctx.resources.single as any).setState({ tag: "hello" })).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(await stored(stores, "single")).toBeUndefined();
  });

  it("single setState still lands when the schema yields an object", async () => {
    // The control: the refusal is about the null result, not this schema.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores);

    await (ctx.resources.single as any).setState({ phase: 1, tag: "hello" });
    expect((await stored(stores, "single"))?.state).toEqual({ phase: 1, tag: "hello" });
  });

  it("collection-instance patchState is refused, and the row is untouched", async () => {
    const stores = createInMemoryStores();
    // The cleared form such a row ends up in — the shape the original report measured.
    await stores.resourceState.set("session", "sess_1", "items/a", {}, "any");
    const ctx = await makeCtx(stores);
    const instance = await (ctx.resources.items as any).get("a");

    // `{ tag: "x" }` has no `phase`, so it parses to null — previously acknowledged
    // and stored as `{}`, i.e. the write was gone.
    await expect(instance.patchState({ tag: "x" })).rejects.toBeInstanceOf(
      ValidationError
    );
    const row = await stored(stores, "items/a");
    expect(row?.state).toEqual({});
    expect(row?.version).toBe(1);
  });

  it("collection create with a seed that parses to null is refused", async () => {
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores);

    await expect((ctx.resources.items as any).create("a", { tag: "x" })).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(await stored(stores, "items/a")).toBeUndefined();
  });

  it("the client create route answers 400 and mints no row", async () => {
    const registry = createFlowRegistry();
    registry.register(makeFlow());
    const stores = createInMemoryStores();
    const session: SessionRecord = {
      orgId: DEFAULT_ORG_ID,
      id: "sess_1",
      flowKind: "null-collapse",
      userId: "user_1",
      state: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      journal: []
    };
    await stores.session.set("sess_1", session, "any");

    const response = await handleCreateCollectionItem(
      new Request("http://x/sessions/sess_1/resources/items", {
        method: "POST",
        body: JSON.stringify({ topic: "a" })
      }),
      { kind: "create_collection_item", sessionId: "sess_1", ref: "items" },
      { registry, stores }
    );

    // Previously 201 with a stored `{}` that no later write could land on.
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("items/a");
    expect(await stored(stores, "items/a")).toBeUndefined();
  });
});
