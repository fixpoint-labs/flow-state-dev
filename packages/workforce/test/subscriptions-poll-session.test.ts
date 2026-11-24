// FIX-2886.
/**
 * A poll's fires keep one session, and a day of history.
 *
 * Why it matters: a poll fires every few minutes for as long as anyone is
 * subscribed. Fired one-off, each fire left a session of its own that nothing
 * removes; in one session per poll, the service flow's retention caps the
 * poll's history at a day. This fires the poll through the app's schedule
 * tick and the real dispatch endpoint, past a simulated day.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootSubscriptionsHost, pollTimeline } from "./subscriptions-harness";

const PR = "github:acme/api#412";
const T0 = Date.parse("2026-11-09T10:00:00Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  pollTimeline.events = [];
  pollTimeline.calls = [];
  pollTimeline.incomplete = false;
  pollTimeline.overlapMs = 0;
});
afterEach(() => vi.useRealTimers());

describe("a poll's session", () => {
  it("holds every fire of the poll, and only the last day of them", async () => {
    const host = bootSubscriptionsHost({ poll: {} });
    try {
      const one = await host.follower("alice");
      await host.subscribe("alice", one, { thread: PR, everyMinutes: 60 });
      const beats = 28;
      for (let beat = 1; beat <= beats; beat += 1) {
        vi.setSystemTime(T0 + beat * HOUR);
        await host.tick();
      }
      const accepted = host.fires.filter((fire) => fire.userId === "alice" && fire.status === 202);
      expect(accepted.length).toBeGreaterThanOrEqual(beats - 1);

      const runtime = await host.state.getRuntime();
      const fires = (await runtime.stores.request.list({})).filter((request) => request.flowKind === "github-service" && request.source === "scheduled");
      // Every fire still held names one session, the poll's, and the store holds no one-off session for the poll.
      const sessions = new Set(fires.map((request) => request.sessionId));
      expect(sessions.size).toBe(1);
      const [session] = [...sessions];
      expect(session).toMatch(/^fsd-schedule\./);
      expect(await runtime.stores.session.get(session!)).toMatchObject({ flowKind: "github-service", userId: "alice" });

      // Retention evicted the fires older than a day: what is left is the last day's.
      expect(fires.length).toBeLessThan(accepted.length);
      const now = T0 + beats * HOUR;
      expect(Math.min(...fires.map((request) => request.startedAtMs))).toBeGreaterThanOrEqual(now - DAY - HOUR);
    } finally {
      await host.dispose();
    }
  });
});
