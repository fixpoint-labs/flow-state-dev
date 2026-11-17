// FIX-2752.
/**
 * The app fires its own schedules: `createFlowState({ scheduler })` and the one
 * schedule tick.
 *
 * Why these matter: a long-lived host has no cron of its own, so the tick is
 * what fires a flow's schedules, static and dynamic, and one tick runs across
 * a deployment however many processes serve it. Each scheduled time is sent
 * once, for its latest due time after a gap (D3), so a restart over 9 AM still
 * sends the morning digest and an outage never sends a burst.
 *
 * The scheduled endpoint is the router's own (its tests are under
 * `test/transports/scheduled/`); here the router's `POST` is wrapped to record
 * what the tick sent and answer 202, so these tests read the tick alone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { SchedulesConfig } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, type FlowState } from "../../src";
import type { ScheduleTicker, SchedulerAdapter } from "../../src/host";

type Sent = { flowKind: string; scheduleId: string; nominalFireTime: string | undefined; authorization: string | null };

/**
 * Record each dispatch the tick sends to `app`'s router, answering 202 in the
 * endpoint's place. The tick sends through the same router `getRouter()`
 * returns, reading its `POST` on each fire.
 */
async function recordFires(app: FlowState, sent: Sent[]): Promise<void> {
  const router = await app.getRouter();
  vi.spyOn(router, "POST").mockImplementation(async (req, ctx) => {
    const [flowKind, , scheduleId] = ctx.params.path ?? [];
    const body = (await req.json()) as { nominalFireTime?: string };
    sent.push({
      flowKind: flowKind!,
      scheduleId: scheduleId!,
      nominalFireTime: body.nominalFireTime,
      authorization: req.headers.get("authorization")
    });
    return new Response(JSON.stringify({ status: "accepted" }), { status: 202 });
  });
}

/** A scheduler adapter that hands the test the ticker. */
function capturing(): SchedulerAdapter & { ticker?: ScheduleTicker } {
  const adapter: SchedulerAdapter & { ticker?: ScheduleTicker } = {
    start(ticker) {
      adapter.ticker = ticker;
      return { stop: async () => undefined };
    }
  };
  return adapter;
}

const noop = handler({ name: "scheduled-noop", inputSchema: z.object({}), execute: () => ({}) });

function scheduledFlow(kind: string, schedules: SchedulesConfig) {
  return defineFlow({ kind, actions: { noop: { inputSchema: z.object({}), block: noop } }, schedules })();
}

const T = Date.parse("2026-11-16T09:00:30Z");

afterEach(() => {
  vi.useRealTimers();
});

describe("the schedule tick", () => {
  it("fires a static schedule for its scheduled time through the app's own router", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
    const sent: Sent[] = [];
    const scheduler = capturing();
    const app = createFlowState({
      flows: [scheduledFlow("digest", { static: { morning: { cron: "* * * * *", block: noop } } })],
      stores: inMemoryStores(),
      scheduler
    });
    await recordFires(app, sent);
    const report = await scheduler.ticker!.tick();
    expect(sent).toEqual([{ flowKind: "digest", scheduleId: "morning", nominalFireTime: "2026-11-16T09:00:00.000Z", authorization: null }]);
    expect(report.dispatched).toEqual([
      { flowKind: "digest", scheduleId: "morning", nominalFireTime: Date.parse("2026-11-16T09:00:00Z"), origin: "static", status: 202 }
    ]);
    await app.dispose();
  });

  it("sends a scheduled time once: a second tick in the same minute sends nothing (the last-tick record)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
    const { app, sent, ticker } = await staticApp("* * * * *");
    await ticker.tick();
    vi.setSystemTime(T + 20_000);
    await ticker.tick();
    expect(sent.map((s) => s.nominalFireTime)).toEqual(["2026-11-16T09:00:00.000Z"]);
    await app.dispose();
  });

  it("after a gap, fires a static schedule once, for the latest time it missed (D3)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
    const { app, sent, ticker } = await staticApp("*/5 * * * *");
    await ticker.tick();
    // Down from 09:00:30 to 09:23:10: 09:05, 09:10, 09:15 and 09:20 were missed.
    vi.setSystemTime(Date.parse("2026-11-16T09:23:10Z"));
    await ticker.tick();
    expect(sent.map((s) => s.nominalFireTime)).toEqual(["2026-11-16T09:00:00.000Z", "2026-11-16T09:20:00.000Z"]);
    await app.dispose();
  });

  it("on a first tick, looks back one interval only: a schedule added today does not fire a time long past", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-11-16T09:30:00Z"));
    const { app, sent, ticker } = await staticApp("0 9 * * *");
    await ticker.tick();
    expect(sent).toEqual([]);
    await app.dispose();
  });
});

