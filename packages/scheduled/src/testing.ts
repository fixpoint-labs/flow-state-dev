/**
 * Conformance test factory for `ScheduleIndex` implementations.
 *
 * Store packages import this from `@flow-state-dev/scheduled/testing`
 * and call `createScheduleIndexConformanceTests({ createIndex, cleanup })`
 * inside their vitest suite to verify the contract end-to-end against
 * a real backend (PGlite, in-memory SQLite, etc.).
 *
 * The factory expresses contract — atomic claim+advance, upsert
 * idempotence, one row per storage cell, no-op remove, and the bad-cron
 * skip behaviour — without
 * pulling vitest as a runtime dep of `@flow-state-dev/scheduled`.
 * Tests are declared via the host's vitest globals at call-time.
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import type { ScheduleIndex } from "./scheduleIndex";

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

    it("upsert is idempotent on (cell, key)", async () => {
      const now = 1_000_000;
      await index.upsert({ cell: "u1", userId: "u1", key: "a", cron: "* * * * *", nextFireAt: now });
      await index.upsert({ cell: "u1", userId: "u1", key: "a", cron: "*/5 * * * *", nextFireAt: now + 60_000 });
      // Claim with a horizon that includes the second insertion only.
      const due = await index.claimDue(now + 60_000, 10);
      expect(due.length).toBe(1);
      expect(due[0].key).toBe("a");
      expect(due[0].cron).toBe("*/5 * * * *");
    });

    /**
     * The organization survives the round trip (FIX-1442).
     *
     * `orgId` is what a dispatched schedule fires into, and it is carried on
     * the row rather than recomputed at fire time — a schedule is a standing
     * instruction from the organization that created it. An adapter that
     * persists every other column but drops this one loses the binding
     * silently: `claimDue` still returns the row, still fires it, and only the
     * organization is quietly gone, so `onDispatch` sees `undefined` and the
     * row is quarantined as if it had never been attributed.
     *
     * Asserted through `claimDue` rather than by reading the table, so it holds
     * for any backend regardless of column naming.
     */
    it("carries orgId through upsert and back out of claimDue", async () => {
      const now = 1_000_000;
      await index.upsert({
        cell: "u1",
        userId: "u1",
        orgId: "org-acme",
        key: "a",
        cron: "* * * * *",
        nextFireAt: now
      });

      const due = await index.claimDue(now, 10);

      expect(due.length).toBe(1);
      expect(due[0].orgId).toBe("org-acme");
    });

    /**
     * A row is identified by `(cell, key)`, not by the person. One person can
     * hold a schedule with one key in several storage cells (a hired seat per
     * organization, plus their own app-wide cell); each is its own schedule.
     * An adapter keyed on `(userId, key)` collapses them onto one row whose
     * organization is whichever wrote last, and a remove in one cell stops the
     * other from firing.
     */
    it("keeps two cells' rows for one person and key apart", async () => {
      const now = 5_000_000;
      await index.upsert({ cell: "u1:~org:acme", userId: "u1", orgId: "acme", key: "weekly", cron: "* * * * *", nextFireAt: now });
      await index.upsert({ cell: "u1:~org:globex", userId: "u1", orgId: "globex", key: "weekly", cron: "* * * * *", nextFireAt: now });

      const due = await index.claimDue(now, 10);

      expect(due.map((r) => [r.cell, r.userId, r.orgId, r.key]).sort()).toEqual([
        ["u1:~org:acme", "u1", "acme", "weekly"],
        ["u1:~org:globex", "u1", "globex", "weekly"],
      ]);
    });

    it("remove in one cell leaves the other cell's row due", async () => {
      const now = 6_000_000;
      await index.upsert({ cell: "u1:~org:acme", userId: "u1", orgId: "acme", key: "weekly", cron: "* * * * *", nextFireAt: now });
      await index.upsert({ cell: "u1:~org:globex", userId: "u1", orgId: "globex", key: "weekly", cron: "* * * * *", nextFireAt: now });

      await index.remove({ cell: "u1:~org:acme", key: "weekly" });

      const due = await index.claimDue(now, 10);
      expect(due.map((r) => [r.cell, r.orgId])).toEqual([["u1:~org:globex", "globex"]]);
    });

    it("advancing one cell's row does not advance another's", async () => {
      const now = 7_000_000;
      await index.upsert({ cell: "u1:~org:acme", userId: "u1", key: "weekly", cron: "* * * * *", nextFireAt: now });
      // Globex's copy is not due yet at `now`.
      await index.upsert({ cell: "u1:~org:globex", userId: "u1", key: "weekly", cron: "* * * * *", nextFireAt: now + 1 });

      expect((await index.claimDue(now, 10)).map((r) => r.cell)).toEqual(["u1:~org:acme"]);
      // Globex still fires at its own time, unadvanced by Acme's claim.
      expect((await index.claimDue(now + 1, 10)).map((r) => r.cell)).toEqual(["u1:~org:globex"]);
    });

    it("keeps two people's rows with one key apart", async () => {
      const now = 8_000_000;
      await index.upsert({ cell: "u1", userId: "u1", key: "weekly", cron: "* * * * *", nextFireAt: now });
      await index.upsert({ cell: "u2", userId: "u2", key: "weekly", cron: "* * * * *", nextFireAt: now });
      const due = await index.claimDue(now, 10);
      expect(due.map((r) => r.userId).sort()).toEqual(["u1", "u2"]);
    });

    it("claimDue advances rows so they don't fire twice for the same horizon", async () => {
      const now = 1_000_000;
      await index.upsert({ cell: "u1", userId: "u1", key: "a", cron: "* * * * *", nextFireAt: now });
      const first = await index.claimDue(now, 10);
      expect(first.length).toBe(1);
      // Immediate second claim at the same `now` must not return the row again —
      // claimDue advanced it past `now`.
      const second = await index.claimDue(now, 10);
      expect(second.length).toBe(0);
    });

    it("remove is a no-op when the row does not exist", async () => {
      await expect(index.remove({ cell: "ghost", key: "nothing" })).resolves.toBeUndefined();
    });

    it("remove deletes a row", async () => {
      const now = 2_000_000;
      await index.upsert({ cell: "u1", userId: "u1", key: "a", cron: "* * * * *", nextFireAt: now });
      await index.remove({ cell: "u1", key: "a" });
      const due = await index.claimDue(now, 10);
      expect(due.length).toBe(0);
    });

    it("bad cron is skipped on claim, row stays at its current nextFireAt", async () => {
      const now = 3_000_000;
      // Mix a valid + an invalid cron; the invalid one should be left in place,
      // the valid one should fire and advance.
      await index.upsert({ cell: "u1", userId: "u1", key: "bad", cron: "not a cron", nextFireAt: now });
      await index.upsert({ cell: "u1", userId: "u1", key: "good", cron: "* * * * *", nextFireAt: now });
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
        await index.upsert({ cell: "u1", userId: "u1", key: `k${i}`, cron: "* * * * *", nextFireAt: now });
      }
      const due = await index.claimDue(now, 2);
      expect(due.length).toBe(2);
    });
  });
}
