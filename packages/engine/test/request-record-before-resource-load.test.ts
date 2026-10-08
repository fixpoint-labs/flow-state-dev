/**
 * An execution context must never hold a resource version that no durable
 * request record accounts for. Request-record presence is what a liveness
 * check reads to decide whether any run may still depend on a version it
 * loaded; if the context loads resource state first and persists its
 * `in_progress` record second, there is a window where a live run holds a
 * version and the store says no run exists.
 *
 * These drive the real path — `createExecutionContext` over
 * `createInMemoryStores` with no host stub in front, which is how the default
 * concurrency mode, `fsdev run` and BullMQ cron reach it — and observe the
 * request store at the moment of every resource-state read.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DEFAULT_ORG_ID,
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import {
  createExecutionContext,
  createInMemoryStores,
  RequestOwnerMismatchError,
  type StoreRegistry
} from "../src";

const REQUEST_ID = "req_liveness";

const sessionNote = defineResource({
  scope: "session",
  stateSchema: z.object({ n: z.number() }),
  writable: true
});
const sessionItems = defineResourceCollection({
  scope: "session",
  pattern: "items/*",
  stateSchema: z.object({ n: z.number() })
} as never);
const userPrefs = defineResource({
  scope: "user",
  stateSchema: z.object({ theme: z.string() }),
  writable: true
});

function makeFlow() {
  return defineFlow({
    kind: "liveness-order",
    resources: { sessionNote, sessionItems, userPrefs },
    actions: {
      run: {
        inputSchema: z.string(),
        block: handler({ name: "noop", execute: () => "ok" })
      }
    }
  })();
}

/**
 * Wrap every resource-state READ so that, before it reaches the store, it
 * records what the request store holds for `REQUEST_ID` right then.
 */
function observeReads(stores: StoreRegistry): Array<{ method: string; status: string | undefined }> {
  const seen: Array<{ method: string; status: string | undefined }> = [];
  const target = stores.resourceState as unknown as Record<string, unknown>;
  for (const method of ["get", "getByPrefix", "getMany"]) {
    const original = target[method];
    if (typeof original !== "function") continue;
    target[method] = async (...args: unknown[]) => {
      const record = await stores.request.get(REQUEST_ID);
      seen.push({ method, status: record?.status });
      return (original as (...a: unknown[]) => unknown).apply(stores.resourceState, args);
    };
  }
  return seen;
}

function makeCtx(stores: StoreRegistry, userId = "user_1", sessionId = "sess_1") {
  return createExecutionContext({
    orgId: DEFAULT_ORG_ID,
    flow: makeFlow(),
    actionName: "run",
    requestId: REQUEST_ID,
    sessionId,
    userId,
    stores
  });
}

describe("request record persists before resource state is read", () => {
  it("every eager resource-state read sees this run's in_progress record", async () => {
    const stores = createInMemoryStores();
    const seen = observeReads(stores);

    const ctx = await makeCtx(stores);

    // The check must reach the loads it guards: session single, session
    // collection and user scope all read at context creation.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.map((s) => s.method)).toContain("getByPrefix");
    // Not one read happened while the store held no record for this run.
    expect(seen.filter((s) => s.status === undefined)).toEqual([]);
    expect(seen.every((s) => s.status === "in_progress")).toBe(true);
    // And it is the record the context runs as.
    expect(ctx.request.incarnation).toBeDefined();
    expect((await stores.request.get(REQUEST_ID))?.incarnation).toBe(ctx.request.incarnation);
  });

  it("a run that loses the id to another principal is refused before reading any resource state", async () => {
    const stores = createInMemoryStores();
    // Another user's run takes the id after this run's admission read saw it
    // free: the admission read is made to miss, the claim then conflicts.
    await makeCtx(stores, "user_other", "sess_other");
    const realGet = stores.request.get.bind(stores.request);
    let first = true;
    stores.request.get = (async (id: string) => {
      if (first && id === REQUEST_ID) {
        first = false;
        return undefined;
      }
      return realGet(id);
    }) as typeof stores.request.get;
    const seen = observeReads(stores);

    await expect(makeCtx(stores)).rejects.toBeInstanceOf(RequestOwnerMismatchError);
    // The refused run never held a resource version.
    expect(seen).toEqual([]);
  });
});