describe("the schedule tick, dynamic schedules", () => {
  it("claims a flow's index and fires each due entry once, for its latest due time from its cron (D3)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = Date.parse("2026-11-16T09:23:10Z");
    vi.setSystemTime(now);
    const claimedAt: number[] = [];
    // Missed since 09:05: the index hands back the first time it missed.
    const index = {
      claimDue: async (at: number) => (
        claimedAt.push(at),
        [{ userId: "alice", orgId: "Acme/EU", key: "poll", cron: "*/5 * * * *", nextFireAt: Date.parse("2026-11-16T09:05:00Z") }]
      )
    };
    const { app, sent, ticker } = await appWith([scheduledFlow("follower", { index })]);
    const report = await ticker.tick();
    expect(claimedAt).toEqual([now]);
    expect(sent).toEqual([
      { flowKind: "follower", scheduleId: "Acme%2FEU/alice/poll", nominalFireTime: "2026-11-16T09:20:00.000Z", authorization: null }
    ]);
    expect(report.dispatched.map((d) => d.origin)).toEqual(["dynamic"]);
    await app.dispose();
  });

  it("claims an index two flows name once, for the first flow that names it", async () => {
    let claims = 0;
    const index = { claimDue: async () => ((claims += 1), []) };
    const { app, ticker } = await appWith([scheduledFlow("one", { index }), scheduledFlow("two", { index })]);
    await ticker.tick();
    expect(claims).toBe(1);
    await app.dispose();
  });

  it("does not dispatch an entry with no organization, and still fires the rest", async () => {
    const at = Date.now() - 1_000;
    const index = {
      claimDue: async () => [
        { userId: "legacy", key: "old", cron: "* * * * *", nextFireAt: at },
        { userId: "alice", orgId: "acme", key: "new", cron: "* * * * *", nextFireAt: at }
      ]
    };
    const { app, sent, ticker } = await appWith([scheduledFlow("follower", { index })]);
    await ticker.tick();
    expect(sent.map((s) => s.scheduleId)).toEqual(["acme/alice/new"]);
    await app.dispose();
  });

  it("rejects when a claim throws, after firing the other flows' schedules", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
    const down = { claimDue: async () => Promise.reject(new Error("index down")) };
    const { app, sent, ticker } = await appWith([
      scheduledFlow("broken", { index: down }),
      scheduledFlow("digest", { static: { morning: { cron: "* * * * *", block: noop } } })
    ]);
    await expect(ticker.tick()).rejects.toThrow("index down");
    expect(sent.map((s) => s.flowKind)).toEqual(["digest"]);
    await app.dispose();
  });
});

/** An app with one static schedule on `cron`, its ticker and what the endpoint received. */
async function staticApp(cron: string) {
  return appWith([scheduledFlow("digest", { static: { morning: { cron, block: noop } } })]);
}

/** An app serving `flows`, recording what the tick sent, with its ticker. */
async function appWith(flows: ReturnType<typeof scheduledFlow>[]) {
  const sent: Sent[] = [];
  const scheduler = capturing();
  const app = createFlowState({ flows, stores: inMemoryStores(), scheduler });
  await recordFires(app, sent);
  return { app, sent, ticker: scheduler.ticker! };
}
