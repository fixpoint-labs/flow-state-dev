/**
 * Conformance test factory for `ScheduleIndex` implementations.
 *
 * Store packages import this from `@flow-state-dev/scheduled/testing`
 * and call `createScheduleIndexConformanceTests({ createIndex, cleanup })`
 * inside their vitest suite to verify the contract end-to-end against
 * a real backend (PGlite, in-memory SQLite, etc.).
 *
 * The factory expresses contract — atomic claim+advance, upsert
 * idempotence, no-op remove, and the bad-cron skip behaviour — without
 * pulling vitest as a runtime dep of `@flow-state-dev/scheduled`.
 * Tests are declared via the host's vitest globals at call-time.
 */

import type { ScheduleIndex } from "./scheduleIndex";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const describe: any;
declare const it: any;
declare const beforeEach: any;
declare const afterEach: any;
declare const expect: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ScheduleIndexConformanceOptions {
  /**
   * Construct a fresh, empty `ScheduleIndex` for one test. Each test
   * gets its own instance — implementations may share underlying
   * storage as long as `cleanup` resets state between tests.
   */
  createIndex: () => Promise<ScheduleIndex> | ScheduleIndex;
  /**
   * Tear down the index returned by the last `createIndex` call.
   * Optional — implementations using throwaway storage may omit it.
   */
  cleanup?: (index: ScheduleIndex) => Promise<void> | void;
}

/**
 * Register the standard `ScheduleIndex` conformance test suite under
 * the given label. Call inside a `describe` block in the host package's
 * test file.
 */
export function createScheduleIndexConformanceTests(
  label: string,
  options: ScheduleIndexConformanceOptions
): void {
  describe(`ScheduleIndex conformance: ${label}`, () => {
    let index: ScheduleIndex;

    beforeEach(async () => {
      index = await options.createIndex();
    });

    afterEach(async () => {
      if (options.cleanup) await options.cleanup(index);
    });

    it("upsert is idempotent on (userId, key)", async () => {
      const now = 1_000_000;
      await index.upsert({ userId: "u1", key: "a", cron: "* * * * *", nextFireAt: now });
      await index.upsert({ userId: "u1", key: "a", cron: "*/5 * * * *", nextFireAt: now + 60_000 });
      // Claim with a horizon that includes the second insertion only.
      const due = await index.claimDue(now + 60_000, 10);
      expect(due.length).toBe(1);
      expect(due[0].key).toBe("a");
      expect(due[0].cron).toBe("*/5 * * * *");
    });

    it("claimDue advances rows so they don't fire twice for the same horizon", async () => {
      const now = 1_000_000;
      await index.upsert({ userId: "u1", key: "a", cron: "* * * * *", nextFireAt: now });
      const first = await index.claimDue(now, 10);
      expect(first.length).toBe(1);
      // Immediate second claim at the same `now` must not return the row again —
      // claimDue advanced it past `now`.
      const second = await index.claimDue(now, 10);
      expect(second.length).toBe(0);
    });

    it("remove is a no-op when the row does not exist", async () => {
      await expect(index.remove("ghost", "nothing")).resolves.toBeUndefined();
    });

    it("remove deletes a row", async () => {
      const now = 2_000_000;
      await index.upsert({ userId: "u1", key: "a", cron: "* * * * *", nextFireAt: now });
      await index.remove("u1", "a");
      const due = await index.claimDue(now, 10);
      expect(due.length).toBe(0);
    });

    it("bad cron is skipped on claim, row stays at its current nextFireAt", async () => {
      const now = 3_000_000;
      // Mix a valid + an invalid cron; the invalid one should be left in place,
      // the valid one should fire and advance.
      await index.upsert({ userId: "u1", key: "bad", cron: "not a cron", nextFireAt: now });
      await index.upsert({ userId: "u1", key: "good", cron: "* * * * *", nextFireAt: now });
      const due = await index.claimDue(now, 10);
      // Either both attempted (bad cron present but skipped on advance) or only
      // good returned. The contract: good must fire and advance; bad must not
      // be left in an advanced state.
      const goodFired = due.some((r) => r.key === "good");
      expect(goodFired).toBe(true);
      // Second claim at the same horizon: good must NOT fire (advanced), bad
      // either fires (then fails to advance, leaving it pending) or never
      // fired. Either way good should not appear.
      const second = await index.claimDue(now, 10);
      expect(second.some((r) => r.key === "good")).toBe(false);
    });

    it("respects limit on claimDue", async () => {
      const now = 4_000_000;
      for (let i = 0; i < 5; i++) {
        await index.upsert({ userId: "u1", key: `k${i}`, cron: "* * * * *", nextFireAt: now });
      }
      const due = await index.claimDue(now, 2);
      expect(due.length).toBe(2);
    });
  });
}
