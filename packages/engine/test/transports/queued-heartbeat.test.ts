/**
 * The queued-request heartbeat follows the flow's cadence (FIX-999).
 *
 * A run waiting behind its concurrency key has already been registered in the
 * active-request registry, but its own executor has not started, so nothing
 * beats the entry until the host does it. The cadence matters: the liveness gate
 * only requires `staleThreshold >= 2 * heartbeatInterval`, so a flow may
 * legitimately pair a fast heartbeat with a tight threshold. Beating a queued
 * entry at a fixed 10s against a 3s threshold lets the sweeper reap a request
 * that is merely waiting its turn, and a liveness read then reports valid work
 * as not live.
 *
 * So this asserts the cadence is the flow's, not a constant.
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

const FAST_HEARTBEAT_MS = 20;

function buildHost(heartbeatIntervalMs: number | undefined) {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  const gates: Array<() => void> = [];

  registry.register(
    defineFlow({
      kind: "queued-hb",
      ...(heartbeatIntervalMs !== undefined
        ? { request: { heartbeatIntervalMs } }
        : {}),
      actions: {
        run: {
          concurrency: "queue",
          inputSchema: z.object({ value: z.string() }),
          block: handler<{ value: string }, { ok: true }>({
            name: "queued-hb-run",
            execute: async () => {
              await new Promise<void>((resolve) => gates.push(resolve));
              return { ok: true };
            }
          })
        }
      }
    })({ id: "queued-hb" })
  );

  // Count beats per request id, without changing what the registry does.
  const beats: string[] = [];
  const realHeartbeat = stores.activeRequests.heartbeat.bind(stores.activeRequests);
  stores.activeRequests.heartbeat = async (requestId: string): Promise<void> => {
    beats.push(requestId);
    return realHeartbeat(requestId);
  };

  const host = createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: {}
  });

  return {
    host,
    beats,
    // Released one at a time: the queued run only creates its gate once the
    // first has finished and it actually starts.
    releaseOne: () => gates.shift()?.()
  };
}

function envelope(value: string) {
  return {
    source: "http" as const,
    flowKind: "queued-hb",
    action: "run",
    input: { value },
    sessionId: "s_q",
    principal: { userId: "u_1" }
  };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("queued-request heartbeat cadence", () => {
  it("beats a queued entry at the flow's configured heartbeat interval", async () => {
    const h = buildHost(FAST_HEARTBEAT_MS);

    // First holds the key and blocks; second is queued behind it.
    const first = h.host.dispatch(envelope("a"));
    await wait(10);
    const second = h.host.dispatch(envelope("b"));

    // Long enough for several beats at the flow's cadence, and far short of the
    // 10s default — which is what makes this fail against a fixed constant.
    await wait(150);

    const queuedBeats = h.beats.filter((id) => id === second.requestId).length;
    expect(queuedBeats).toBeGreaterThanOrEqual(2);

    h.releaseOne();
    await first.finished;
    await wait(10);
    h.releaseOne();
    await second.finished;
  });

  it("starts no queued timer when the flow disables heartbeats", async () => {
    // `0` is "do not keep this warm". Falling back to a default here would keep
    // an entry alive that the flow explicitly asked never to be kept alive.
    const h = buildHost(0);

    const first = h.host.dispatch(envelope("a"));
    await wait(10);
    const second = h.host.dispatch(envelope("b"));
    await wait(120);

    expect(h.beats.filter((id) => id === second.requestId)).toHaveLength(0);

    h.releaseOne();
    await first.finished;
    await wait(10);
    h.releaseOne();
    await second.finished;
  });
});
