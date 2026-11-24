// FIX-2752.
/**
 * The app fires its own schedules, end to end: the engine's schedule tick
 * against the real scheduled endpoint (the router's built-in, no adapter line) and
 * real SQLite stores.
 *
 * Why these matter:
 *
 * - **After downtime each schedule fires once, late, for the latest time it
 *   missed (D3)**, static and dynamic alike, and the endpoint takes it. Before,
 *   a dynamic schedule sent the oldest time it missed, which the endpoint
 *   refuses as stale after two missed times, so it fired nothing.
 * - **One process ticks** across processes on one SQLite file: the store's
 *   lease elects it, and SQLite stores need no warning (D2).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { __resetDeprecationWarningsForTests, defineFlow, formatScheduleId, handler } from "@flow-state-dev/core";
import type { ScheduleDueEntry, SchedulesConfig } from "@flow-state-dev/core/types";
import { latestScheduledTime } from "@flow-state-dev/core/internal";
import { createBearerSecretPrincipalResolver, createFlowState, type FlowState } from "@flow-state-dev/engine";
import type { ScheduleTicker } from "@flow-state-dev/engine/host";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { createMockModelResolver } from "@flow-state-dev/testing";

const SECRET = "tick-secret";
const MINUTE = 60_000;
const DYNAMIC_ID = formatScheduleId("acme", "alice", "poll");

/** An index holding one entry, advanced past `now` as a real index's claim advances it. */
function oneEntryIndex(cron: string, firstDue: number) {
  const entry: ScheduleDueEntry = { userId: "alice", orgId: "acme", key: "poll", cron, nextFireAt: firstDue };
  const claims = { count: 0 };
  return {
    claims,
    claimDue: async (now: number) => {
      claims.count += 1;
      if (entry.nextFireAt > now) return [];
      const due = { ...entry };
      // The next scheduled minute after `now`.
      let next = Math.floor(now / MINUTE) * MINUTE + MINUTE;
      while (latestScheduledTime(cron, "UTC", next) !== next) next += MINUTE;
      entry.nextFireAt = next;
      return [due];
    }
  };
}

/** A flow with a static schedule and a dynamic one on `index`, each run recorded by origin. */
function scheduledFlow(cron: string, index: SchedulesConfig["index"], runs: string[]) {
  const record = (origin: string) =>
    handler({ name: `run-${origin}`, inputSchema: z.object({}).passthrough(), execute: () => (runs.push(origin), {}) });
  const dynamicRun = record("dynamic");
  return defineFlow({
    kind: "digest",
    actions: { noop: { inputSchema: z.object({}), block: record("noop") } },
    schedules: {
      static: { morning: { cron, block: record("static") } },
      resolve: (id) => (id === DYNAMIC_ID ? { cron, block: dynamicRun, principal: { userId: "alice", orgId: "acme" } } : null),
      index
    }
  })();
}

function app(filename: string, flow: ReturnType<typeof scheduledFlow>, scheduler?: { start(t: ScheduleTicker): { stop(): Promise<void> } }) {
  return createFlowState({
    flows: [flow],
    stores: sqliteStores({ filename }),
    modelResolver: createMockModelResolver({}),
    resolvePrincipal: createBearerSecretPrincipalResolver({ secret: SECRET, principal: { userId: "system", orgId: "acme" } }),
    ...(scheduler === undefined ? {} : { scheduler })
  });
}

let dir: string;
const apps: FlowState[] = [];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fsd-schedule-tick-"));
  vi.stubEnv("CRON_SECRET", SECRET);
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.dispose()));
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

/** Wait until `runs` holds `n` entries: a fire the endpoint accepted runs after it answers. */
async function until(runs: string[], n: number) {
  for (let i = 0; i < 400 && runs.length < n; i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

describe("the schedule tick, against the real endpoint", () => {
  it("after downtime fires a static and a dynamic schedule once each, for the latest time missed (D3)", async () => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(Date.parse("2026-11-16T09:00:30Z"));
    const runs: string[] = [];
    let ticker: ScheduleTicker | undefined;
    const index = oneEntryIndex("*/5 * * * *", Date.parse("2026-11-16T09:00:00Z"));
    const a = app(join(dir, "d3.sqlite"), scheduledFlow("*/5 * * * *", index, runs), {
      start: (t) => ((ticker = t), { stop: async () => undefined })
    });
    apps.push(a);

    const first = await ticker!.tick();
    expect(first.dispatched.map((d) => [d.origin, new Date(d.nominalFireTime).toISOString(), d.status]).sort()).toEqual([
      ["dynamic", "2026-11-16T09:00:00.000Z", 202],
      ["static", "2026-11-16T09:00:00.000Z", 202]
    ]);
    await until(runs, 2);

    // Down from 09:00:30 to 09:23:10: 09:05, 09:10, 09:15 and 09:20 were missed.
    vi.setSystemTime(Date.parse("2026-11-16T09:23:10Z"));
    const second = await ticker!.tick();
    expect(second.dispatched.map((d) => [d.origin, new Date(d.nominalFireTime).toISOString(), d.status]).sort()).toEqual([
      ["dynamic", "2026-11-16T09:20:00.000Z", 202],
      ["static", "2026-11-16T09:20:00.000Z", 202]
    ]);
    await until(runs, 4);
    expect(runs.sort()).toEqual(["dynamic", "dynamic", "static", "static"]);
  });
});

describe("the local cron across processes on one SQLite file", () => {
  it("lets one process claim each minute, and needs no warning in production (D2)", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(Date.parse("2026-11-16T09:00:30Z"));
    vi.stubEnv("NODE_ENV", "production");
    __resetDeprecationWarningsForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const file = join(dir, "shared.sqlite");
    // Each process counts its own claims; the entry is never due, so nothing runs.
    const never = Date.parse("2099-01-01T00:00:00Z");
    const one = oneEntryIndex("0 0 1 1 *", never);
    const two = oneEntryIndex("0 0 1 1 *", never);
    const runs: string[] = [];
    const a = app(file, scheduledFlow("0 0 1 1 *", one, runs));
    const b = app(file, scheduledFlow("0 0 1 1 *", two, runs));
    apps.push(a, b);
    await a.ready();
    await b.ready();
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect([one.claims.count, two.claims.count]).toEqual([3, 0]);
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("local cron"))).toEqual([]);
  });
});
