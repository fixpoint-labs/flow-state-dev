/**
 * The Postgres change bus (FIX-2427): when it says it crosses processes, what
 * reaches a subscriber, and what it holds open. Against a fake `LISTEN` /
 * `NOTIFY` network; the real two-process path is the goal check's
 * (`goals/session-stream/wakes-across-processes/`).
 *
 * Why these matter: saying "crosses" turns the session stream's once-a-second
 * read off. A wrong "yes" is a view that stops updating with no error, so
 * every way the path can go quiet must turn the answer back to "no".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusTopic, ChangeNotice } from "@flow-state-dev/engine/host";
import { BUS_CHANNEL, createPostgresBus, type PostgresBus } from "../src/bus";
import { FakeNotifyNetwork, delay, until } from "./fake-notify-network";
import type { PGlite } from "@electric-sql/pglite";
import { postgresStores } from "../src";
import { createPostgresStores, type QueryExecutor } from "../src/host";
import { freshPglite } from "./shared-pglite";

const TIMINGS = { pingIntervalMs: 20, staleAfterMs: 50, reconnectMinMs: 5, reconnectMaxMs: 20 };

const s1: BusTopic = { scope: "session", id: "s1", tenantId: "" };

const open: PostgresBus[] = [];
afterEach(async () => {
  for (const bus of open.splice(0)) await bus.close();
  vi.restoreAllMocks();
});

function busOn(network: FakeNotifyNetwork, options: { tailPool?: boolean; notify?: boolean } = {}): PostgresBus {
  const bus = createPostgresBus({
    executor: network.executor,
    liveTailPool: options.tailPool === false ? null : network.pool,
    notify: options.notify ?? true,
    timings: TIMINGS
  });
  open.push(bus);
  return bus;
}

/** Every notice `bus` delivers on `topic`, a connection's `resync` included. */
function hearAll(bus: PostgresBus, topic: BusTopic): ChangeNotice[] {
  const heard: ChangeNotice[] = [];
  bus.subscribe(topic, (notice) => heard.push(notice));
  return heard;
}

/** The notices `bus` delivers on `topic` that some write sent: every `resync` left out. */
function hear(bus: PostgresBus, topic: BusTopic): ChangeNotice[] {
  const heard: ChangeNotice[] = [];
  bus.subscribe(topic, (notice) => {
    if (notice.kind !== "resync") heard.push(notice);
  });
  return heard;
}

function crossings(bus: PostgresBus): boolean[] {
  const seen: boolean[] = [];
  bus.onCrossingChange((crosses) => seen.push(crosses));
  return seen;
}

