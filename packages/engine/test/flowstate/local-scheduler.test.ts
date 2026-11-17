// FIX-2752.
/**
 * The built-in local cron and its lease.
 *
 * Why these matter: with no scheduler named, the app fires its own schedules
 * each minute in a process that serves it or works its job queue, and never in
 * a one-shot CLI run. Across processes that share a store, one ticks: the
 * others stay idle and take over when it stops. Each process below is a
 * `FlowState` over one shared store, its claims counted on its own index, so a
 * second ticker shows up as a second claim.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { __resetDeprecationWarningsForTests } from "@flow-state-dev/core";
import type { SchedulesConfig } from "@flow-state-dev/core/types";
import { createBearerSecretPrincipalResolver, createFlowState, filesystemStores, inMemoryStores, type StoreAdapter } from "../../src";
import { createInMemoryStores, type JobQueueAdapter, type LeaseStore } from "../../src/host";
import type { FlowRunner } from "../../src/transports/runner";
import type { StoreRegistry } from "../../src/stores/types";

const MINUTE = 60_000;
const SECRET = "local-cron-secret";
const noop = handler({ name: "local-cron-noop", inputSchema: z.object({}), execute: () => ({}) });

/** A flow on an index that counts its claims: one process's ticks. */
function countedFlow(schedules: Partial<SchedulesConfig> = {}) {
  const ticks = { count: 0 };
  const flow = defineFlow({
    kind: "counted",
    actions: { noop: { inputSchema: z.object({}), block: noop } },
    schedules: { index: { claimDue: async () => ((ticks.count += 1), []) }, ...schedules }
  })();
  return { flow, ticks };
}

/** One store shared by every "process" built over it. */
function sharedStore(override?: (stores: StoreRegistry) => StoreRegistry): StoreAdapter {
  const registry = createInMemoryStores();
  const resolved = override?.(registry) ?? registry;
  return { capabilities: ["primary"], resolve: async () => resolved };
}

/** `leases` with its `acquire` replaced. */
function withAcquire(leases: LeaseStore, acquire: LeaseStore["acquire"]): LeaseStore {
  return { acquire, release: (key, id) => leases.release(key, id), get: (key) => leases.get(key), pruneExpired: () => leases.pruneExpired() };
}

/** A process: a FlowState over `stores` whose ticks are counted. */
function processOn(stores: StoreAdapter, extra: { scheduler?: false; jobQueue?: JobQueueAdapter } = {}) {
  const { flow, ticks } = countedFlow();
  const app = createFlowState({ flows: [flow], stores, ...extra });
  return { app, ticks };
}

const apps: Array<{ dispose(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()));
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function fakeClock() {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(Date.parse("2026-11-16T09:00:30Z"));
}

