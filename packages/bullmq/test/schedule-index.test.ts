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
    const index = createBullmqScheduleIndex(queue);

    await index.upsert({
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
    const index = createBullmqScheduleIndex(queue);

    await index.upsert({
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
    const index = createBullmqScheduleIndex(queue);
    const result = await index.claimDue(Date.now());
    expect(result).toEqual([]);
  });

  it("remove calls queue.removeJobScheduler with correct id", async () => {
    const queue = createMockQueue();
    const index = createBullmqScheduleIndex(queue);
    await index.remove("user-1", "daily-report");
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(
      "fsd-sched:user-1:daily-report"
    );
  });

  it("uses custom scheduler id prefix", async () => {
    const queue = createMockQueue();
    const index = createBullmqScheduleIndex(queue, {
      schedulerIdPrefix: "myapp-sched"
    });

    await index.upsert({
      userId: "u2",
      key: "k1",
      cron: "* * * * *",
      nextFireAt: 0
    });

    const schedulerId = queue.upsertJobScheduler.mock.calls[0][0];
    expect(schedulerId).toBe("myapp-sched:u2:k1");
  });
});