describe("the Postgres bus · when it says it crosses processes", () => {
  it("tells every subscriber to read once on its first connection, before it says it crosses", async () => {
    const network = new FakeNotifyNetwork();
    const bus = busOn(network);
    const order: string[] = [];
    bus.onCrossingChange((crosses) => order.push(`crosses:${crosses}`));
    bus.subscribe(s1, (notice) => order.push(`s1:${notice.kind}`));
    bus.subscribe({ ...s1, id: "s2" }, (notice) => order.push(`s2:${notice.kind}`));
    await until(() => bus.crossesProcesses);
    // A notice sent before the LISTEN took effect reached nobody here: each
    // view reads once, while its timed read is still on.
    expect(order).toEqual(["s1:resync", "s2:resync", "crosses:true"]);
  });

  it("says so only once its own ping comes back over LISTEN, and says it as an event", async () => {
    const network = new FakeNotifyNetwork();
    const bus = busOn(network);
    const seen = crossings(bus);
    expect(bus.crossesProcesses).toBe(false);
    hear(bus, s1);
    await until(() => bus.crossesProcesses);
    expect(seen).toEqual([true]);
  });

  it("never says so behind a pooler that accepts LISTEN and delivers nothing, and warns once with the fix", async () => {
    const network = new FakeNotifyNetwork();
    network.deliver = false;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bus = busOn(network);
    const seen = crossings(bus);
    hear(bus, s1);
    await delay(TIMINGS.staleAfterMs * 4);
    expect(bus.crossesProcesses).toBe(false);
    expect(seen).toEqual([]);
    const lines = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("ping"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/pooler/);
    expect(lines[0]).toMatch(/liveTailPool/);
  });

  it("stops saying so at once when the listening connection is killed, then reconnects, resyncs and says so again", async () => {
    const network = new FakeNotifyNetwork();
    const bus = busOn(network);
    const seen = crossings(bus);
    const heard = hearAll(bus, s1);
    await until(() => bus.crossesProcesses);
    expect(heard.map((n) => n.kind)).toEqual(["resync"]);

    const [first] = network.listeners(BUS_CHANNEL);
    first!.kill();
    expect(bus.crossesProcesses).toBe(false);
    expect(first!.released).toEqual({ broken: true });

    // Back on a new connection: every subscriber reads once, since notices
    // sent while it was down are gone.
    await until(() => bus.crossesProcesses);
    expect(network.listeners(BUS_CHANNEL)).toHaveLength(1);
    expect(heard.map((n) => n.kind)).toEqual(["resync", "resync"]);
    expect(heard[1]!.topic).toEqual(s1);
    expect(seen).toEqual([true, false, true]);
  });

  it("stops saying so when the connection goes quiet without an error, within the stale bound plus a ping", async () => {
    const network = new FakeNotifyNetwork();
    const bus = busOn(network);
    hear(bus, s1);
    await until(() => bus.crossesProcesses);
    const quietAt = Date.now();
    network.listeners(BUS_CHANNEL)[0]!.silent = true;
    await until(() => !bus.crossesProcesses);
    expect(Date.now() - quietAt).toBeLessThanOrEqual(TIMINGS.staleAfterMs + TIMINGS.pingIntervalMs + 20);
    // And it does not stay there: a fresh connection hears its ping again.
    await until(() => bus.crossesProcesses);
  });

  it("never gives up reconnecting", async () => {
    const network = new FakeNotifyNetwork();
    network.failConnects = 8;
    const bus = busOn(network);
    hear(bus, s1);
    await until(() => bus.crossesProcesses, 2_000);
    expect(network.failConnects).toBe(0);
  });

  it("never says so without a tail pool, and never opens a connection", async () => {
    const network = new FakeNotifyNetwork();
    const bus = busOn(network, { tailPool: false });
    const heard = hear(bus, s1);
    await bus.publish({ topic: s1, kind: "items" });
    await delay(TIMINGS.staleAfterMs * 2);
    expect(bus.crossesProcesses).toBe(false);
    expect(network.clients).toEqual([]);
    // Its own views still hear it, and other processes still get it.
    expect(heard.map((n) => n.kind)).toEqual(["items"]);
    expect(network.notified.filter((n) => !n.payload.includes("ping"))).toHaveLength(1);
  });
});

describe("the Postgres bus · what a subscriber hears", () => {
  it("hears another process's notice, and its own once, in process", async () => {
    const network = new FakeNotifyNetwork();
    const here = busOn(network);
    const there = busOn(network);
    const heardHere = hear(here, s1);
    const heardThere = hear(there, s1);
    await until(() => here.crossesProcesses && there.crossesProcesses);

    await here.publish({ topic: s1, kind: "items" });
    await until(() => heardThere.length === 1);
    await delay(10);
    // Its echo came back over LISTEN and was dropped: one wake, not two.
    expect(heardHere.map((n) => n.kind)).toEqual(["items"]);
    expect(heardThere).toEqual([{ topic: s1, kind: "items" }]);
  });

  it("hears its own process's notice while the listener is down", async () => {
    const network = new FakeNotifyNetwork();
    network.failConnects = 1_000;
    const bus = busOn(network);
    const heard = hear(bus, s1);
    await bus.publish({ topic: s1, kind: "request" });
    await delay(1);
    expect(heard.map((n) => n.kind)).toEqual(["request"]);
  });

  it("keeps tenants apart: one tenant's notice never reaches another's subscriber", async () => {
    const network = new FakeNotifyNetwork();
    const here = busOn(network);
    const there = busOn(network);
    const t1 = hear(there, { ...s1, tenantId: "t1" });
    const t2 = hear(there, { ...s1, tenantId: "t2" });
    hear(here, s1);
    await until(() => there.crossesProcesses && here.crossesProcesses);
    await here.publish({ topic: { ...s1, tenantId: "t2" }, kind: "run" });
    await until(() => t2.length === 1);
    await delay(10);
    expect(t1).toEqual([]);
  });

  it("sends a notice too large for NOTIFY as its whole scope, never dropping it", async () => {
    const network = new FakeNotifyNetwork();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const here = busOn(network);
    const there = busOn(network);
    const heard = hear(there, s1);
    hear(here, s1);
    await until(() => there.crossesProcesses && here.crossesProcesses);
    await here.publish({ topic: { ...s1, resource: "r".repeat(9_000) }, kind: "run" });
    await until(() => heard.length === 1);
    expect(heard[0]).toEqual({ topic: s1, kind: "run" });
    expect(warn.mock.calls.some((call) => String(call[0]).includes("too large"))).toBe(true);
  });
});

