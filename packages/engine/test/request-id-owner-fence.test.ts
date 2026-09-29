/**
 * A request id reaches only its own principal's record, at the host seam.
 *
 * The HTTP action route hands a caller who reuses another user's request id
 * its own request (see the two-users-one-tenant suite in
 * `@flow-state-dev/integration-tests`). These tests go under that route, to
 * `host.dispatch` itself, which every transport and any race reaches: a
 * dispatch carrying another principal's request id must be refused before it
 * writes, adopts or re-parents that record, on every dispatch path. The
 * record's first owner keeps it exactly as it was, and can still reuse the id.
 */
import { describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver,
  RequestOwnerMismatchError
} from "../src";
import { createInitialRequestRecord } from "../src/context/initial-request-record";
import type { FlowDispatcher } from "../src/transports/dispatcher";
import type { StoreRegistry } from "../src/stores/types";

const FLOW = "owner-fence";
const REQUEST_ID = "req_client_chosen";
const TENANT = "tenant_shared";
const ORG = "org_shared";

const input = z.object({ text: z.string() });
const run = {
  inputSchema: input,
  userMessage: (value: { text: string }) => value.text,
  block: handler({ name: "owner-fence-run", inputSchema: input, execute: () => ({}) })
};

function buildHost(stores: StoreRegistry, dispatcher?: FlowDispatcher) {
  const registry = createFlowRegistry();
  registry.register(
    defineFlow({
      kind: FLOW,
      actions: {
        run,
        runQueued: { ...run, concurrency: { policy: "queue", key: "session" } }
      }
    })({ id: FLOW })
  );
  return createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: {},
    ...(dispatcher === undefined ? {} : { dispatcher })
  });
}

function dispatchAs(
  host: ReturnType<typeof buildHost>,
  userId: string,
  action: "run" | "runQueued",
  text: string
) {
  return host.dispatch({
    source: "http",
    flowKind: FLOW,
    action,
    input: { text },
    sessionId: `s_${userId}`,
    requestId: REQUEST_ID,
    tenantId: TENANT,
    orgId: ORG,
    principal: { userId, orgId: ORG }
  });
}

/** Alice's completed request under the shared id, and a snapshot of it. */
async function aliceCompletes(stores: StoreRegistry) {
  const handle = dispatchAs(buildHost(stores), "alice", "run", "alice's note");
  await handle.finished;
  const record = await stores.request.get(REQUEST_ID);
  expect(record?.status).toBe("completed");
  return record!;
}

/** A queue whose worker never claims the job. */
function externalDispatcher(): FlowDispatcher {
  return {
    dispatch: vi.fn(async (env) => ({
      requestId: env.requestId,
      finished: new Promise<never>(() => {}),
      abort: () => {}
    })),
    close: vi.fn(async () => {})
  };
}

