/**
 * Postgres adapter compliance with the FIX-405 delta verb contract.
 *
 * Validates `patchField`, `incField`, and `pushToArray` on the Postgres
 * SessionStore (the other three stores use the same generic record store,
 * so coverage transitively applies). Mirrors the in-memory conformance
 * suite, plus a check that patchField sends only the changed value (the
 * reason the spec expects it to beat a full `set`), asserted on the SQL it
 * issues rather than on wall-clock time.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshPglite } from "./shared-pglite";
import type { JsonObject } from "@flow-state-dev/core/types";
import type { SessionRecord } from "@flow-state-dev/engine";
import { createPostgresStores, type PostgresStoreRegistry } from "../src";
import type { QueryExecutor } from "../src";

type RecordedQuery = { text: string; values?: unknown[] };

/** PGlite as a `QueryExecutor`; pushes each query onto `recorded` when given. */
function pgliteExecutor(pglite: PGlite, recorded?: RecordedQuery[]): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      recorded?.push({ text, values });
      const result = await pglite.query(text, values);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.affectedRows ?? 0
      };
    }
  };
}

function makeSession(
  id: string,
  version: number,
  state: JsonObject = {}
): SessionRecord {
  const ts = Date.now();
  return {
    id,
    flowKind: "flow-a",
    userId: "user_1",
    state,
    version,
    createdAt: ts,
    updatedAt: ts,
    journal: []
  };
}