describe("the Postgres bus · a notice too large for NOTIFY", () => {
  it("still reaches the other process's subscribers narrowed to its resource", async () => {
    const network = new FakeNotifyNetwork();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const here = busOn(network);
    const there = busOn(network);
    const resource = "r".repeat(9_000);
    const narrowed = hear(there, { ...s1, resource });
    // Widened to the scope: a view of another resource under it reads too, never fewer.
    const other = hear(there, { ...s1, resource: "notes" });
    const elsewhere = hear(there, { ...s1, id: "s2" });
    hear(here, s1);
    await until(() => there.crossesProcesses && here.crossesProcesses);
    await here.publish({ topic: { ...s1, resource }, kind: "run" });
    await until(() => narrowed.length === 1);
    expect(narrowed[0]).toEqual({ topic: { ...s1, resource }, kind: "run" });
    expect(other.map((n) => n.kind)).toEqual(["run"]);
    await delay(10);
    expect(elsewhere).toEqual([]);
  });
});

describe("the Postgres bus · what it holds open", () => {
  it("opens no connection until a subscriber does, and hands it back when the last one leaves", async () => {
    const network = new FakeNotifyNetwork();
    const bus = busOn(network);
    await bus.publish({ topic: s1, kind: "items" });
    await delay(TIMINGS.pingIntervalMs * 2);
    // A process that only publishes (a worker) holds nothing and pings nothing.
    expect(network.clients).toEqual([]);
    expect(network.notified.filter((n) => n.payload.includes("ping"))).toEqual([]);

    const stopA = bus.subscribe(s1, () => {});
    const stopB = bus.subscribe({ ...s1, id: "s2" }, () => {});
    await until(() => bus.crossesProcesses);
    // One connection for the process, however many views.
    expect(network.clients).toHaveLength(1);
    stopA();
    expect(network.open.size).toBe(1);
    stopB();
    await until(() => network.open.size === 0);
    expect(network.clients[0]!.released).toEqual({ broken: false });
    expect(network.clients[0]!.statements).toContain(`UNLISTEN ${BUS_CHANNEL}`);
    expect(bus.crossesProcesses).toBe(false);
  });

  it("pings once per interval per process, not per view", async () => {
    const network = new FakeNotifyNetwork();
    const bus = busOn(network);
    hear(bus, s1);
    hear(bus, { ...s1, id: "s2" });
    await until(() => bus.crossesProcesses);
    const before = network.notified.length;
    await delay(TIMINGS.pingIntervalMs * 10);
    const pings = network.notified.slice(before).filter((n) => n.payload.includes("ping")).length;
    expect(pings).toBeGreaterThanOrEqual(7);
    expect(pings).toBeLessThanOrEqual(11);
  });

  it("closes with the connection handed back and the ping stopped, before it resolves", async () => {
    const network = new FakeNotifyNetwork();
    const bus = busOn(network);
    hear(bus, s1);
    await until(() => bus.crossesProcesses);
    await bus.close();
    expect(network.open.size).toBe(0);
    const after = network.notified.length;
    await bus.publish({ topic: s1, kind: "items" });
    await delay(TIMINGS.pingIntervalMs * 3);
    expect(network.notified.length).toBe(after);
    expect(bus.crossesProcesses).toBe(false);
  });

  it("closes cleanly while a connect is still being retried", async () => {
    const network = new FakeNotifyNetwork();
    network.failConnects = 1_000;
    const bus = busOn(network);
    hear(bus, s1);
    await delay(15);
    await bus.close();
    network.failConnects = 0;
    await delay(TIMINGS.reconnectMaxMs * 3);
    expect(network.open.size).toBe(0);
  });
});

describe("the Postgres adapter · backs the bus slot", () => {
  it("declares `bus`, so a profile on Postgres gets the Postgres bus with no config", async () => {
    const pglite = await freshPglite();
    const adapter = postgresStores({ executor: pgliteExecutor(pglite) });
    expect(adapter.capabilities).toContain("bus");
    const registry = await adapter.resolve(["bus"]);
    expect(registry.bus).toBeDefined();
    await adapter.dispose?.();
  });

  it("keeps an executor's bus (PGlite) in process: it never says it crosses and sends nothing", async () => {
    const pglite = await freshPglite();
    const statements: string[] = [];
    const registry = await createPostgresStores({ executor: pgliteExecutor(pglite, statements) });
    const heard = hear(registry.bus, s1);
    statements.length = 0;
    await registry.bus.publish({ topic: s1, kind: "items" });
    await delay(5);
    expect(heard.map((n) => n.kind)).toEqual(["items"]);
    expect(registry.bus.crossesProcesses).toBe(false);
    expect(statements.filter((text) => text.includes("pg_notify"))).toEqual([]);
    await registry.close();
  });
});

function pgliteExecutor(pglite: PGlite, statements?: string[]): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      statements?.push(text);
      const result = await pglite.query(text, values);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
    }
  };
}
