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

/** The organization the writing execution was admitted under. */
const EXEC_ORG = "org-acme";

/**
 * A real `orgId` on both sides, deliberately.
 *
 * `bindingIsTrusted` compares the row's stored organization with this one, so a
 * ctx with no `orgId` and states with no `orgId` would compare `undefined` to
 * `undefined` and pass every case in this file WITHOUT the guard ever deciding
 * anything (BR-19). The mismatch cases below are the only reason the guard is
 * observable at all, and they only work if the agreeing cases really agree.
 */
const HOOK_CTX = {
  log: () => {},
  scopeType: "user" as const,
  scopeId: "user-1",
  orgId: EXEC_ORG
};

/** A schedule state bound to the organization `HOOK_CTX` runs in. */
function bound(state: {
  cron: string;
  kind: string;
  enabled: boolean;
  orgId?: string;
}): Record<string, unknown> {
  const { orgId = EXEC_ORG, ...rest } = state;
  return { ...rest, orgId };
}

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
      bound({ cron: "0 0 * * 0", kind: "send-digest", enabled: true }),
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
      bound({ cron: "0 0 * * 0", kind: "noop", enabled: false }),
      HOOK_CTX
    );
    expect(index.rows.size).toBe(0);
  });

  it("onInstanceUpdated removes the row when toggled off", async () => {
    const index = createFakeIndex();
    const coll = defineScheduleCollection({ pattern: "schedules/*", index });
    await coll.onInstanceCreated!(
      "schedules/weekly",
      bound({ cron: "0 0 * * 0", kind: "send-digest", enabled: true }),
      HOOK_CTX
    );
    expect(index.rows.size).toBe(1);

    await coll.onInstanceUpdated!(
      "schedules/weekly",
      bound({ cron: "0 0 * * 0", kind: "send-digest", enabled: false }),
      bound({ cron: "0 0 * * 0", kind: "send-digest", enabled: true }),
      HOOK_CTX
    );
    expect(index.rows.size).toBe(0);
  });

  it("onInstanceUpdated re-upserts when re-enabled (and recomputes nextFireAt)", async () => {
    const index = createFakeIndex();
    const coll = defineScheduleCollection({ pattern: "schedules/*", index });
    await coll.onInstanceUpdated!(
      "schedules/weekly",
      bound({ cron: "*/5 * * * *", kind: "noop", enabled: true }),
      bound({ cron: "0 0 * * 0", kind: "noop", enabled: true }),
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
      bound({ cron: "0 0 * * 0", kind: "noop", enabled: true }),
      HOOK_CTX
    );
    await coll.onInstanceDeleted!("schedules/weekly", HOOK_CTX);
    expect(index.rows.size).toBe(0);
  });

  describe("BR-19 · the row's organization must be the writing execution's", () => {
    /**
     * A schedule is a standing instruction that fires later, into the
     * organization its row names. A write that moves that binding is not an
     * update to honour — it points somebody else's standing instruction
     * somewhere new. The hook observes the write rather than transforming it,
     * so it enforces the rule by refusing to INDEX the row: an unindexed
     * schedule never fires.
     *
     * BR-19 therefore holds for FIRING, not for the write — the durable row is
     * still overwritten by the disagreeing execution. That is the accepted
     * limit of a post-write observer hook, and these tests pin both halves.
     */
    it("does not index a created row bound to another organization", async () => {
      const index = createFakeIndex();
      const coll = defineScheduleCollection({ pattern: "schedules/*", index });
      await coll.onInstanceCreated!(
        "schedules/weekly",
        bound({ cron: "0 0 * * 0", kind: "send-digest", enabled: true, orgId: "org-globex" }),
        HOOK_CTX
      );
      expect(index.rows.size).toBe(0);
    });

    it("indexes the same row when it names the execution's own organization", async () => {
      // The control for the refusal above: without it, "nothing was indexed"
      // is also what a hook that indexes nothing at all would produce.
      const index = createFakeIndex();
      const coll = defineScheduleCollection({ pattern: "schedules/*", index });
      await coll.onInstanceCreated!(
        "schedules/weekly",
        bound({ cron: "0 0 * * 0", kind: "send-digest", enabled: true }),
        HOOK_CTX
      );
      expect(index.rows.get("user-1/weekly")?.orgId).toBe(EXEC_ORG);
    });

    it("takes an already-indexed row OUT of the index when an update moves its binding", async () => {
      const index = createFakeIndex();
      const coll = defineScheduleCollection({ pattern: "schedules/*", index });
      await coll.onInstanceCreated!(
        "schedules/weekly",
        bound({ cron: "0 0 * * 0", kind: "send-digest", enabled: true }),
        HOOK_CTX
      );
      expect(index.rows.size).toBe(1);

      await coll.onInstanceUpdated!(
        "schedules/weekly",
        bound({ cron: "0 0 * * 0", kind: "send-digest", enabled: true, orgId: "org-globex" }),
        bound({ cron: "0 0 * * 0", kind: "send-digest", enabled: true }),
        HOOK_CTX
      );

      // Out, not re-indexed under either organization: the schedule stops
      // firing until it is written from the organization it names.
      expect(index.rows.size).toBe(0);
    });

    it("refuses a row with no organization at all, the same as a mismatched one", async () => {
      // A legacy row predating organizations. Refused by the same equality —
      // `undefined` is not the execution's org — so no separate clause is
      // needed, but the behaviour is load-bearing and pinned here.
      const index = createFakeIndex();
      const coll = defineScheduleCollection({ pattern: "schedules/*", index });
      await coll.onInstanceCreated!(
        "schedules/legacy",
        { cron: "0 0 * * 0", kind: "send-digest", enabled: true },
        HOOK_CTX
      );
      expect(index.rows.size).toBe(0);
    });
  });

  it("logs and skips when cron fails to parse", async () => {
    const index = createFakeIndex();
    const coll = defineScheduleCollection({ pattern: "schedules/*", index });
    await coll.onInstanceCreated!(
      "schedules/bad",
      bound({ cron: "not a cron", kind: "noop", enabled: true }),
      HOOK_CTX
    );
    expect(index.rows.size).toBe(0);
  });
});
