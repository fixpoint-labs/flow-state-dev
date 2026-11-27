/**
 * A webhook delivery's origin, carried onto every run it fires.
 *
 * Why these matter: a webhook turn reads text a stranger wrote, and the fence
 * that keeps such a turn out of other sessions keys on this mark. A service
 * delivery reaches its worker through runs dispatched as `internal` (the
 * routing, then each owner run), so the `webhook` source alone never reaches
 * the worker. If the mark is dropped on the way, the fence fences nothing; if a
 * caller can write it, it is not a mark the server set.
 *
 * The check reads each run's stored request record through the one reader the
 * running context uses, which is what the run itself sees.
 *
 * `internal` and `task` are not reserved sources (an app's own code runs an
 * internal entry through `runAction`), so the mark is honoured only on runs the
 * engine started: the public `runAction` and an adapter's `host.dispatch` drop
 * it, and the engine's own dispatches keep it.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowState, inMemoryStores, resolveUserStorageKey, runAction } from "../../src";
import { dispatchInternalAs } from "../../src/durability/dispatch-internal";
import { fireOwnerRunThrough } from "../../src/durability/owner-runs";
import { readDeliveryOrigin } from "../../src/execution/delivery-origin";
import { routeServiceEvent } from "../../src/internal";
import { type InboundTransportHost } from "../../src/host";

const ORG = "acme";

const deliver = handler({
  name: "deliver",
  inputSchema: z.object({ note: z.string() }),
  outputSchema: z.object({ note: z.string() }),
  execute: async (input) => ({ note: input.note })
});

const route = handler({
  name: "route",
  inputSchema: z.object({ runs: z.array(z.any()) }),
  outputSchema: z.object({ ownerRuns: z.array(z.any()) }),
  execute: async (input) => ({ ownerRuns: input.runs })
});

/** Requests the `work` entry ran, so a test can find a child the seam started. */
const worked: string[] = [];

const work = handler({
  name: "work",
  inputSchema: z.object({ note: z.string() }),
  outputSchema: z.object({}),
  execute: async (_input, ctx) => {
    worked.push(ctx.request.identity.id);
    return {};
  }
});

/** An internal entry that dispatches on: the hop a marked run's own dispatch takes. */
const relay = dispatcher({
  name: "relay",
  type: "internal",
  action: "work",
  inputSchema: z.object({ note: z.string() }),
  session: { key: () => "relayed" },
  payload: (input) => ({ note: input.note })
});

const svc = defineFlow({
  kind: "svc",
  actions: { ask: deliver },
  internal: { actions: { deliver, route, relay: { block: relay }, work: { block: work } } }
})();

async function boot() {
  let host: InboundTransportHost | undefined;
  const stores = inMemoryStores();
  const state = createFlowState({
    flows: [svc],
    stores: { default: { primary: stores } },
    resolvePrincipal: () => null,
    adapters: [{ source: "test", createBindings: (h: InboundTransportHost) => ((host = h), {}) }]
  } as never);
  await state.getRouter();
  const write = (userId: string, key: string, entry: Record<string, unknown>) =>
    host!.stores.resourceState.set("user", resolveUserStorageKey(userId, ORG, { id: "svc", isolateUserState: false }), key, entry as never, "any");
  /** The origin the run with `requestId` reads, from its stored record. */
  const originOf = async (requestId: string) => {
    const record = await host!.stores.request.get(requestId);
    expect(record).toBeDefined();
    return readDeliveryOrigin(record!.source, record!.metadata);
  };
  return { host: host!, write, originOf, dispose: () => state.dispose() };
}

/** Poll until `predicate` holds: a dispatched child runs unawaited. */
async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for the dispatched run");
}

const run = (userId: string, key: string) => ({
  flowKind: "svc",
  entry: "deliver",
  input: { note: "hi" },
  owner: { userId, orgId: ORG },
  rowKey: key
});

