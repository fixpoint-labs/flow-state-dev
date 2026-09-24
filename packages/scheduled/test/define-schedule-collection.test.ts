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

    /**
     * Absent is NOT the same as mismatched, and treating it as such is what
     * silently stopped org-less schedules from ever firing.
     *
     * `schedules.create(key, { cron, kind, enabled })` is the documented way to
     * make a schedule and produces exactly this state. Refusing it indexed
     * nothing, returned success, and logged only a server-side warning — the
     * caller was told their schedule existed and it never fired.
     *
     * A row with no organization carries no claim, so there is nothing to
     * contradict: `ctx.orgId` is server-derived, so stamping it is the server
     * recording what it already knows. A row naming a DIFFERENT organization is
     * a claim that disagrees, and that one still stays out (the test above).
     */
    it("stamps the execution's own organization on a row that stores none", async () => {
      const index = createFakeIndex();
      const coll = defineScheduleCollection({ pattern: "schedules/*", index });
      await coll.onInstanceCreated!(
        "schedules/legacy",
        { cron: "0 0 * * 0", kind: "send-digest", enabled: true },
        HOOK_CTX
      );
      expect(index.rows.size).toBe(1);
      expect(index.rows.get("user-1/legacy")?.orgId).toBe(EXEC_ORG);
    });

    /**
     * The update half. Without it a create that stamped the org would be undone
     * the first time the row was edited: the resource state still stores no
     * organization (the hook fires after the write commits, so it cannot write
     * one back), so an update that re-applied the strict equality would pull
     * the row straight back out of the index and the schedule would stop.
     */
    it("keeps a row that stores no organization indexed across an update", async () => {
      const index = createFakeIndex();
      const coll = defineScheduleCollection({ pattern: "schedules/*", index });
      const state = { cron: "0 0 * * 0", kind: "send-digest", enabled: true };
      await coll.onInstanceCreated!("schedules/legacy", state, HOOK_CTX);
      await coll.onInstanceUpdated!(
        "schedules/legacy",
        { ...state, cron: "0 9 * * 1" },
        state,
        HOOK_CTX
      );
      expect(index.rows.size).toBe(1);
      expect(index.rows.get("user-1/legacy")?.cron).toBe("0 9 * * 1");
    });
  });

  /**
   * FIX-1442 review, round 3 — what `(userId, key)` identity means across
   * organizations.
   *
   * The schedule collection is USER-scoped (`scope: "user"` is forced above),
   * and a user-scoped resource's storage identity is the bare `userId` — the
   * organization never enters it (`resolveResourceScopeId`). So two
   * organizations cannot hold two different schedules at one `(userId, key)`:
   * they hold the SAME resource, and the index's `PRIMARY KEY (user_id, key)`
   * mirrors that key space exactly rather than collapsing anything.
   *
   * What that leaves is not a key collision but an ATTRIBUTION one, and only
   * for a row whose state names no organization. `create` now stamps the
   * state and updates keep it (`stampOrgId`), so that is a row written before
   * the stamp. The hook's own stamp lands on the index row and never
   * on the state (it fires after the write commits), so such a state stays
   * org-less, `indexOrgFor` returns the writing execution's org every time,
   * and BR-19's disagreement check — the whole enforcement of the binding —
   * never engages for that row. These tests pin that, so the gap is visible
   * rather than inferred.
   */
  describe("cross-organization writes at one (userId, key)", () => {
    /** A second execution: same user, a different organization. */
    const OTHER_ORG_CTX = { ...HOOK_CTX, orgId: "org-globex" };

    it("re-stamps an org-less row with whichever organization last wrote it", async () => {
      const index = createFakeIndex();
      const coll = defineScheduleCollection({ pattern: "schedules/*", index });
      // A row whose state names no organization (written before `create`
      // stamped one).
      const state = { cron: "0 0 * * 0", kind: "send-digest", enabled: true };
      await coll.onInstanceCreated!("schedules/digest", state, HOOK_CTX);
      expect(index.rows.get("user-1/digest")?.orgId).toBe(EXEC_ORG);

      // The same user, acting under a different organization, edits the row.
      await coll.onInstanceUpdated!(
        "schedules/digest",
        { ...state, cron: "0 9 * * 1" },
        state,
        OTHER_ORG_CTX
      );

      // Still one row — same key space — but it now fires into org-globex.
      // BR-19 did not engage: the state named no organization to disagree with.
      expect(index.rows.size).toBe(1);
      expect(index.rows.get("user-1/digest")?.orgId).toBe("org-globex");
    });

    it("lets a second organization unschedule an org-less row by disabling it", async () => {
      const index = createFakeIndex();
      const coll = defineScheduleCollection({ pattern: "schedules/*", index });
      const state = { cron: "0 0 * * 0", kind: "send-digest", enabled: true };
      await coll.onInstanceCreated!("schedules/digest", state, HOOK_CTX);
      expect(index.rows.size).toBe(1);

      await coll.onInstanceUpdated!(
        "schedules/digest",
        { ...state, enabled: false },
        state,
        OTHER_ORG_CTX
      );
      expect(index.rows.size).toBe(0);
    });

    /**
     * The control, and the reason the two above are about attribution rather
     * than about the key: once the state NAMES an organization, BR-19 does
     * engage from the other organization, and the row comes out instead of
     * being re-pointed. An attributed row is protected; an org-less one is not.
     */
    it("refuses the same cross-organization update once the state names an org", async () => {
      const index = createFakeIndex();
      const coll = defineScheduleCollection({ pattern: "schedules/*", index });
      const state = bound({ cron: "0 0 * * 0", kind: "send-digest", enabled: true });
      await coll.onInstanceCreated!("schedules/digest", state, HOOK_CTX);
      expect(index.rows.get("user-1/digest")?.orgId).toBe(EXEC_ORG);

      await coll.onInstanceUpdated!(
        "schedules/digest",
        { ...state, cron: "0 9 * * 1" },
        state,
        OTHER_ORG_CTX
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