describe("the local cron", () => {
  it("ticks each minute once the router is built", async () => {
    fakeClock();
    const p = processOn(sharedStore());
    apps.push(p.app);
    await p.app.ready();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(p.ticks.count).toBe(1);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(p.ticks.count).toBe(2);
  });

  // `register()` after start is public: a scheduled flow registered then must still fire.
  it("ticks for a scheduled flow registered after the router is built", async () => {
    fakeClock();
    const app = createFlowState({ flows: [], stores: sharedStore() });
    apps.push(app);
    await app.ready();
    const { flow, ticks } = countedFlow();
    app.register(flow);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(ticks.count).toBe(1);
  });

  it("never ticks in a process that only resolves the runtime (fsdev run, chat, block)", async () => {
    fakeClock();
    const p = processOn(sharedStore());
    apps.push(p.app);
    await p.app.getRuntime();
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(p.ticks.count).toBe(0);
  });

  // A colocated queue starts processing as the runtime resolves; `fsdev run` must still not tick.
  it("never ticks in a process that only resolves the runtime, with a colocated job queue", async () => {
    fakeClock();
    const jobQueue: JobQueueAdapter = {
      mode: "colocated",
      createRunner: vi.fn(() => ({ dispatch: vi.fn(), close: async () => undefined })),
      startProcessing: () => ({ close: async () => undefined })
    };
    const p = processOn(sharedStore(), { jobQueue });
    apps.push(p.app);
    await p.app.getRuntime();
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(p.ticks.count).toBe(0);
  });

  // FIX-2753: the endpoint is the router's own, so a fire needs no adapter line to land.
  it("fires a static schedule through the router's built-in endpoint, with no adapters", async () => {
    fakeClock();
    vi.stubEnv("CRON_SECRET", SECRET);
    const ran: string[] = [];
    const recorded = handler({
      name: "local-cron-recorded",
      inputSchema: z.object({}).passthrough(),
      execute: () => (ran.push("ran"), {})
    });
    const flow = defineFlow({
      kind: "built-in-mount",
      authentication: {
        resolvePrincipal: createBearerSecretPrincipalResolver({ secret: SECRET, principal: { userId: "system", orgId: "org_sys" } }),
        requireUser: true
      },
      actions: { noop: { inputSchema: z.object({}), block: noop } },
      schedules: { static: { each: { cron: "* * * * *", block: recorded } } }
    })();
    const app = createFlowState({ flows: [flow], stores: sharedStore() });
    apps.push(app);
    await app.ready();
    await vi.advanceTimersByTimeAsync(MINUTE);
    await vi.waitFor(() => expect(ran).toEqual(["ran"]));
  });

  it("starts nothing with `scheduler: false`", async () => {
    fakeClock();
    const p = processOn(sharedStore(), { scheduler: false });
    apps.push(p.app);
    await p.app.ready();
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(p.ticks.count).toBe(0);
  });

  it("ticks in a job-queue worker that builds no router, enqueueing its fires through the queue's runner (D1)", async () => {
    fakeClock();
    const runner: FlowRunner = { dispatch: vi.fn(), close: async () => undefined };
    const jobQueue: JobQueueAdapter = {
      mode: "process-only",
      createRunner: vi.fn(() => runner),
      startProcessing: () => ({ close: async () => undefined })
    };
    const p = processOn(sharedStore(), { jobQueue });
    apps.push(p.app);
    // A worker process resolves the runtime, which starts the queue's processing; it never asks for a router.
    await p.app.getRuntime();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(p.ticks.count).toBe(1);
    // The router the tick dispatches through was given the queue's runner.
    expect(jobQueue.createRunner).toHaveBeenCalledTimes(1);
  });

  it("does not hold dispose() open on a tick stalled in its claim", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    let claims = 0;
    const flow = defineFlow({
      kind: "stalled",
      actions: { noop: { inputSchema: z.object({}), block: noop } },
      // A store that stopped answering: the claim never settles.
      schedules: { index: { claimDue: () => ((claims += 1), new Promise<never>(() => undefined)) } }
    })();
    const app = createFlowState({ flows: [flow], stores: sharedStore() });
    await app.ready();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(claims).toBe(1);
    let disposed = false;
    void app.dispose().then(() => (disposed = true));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(disposed).toBe(true);
  });
});

