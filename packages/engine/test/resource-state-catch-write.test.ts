/**
 * Durable-row evidence for FIX-1264. Peel / field-level / consecutive-catch
 * cases live on `parseResourceWriteState` in `normalize-resource-state.test.ts`.
 * This file keeps one registry path: the original failure replaced the stored
 * row and reported success, so the unrelated fields and version are the
 * evidence that no write landed.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResource, handler } from "@flow-state-dev/core";
import type { JsonObject } from "@flow-state-dev/core/types";
import {
  createExecutionContext,
  createInMemoryStores,
  type StoreRegistry
} from "../src";
import { ValidationError } from "../src/errors/flow-error";

const row = defineResource({
  scope: "session",
  stateSchema: z
    .object({
      n: z.number().min(0),
      keep: z.string(),
      tag: z.string().optional()
    })
    .catch({ n: 0, keep: "schema-default" }),
  default: { n: 0, keep: "schema-default" },
  writable: true
});

async function makeCtx(stores: StoreRegistry) {
  const flow = defineFlow({
    kind: "fix1264-catch",
    actions: {
      run: {
        inputSchema: z.object({}),
        block: handler({
          name: "noop",
          resources: { row },
          execute: () => ({ ok: true })
        })
      }
    }
  })();
  return createExecutionContext({
    flow,
    actionName: "run",
    requestId: "req_patch",
    sessionId: "sess_1",
    userId: "user_1",
    stores
  });
}

async function seedStored(stores: StoreRegistry, state: JsonObject): Promise<void> {
  await stores.resourceState.set("session", "sess_1", "row", state, "any");
}

describe("catch-wrapped resource writes reject fallback parses", () => {
  it("patchState keeps unrelated fields when `.catch()` would fallback", async () => {
    const stores = createInMemoryStores();
    const initial = { n: 5, keep: "DO-NOT-LOSE", tag: "seed" };
    await seedStored(stores, initial);
    const ctx = await makeCtx(stores);

    await expect((ctx.resources.row as any).patchState({ n: -5 })).rejects.toBeInstanceOf(
      ValidationError
    );

    const persisted = await stores.resourceState.get("session", "sess_1", "row");
    expect(persisted?.state).toEqual(initial);
    expect(persisted?.version).toBe(1);
  });
});
