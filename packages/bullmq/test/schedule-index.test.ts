import { describe, it, expect, vi } from "vitest";
import { createBullmqScheduleIndex } from "../src/schedule-index";

function createMockQueue() {
  return {
    upsertJobScheduler: vi.fn(async () => {}),
    removeJobScheduler: vi.fn(async () => {})
  } as any;
}

describe("createBullmqScheduleIndex", () => {
  it("upsert calls queue.upsertJobScheduler with correct args", async () => {
    const queue = createMockQueue();
    const index = createBullmqScheduleIndex(queue, { flowKind: "weekly-digest" });

    await index.upsert({
      cell: "user-1",
      userId: "user-1",
      key: "daily-report",
      cron: "0 9 * * *",
      timezone: "America/New_York",
      nextFireAt: Date.now()
    });

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      "fsd-sched:user-1:daily-report",
      { pattern: "0 9 * * *", tz: "America/New_York" },
      {
        name: "schedule-fire",
        data: {
          flowKind: "weekly-digest",
          userId: "user-1",
          key: "daily-report",
          cron: "0 9 * * *",
          timezone: "America/New_York"
        }
      }
    );
  });

  it("upsert omits tz when timezone is undefined", async () => {
    const queue = createMockQueue();
    const index = createBullmqScheduleIndex(queue, { flowKind: "weekly-digest" });

    await index.upsert({
      cell: "user-1",
      userId: "user-1",
      key: "hourly",
      cron: "0 * * * *",
      nextFireAt: Date.now()
    });

    const call = queue.upsertJobScheduler.mock.calls[0];
    expect(call[1]).toEqual({ pattern: "0 * * * *" });
  });

  it("claimDue always returns empty array (native firing)", async () => {
    const queue = createMockQueue();
    const index = createBullmqScheduleIndex(queue, { flowKind: "weekly-digest" });
    const result = await index.claimDue(Date.now());
    expect(result).toEqual([]);
  });

  it("remove calls queue.removeJobScheduler with correct id", async () => {
    const queue = createMockQueue();
    const index = createBullmqScheduleIndex(queue, { flowKind: "weekly-digest" });
    await index.remove({ cell: "user-1", key: "daily-report" });
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(
      "fsd-sched:user-1:daily-report"
    );
  });

  /**
   * The scheduler id is built from the row's identity. An app-wide row's cell
   * is the person's own id, so its scheduler id is byte-identical to the one
   * written before rows carried a cell and nothing re-registers (BR-15); two
   * seats' rows with one key are two schedulers, and removing one leaves the
   * other.
   */
  it("keys schedulers on the cell: app-wide ids unchanged, seats apart", async () => {
    const queue = createMockQueue();
    const index = createBullmqScheduleIndex(queue, { flowKind: "weekly-digest" });
    const row = { userId: "user-1", key: "weekly", cron: "* * * * *", nextFireAt: 0 };

    await index.upsert({ ...row, cell: "user-1" });
    await index.upsert({ ...row, cell: "user-1:~org:acme", orgId: "acme" });
    await index.upsert({ ...row, cell: "user-1:~org:globex", orgId: "globex" });
    await index.remove({ cell: "user-1:~org:acme", key: "weekly" });

    expect(queue.upsertJobScheduler.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      "fsd-sched:user-1:weekly",
      "fsd-sched:user-1:~org:acme:weekly",
      "fsd-sched:user-1:~org:globex:weekly",
    ]);
    expect(queue.removeJobScheduler.mock.calls).toEqual([["fsd-sched:user-1:~org:acme:weekly"]]);
  });

  it("uses custom scheduler id prefix", async () => {
    const queue = createMockQueue();
    const index = createBullmqScheduleIndex(queue, {
      flowKind: "weekly-digest",
      schedulerIdPrefix: "myapp-sched"
    });

    await index.upsert({
      cell: "u2",
      userId: "u2",
      key: "k1",
      cron: "* * * * *",
      nextFireAt: 0
    });

    const schedulerId = queue.upsertJobScheduler.mock.calls[0][0];
    expect(schedulerId).toBe("myapp-sched:u2:k1");
  });
});
