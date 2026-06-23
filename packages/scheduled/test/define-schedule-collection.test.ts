/**
 * Unit tests for `defineScheduleCollection` — covers the
 * collection-shape it produces and that lifecycle hooks correctly
 * mirror create/update/delete into a `ScheduleIndex` (via a small
 * in-memory fake).
 */
import { describe, expect, it } from "vitest";
import { defineScheduleCollection } from "../src/defineScheduleCollection";
import type { ScheduleIndex, ScheduleIndexRow } from "../src/scheduleIndex";

/**
 * In-memory `ScheduleIndex` used to observe hook side-effects.
 * Mirrors the contract loosely — claimDue is not exercised by these
 * tests (the real backends are covered by the conformance suite).
 */
function createFakeIndex(): ScheduleIndex & { rows: Map<string, ScheduleIndexRow> } {
  const rows = new Map<string, ScheduleIndexRow>();
  return {
    rows,
    async upsert(row) {
      rows.set(`${row.userId}/${row.key}`, row);
    },
    async remove(userId, key) {
      rows.delete(`${userId}/${key}`);
    },
    async claimDue() {
      return [];
    }
  };
}

const HOOK_CTX = {
  log: () => {},
  scopeType: "user" as const,
  scopeId: "user-1"
};

describe("defineScheduleCollection", () => {
  it("produces a user-scoped collection with the schedule schema", () => {
    const coll = defineScheduleCollection({ pattern: "schedules/*" });
    expect(coll.scope).toBe("user");
    expect(coll.pattern).toBe("schedules/*");
    // No index → no hooks installed
    expect(coll.onInstanceCreated).toBeUndefined();
    expect(coll.onInstanceUpdated).toBeUndefined();
    expect(coll.onInstanceDeleted).toBeUndefined();
  });

  it("installs hooks when an index is provided", () => {
    const index = createFakeIndex();
    const coll = defineScheduleCollection({ pattern: "schedules/*", index });
    expect(coll.onInstanceCreated).toBeDefined();
    expect(coll.onInstanceUpdated).toBeDefined();
    expect(coll.onInstanceDeleted).toBeDefined();
  });

  it("onInstanceCreated mirrors into the index", async () => {
    const index = createFakeIndex();
    const coll = defineScheduleCollection({ pattern: "schedules/*", index });
    await coll.onInstanceCreated!(
      "schedules/weekly",
      { cron: "0 0 * * 0", kind: "send-digest", enabled: true },
      HOOK_CTX
    );
    expect(index.rows.size).toBe(1);
    const row = index.rows.get("user-1/weekly")!;
    expect(row.key).toBe("weekly");
    expect(row.userId).toBe("user-1");
    expect(row.cron).toBe("0 0 * * 0");
    expect(row.nextFireAt).toBeGreaterThan(Date.now() - 1000);
  });

  it("onInstanceCreated skips disabled schedules", async () => {
    const index = createFakeIndex();
    const coll = defineScheduleCollection({ pattern: "schedules/*", index });
    await coll.onInstanceCreated!(
      "schedules/disabled",
      { cron: "0 0 * * 0", kind: "noop", enabled: false },
      HOOK_CTX
    );
    expect(index.rows.size).toBe(0);
  });

  it("onInstanceUpdated removes the row when toggled off", async () => {
    const index = createFakeIndex();
    const coll = defineScheduleCollection({ pattern: "schedules/*", index });
    await coll.onInstanceCreated!(
      "schedules/weekly",
      { cron: "0 0 * * 0", kind: "send-digest", enabled: true },
      HOOK_CTX
    );
    expect(index.rows.size).toBe(1);

    await coll.onInstanceUpdated!(
      "schedules/weekly",
      { cron: "0 0 * * 0", kind: "send-digest", enabled: false },
      { cron: "0 0 * * 0", kind: "send-digest", enabled: true },
      HOOK_CTX
    );
    expect(index.rows.size).toBe(0);
  });

  it("onInstanceUpdated re-upserts when re-enabled (and recomputes nextFireAt)", async () => {
    const index = createFakeIndex();
    const coll = defineScheduleCollection({ pattern: "schedules/*", index });
    await coll.onInstanceUpdated!(
      "schedules/weekly",
      { cron: "*/5 * * * *", kind: "noop", enabled: true },
      { cron: "0 0 * * 0", kind: "noop", enabled: true },
      HOOK_CTX
    );
    expect(index.rows.size).toBe(1);
    expect(index.rows.get("user-1/weekly")!.cron).toBe("*/5 * * * *");
  });

  it("onInstanceDeleted removes the row", async () => {
    const index = createFakeIndex();
    const coll = defineScheduleCollection({ pattern: "schedules/*", index });
    await coll.onInstanceCreated!(
      "schedules/weekly",
      { cron: "0 0 * * 0", kind: "noop", enabled: true },
      HOOK_CTX
    );
    await coll.onInstanceDeleted!("schedules/weekly", HOOK_CTX);
    expect(index.rows.size).toBe(0);
  });

  it("logs and skips when cron fails to parse", async () => {
    const index = createFakeIndex();
    const coll = defineScheduleCollection({ pattern: "schedules/*", index });
    await coll.onInstanceCreated!(
      "schedules/bad",
      { cron: "not a cron", kind: "noop", enabled: true },
      HOOK_CTX
    );
    expect(index.rows.size).toBe(0);
  });
});
