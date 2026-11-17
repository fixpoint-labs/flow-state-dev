// FIX-2752.
/**
 * `vercelScheduler()`: the one route Vercel Cron calls for every schedule of
 * every flow. It decides only when the app's schedule tick runs: a GET with
 * the cron secret runs it once, dispatching to this deployment over the
 * network, so each fire is its own function invocation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduleTicker, ScheduleTickReport } from "@flow-state-dev/engine/host";
import { vercelScheduler } from "../src/scheduler";

const SECRET = "cron-s3cret";
const EMPTY: ScheduleTickReport = { dispatched: [] };

/** Vercel Cron's call: a GET to the route on the deployment's own host. */
function cronCall(authorization: string | null, url = "https://my-app.vercel.app/api/cron/schedules"): Request {
  return new Request(url, authorization === null ? {} : { headers: { Authorization: authorization } });
}

/** A ticker that records each tick's options. */
function recordingTicker(tick: ScheduleTicker["tick"] = async () => EMPTY) {
  const calls: Array<{ baseUrl?: string; secret?: string } | undefined> = [];
  const ticker: ScheduleTicker = {
    tick: (options) => {
      calls.push(options);
      return tick(options);
    }
  };
  return { ticker, calls };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("vercelScheduler", () => {
  it("runs the tick once per authorized cron call, dispatching back to the deployment the call reached", async () => {
    const scheduler = vercelScheduler({ secret: SECRET });
    const { ticker, calls } = recordingTicker();
    scheduler.start(ticker);

    const res = await scheduler.route(cronCall(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    expect(calls).toEqual([{ baseUrl: "https://my-app.vercel.app", secret: SECRET }]);
  });

  // Anyone can reach a cron route's URL; only Vercel Cron holds the secret.
  it.each([
    ["a wrong secret", `Bearer not-${SECRET}`],
    ["a prefix of the secret", `Bearer ${SECRET.slice(0, -1)}`],
    ["no Authorization header", null]
  ])("answers 401 and fires nothing for %s", async (_name, authorization) => {
    const scheduler = vercelScheduler({ secret: SECRET });
    const { ticker, calls } = recordingTicker();
    scheduler.start(ticker);

    const res = await scheduler.route(cronCall(authorization));

    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("refuses every call when no secret is configured, so a missing CRON_SECRET never opens the route", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const scheduler = vercelScheduler();
    const { ticker, calls } = recordingTicker();
    scheduler.start(ticker);

    expect((await scheduler.route(cronCall("Bearer "))).status).toBe(401);
    expect(calls).toEqual([]);
  });

  // The index's claim threw: its due rows are still pending, so a 500 makes the next beat retry them.
  it("answers 500 when the tick rejects, so the next beat retries", async () => {
    const scheduler = vercelScheduler({ secret: SECRET });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    scheduler.start(recordingTicker(async () => Promise.reject(new Error("claimDue: connection reset"))).ticker);

    const res = await scheduler.route(cronCall(`Bearer ${SECRET}`));

    expect(res.status).toBe(500);
    err.mockRestore();
  });

  it("answers 500, naming the fix, when it was never passed to createFlowState", async () => {
    const scheduler = vercelScheduler({ secret: SECRET });

    const res = await scheduler.route(cronCall(`Bearer ${SECRET}`));

    expect(res.status).toBe(500);
    expect(await res.text()).toContain("createFlowState({ scheduler })");
  });

  it("stops ticking once createFlowState stops it", async () => {
    const scheduler = vercelScheduler({ secret: SECRET });
    const { ticker, calls } = recordingTicker();
    await scheduler.start(ticker).stop();

    expect((await scheduler.route(cronCall(`Bearer ${SECRET}`))).status).toBe(500);
    expect(calls).toEqual([]);
  });

  it("reads CRON_SECRET from the environment when no secret is passed", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const scheduler = vercelScheduler();
    const { ticker, calls } = recordingTicker();
    scheduler.start(ticker);

    expect((await scheduler.route(cronCall(`Bearer ${SECRET}`))).status).toBe(200);
    expect(calls).toHaveLength(1);
  });
});