describe("Postgres adapter — delta verb contract (FIX-405)", () => {
  let stores: PostgresStoreRegistry;
  let pglite: PGlite;

  afterEach(async () => {
    await stores?.close();
  });

  async function freshStores(recorded?: RecordedQuery[]): Promise<PostgresStoreRegistry> {
    pglite = await freshPglite();
    const executor = pgliteExecutor(pglite, recorded);
    stores = await createPostgresStores({ executor });
    return stores;
  }

  async function seed(
    s: PostgresStoreRegistry,
    id: string,
    state: JsonObject = {}
  ): Promise<void> {
    await s.session.set(id, makeSession(id, 0, state), "any");
  }

  describe("patchField", () => {
    it("replaces a single state field and bumps version + updatedAt", async () => {
      const s = await freshStores();
      await seed(s, "s1", { count: 0, mode: "idle" });

      const before = await s.session.get("s1");
      const result = await s.session.patchField!("s1", ["count"], 5, 0, Date.now());

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.version).toBe(1);
      const after = await s.session.get("s1");
      expect(after?.state).toEqual({ count: 5, mode: "idle" });
      expect(after?.version).toBe(1);
      expect(after?.updatedAt).toBeGreaterThanOrEqual(before!.updatedAt);
    });

    it("supports JSON object values", async () => {
      const s = await freshStores();
      await seed(s, "s1", {});
      await s.session.patchField!("s1", ["nested"], { a: 1, b: "x" }, 0, Date.now());

      const after = await s.session.get("s1");
      expect(after?.state).toEqual({ nested: { a: 1, b: "x" } });
    });

    it("supports null values", async () => {
      const s = await freshStores();
      await seed(s, "s1", { active: true });
      await s.session.patchField!("s1", ["active"], null, 0, Date.now());

      const after = await s.session.get("s1");
      expect(after?.state).toEqual({ active: null });
    });

    it("returns conflict with current value on stale expectedVersion", async () => {
      const s = await freshStores();
      await seed(s, "s1", { count: 0 });
      await s.session.patchField!("s1", ["count"], 1, 0, Date.now()); // v1

      const stale = await s.session.patchField!("s1", ["count"], 99, 0, Date.now());
      expect(stale.ok).toBe(false);
      if (stale.ok) return;
      expect(stale.conflict.currentVersion).toBe(1);
      expect(stale.conflict.currentValue?.state).toEqual({ count: 1 });
    });

    it('"any" applies unconditionally when a record exists', async () => {
      const s = await freshStores();
      await seed(s, "s1", { count: 0 });
      await s.session.patchField!("s1", ["count"], 1, 0, Date.now()); // v1

      const result = await s.session.patchField!("s1", ["count"], 42, "any", Date.now());
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.version).toBe(2);
      expect((await s.session.get("s1"))?.state).toEqual({ count: 42 });
    });

    it('"any" against a missing record returns conflict', async () => {
      const s = await freshStores();
      const result = await s.session.patchField!("missing", ["x"], 1, "any", Date.now());
      expect(result.ok).toBe(false);
    });
  });

  describe("incField", () => {
    it("adds delta to an existing numeric field", async () => {
      const s = await freshStores();
      await seed(s, "s1", { count: 10 });

      await s.session.incField!("s1", ["count"], 5, 0, Date.now());

      expect((await s.session.get("s1"))?.state).toEqual({ count: 15 });
    });

    it("treats a missing field as 0", async () => {
      const s = await freshStores();
      await seed(s, "s1", {});
      await s.session.incField!("s1", ["count"], 3, 0, Date.now());

      expect((await s.session.get("s1"))?.state).toEqual({ count: 3 });
    });

    it("supports negative deltas and decimals", async () => {
      const s = await freshStores();
      await seed(s, "s1", { balance: 100 });
      await s.session.incField!("s1", ["balance"], -25.5, 0, Date.now());

      expect((await s.session.get("s1"))?.state).toEqual({ balance: 74.5 });
    });

    it("N sequential increments converge", async () => {
      const s = await freshStores();
      await seed(s, "s1", { count: 0 });
      for (let i = 0; i < 10; i++) {
        await s.session.incField!("s1", ["count"], 1, i, Date.now());
      }
      const after = await s.session.get("s1");
      expect(after?.state).toEqual({ count: 10 });
      expect(after?.version).toBe(10);
    });
  });

  describe("pushToArray", () => {
    it("appends to an existing array", async () => {
      const s = await freshStores();
      await seed(s, "s1", { items: ["a"] });
      await s.session.pushToArray!("s1", ["items"], ["b", "c"], 0, Date.now());

      expect((await s.session.get("s1"))?.state).toEqual({
        items: ["a", "b", "c"]
      });
    });

    it("treats a missing field as []", async () => {
      const s = await freshStores();
      await seed(s, "s1", {});
      await s.session.pushToArray!("s1", ["log"], ["first"], 0, Date.now());

      expect((await s.session.get("s1"))?.state).toEqual({ log: ["first"] });
    });

    it("throws on a non-array when expectedVersion is \"any\"", async () => {
      const s = await freshStores();
      await seed(s, "s1", { log: "not-an-array" });
      await expect(
        s.session.pushToArray!("s1", ["log"], ["x"], "any", Date.now())
      ).rejects.toThrow(/not an array/);
      expect((await s.session.get("s1"))?.state).toEqual({ log: "not-an-array" });
    });

    it("preserves order across multiple pushes", async () => {
      const s = await freshStores();
      await seed(s, "s1", {});
      await s.session.pushToArray!("s1", ["log"], ["a"], 0, Date.now());
      await s.session.pushToArray!("s1", ["log"], ["b"], 1, Date.now());
      await s.session.pushToArray!("s1", ["log"], ["c"], 2, Date.now());

      expect((await s.session.get("s1"))?.state).toEqual({
        log: ["a", "b", "c"]
      });
    });

    it("supports pushing object values", async () => {
      const s = await freshStores();
      await seed(s, "s1", { log: [] });
      await s.session.pushToArray!(
        "s1",
        ["log"],
        [{ ts: 1, msg: "hello" }],
        0,
        Date.now()
      );

      expect((await s.session.get("s1"))?.state).toEqual({
        log: [{ ts: 1, msg: "hello" }]
      });
    });
  });

  describe("non-state field preservation", () => {
    it("delta verbs preserve indexed columns and other top-level data fields", async () => {
      const s = await freshStores();
      await seed(s, "s1", { count: 0 });
      const before = await s.session.get("s1");
      expect(before?.flowKind).toBe("flow-a");
      expect(before?.userId).toBe("user_1");

      await s.session.patchField!("s1", ["count"], 1, 0, Date.now());

      const after = await s.session.get("s1");
      expect(after?.flowKind).toBe("flow-a");
      expect(after?.userId).toBe("user_1");
      expect(after?.id).toBe("s1");
      expect(after?.createdAt).toBe(before?.createdAt);
    });
  });

  describe("patchField takes the delta path, not a full-record write", () => {
    // The spec's "100 patchField faster than 100 set" criterion comes from
    // what each path sends to Postgres: the JSONB delta path ships only the
    // changed value, `set` ships the whole serialized record. Timing the two
    // on PGlite measured CI load, not that difference, so this test asserts
    // the difference itself: what SQL each call issues and what it carries.
    // If patchField regressed to a read-modify-write or a full `set`, its
    // queries would carry the untouched fields and the assertions fail.
    it("each patchField is one jsonb_set UPDATE that never carries the untouched fields", async () => {
      const recorded: RecordedQuery[] = [];
      const s = await freshStores(recorded);

      // Wide state: 50 fields the patch never touches. Their payload is the
      // marker for "the whole record went over the wire".
      const untouched = "value_with_some_payload_padding";
      const wideState: JsonObject = {};
      for (let i = 0; i < 50; i++) {
        wideState[`field_${i}`] = `${untouched}_${i}`;
      }
      await seed(s, "patch_target", { ...wideState, count: 0 });
      await seed(s, "set_target", { ...wideState, count: 0 });

      const carriesUntouched = (q: RecordedQuery): boolean =>
        JSON.stringify(q.values ?? []).includes(untouched);

      recorded.length = 0;
      for (let i = 0; i < 100; i++) {
        const result = await s.session.patchField!(
          "patch_target",
          ["count"],
          i + 1,
          i,
          Date.now()
        );
        if (!result.ok) throw new Error("unexpected conflict");
      }
      const patchQueries = recorded.splice(0);

      // One round trip per call: no read before the write.
      expect(patchQueries).toHaveLength(100);
      for (const q of patchQueries) {
        expect(q.text).toMatch(/^\s*UPDATE\b/);
        expect(q.text).toContain("jsonb_set");
        expect(carriesUntouched(q)).toBe(false);
      }

      // Control: the full-record path does carry the untouched fields, so
      // the check above can tell the two paths apart.
      for (let i = 0; i < 100; i++) {
        const result = await s.session.set(
          "set_target",
          makeSession("set_target", i + 1, { ...wideState, count: i + 1 }),
          i
        );
        if (!result.ok) throw new Error("unexpected conflict");
      }
      const setQueries = recorded.splice(0);
      expect(setQueries.length).toBeGreaterThanOrEqual(100);
      expect(setQueries.every(carriesUntouched)).toBe(true);

      // Both paths reach the same end state.
      expect((await s.session.get("patch_target"))?.state).toEqual({
        ...wideState,
        count: 100
      });
      expect((await s.session.get("set_target"))?.state).toEqual({
        ...wideState,
        count: 100
      });
    });
  });
});
