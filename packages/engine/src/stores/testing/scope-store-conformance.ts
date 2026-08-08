/**
 * Shared conformance suite for the **scope** stores' CAS write contract.
 *
 * The four scope stores — session, request, user, org — share one
 * `ExpectedVersion` contract across four adapter families (memory, filesystem,
 * SQLite, Postgres) with no compiler to enforce that they agree. This suite is
 * what makes them agree, the same way `createResourceStateStoreConformanceTests`
 * does for the resource side. Every adapter runs it from its own package via
 * `@flow-state-dev/engine/testing`.
 *
 * It runs against each adapter's `SessionStore`. That is sufficient coverage
 * for all four scope stores per adapter, because within an adapter family all
 * four are built from one shared write helper (`casWriteToMap`, the filesystem
 * record store, the two SQL record stores) — the predicate under test has
 * exactly one implementation per family.
 *
 * ## What it is really pinning
 *
 * `expectedVersion: "absent"` (create-if-absent) and the fact that `0` did
 * **not** change meaning. Scope records are created *at* version `0`, so `0` is
 * a live version here and cannot express "must not exist" — the reason this
 * contract needed a non-numeric sentinel at all. Both halves are asserted
 * together, because the failure mode of getting this wrong is not a type error
 * but a wrong answer: `"absent" !== 5` is a perfectly good comparison.
 *
 * Cases that need two connections over one database (`createSharedPair`) are
 * skipped when an adapter cannot provide them. For the SQL adapters that hook
 * is not optional in practice — see the note on `createSharedPair`.
 */
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@flow-state-dev/core/types";
import type { ExpectedVersion, SessionRecord, SetResult } from "../types";

/**
 * The slice of a scope store this suite exercises. Structurally satisfied by
 * every adapter's `SessionStore`; the delta verbs stay optional because the
 * contract lets an adapter implement none of them.
 */
