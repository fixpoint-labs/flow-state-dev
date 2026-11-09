/**
 * The shared schedule tick (FIX-2536): one body that Vercel's per-beat handler
 * and `serve()`'s interval both run.
 *
 * Why these matter: a long-lived host has no cron of its own, so this tick is
 * the only thing that fires its dynamic schedules. Each due row must reach the
 * dispatch endpoint under its canonical id, an org-less row must never be
 * sent (it names no cell to fire from), a failed claim must not lose the rows
 * (the next beat tries again), and stopping the host must not leave a tick
 * running against closed stores.
 */
import { describe, expect, it, vi } from "vitest";
import { formatScheduleId } from "../src";
import { runScheduleTick, scheduleDispatchRequest, startScheduleTick } from "../src/collection";

const row = (key: string, orgId: string | null = "acme") => ({ userId: "alice", ...(orgId === null ? {} : { orgId }), key, nextFireAt: 60_000 });

describe("runScheduleTick", () => {
  it("dispatches each claimed row under its dispatch id, and none with no org", async () => {
    const claimDue = vi.fn(async () => [row("a"), row("b"), row("c", null)]);
    const dispatched: string[] = [];
    const statuses: number[] = [];
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await runScheduleTick({
      index: { claimDue },
      now: 123,
      dispatch: async (_row, id) => (dispatched.push(id), 202),
      onDispatch: (_row, status) => statuses.push(status)
    });
    err.mockRestore();
    expect(claimDue).toHaveBeenCalledWith(123, 100);
    expect(dispatched.sort()).toEqual([formatScheduleId("acme", "alice", "a"), formatScheduleId("acme", "alice", "b")]);
    expect(statuses.sort()).toEqual([0, 202, 202]);
  });

  it("throws when the claim does, dispatching nothing", async () => {
    const dispatch = vi.fn();
    await expect(runScheduleTick({ index: { claimDue: async () => Promise.reject(new Error("down")) }, dispatch })).rejects.toThrow("down");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("builds the dispatch request with the scheduled time and the bearer", () => {
    const { url, init } = scheduleDispatchRequest({ baseUrl: "https://app.test/", flowKind: "github-service", row: row("k"), scheduleId: "acme/alice/k", secret: "s" });
    expect(url).toBe("https://app.test/api/flows/github-service/schedules/acme%2Falice%2Fk/dispatch");
    expect(init.headers.Authorization).toBe("Bearer s");
    expect(JSON.parse(init.body)).toEqual({ nominalFireTime: new Date(60_000).toISOString() });
  });
});

describe("startScheduleTick", () => {
  it("ticks on its interval against its clock, and stops on dispose", async () => {
    vi.useFakeTimers();
    try {
      const seen: number[] = [];
      const tick = startScheduleTick({
        index: { claimDue: async (now) => (seen.push(now), []) },
        dispatch: async () => 202,
        intervalMs: 1000,
        clock: () => 42
      });
      await vi.advanceTimersByTimeAsync(3000);
      expect(seen).toEqual([42, 42, 42]);
      await tick.dispose();
      await vi.advanceTimersByTimeAsync(3000);
      expect(seen).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
