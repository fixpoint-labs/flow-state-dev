/**
 * Host-level concurrency policy tests (FIX-837). Exercises the policy through
 * the real `host.dispatch` seam (no HTTP server): `allow` overlaps, `reject`
 * throws `ConcurrencyRejectedError` synchronously from `dispatch` while a
 * request holds the key and releases it on terminal, and `queue` serializes two
 * dispatches on one key without temporal overlap. Also asserts the dispatch
 * handle (requestId + liveStream) still returns synchronously while a queued run
 * waits.
 */
import { describe, it, expect } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver
} from "../../src";
import { ConcurrencyRejectedError } from "../../src/transports/errors";
import { UserBindingMismatchError } from "../../src/context/binding-errors";
import type { ConcurrencyConfig } from "@flow-state-dev/core";

/**
 * Build a host with a single flow whose handler blocks until the test releases
 * it, so concurrency timing is deterministic. `release(requestId?)` frees one
 * (or, with no id, all) in-flight runs. `live` tracks currently-executing runs.
 */
function buildHost(concurrency: ConcurrencyConfig) {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  const gates: Array<() => void> = [];
  const live: string[] = [];
  let maxLive = 0;
  const startOrder: string[] = [];

  registry.register(
    defineFlow({
      kind: "concur",
      actions: {
        run: {
          concurrency,
          inputSchema: z.object({ value: z.string() }),
          block: handler<{ value: string }, { ok: true }>({
            name: "concur-run",
            execute: async (input) => {
              const id = input.value;
              live.push(id);
              startOrder.push(id);
              maxLive = Math.max(maxLive, live.length);
              await new Promise<void>((resolve) => gates.push(resolve));
              live.splice(live.indexOf(id), 1);
              return { ok: true };
            }
          })
        }
      }
    })({ id: "concur" })
  );

  const host = createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: {}
  });

  return {
    host,
    stores,
    releaseAll: () => {
      const pending = gates.splice(0);
      pending.forEach((g) => g());
    },
    releaseOne: () => gates.shift()?.(),
    get maxLive() {
      return maxLive;
    },
    get liveCount() {
      return live.length;
    },
    startOrder
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

function envelope(value: string, sessionId = "s_1") {
  return {
    source: "http" as const,
    flowKind: "concur",
    action: "run",
    input: { value },
    sessionId,
    principal: { userId: "u_1" }
  };
}

describe("host concurrency — allow (default)", () => {
  it("runs two dispatches on one session concurrently", async () => {
    const h = buildHost("allow");
    await h.host.validateDispatch(envelope("a"));
    const r1 = h.host.dispatch(envelope("a"));
    await h.host.validateDispatch(envelope("b"));
    const r2 = h.host.dispatch(envelope("b"));
    await tick();
    expect(h.liveCount).toBe(2);
    h.releaseAll();
    await Promise.all([r1.finished, r2.finished]);
    expect(h.maxLive).toBe(2);
  });
});

describe("host concurrency — reject", () => {
  it("rejects a second request on the key while one is in flight, naming the in-flight requestId", async () => {
    const h = buildHost("reject");
    const env1 = envelope("a");
    const r1 = h.host.dispatch(env1);
    await tick();

    // The gate throws synchronously from `dispatch` — before any record exists.
    const env2 = envelope("b");
    expect(() => h.host.dispatch(env2)).toThrow(ConcurrencyRejectedError);
    try {
      h.host.dispatch(env2);
    } catch (e) {
      expect((e as ConcurrencyRejectedError).inFlightRequestId).toBe(r1.requestId);
      expect((e as ConcurrencyRejectedError).status).toBe(409);
    }

    // Only the admitted request is executing.
    expect(h.liveCount).toBe(1);

    // Releasing the first frees the key; a later request is admitted.
    h.releaseAll();
    await r1.finished;
    const env3 = envelope("c");
    const r3 = h.host.dispatch(env3);
    await tick();
    h.releaseAll();
    await r3.finished;
  });

  it("does not arbitrate distinct sessions under reject", async () => {
    const h = buildHost("reject");
    const r1 = h.host.dispatch(envelope("a", "s_1"));
    const r2 = h.host.dispatch(envelope("b", "s_2"));
    await tick();
    h.releaseAll();
    await Promise.all([r1.finished, r2.finished]);
  });
});

describe("host concurrency — queue", () => {
  it("rejects a different user before materializing a queued request", async () => {
    const h = buildHost("queue");
    const victim = h.host.dispatch(envelope("victim"));
    await tick();

    const attackerEnvelope = {
      ...envelope("attacker"),
      requestId: "attacker-request",
      principal: { userId: "attacker" }
    };
    await expect(h.host.validateDispatch(attackerEnvelope)).rejects.toBeInstanceOf(
      UserBindingMismatchError
    );
    expect(await h.stores.request.get("attacker-request")).toBeUndefined();

    h.releaseAll();
    await victim.finished;
  });

  it("does not overwrite an existing record when a queued request id collides", async () => {
    const h = buildHost("queue");
    const first = h.host.dispatch({ ...envelope("first"), requestId: "same-id" });
    await tick();
    h.releaseAll();
    await first.finished;
    const existing = await h.stores.request.get("same-id");

    const collision = h.host.dispatch({
      ...envelope("collision"),
      requestId: "same-id"
    });
    await expect(collision.finished).rejects.toThrow("already exists");
    expect(await h.stores.request.get("same-id")).toEqual(existing);
  });

  it("serializes two dispatches on one key in submission order with no overlap", async () => {
    const h = buildHost("queue");
    const env1 = envelope("first");
    const env2 = envelope("second");

    await h.host.validateDispatch(env1);
    const r1 = h.host.dispatch(env1);
    await h.host.validateDispatch(env2);
    const r2 = h.host.dispatch(env2);

    // Handle returns synchronously even while the second run is queued.
    expect(r2.requestId).toBeTypeOf("string");
    expect(r2.liveStream).not.toBeNull();

    await tick();
    // Only the first is executing; the second is parked behind the key.
    expect(h.liveCount).toBe(1);

    h.releaseOne(); // finish first
    await r1.finished;
    await tick();
    expect(h.liveCount).toBe(1); // second now running
    h.releaseOne();
    await r2.finished;

    expect(h.maxLive).toBe(1);
    expect(h.startOrder).toEqual(["first", "second"]);
  });

  it("materializes a discoverable request record for a queued run before it starts", async () => {
    const h = buildHost("queue");
    const r1 = h.host.dispatch(envelope("first"));
    const r2 = h.host.dispatch(envelope("second"));
    await tick();

    // The second run hasn't started, but its requestId must already resolve to a
    // record (so a 202 client polling .../requests/:id/stream gets the record,
    // not a 404). FIX-837 materializes it up front, like the external dispatcher.
    expect(h.liveCount).toBe(1);
    const queuedRecord = await h.stores.request.get(r2.requestId);
    expect(queuedRecord).toBeDefined();
    expect(queuedRecord?.status).toBe("in_progress");

    h.releaseOne();
    await r1.finished;
    await tick();
    h.releaseOne();
    await r2.finished;
  });
});