describe("a request id another principal holds, dispatched at the host", () => {
  it.each([
    ["an in-process run", "run"],
    ["a run queued behind its session", "runQueued"]
  ] as const)("is refused on %s, and the owner's record is untouched", async (_label, action) => {
    const stores = createInMemoryStores();
    const before = await aliceCompletes(stores);

    const handle = dispatchAs(buildHost(stores), "bob", action, "bob's note");
    await expect(handle.accepted).rejects.toBeInstanceOf(RequestOwnerMismatchError);
    await handle.finished.catch(() => undefined);

    expect(await stores.request.get(REQUEST_ID)).toEqual(before);
    expect(await stores.activeRequests.get(REQUEST_ID)).toBeUndefined();
  });

  it("is refused on an external queue before the job is enqueued", async () => {
    const stores = createInMemoryStores();
    const before = await aliceCompletes(stores);
    const dispatcher = externalDispatcher();

    const handle = dispatchAs(buildHost(stores, dispatcher), "bob", "run", "bob's note");
    await expect(handle.accepted).rejects.toBeInstanceOf(RequestOwnerMismatchError);

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(await stores.request.get(REQUEST_ID)).toEqual(before);
  });

  it("is refused for the same user in another organization", async () => {
    const stores = createInMemoryStores();
    const before = await aliceCompletes(stores);

    const handle = buildHost(stores).dispatch({
      source: "http",
      flowKind: FLOW,
      action: "runQueued",
      input: { text: "alice, acting for another org" },
      sessionId: "s_alice_other_org",
      requestId: REQUEST_ID,
      tenantId: TENANT,
      orgId: "org_other",
      principal: { userId: "alice", orgId: "org_other" }
    });
    await expect(handle.accepted).rejects.toBeInstanceOf(RequestOwnerMismatchError);
    await handle.finished.catch(() => undefined);
    expect(await stores.request.get(REQUEST_ID)).toEqual(before);
  });

  it.each([
    ["an in-process run", "run"],
    ["a run queued behind its session", "runQueued"]
  ] as const)(
    "is claimed by one of two principals racing on an unused id, on %s",
    async (_label, action) => {
      const stores = createInMemoryStores();
      const host = buildHost(stores);

      const alice = dispatchAs(host, "alice", action, "alice's note");
      const bob = dispatchAs(host, "bob", action, "bob's note");
      const [aliceAck, bobAck] = await Promise.allSettled([alice.accepted, bob.accepted]);

      // Exactly one is acknowledged; the other is refused before its ack.
      const acked = [aliceAck, bobAck].filter((ack) => ack.status === "fulfilled");
      expect(acked).toHaveLength(1);
      const [winner, loser, loserAck] =
        aliceAck.status === "fulfilled"
          ? (["alice", bob, bobAck] as const)
          : (["bob", alice, aliceAck] as const);
      expect(loserAck).toMatchObject({ status: "rejected" });
      expect((loserAck as PromiseRejectedResult).reason).toBeInstanceOf(RequestOwnerMismatchError);
      await loser.finished.catch(() => undefined);

      // The winner's run completes untouched by the loser.
      await (winner === "alice" ? alice : bob).finished;
      const record = await stores.request.get(REQUEST_ID);
      expect(record).toMatchObject({ userId: winner, status: "completed" });
      const loserText = winner === "alice" ? "bob's note" : "alice's note";
      expect(JSON.stringify(record?.items)).not.toContain(loserText);
    }
  );

  it("is never settled failed by a run that finds it held by another principal", async () => {
    const stores = createInMemoryStores();
    // Alice's request is still running, so a terminal status cannot be what
    // keeps the settler off it.
    const alicesRecord = createInitialRequestRecord(
        {
          requestId: REQUEST_ID,
          flowKind: FLOW,
          flowId: FLOW,
          actionName: "run",
          userId: "alice",
          sessionId: "s_alice",
          tenantId: TENANT,
          orgId: ORG,
          input: { text: "alice's note" }
        },
        Date.now()
      );
    // Bob's claim lands, then Alice's record replaces it before his run loads
    // it: the one window the claim cannot close, reached on purpose.
    const realSet = stores.request.set.bind(stores.request);
    let claimed = false;
    const racing: StoreRegistry = {
      ...stores,
      request: Object.assign(Object.create(stores.request), {
        set: async (...args: Parameters<typeof realSet>) => {
          const result = await realSet(...args);
          if (!claimed && args[2] === "absent") {
            claimed = true;
            await realSet(REQUEST_ID, alicesRecord, "any");
          }
          return result;
        }
      })
    };

    const handle = dispatchAs(buildHost(racing), "bob", "run", "bob's note");
    await expect(handle.finished).rejects.toBeInstanceOf(RequestOwnerMismatchError);

    const after = await stores.request.get(REQUEST_ID);
    expect(after).toMatchObject({ userId: "alice", status: "in_progress" });
    expect(JSON.stringify(after?.items ?? [])).not.toContain("bob's note");
  });

  it.each([
    ["an in-process run", "run"],
    ["a run queued behind its session", "runQueued"]
  ] as const)(
    "answers the HTTP caller 409 on %s when the id is taken after the route looked",
    async (_label, action) => {
      const stores = createInMemoryStores();
      const before = await aliceCompletes(stores);
      // The route's own read of the id misses, as it would had Alice's record
      // landed a moment later; every read after it is the real store's.
      const racing: StoreRegistry = {
        ...stores,
        request: Object.assign(Object.create(stores.request), {
          get: vi
            .fn(stores.request.get.bind(stores.request))
            .mockResolvedValueOnce(undefined)
        }),
        activeRequests: Object.assign(Object.create(stores.activeRequests), {
          get: vi
            .fn(stores.activeRequests.get.bind(stores.activeRequests))
            .mockResolvedValueOnce(undefined)
        })
      };
      const registry = createFlowRegistry();
      registry.register(
        defineFlow({
          kind: FLOW,
          actions: { run, runQueued: { ...run, concurrency: { policy: "queue", key: "session" } } }
        })({ id: FLOW })
      );
      const router = createFlowApiRouter({ registry, stores: racing });

      const response = await router.POST(
        new Request(`http://localhost/api/flows/${FLOW}/s_bob/actions/${action}`, {
          method: "POST",
          headers: { "x-tenant-id": TENANT },
          body: JSON.stringify({ userId: "bob", requestId: REQUEST_ID, input: { text: "bob's note" } })
        }),
        { params: { path: [FLOW, "s_bob", "actions", action] } }
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: "request-id-in-use" });
      expect(await stores.request.get(REQUEST_ID)).toEqual(before);
    }
  );

  it.each([
    ["an in-process run", "run"],
    ["a run queued behind its session", "runQueued"]
  ] as const)("is still the owner's to reuse on %s", async (_label, action) => {
    const stores = createInMemoryStores();
    await aliceCompletes(stores);

    const handle = dispatchAs(buildHost(stores), "alice", action, "alice again");
    await expect(handle.accepted).resolves.toBeUndefined();
    await handle.finished;
    expect((await stores.request.get(REQUEST_ID))?.userId).toBe("alice");
  });
});