export type ScopeStoreUnderTest = {
  get(id: string): Promise<SessionRecord | undefined>;
  set(
    id: string,
    value: SessionRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<SessionRecord>>;
  delete(id: string): Promise<void>;
  patchField?(
    id: string,
    path: string[],
    value: unknown,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<SessionRecord>>;
  incField?(
    id: string,
    path: string[],
    delta: number,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<SessionRecord>>;
  pushToArray?(
    id: string,
    path: string[],
    values: unknown[],
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<SessionRecord>>;
  deleteField?(
    id: string,
    path: string[],
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<SessionRecord>>;
};

export type CreateScopeStoreConformanceTestsOptions = {
  /** Display name surfaced in the `describe` block, e.g. `"SQLiteSessionStore"`. */
  name: string;
  /** Build a fresh store. Called per-test so cases run against an empty backend. */
  createStore: () => ScopeStoreUnderTest | Promise<ScopeStoreUnderTest>;
  /** Optional teardown hook for adapters with external resources. */
  cleanup?: (store: ScopeStoreUnderTest) => Promise<void> | void;
  /**
   * Build **two** stores over **one** backing database, simulating two nodes.
   *
   * Supply this wherever the backend can actually be shared. It is what
   * distinguishes an atomic create-if-absent from a read-then-insert: a
   * single-process `Promise.all` proves ordering, not atomicity. On
   * `better-sqlite3` in particular nothing yields between two statements
   * inside one process, so the interleaving that breaks a non-atomic
   * implementation cannot even occur in-process — a read-then-insert would
   * pass every other case here and still lose the race in production.
   *
   * Omit it only for adapters with no cross-connection notion (in-memory), or
   * where the store's own guarantee is explicitly in-process (filesystem,
   * whose lock is held on the instance).
   */
  createSharedPair?: () => Promise<{
    a: ScopeStoreUnderTest;
    b: ScopeStoreUnderTest;
    cleanup?: () => Promise<void> | void;
  }>;
};

function makeSession(id: string, version: number, state: JsonObject = {}): SessionRecord {
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

/** Narrow a `SetResult` to its conflict arm, failing the test if it succeeded. */
function expectConflict(
  result: SetResult<SessionRecord>
): { currentValue: SessionRecord | undefined; currentVersion: number } {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a conflict");
  return result.conflict;
}

/**
 * Register the shared scope-store CAS conformance cases against a backend.
 * Call inside a test file's top-level scope.
 */
export function createScopeStoreConformanceTests(
  options: CreateScopeStoreConformanceTestsOptions
): void {
  const { name, createStore, cleanup, createSharedPair } = options;

  describe(`${name} (scope store CAS conformance)`, () => {
    async function withStore(
      fn: (store: ScopeStoreUnderTest) => Promise<void>
    ): Promise<void> {
      const store = await createStore();
      try {
        await fn(store);
      } finally {
        await cleanup?.(store);
      }
    }

    describe('expectedVersion: "absent"', () => {
      it("writes when no record exists", async () => {
        await withStore(async (store) => {
          const result = await store.set("s1", makeSession("s1", 0, { made: true }), "absent");

          expect(result).toEqual({ ok: true, version: 0 });
          expect((await store.get("s1"))?.state).toEqual({ made: true });
        });
      });

      it("conflicts against a record stored at version 0, which is live and not absent", async () => {
        // The whole reason this sentinel is a word and not `0`: scope records
        // are created at version 0, so a v0 row is a real record.
        await withStore(async (store) => {
          await store.set("s1", makeSession("s1", 0, { first: true }), "absent");

          const second = await store.set("s1", makeSession("s1", 0, { second: true }), "absent");

          const conflict = expectConflict(second);
          expect(conflict.currentVersion).toBe(0);
          expect(conflict.currentValue?.state).toEqual({ first: true });
          expect((await store.get("s1"))?.state).toEqual({ first: true });
        });
      });

      it("conflicts against a record at a positive version, carrying that version", async () => {
        await withStore(async (store) => {
          await store.set("s1", makeSession("s1", 0), "absent");
          await store.set("s1", makeSession("s1", 3, { advanced: true }), 0);

          const conflict = expectConflict(
            await store.set("s1", makeSession("s1", 0, { clobber: true }), "absent")
          );

          expect(conflict.currentVersion).toBe(3);
          expect(conflict.currentValue?.state).toEqual({ advanced: true });
        });
      });

      it("writes again after the record is deleted", async () => {
        await withStore(async (store) => {
          await store.set("s1", makeSession("s1", 0), "absent");
          await store.delete("s1");

          // Hard delete, no tombstone: the id is absent again and versions may
          // restart. Stated in the contract rather than defended.
          const recreated = await store.set("s1", makeSession("s1", 0, { again: true }), "absent");

          expect(recreated.ok).toBe(true);
          expect((await store.get("s1"))?.state).toEqual({ again: true });
        });
      });

      it("lets exactly one of two concurrent creates win, and hands the loser the winner's record", async () => {
        // The race this contract exists to close. Before it, both writes
        // landed and the second silently overwrote the first.
        await withStore(async (store) => {
          const [first, second] = await Promise.all([
            store.set("s1", makeSession("s1", 0, { writer: "A" }), "absent"),
            store.set("s1", makeSession("s1", 0, { writer: "B" }), "absent")
          ]);

          const winners = [first, second].filter((result) => result.ok);
          expect(winners).toHaveLength(1);

          const loser = first.ok ? second : first;
          const conflict = expectConflict(loser);
          const stored = await store.get("s1");
          // The loser is told what actually won, not merely that it lost —
          // that is what makes adopt-on-conflict possible for callers who want
          // get-or-create rather than a 409.
          expect(conflict.currentValue?.state).toEqual(stored?.state);
          expect(stored?.state).toEqual(first.ok ? { writer: "A" } : { writer: "B" });
        });
      });
    });

    describe("existing expectedVersion semantics are unchanged", () => {
      it("0 creates an absent record and then matches that record at version 0", async () => {
        // Pinned deliberately: this is the behaviour that made `0` unavailable
        // as a create-if-absent sentinel. If this ever changes, the first CAS
        // write of every new session, user and org changes with it.
        await withStore(async (store) => {
          const created = await store.set("s1", makeSession("s1", 0), 0);
          expect(created).toEqual({ ok: true, version: 0 });

          const updated = await store.set("s1", makeSession("s1", 1, { n: 1 }), 0);
          expect(updated).toEqual({ ok: true, version: 1 });
          expect((await store.get("s1"))?.version).toBe(1);
        });
      });

      it("a stale numeric version still conflicts", async () => {
        await withStore(async (store) => {
          await store.set("s1", makeSession("s1", 0), 0);
          await store.set("s1", makeSession("s1", 1, { n: 1 }), 0);

          const conflict = expectConflict(
            await store.set("s1", makeSession("s1", 2, { stale: true }), 0)
          );

          expect(conflict.currentVersion).toBe(1);
          expect((await store.get("s1"))?.state).toEqual({ n: 1 });
        });
      });

      it('"any" still writes unconditionally', async () => {
        await withStore(async (store) => {
          await store.set("s1", makeSession("s1", 0), "any");
          await store.set("s1", makeSession("s1", 7, { overwrite: true }), "any");

          const fetched = await store.get("s1");
          expect(fetched?.version).toBe(7);
          expect(fetched?.state).toEqual({ overwrite: true });
        });
      });
    });

    describe('delta verbs reject "absent"', () => {
      // Each verb read-modify-writes an existing record, so the value is
      // unsatisfiable by construction — a call-site error, not a lost race.
      // A conflict would send the caller into a retry loop that never
      // converges; on the SQL adapters the string would also reach
      // `expectedVersion + 1` and a numeric bind parameter.
      it("throws rather than conflicting", async () => {
        await withStore(async (store) => {
          await store.set("s1", makeSession("s1", 0, { count: 1, items: [] }), "absent");
          const now = Date.now();

          const calls: Array<[string, () => Promise<unknown> | undefined]> = [
            ["patchField", () => store.patchField?.("s1", ["count"], 2, "absent", now)],
            ["incField", () => store.incField?.("s1", ["count"], 1, "absent", now)],
            ["pushToArray", () => store.pushToArray?.("s1", ["items"], [1], "absent", now)],
            ["deleteField", () => store.deleteField?.("s1", ["count"], "absent", now)]
          ];

          for (const [verb, call] of calls) {
            const invoked = call();
            // Adapters may implement none, some, or all of the delta verbs.
            if (invoked === undefined) continue;
            await expect(invoked, `${verb} must reject "absent"`).rejects.toThrow(/absent/);
          }

          // And the record is untouched by any of them.
          expect((await store.get("s1"))?.version).toBe(0);
        });
      });
    });

    describe.runIf(createSharedPair !== undefined)("across two connections", () => {
      async function withPair(
        fn: (a: ScopeStoreUnderTest, b: ScopeStoreUnderTest) => Promise<void>
      ): Promise<void> {
        const pair = await (createSharedPair as NonNullable<typeof createSharedPair>)();
        try {
          await fn(pair.a, pair.b);
        } finally {
          await pair.cleanup?.();
        }
      }

      it("lets exactly one of two concurrent creates win", async () => {
        // The case a read-then-insert implementation fails and every
        // in-process case above passes.
        await withPair(async (a, b) => {
          const [first, second] = await Promise.all([
            a.set("s1", makeSession("s1", 0, { writer: "A" }), "absent"),
            b.set("s1", makeSession("s1", 0, { writer: "B" }), "absent")
          ]);

          const winners = [first, second].filter((result) => result.ok);
          expect(winners).toHaveLength(1);

          const conflict = expectConflict(first.ok ? second : first);
          const stored = await a.get("s1");
          expect(conflict.currentValue?.state).toEqual(stored?.state);
        });
      });

      it("conflicts when the other connection already created the record", async () => {
        await withPair(async (a, b) => {
          await a.set("s1", makeSession("s1", 0, { writer: "A" }), "absent");

          const conflict = expectConflict(
            await b.set("s1", makeSession("s1", 0, { writer: "B" }), "absent")
          );

          expect(conflict.currentVersion).toBe(0);
          expect(conflict.currentValue?.state).toEqual({ writer: "A" });
        });
      });
    });
  });
}
