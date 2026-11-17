/**
 * The schedule tick and the local cron when a store or the endpoint misbehaves:
 * an index whose claim never answers, a lease renewal that never answers, and
 * a fire the endpoint refuses. Each was silent or stalled other schedules.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { ScheduleDueSource, SchedulesConfig } from "@flow-state-dev/core/types";
import { createInMemoryStores, type LeaseStore } from "../../src/host";
import { createLocalScheduler } from "../../src/execution/local-scheduler";
import { runScheduleTick, type ScheduleDispatch } from "../../src/execution/schedule-tick";

const noop = handler({ name: "tick-failure-noop", inputSchema: z.object({}), execute: () => ({}) });

function flowWith(kind: string, schedules: SchedulesConfig) {
  return defineFlow({ kind, actions: { noop: { inputSchema: z.object({}), block: noop } }, schedules })();
}

const dueEntry = { orgId: "o", userId: "u", key: "k", cron: "* * * * *", nextFireAt: Date.parse("2026-11-16T09:00:00Z") };

afterEach(() => {
  vi.useRealTimers();
});

describe("the schedule tick, when one index never answers its claim", () => {
  it("still fires the static schedules and the healthy indexes, and settles", async () => {
    const stuck: ScheduleDueSource = { claimDue: () => new Promise(() => undefined) };
    const healthy: ScheduleDueSource = { claimDue: async () => [dueEntry] };
    const sent: ScheduleDispatch[] = [];
    const tick = runScheduleTick({
      flows: [
        flowWith("stuck", { index: stuck, static: { each: { cron: "* * * * *", block: noop } } }),
        flowWith("healthy", { index: healthy })
      ],
      resourceState: createInMemoryStores().resourceState,
      dispatch: async (fire) => (sent.push(fire), 202),
      // 20 ms past the minute: the static schedule is due within the 40 ms a first tick looks back.
      now: Date.parse("2026-11-16T09:00:00.020Z"),
      intervalMs: 40,
      logger: {}
    });
    await expect(tick).rejects.toThrow(/claim/i);
    expect(sent.map((fire) => `${fire.flowKind}:${fire.origin}`).sort()).toEqual(["healthy:dynamic", "stuck:static"]);
  });
});

describe("the schedule tick, when a claim answers after it stopped waiting", () => {
  it("logs the entries that claim advanced, since none of them fires", async () => {
    const errors: Array<{ message: string; context: Record<string, unknown> }> = [];
    let answer: (entries: (typeof dueEntry)[]) => void = () => undefined;
    const late: ScheduleDueSource = { claimDue: () => new Promise((resolve) => (answer = resolve)) };
    await runScheduleTick({
      flows: [flowWith("late", { index: late })],
      resourceState: createInMemoryStores().resourceState,
      dispatch: async () => 202,
      now: Date.parse("2026-11-16T09:00:00.020Z"),
      intervalMs: 40,
      logger: { error: (message, context) => errors.push({ message, context }) }
    }).catch(() => undefined);
    answer([dueEntry]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const dropped = errors.find((entry) => entry.message.includes("not fired"));
    expect(dropped?.context).toMatchObject({ flowKind: "late", scheduleIds: ["o/u/k"] });
  });
});

describe("the schedule tick, when one fire never answers", () => {
  it("stops waiting for it after a beat, so the tick settles and the other fires are reported", async () => {
    const tick = runScheduleTick({
      flows: [
        flowWith("hangs", { static: { each: { cron: "* * * * *", block: noop } } }),
        flowWith("answers", { static: { each: { cron: "* * * * *", block: noop } } })
      ],
      resourceState: createInMemoryStores().resourceState,
      dispatch: (fire) => (fire.flowKind === "hangs" ? new Promise(() => undefined) : Promise.resolve(202)),
      now: Date.parse("2026-11-16T09:00:00.020Z"),
      intervalMs: 40,
      logger: {}
    });
    const report = await tick;
    expect(report.dispatched.map((fire) => `${fire.flowKind}:${fire.status}`).sort()).toEqual(["answers:202", "hangs:0"]);
  });
});

describe("the schedule tick, when the endpoint refuses a fire", () => {
  it("logs each fire answered with an error status, naming the flow, the schedule and the status", async () => {
    const errors: Array<{ message: string; context: Record<string, unknown> }> = [];
    await runScheduleTick({
      flows: [flowWith("refused", { static: { each: { cron: "* * * * *", block: noop } } })],
      resourceState: createInMemoryStores().resourceState,
      dispatch: async () => 401,
      now: Date.parse("2026-11-16T09:00:30Z"),
      logger: { error: (message, context) => errors.push({ message, context }) }
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain("refused/each");
    expect(errors[0]!.context).toMatchObject({ status: 401 });
  });

  it("logs nothing for the answers a fire is meant to get (202, and 200 for a duplicate)", async () => {
    const errors: string[] = [];
    await runScheduleTick({
      flows: [
        flowWith("a", { static: { each: { cron: "* * * * *", block: noop } } }),
        flowWith("b", { static: { each: { cron: "* * * * *", block: noop } } })
      ],
      resourceState: createInMemoryStores().resourceState,
      dispatch: async (fire) => (fire.flowKind === "a" ? 202 : 200),
      now: Date.parse("2026-11-16T09:00:30Z"),
      logger: { error: (message) => errors.push(message) }
    });
    expect(errors).toEqual([]);
  });
});

describe("the local cron, when a renewal never answers", () => {
  it("tells the running tick to stop by the time its lease runs out", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(Date.parse("2026-11-16T09:00:30Z"));
    const registry = createInMemoryStores();
    let answers = true;
    const leases: LeaseStore = {
      acquire: (key, options) => (answers ? registry.leases.acquire(key, options) : new Promise(() => undefined)),
      release: (key, id) => registry.leases.release(key, id),
      get: (key) => registry.leases.get(key),
      pruneExpired: () => registry.leases.pruneExpired()
    };
    const signals: AbortSignal[] = [];
    const scheduler = createLocalScheduler({
      intervalMs: 60_000,
      tick: (signal) => (signals.push(signal), new Promise(() => undefined))
    });
    scheduler.arm(leases);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(signals).toHaveLength(1);
    answers = false;
    // The lease was taken at 09:00:30 for two minutes; past that another process may hold it.
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(signals[0]!.aborted).toBe(true);
    void scheduler.stop();
  });
});

describe("the local cron, when one acquire never answers", () => {
  it("tries again on a later beat, and ticks once the store answers", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(Date.parse("2026-11-16T09:00:30Z"));
    const registry = createInMemoryStores();
    let calls = 0;
    const leases: LeaseStore = {
      // The first acquire hangs, as a dropped connection would; the store answers from then on.
      acquire: (key, options) => (++calls === 1 ? new Promise(() => undefined) : registry.leases.acquire(key, options)),
      release: (key, id) => registry.leases.release(key, id),
      get: (key) => registry.leases.get(key),
      pruneExpired: () => registry.leases.pruneExpired()
    };
    let ticks = 0;
    const scheduler = createLocalScheduler({ intervalMs: 60_000, tick: async () => void (ticks += 1) });
    scheduler.arm(leases);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(calls).toBeGreaterThan(1);
    expect(ticks).toBeGreaterThanOrEqual(1);
    void scheduler.stop();
  });
});

describe("the local cron, when releasing its lease never answers", () => {
  it("still lets stop() return, leaving the lease to run out", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(Date.parse("2026-11-16T09:00:30Z"));
    const registry = createInMemoryStores();
    const leases: LeaseStore = {
      acquire: (key, options) => registry.leases.acquire(key, options),
      release: () => new Promise(() => undefined),
      get: (key) => registry.leases.get(key),
      pruneExpired: () => registry.leases.pruneExpired()
    };
    const scheduler = createLocalScheduler({ intervalMs: 60_000, tick: async () => undefined });
    scheduler.arm(leases);
    await vi.advanceTimersByTimeAsync(60_000);
    let stopped = false;
    void scheduler.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(stopped).toBe(true);
  });
});
