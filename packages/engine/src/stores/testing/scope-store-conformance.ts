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
import type { JsonObject, JsonValue } from "@flow-state-dev/core/types";
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

    describe("pushToArray value-type contract", () => {
      // Missing → []; existing array → append; any present non-array
      // (scalar, null) → throw, and the record is left alone. Memory already
      // keeps this; SQLite historically replaced the scalar and Postgres
      // wrapped it. These four cases are what makes the adapters swappable.

      it("treats a missing field as an empty array", async () => {
        await withStore(async (store) => {
          if (store.pushToArray === undefined) return;
          await store.set("s1", makeSession("s1", 0, {}), "absent");

          const result = await store.pushToArray("s1", ["log"], ["first"], 0, Date.now());

          expect(result.ok).toBe(true);
          expect((await store.get("s1"))?.state).toEqual({ log: ["first"] });
        });
      });

      it("appends onto an existing array", async () => {
        await withStore(async (store) => {
          if (store.pushToArray === undefined) return;
          await store.set("s1", makeSession("s1", 0, { log: ["a"] }), "absent");

          const result = await store.pushToArray("s1", ["log"], ["b", "c"], 0, Date.now());

          expect(result.ok).toBe(true);
          expect((await store.get("s1"))?.state).toEqual({ log: ["a", "b", "c"] });
        });
      });

      it("throws when the existing value is a scalar, leaving the record untouched", async () => {
        await withStore(async (store) => {
          if (store.pushToArray === undefined) return;
          await store.set("s1", makeSession("s1", 0, { log: "scalar" }), "absent");

          await expect(
            store.pushToArray("s1", ["log"], ["x"], 0, Date.now())
          ).rejects.toThrow(/not an array/);

          const fetched = await store.get("s1");
          expect(fetched?.state).toEqual({ log: "scalar" });
          expect(fetched?.version).toBe(0);
        });
      });

      it("throws when the existing value is null, leaving the record untouched", async () => {
        // null is a present value, not a missing one. Missing is the absent
        // key (undefined after parse); that case is the empty-array path above.
        await withStore(async (store) => {
          if (store.pushToArray === undefined) return;
          await store.set("s1", makeSession("s1", 0, { log: null }), "absent");

          await expect(
            store.pushToArray("s1", ["log"], ["x"], 0, Date.now())
          ).rejects.toThrow(/not an array/);

          const fetched = await store.get("s1");
          expect(fetched?.state).toEqual({ log: null });
          expect(fetched?.version).toBe(0);
        });
      });
    });

    describe("incField value-type contract", () => {
      // Missing or null → starts from 0 (a field's empty state: BP-023 state
      // fields default to null, so an untouched counter reads as null);
      // existing number → add; any other present value (string, boolean,
      // object, array) → throw, and the record is left alone. Coercing it to
      // 0 would replace the stored value with the delta and report success.

      it("treats a missing field as 0", async () => {
        await withStore(async (store) => {
          if (store.incField === undefined) return;
          await store.set("s1", makeSession("s1", 0, {}), "absent");

          const result = await store.incField("s1", ["count"], 3, 0, Date.now());

          expect(result.ok).toBe(true);
          expect((await store.get("s1"))?.state).toEqual({ count: 3 });
        });
      });

      it("treats a null field as 0", async () => {
        await withStore(async (store) => {
          if (store.incField === undefined) return;
          await store.set("s1", makeSession("s1", 0, { count: null }), "absent");

          const result = await store.incField("s1", ["count"], 3, 0, Date.now());

          expect(result.ok).toBe(true);
          expect((await store.get("s1"))?.state).toEqual({ count: 3 });
        });
      });

      it("adds onto an existing number", async () => {
        await withStore(async (store) => {
          if (store.incField === undefined) return;
          await store.set("s1", makeSession("s1", 0, { count: 4 }), "absent");

          const result = await store.incField("s1", ["count"], 3, 0, Date.now());

          expect(result.ok).toBe(true);
          expect((await store.get("s1"))?.state).toEqual({ count: 7 });
        });
      });

      const wrongTyped: Array<[string, JsonValue]> = [
        ["string", "hello"],
        ["numeric-looking string", "5"],
        ["boolean", true],
        ["object", { nested: 1 }],
        ["array", [1, 2]]
      ];

      for (const [label, value] of wrongTyped) {
        for (const expectedVersion of [0, "any"] as const) {
          it(`throws on a ${label} target (expectedVersion ${String(expectedVersion)}), leaving the record untouched`, async () => {
            await withStore(async (store) => {
              if (store.incField === undefined) return;
              await store.set("s1", makeSession("s1", 0, { count: value }), "absent");

              await expect(
                store.incField("s1", ["count"], 1, expectedVersion, Date.now())
              ).rejects.toThrow(/not a number/);

              const fetched = await store.get("s1");
              expect(fetched?.state).toEqual({ count: value });
              expect(fetched?.version).toBe(0);
            });
          });
        }
      }
    });

    // FIX-2942: a session's recorded principal kind is written once, at birth,
    // and kept by `set` whatever a later whole-record write carries, so a
    // writer holding a stale snapshot can't turn a machine's session into a
    // person's.
    describe("a session's principal kind is kept by set", () => {
      const withKind = (record: SessionRecord, principalKind: "person" | "machine" | undefined): SessionRecord => {
        const { principalKind: _dropped, ...rest } = record;
        return principalKind === undefined ? rest : { ...rest, principalKind };
      };

      it("keeps a machine's kind against a stale person snapshot written unconditionally", async () => {
        await withStore(async (store) => {
          const stale = withKind(makeSession("s1", 0, { from: "first" }), "person");
          await store.set("s1", withKind(makeSession("s1", 0), "machine"), "absent");

          expect((await store.set("s1", { ...stale, version: 1 }, "any")).ok).toBe(true);

          const stored = await store.get("s1");
          expect(stored?.principalKind).toBe("machine");
          expect(stored?.state).toEqual({ from: "first" });
        });
      });

      it("keeps a machine's kind against a version-matched write carrying person", async () => {
        await withStore(async (store) => {
          await store.set("s1", withKind(makeSession("s1", 0), "machine"), "absent");
          await store.set("s1", withKind(makeSession("s1", 1), "person"), 0);
          expect((await store.get("s1"))?.principalKind).toBe("machine");
        });
      });

      it("keeps the stored kind when a write omits it", async () => {
        await withStore(async (store) => {
          await store.set("s1", withKind(makeSession("s1", 0), "person"), "absent");
          await store.set("s1", withKind(makeSession("s1", 1), undefined), "any");
          expect((await store.get("s1"))?.principalKind).toBe("person");
        });
      });

      // BP-030: a session from before the field gets its backfilled kind once,
      // and from then on it is kept like a born one.
      it("writes the first kind onto a record stored without one, then keeps it", async () => {
        await withStore(async (store) => {
          await store.set("s1", withKind(makeSession("s1", 0), undefined), "absent");
          expect((await store.set("s1", withKind(makeSession("s1", 1), "machine"), 0)).ok).toBe(true);
          expect((await store.get("s1"))?.principalKind).toBe("machine");
          await store.set("s1", withKind(makeSession("s1", 2), "person"), "any");
          await store.set("s1", withKind(makeSession("s1", 3), undefined), "any");
          expect((await store.get("s1"))?.principalKind).toBe("machine");
        });
      });

      it("writes the kind a create carries", async () => {
        await withStore(async (store) => {
          await store.set("s1", withKind(makeSession("s1", 0), "machine"), "absent");
          await store.set("s2", withKind(makeSession("s2", 0), "person"), "any");
          expect((await store.get("s1"))?.principalKind).toBe("machine");
          expect((await store.get("s2"))?.principalKind).toBe("person");
        });
      });

      it.runIf(createSharedPair !== undefined)(
        "keeps a reborn machine's kind against a person snapshot another connection read before the delete",
        async () => {
          const pair = await (createSharedPair as NonNullable<typeof createSharedPair>)();
          try {
            await pair.a.set("s1", withKind(makeSession("s1", 0), "person"), "absent");
            const snapshot = await pair.b.get("s1");
            await pair.a.delete("s1");
            await pair.a.set("s1", withKind(makeSession("s1", 0), "machine"), "absent");

            await pair.b.set("s1", { ...(snapshot as SessionRecord), version: 1 }, "any");

            expect((await pair.a.get("s1"))?.principalKind).toBe("machine");
          } finally {
            await pair.cleanup?.();
          }
        }
      );
    });

    // A session's incarnation token is minted once, at birth, and kept by
    // `set` like its principal kind, so a writer holding a stale snapshot of
    // an earlier birth under the same id can't make the reborn session read
    // as the one it replaced.
    describe("a session's incarnation token is kept by set", () => {
      const withToken = (record: SessionRecord, incarnationToken: string | undefined): SessionRecord => {
        const { incarnationToken: _dropped, ...rest } = record;
        return incarnationToken === undefined ? rest : { ...rest, incarnationToken };
      };

      it("keeps the stored token against a stale whole-record write carrying another, or none", async () => {
        await withStore(async (store) => {
          await store.set("s1", withToken(makeSession("s1", 0), "inc_reborn"), "absent");
          expect((await store.set("s1", withToken(makeSession("s1", 1, { from: "stale" }), "inc_first"), "any")).ok).toBe(true);
          const stored = await store.get("s1");
          expect(stored?.incarnationToken).toBe("inc_reborn");
          expect(stored?.state).toEqual({ from: "stale" });
          await store.set("s1", withToken(makeSession("s1", 2), undefined), 1);
          expect((await store.get("s1"))?.incarnationToken).toBe("inc_reborn");
        });
      });

      // BP-030: a record from before the field has none, and none is invented.
      it("leaves a record stored without one without one", async () => {
        await withStore(async (store) => {
          await store.set("s1", withToken(makeSession("s1", 0), undefined), "absent");
          await store.set("s1", withToken(makeSession("s1", 1), undefined), "any");
          expect((await store.get("s1"))?.incarnationToken ?? undefined).toBeUndefined();
        });
      });

      it.runIf(createSharedPair !== undefined)(
        "keeps a reborn session's token against a snapshot another connection read before the delete",
        async () => {
          const pair = await (createSharedPair as NonNullable<typeof createSharedPair>)();
          try {
            await pair.a.set("s1", withToken(makeSession("s1", 0), "inc_first"), "absent");
            const snapshot = await pair.b.get("s1");
            await pair.a.delete("s1");
            await pair.a.set("s1", withToken(makeSession("s1", 0), "inc_reborn"), "absent");

            await pair.b.set("s1", { ...(snapshot as SessionRecord), version: 1 }, "any");

            expect((await pair.a.get("s1"))?.incarnationToken).toBe("inc_reborn");
          } finally {
            await pair.cleanup?.();
          }
        }
      );
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