describe("a webhook delivery's origin", () => {
  it("rides the routing and every owner run a webhook-delivered event fires", async () => {
    const { host, write, originOf, dispose } = await boot();
    try {
      await write("alice", "subs/a", { orgId: ORG, enabled: true });
      await write("bob", "subs/b", { orgId: ORG, enabled: true });
      const routed = await routeServiceEvent(
        host,
        { flowKind: "svc", entry: "route", principal: { userId: "service:github", orgId: ORG }, input: { runs: [run("alice", "subs/a"), run("bob", "subs/b")] } },
        { origin: "webhook" }
      );
      expect(await originOf(routed.requestId)).toBe("webhook");
      const fired = routed.ownerRuns.map((o) => o.requestId);
      expect(fired).toHaveLength(2);
      for (const requestId of fired) {
        await routed.ownerRuns.find((o) => o.requestId === requestId)!.finished;
        expect(await originOf(requestId!)).toBe("webhook");
      }
    } finally {
      await dispose();
    }
  });

  it("is absent from a routing and its runs that no outside delivery started", async () => {
    const { host, write, originOf, dispose } = await boot();
    try {
      await write("alice", "subs/a", { orgId: ORG, enabled: true });
      const routed = await routeServiceEvent(host, {
        flowKind: "svc",
        entry: "route",
        principal: { userId: "service:github", orgId: ORG },
        input: { runs: [run("alice", "subs/a")] }
      });
      expect(await originOf(routed.requestId)).toBeUndefined();
      const fired = await fireOwnerRunThrough(host, run("alice", "subs/a"));
      expect(fired.fired).toBe(true);
      expect(await originOf((fired as { requestId: string }).requestId)).toBeUndefined();
    } finally {
      await dispose();
    }
  });

  it("is never read from a caller's metadata: an HTTP action naming the origin is not webhook-originated", async () => {
    const { host, originOf, dispose } = await boot();
    try {
      const handle = host.dispatch({
        source: "http",
        flowKind: "svc",
        action: "ask",
        input: { note: "hi" },
        sessionId: "s-http",
        principal: { userId: "alice", orgId: ORG },
        metadata: { deliveryOrigin: "webhook" },
        responseEmitter: null
      });
      await handle.finished;
      expect(await originOf(handle.requestId)).toBeUndefined();
    } finally {
      await dispose();
    }
  });

  it("rides a dispatch a webhook-originated run makes, into the run that dispatch starts", async () => {
    const { host, originOf, dispose } = await boot();
    try {
      worked.length = 0;
      const parent = dispatchInternalAs(host, {
        flowKind: "svc",
        entry: "relay",
        input: { note: "hi" },
        as: { userId: "alice", orgId: ORG },
        sessionId: "s-relay",
        metadata: {},
        origin: "webhook"
      });
      await parent.finished;
      await until(() => worked.length === 1);
      expect(await originOf(parent.requestId)).toBe("webhook");
      expect(await originOf(worked[0]!)).toBe("webhook");
    } finally {
      await dispose();
    }
  });

  it("is dropped from an adapter's own internal dispatch: only the engine's dispatches carry it", async () => {
    const { host, originOf, dispose } = await boot();
    try {
      const handle = host.dispatch({
        source: "internal",
        flowKind: "svc",
        action: "deliver",
        input: { note: "hi" },
        sessionId: "s-adapter",
        principal: { userId: "alice", orgId: ORG },
        metadata: { deliveryOrigin: "webhook" },
        responseEmitter: null
      });
      await handle.finished;
      expect(await originOf(handle.requestId)).toBeUndefined();
    } finally {
      await dispose();
    }
  });

  it("is dropped from a public runAction call that claims an internal source", async () => {
    const { host, originOf, dispose } = await boot();
    try {
      const result = await runAction({
        flow: svc,
        actionName: "deliver" as never,
        input: { note: "hi" },
        userId: "alice",
        orgId: ORG,
        sessionId: "s-run-action",
        source: "internal",
        metadata: { deliveryOrigin: "webhook" },
        stores: host.stores,
        runtimeConfig: {}
      });
      expect(await originOf(result.requestId!)).toBeUndefined();
    } finally {
      await dispose();
    }
  });

  it("reads a turn the webhook transport started directly as webhook-originated", () => {
    expect(readDeliveryOrigin("webhook", undefined)).toBe("webhook");
    expect(readDeliveryOrigin("internal", { deliveryOrigin: "webhook" })).toBe("webhook");
    expect(readDeliveryOrigin("task", { deliveryOrigin: "webhook" })).toBe("webhook");
    expect(readDeliveryOrigin("http", { deliveryOrigin: "webhook" })).toBeUndefined();
    expect(readDeliveryOrigin("internal", { deliveryOrigin: "poll" })).toBeUndefined();
  });
});
