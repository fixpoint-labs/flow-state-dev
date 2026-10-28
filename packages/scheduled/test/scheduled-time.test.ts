/**
 * The scheduled time a fire counts against, and the record's floor, on a
 * pinned clock: the rules that `once-per-time.test.ts` exercises through the
 * endpoint, here where the clock can sit a second before a scheduled time.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryResourceStateStore } from "@flow-state-dev/engine";
import { claimScheduledTime, scheduledTimeOf } from "../src/scheduledTime";

const HOURLY = "0 * * * *";
const at = (iso: string) => Date.parse(iso);

describe("the scheduled time a fire counts against", () => {
  it("counts an untimed fire a second early against the time it is for, not the one before", () => {
    // The sender's clock is a second ahead of ours: its 10:00 run lands at 09:59:59 here.
    const result = scheduledTimeOf(HOURLY, "UTC", undefined, at("2026-10-21T09:59:59.000Z"));
    expect(result).toMatchObject({ ok: true, at: at("2026-10-21T10:00:00.000Z") });
  });

  it("still counts an untimed fire well before a time against the latest one already due", () => {
    const result = scheduledTimeOf(HOURLY, "UTC", undefined, at("2026-10-21T09:30:00.000Z"));
    expect(result).toMatchObject({ ok: true, at: at("2026-10-21T09:00:00.000Z") });
  });

  it("marks a carried time more than one period behind the latest due time stale", () => {
    const now = at("2026-10-21T10:30:00.000Z");
    // 08:00 is two periods behind 10:00, the latest due time: a fixed body, or a host stalled for hours.
    expect(scheduledTimeOf(HOURLY, "UTC", "2026-10-21T08:00:00.000Z", now)).toMatchObject({ ok: true, stale: true });
    // 09:00 is one period behind: a late retry, which still counts.
    expect(scheduledTimeOf(HOURLY, "UTC", "2026-10-21T09:00:00.000Z", now)).toMatchObject({ ok: true, stale: false });
    expect(scheduledTimeOf(HOURLY, "UTC", "2026-10-21T10:00:00.000Z", now)).toMatchObject({ ok: true, stale: false });
  });
});

describe("the record's floor", () => {
  const address = { scopeId: "alice:~org:acme", key: "scheduled-fires/billing/digest" };

  it("refuses a time at or before the last fired one, whatever cron it is claimed under", async () => {
    const store = createInMemoryResourceStateStore();
    expect((await claimScheduledTime(store, address, { at: at("2026-10-21T10:00:00.000Z") })).outcome).toBe("claimed");
    // The schedule was edited, and a job stalled under its old cron delivers an earlier time.
    expect((await claimScheduledTime(store, address, { at: at("2026-10-21T09:30:00.000Z") })).outcome).toBe("duplicate");
    expect((await claimScheduledTime(store, address, { at: at("2026-10-21T10:00:00.000Z") })).outcome).toBe("duplicate");
    expect((await claimScheduledTime(store, address, { at: at("2026-10-21T10:30:00.000Z") })).outcome).toBe("claimed");
  });

  it("reads a record written with the cron and zone it fired under as its floor", async () => {
    const store = createInMemoryResourceStateStore();
    await store.set("user", address.scopeId, address.key, { lastFiredAt: at("2026-10-21T10:00:00.000Z"), cron: "0 * * * *", timezone: "UTC" }, 0);
    expect((await claimScheduledTime(store, address, { at: at("2026-10-21T09:45:00.000Z") })).outcome).toBe("duplicate");
  });
});
