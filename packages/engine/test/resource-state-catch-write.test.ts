/**
 * FIX-1264 — a resource write must not treat a top-level `.catch()` fallback
 * as a successful candidate validation.
 *
 * These tests use the real `createExecutionContext` resource path and assert
 * the durable row, not just the ref's cached state. The bug replaced stored
 * rows with the schema fallback and reported success, so the unrelated fields
 * and version are the evidence that no write landed.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import type { JsonObject } from "@flow-state-dev/core/types";
import {
  createExecutionContext,
  createInMemoryStores,
  type StoreRegistry
} from "../src";
import { ValidationError } from "../src/errors/flow-error";

const catchWrappedSchema = z
  .object({
    n: z.number().min(0),
    keep: z.string(),
    tag: z.string().optional()
  })
  .catch({ n: 0, keep: "schema-default" });

const consecutiveCatchWrappedSchema = z
  .object({
    n: z.number().min(0),
    keep: z.string(),
    tag: z.string().optional()
  })
  .catch({ n: 0, keep: "inner-default" })
  .catch({ n: 0, keep: "outer-default" });

const row = defineResource({
  scope: "session",
  stateSchema: catchWrappedSchema,
  default: { n: 0, keep: "schema-default" },
  writable: true
});

const nestedRow = defineResource({
  scope: "session",
  stateSchema: consecutiveCatchWrappedSchema,
  default: { n: 0, keep: "outer-default" },
  writable: true
});

const rows = defineResourceCollection({
  scope: "session",
  pattern: "rows/**",
  stateSchema: catchWrappedSchema
});

function makeFlow() {
  return defineFlow({
    kind: "fix1264-catch",
    actions: {
      run: {
        inputSchema: z.object({}),
        block: handler({
          name: "noop",
          resources: { row, nestedRow, rows },
          execute: () => ({ ok: true })
        })
      }
    }
  })();
}

async function makeCtx(stores: StoreRegistry, requestId: string) {
  return createExecutionContext({
    flow: makeFlow(),
    actionName: "run",
    requestId,
    sessionId: "sess_1",
    userId: "user_1",
    stores
  });
}

async function seedStored(
  stores: StoreRegistry,
  key: string,
  state: JsonObject
): Promise<void> {
  await stores.resourceState.set("session", "sess_1", key, state, "any");
}

describe("FIX-1264: catch-wrapped resource writes reject fallback parses", () => {
  it("single resource patchState keeps unrelated fields when `.catch()` would fallback", async () => {
    const stores = createInMemoryStores();
    const initial = { n: 5, keep: "DO-NOT-LOSE", tag: "seed" };
    await seedStored(stores, "row", initial);
    const ctx = await makeCtx(stores, "req_patch");

    await expect((ctx.resources.row as any).patchState({ n: -5 })).rejects.toBeInstanceOf(
      ValidationError
    );

    const persisted = await stores.resourceState.get("session", "sess_1", "row");
    expect(persisted?.state).toEqual(initial);
    expect(persisted?.version).toBe(1);
  });

  it("single resource patchState rejects consecutive top-level `.catch()` fallbacks", async () => {
    const stores = createInMemoryStores();
    const initial = { n: 5, keep: "DO-NOT-LOSE", tag: "seed" };
    await seedStored(stores, "nestedRow", initial);
    const ctx = await makeCtx(stores, "req_nested_patch");

    await expect(
      (ctx.resources.nestedRow as any).patchState({ n: -5 })
    ).rejects.toBeInstanceOf(ValidationError);

    const persisted = await stores.resourceState.get("session", "sess_1", "nestedRow");
    expect(persisted?.state).toEqual(initial);
    expect(persisted?.version).toBe(1);
  });

  it("collection delta writes keep unrelated fields when `.catch()` would fallback", async () => {
    const stores = createInMemoryStores();
    const initial = { n: 5, keep: "DO-NOT-LOSE", tag: "seed" };
    await seedStored(stores, "rows/one", initial);
    const ctx = await makeCtx(stores, "req_inc");
    const instance = await (ctx.resources.rows as any).get("one");

    await expect(instance.incState({ n: -10 })).rejects.toBeInstanceOf(ValidationError);

    const persisted = await stores.resourceState.get("session", "sess_1", "rows/one");
    expect(persisted?.state).toEqual(initial);
    expect(persisted?.version).toBe(1);
  });
});
