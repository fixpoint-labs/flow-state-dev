/**
 * Request tails on the listen helper they share with the change bus
 * (FIX-2427): a tail still reconnects when its `LISTEN flow_events`
 * connection is killed, and still gives up after its budget, which the bus
 * never does.
 */
import { describe, expect, it } from "vitest";
import { StoreSubscriptionError } from "@flow-state-dev/engine/host";
import { createPostgresRequestStore, initializeSchema, type QueryExecutor } from "../src/host";
import { FakeNotifyNetwork, until } from "./fake-notify-network";
import { openListen } from "../src/listen";
import { freshPglite } from "./shared-pglite";

async function executor(): Promise<QueryExecutor> {
  const pglite = await freshPglite();
  const exec: QueryExecutor = {
    async query(text: string, values?: unknown[]) {
      const result = await pglite.query(text, values);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
    }
  };
  await initializeSchema(exec);
  return exec;
}

describe("the listen helper", () => {
  it("refuses a connection that failed before it could be handed over, rather than returning it dead", async () => {
    const network = new FakeNotifyNetwork();
    network.errorAfterListen = 1;
    let lostHeard = 0;
    await expect(
      openListen(network.pool, "flow_events", { notification: () => {}, lost: () => (lostHeard += 1) })
    ).rejects.toThrow();
    expect(network.clients[0]!.released).toEqual({ broken: true });
    // The caller never held it, so it isn't told it lost it.
    expect(lostHeard).toBe(0);
  });
});

describe("a request tail on the shared listen helper", () => {
  it("reconnects when its listening connection is killed", async () => {
    const network = new FakeNotifyNetwork();
    const store = createPostgresRequestStore(await executor(), { liveTailPool: network.pool });
    const controller = new AbortController();
    const tail = store.subscribeToEvents("r1", { fromSequence: 0, signal: controller.signal });
    const pending = tail.next();
    await until(() => network.listeners("flow_events").length === 1);
    const first = network.listeners("flow_events")[0]!;
    first.kill();
    await until(() => network.listeners("flow_events").length === 1 && network.clients.length === 2);
    expect(first.released).toEqual({ broken: true });
    controller.abort();
    await pending;
    await until(() => network.open.size === 0);
    // Handed back healthy on the way out, so the pool keeps it.
    expect(network.clients[1]!.released).toEqual({ broken: false });
  });

  it("reconnects when its connection fails just after LISTEN, before it resumes", async () => {
    const network = new FakeNotifyNetwork();
    network.errorAfterListen = 1;
    const store = createPostgresRequestStore(await executor(), { liveTailPool: network.pool });
    const controller = new AbortController();
    const tail = store.subscribeToEvents("r1", { fromSequence: 0, signal: controller.signal, livenessTimeoutMs: 60_000 });
    const pending = tail.next();
    // Not left waiting out its liveness timeout on a dead connection.
    await until(() => network.clients.length === 2 && network.listeners("flow_events").length === 1, 2_000);
    expect(network.clients[0]!.released).toEqual({ broken: true });
    controller.abort();
    await pending;
  });

  it("gives up after its reconnect budget", async () => {
    const network = new FakeNotifyNetwork();
    network.failConnects = 100;
    const store = createPostgresRequestStore(await executor(), { liveTailPool: network.pool });
    const tail = store.subscribeToEvents("r1", { fromSequence: 0 });
    await expect(tail.next()).rejects.toBeInstanceOf(StoreSubscriptionError);
    expect(network.failConnects).toBe(100 - 6);
  });
});