describe("the schedule-tick lease", () => {
  it("lets one process tick across processes that share a store", async () => {
    fakeClock();
    const store = sharedStore();
    const a = processOn(store);
    const b = processOn(store);
    apps.push(a.app, b.app);
    await a.app.ready();
    await b.app.ready();
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect([a.ticks.count, b.ticks.count]).toEqual([3, 0]);
  });

  it("hands over at once when the holder is disposed", async () => {
    fakeClock();
    const store = sharedStore();
    const a = processOn(store);
    const b = processOn(store);
    apps.push(b.app);
    await a.app.ready();
    await b.app.ready();
    await vi.advanceTimersByTimeAsync(MINUTE);
    await a.app.dispose();
    // Released: the next minute is b's, not the minute after the lease runs out.
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(a.ticks.count).toBe(1);
    expect(b.ticks.count).toBe(1);
  });

  it("stops a holder that fails to renew, and another takes over within three minutes", async () => {
    fakeClock();
    const registry = createInMemoryStores();
    let aRenews = true;
    // Process a's view of the store: its renewals start failing, as a process that hung would.
    const aStore: StoreAdapter = {
      capabilities: ["primary"],
      resolve: async () => ({
        ...registry,
        leases: withAcquire(registry.leases, async (key, options) => (aRenews ? registry.leases.acquire(key, options) : null))
      })
    };
    const bStore: StoreAdapter = { capabilities: ["primary"], resolve: async () => registry };
    const a = processOn(aStore);
    const b = processOn(bStore);
    apps.push(a.app, b.app);
    await a.app.ready();
    await b.app.ready();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect([a.ticks.count, b.ticks.count]).toEqual([1, 0]);
    aRenews = false;
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(a.ticks.count).toBe(1);
    expect(b.ticks.count).toBeGreaterThanOrEqual(1);
  });

  // The handover bound is the lease (two minutes) plus one beat to notice it ran out. A contender
  // that waited one beat more to tick after taking the lease would hand over in four.
  it("ticks on the beat a contender takes the lease, so a crash hands over within three minutes", async () => {
    fakeClock();
    const registry = createInMemoryStores();
    let aAlive = true;
    const aStore: StoreAdapter = {
      capabilities: ["primary"],
      resolve: async () => ({
        ...registry,
        leases: withAcquire(registry.leases, async (key, options) => (aAlive ? registry.leases.acquire(key, options) : null))
      })
    };
    const a = processOn(aStore);
    // b's store answers over a network, as Postgres does: an acquire resolves on I/O, not in the same microtask run.
    const overNetwork = withAcquire(registry.leases, async (key, options) => {
      await new Promise((resolve) => setImmediate(resolve));
      return registry.leases.acquire(key, options);
    });
    const b = processOn({ capabilities: ["primary"], resolve: async () => ({ ...registry, leases: overNetwork }) });
    apps.push(a.app, b.app);
    await a.app.ready();
    // b started half a minute after a: its beats fall between a's.
    await vi.advanceTimersByTimeAsync(MINUTE / 2);
    await b.app.ready();
    await vi.advanceTimersByTimeAsync(MINUTE / 2);
    // a has just renewed and ticked; it dies now, holding a lease good for two more minutes.
    expect([a.ticks.count, b.ticks.count]).toEqual([1, 0]);
    aAlive = false;
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(a.ticks.count).toBe(1);
    expect(b.ticks.count).toBeGreaterThanOrEqual(1);
  });

  it("idles when acquiring the lease throws (SQLITE_BUSY)", async () => {
    fakeClock();
    const p = processOn(
      sharedStore((stores) => ({
        ...stores,
        leases: withAcquire(stores.leases, async () => Promise.reject(new Error("SQLITE_BUSY")))
      }))
    );
    apps.push(p.app);
    await p.app.ready();
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(p.ticks.count).toBe(0);
  });
});

describe("startup checks", () => {
  it("starts a flow that declares schedules with no adapters", async () => {
    const { flow } = countedFlow();
    const app = createFlowState({ flows: [flow], stores: sharedStore(), scheduler: false });
    apps.push(app);
    await expect(app.ready()).resolves.toBeUndefined();
  });

  it("starts a flow whose schedules only resolve, with no index for the tick to claim", async () => {
    const flow = defineFlow({
      kind: "resolve-only",
      actions: { noop: { inputSchema: z.object({}), block: noop } },
      schedules: { resolve: () => null }
    })();
    const app = createFlowState({ flows: [flow], stores: sharedStore() });
    apps.push(app);
    await expect(app.ready()).resolves.toBeUndefined();
  });

  it("warns once in production when the local cron runs on stores whose lease can't elect one process (D2)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    __resetDeprecationWarningsForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const p = processOn(inMemoryStores());
    apps.push(p.app);
    await p.app.ready();
    const lines = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("local cron"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/run one server, or use SQLite or Postgres stores/);
  });

  it("warns on filesystem stores in production too (D2)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    __resetDeprecationWarningsForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const p = processOn(filesystemStores({ rootDir: mkdtempSync(join(tmpdir(), "fsd-local-cron-")), developmentOnly: true }));
    apps.push(p.app);
    await p.app.ready();
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("local cron"))).toHaveLength(1);
  });

  it("does not warn outside production, or with no schedules to fire", async () => {
    __resetDeprecationWarningsForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const p = processOn(inMemoryStores());
    apps.push(p.app);
    await p.app.ready();
    vi.stubEnv("NODE_ENV", "production");
    const quiet = createFlowState({ flows: [], stores: inMemoryStores() });
    apps.push(quiet);
    await quiet.ready();
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("local cron"))).toEqual([]);
  });

  it("on Vercel with the local default, warns to pass vercelScheduler()", async () => {
    vi.stubEnv("VERCEL", "1");
    __resetDeprecationWarningsForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const p = processOn(sharedStore());
    apps.push(p.app);
    await p.app.ready();
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("vercelScheduler()"))).toHaveLength(1);
  });
});
