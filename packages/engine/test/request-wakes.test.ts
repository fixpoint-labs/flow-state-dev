/**
 * The request host's wake verb (FIX-2078 D1): a block owes a wake for its own
 * session or another of its principal's, reads it at a pass's start, and
 * settles it after, conditional on the version it read, never inside the fence
 * a writer still landing its write holds.
 *
 * The owner, org, tenant and the session's flow come from the running
 * request's identity or the target session's stored record, never the caller.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "../src/stores";
import { createRequestWakes, installWakes, onWakeOwed, probeWakes } from "../src/durability/request-wakes";

const identity = { userId: "u1", tenantId: undefined, orgId: "o1", sessionId: "own" };

async function setup(now = { t: 1_000_000 }) {
  const stores = createInMemoryStores();
  const seed = (id: string, over: Record<string, unknown> = {}) =>
    stores.session.set(id, {
      id,
      state: {},
      version: 0,
      createdAt: 0,
      updatedAt: 0,
      flowKind: "desk-kind",
      flowId: "desk",
      userId: "u1",
      orgId: "o1",
      journal: [],
      ...over
    } as never, "any");
  await seed("own");
  await seed("filer", { flowId: "filer-flow" });
  await seed("theirs", { userId: "u2" });
  await seed("other-org", { orgId: "o2" });
  const wakes = createRequestWakes({
    store: stores.wakes!,
    sessions: stores.session,
    identity,
    flowId: "desk",
    fenceMs: 30_000,
    maxDebtAgeMs: 86_400_000,
    now: () => now.t
  });
  return { stores, wakes, now };
}

describe("RequestHost.wakes", () => {
  it("owes this session's wake as this request's owner, fenced by its lease", async () => {
    const { stores, wakes } = await setup();
    expect(await wakes.owe({ entry: "runTaskBoard", dueAt: 1_002_000 })).toBe(true);
    expect(await stores.wakes!.get({ sessionId: "own", entry: "runTaskBoard" })).toMatchObject({
      flowKind: "desk",
      userId: "u1",
      orgId: "o1",
      dueAt: 1_002_000,
      landBy: 1_030_000
    });
  });

  it("owes another of its principal's sessions under that session's own flow", async () => {
    const { stores, wakes } = await setup();
    expect(await wakes.owe({ entry: "runTaskBoard", dueAt: 5, sessionId: "filer" })).toBe(true);
    expect((await stores.wakes!.get({ sessionId: "filer", entry: "runTaskBoard" }))?.flowKind).toBe("filer-flow");
  });

  it("refuses a session it may not reach, and writes nothing", async () => {
    const { stores, wakes } = await setup();
    for (const sessionId of ["theirs", "other-org", "missing"]) {
      expect(await wakes.owe({ entry: "runTaskBoard", dueAt: 5, sessionId })).toBe(false);
      expect(await stores.wakes!.get({ sessionId, entry: "runTaskBoard" })).toBeNull();
    }
  });

  it("settles to the next due time, or clears once past the fence", async () => {
    const { stores, wakes, now } = await setup();
    await wakes.owe({ entry: "runTaskBoard", dueAt: 1_002_000 });
    const read = (await wakes.read("runTaskBoard"))!;
    expect(await wakes.settle("runTaskBoard", read, 1_500_000)).toBe("moved");
    expect((await stores.wakes!.get({ sessionId: "own", entry: "runTaskBoard" }))?.dueAt).toBe(1_500_000);
    now.t = 1_031_000; // past the fence
    expect(await wakes.settle("runTaskBoard", read, null)).toBe("cleared");
    expect(await wakes.read("runTaskBoard")).toBeUndefined();
  });

  it("a clear before the fence moves the wake to the fence instead", async () => {
    const { wakes } = await setup();
    await wakes.owe({ entry: "runTaskBoard", dueAt: 1_002_000 });
    const read = (await wakes.read("runTaskBoard"))!;
    expect(await wakes.settle("runTaskBoard", read, null)).toBe("moved");
    expect((await wakes.read("runTaskBoard"))?.dueAt).toBe(1_030_000);
  });

  it("a wake written during the pass survives its settle", async () => {
    const { wakes, now } = await setup();
    await wakes.owe({ entry: "runTaskBoard", dueAt: 1_002_000 });
    const read = (await wakes.read("runTaskBoard"))!;
    await wakes.owe({ entry: "runTaskBoard", dueAt: 1_003_000 });
    now.t = 1_100_000;
    expect(await wakes.settle("runTaskBoard", read, null)).toBe("stale");
    expect((await wakes.read("runTaskBoard"))?.dueAt).toBe(1_002_000);
  });

  it("tells a listener on the store when a wake is owed, so a sweeper can come forward", async () => {
    const { stores, wakes } = await setup();
    const heard: number[] = [];
    const stop = onWakeOwed(stores.wakes!, (dueAt) => heard.push(dueAt));
    await wakes.owe({ entry: "runTaskBoard", dueAt: 1_002_000 });
    stop();
    await wakes.owe({ entry: "runTaskBoard", dueAt: 1_001_000 });
    expect(heard).toEqual([1_002_000]);
  });

  it("tells the listener the due time the wake keeps, so a later owe never delays the sweeper", async () => {
    const { stores, wakes } = await setup();
    const heard: number[] = [];
    await wakes.owe({ entry: "runTaskBoard", dueAt: 1_001_000 });
    const stop = onWakeOwed(stores.wakes!, (dueAt) => heard.push(dueAt));
    // Coalesced: the earlier due time still governs.
    await wakes.owe({ entry: "runTaskBoard", dueAt: 1_009_000 });
    stop();
    expect(heard).toEqual([1_001_000]);
  });

  it("tells the listener where a settle moved the wake, so a sweeper armed later comes forward", async () => {
    const { stores, wakes, now } = await setup();
    await wakes.owe({ entry: "runTaskBoard", dueAt: 1_002_000 });
    const read = (await wakes.read("runTaskBoard"))!;
    const heard: number[] = [];
    const stop = onWakeOwed(stores.wakes!, (dueAt) => heard.push(dueAt));
    now.t = 1_003_000;
    expect(await wakes.settle("runTaskBoard", read, 1_007_000)).toBe("moved");
    stop();
    expect(heard).toEqual([1_007_000]);
  });

  it("is withdrawn at start when the store can't read its wakes, as a database not migrated for them", async () => {
    const { stores } = await setup();
    const broken = { ...stores.wakes!, earliestDueAt: async () => { throw new Error('relation "wakes" does not exist'); } };
    const requestHost: { wakes?: { maxDebtAgeMs: number } } = {};
    const logged: string[] = [];
    const logger = { info: (m: string) => logged.push(m), warn: (m: string) => logged.push(m), error: (m: string) => logged.push(m), debug: () => {} };
    installWakes(requestHost, { stores: { wakes: broken }, durable: true, logger: logger as never });
    expect(requestHost.wakes).toBeDefined();
    await probeWakes(requestHost, { wakes: broken }, logger as never);
    expect(requestHost.wakes).toBeUndefined();
    expect(logged.some((m) => m.includes("migration"))).toBe(true);
    // A store that reads its wakes keeps the verb.
    const healthy: { wakes?: { maxDebtAgeMs: number } } = {};
    installWakes(healthy, { stores, durable: true, logger: logger as never });
    await probeWakes(healthy, stores, logger as never);
    expect(healthy.wakes).toBeDefined();
  });
});
