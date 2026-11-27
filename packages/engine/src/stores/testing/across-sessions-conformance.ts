/**
 * Shared conformance for `ResourceStateStore.listAcrossSessions`, the store
 * half of a read across an owner's sessions. Every adapter (memory,
 * filesystem, SQLite, Postgres) runs it via `@flow-state-dev/engine/testing`,
 * so the four give one answer in one order.
 *
 * The read is scoped to one owner in the store's own query, so each case is a
 * row that must never come back: another user's, the same user's in another
 * organization or tenant, a session with no organization, a row whose session
 * record is gone, another collection's, a tombstone, and a row kept outside a
 * session (lineage, user). Beside those: a child session's rows come back with
 * its parent's; rows come in session-key, then row-key byte order; a cursor
 * neither repeats nor skips a row across session boundaries; a key filter
 * reads one row a session; an index filter reads the rows with the value
 * where the session's index is built, and every row where it isn't; and a SQL
 * store answers a page in one statement that reads from `sessions`.
 */
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@flow-state-dev/core/types";
import type { AcrossSessionsQuery, ResourceStateStore, SessionRecord, SessionStore } from "../types";

/** One backend under test: its resource-state store and the session store it joins to. */
export type AcrossSessionsUnderTest = {
  resourceState: ResourceStateStore;
  /** Where the suite writes the sessions the rows join to. */
  sessions: Pick<SessionStore, "set">;
  /**
   * SQL adapters only: every statement the resource-state store runs is
   * pushed here, so the suite can check a page is one statement reading
   * `sessions`.
   */
  statements?: string[];
};

export type CreateAcrossSessionsConformanceTestsOptions = {
  /** Display name surfaced in the `describe` block, e.g. `"SQLite"`. */
  name: string;
  /** Build a fresh, empty backend. Called per test. */
  createStore: () => AcrossSessionsUnderTest | Promise<AcrossSessionsUnderTest>;
  /** Optional teardown hook for backends with external resources. */
  cleanup?: (store: AcrossSessionsUnderTest) => Promise<void> | void;
};

const NOW = 1_800_000_000_000;
const ALICE = { userId: "alice", tenantId: undefined, orgId: "acme" } as const;
const COLLECTION = "notes/*";
const PREFIX = "notes/";
const INDEX = "byStatus@1";

type SessionScope = { userId?: string; orgId?: string | null; tenantId?: string; parentSessionId?: string };

function sessionRecord(key: string, scope: SessionScope = {}): SessionRecord {
  return {
    id: key,
    state: {},
    version: 0,
    createdAt: NOW,
    updatedAt: NOW,
    flowKind: "notes-flow",
    flowId: "notes-flow",
    userId: scope.userId ?? ALICE.userId,
    journal: [],
    ...(scope.orgId === null ? {} : { orgId: scope.orgId ?? ALICE.orgId }),
    ...(scope.tenantId !== undefined ? { tenantId: scope.tenantId } : {}),
    ...(scope.parentSessionId !== undefined ? { parentSessionId: scope.parentSessionId } : {})
  } as SessionRecord;
}

function query(over: Partial<AcrossSessionsQuery> = {}): AcrossSessionsQuery {
  return { owner: { ...ALICE }, keyPrefix: PREFIX, limit: 100, ...over };
}

/** `[sessionKey, key]` of each row, in the order answered. */
function keysOf(rows: { sessionKey: string; key: string }[]): string[] {
  return rows.map((row) => `${row.sessionKey} ${row.key}`);
}

export function createAcrossSessionsConformanceTests(options: CreateAcrossSessionsConformanceTestsOptions): void {
  const { name, createStore, cleanup } = options;

  describe(`listAcrossSessions conformance: ${name}`, () => {
    async function withStore(run: (store: AcrossSessionsUnderTest) => Promise<void>): Promise<void> {
      const store = await createStore();
      try {
        await run(store);
      } finally {
        await cleanup?.(store);
      }
    }

    const list = (store: AcrossSessionsUnderTest, q: AcrossSessionsQuery) => {
      const read = store.resourceState.listAcrossSessions;
      if (read === undefined) throw new Error(`${name}: the resource-state store has no listAcrossSessions`);
      return read.call(store.resourceState, q);
    };
    const session = (store: AcrossSessionsUnderTest, key: string, scope?: SessionScope) =>
      store.sessions.set(key, sessionRecord(key, scope), "absent");
    const row = (store: AcrossSessionsUnderTest, sessionKey: string, key: string, state: JsonObject = { text: key }) =>
      store.resourceState.set("session", sessionKey, key, state, "any");

    it("answers the owner's rows in every session, a child's included, in session then key order", async () => {
      await withStore(async (store) => {
        await session(store, "s-b");
        await session(store, "s-a");
        await session(store, "s-a-child", { parentSessionId: "s-a" });
        await row(store, "s-b", "notes/1");
        await row(store, "s-a", "notes/2");
        await row(store, "s-a", "notes/1");
        await row(store, "s-a-child", "notes/9");
        const rows = await list(store, query());
        expect(keysOf(rows)).toEqual(["s-a notes/1", "s-a notes/2", "s-a-child notes/9", "s-b notes/1"]);
        expect(rows[0]!.state).toEqual({ text: "notes/1" });
        expect(rows[0]!.version).toBe(1);
        // The session's owner and flow, as its record holds them: what the per-row admission judges.
        expect(rows[0]!.session).toEqual({ flowKind: "notes-flow", flowId: "notes-flow", userId: "alice", orgId: "acme" });
      });
    });

    it("carries a tenant-bound session's tenant with its row", async () => {
      await withStore(async (store) => {
        await session(store, "t1:a", { tenantId: "t1" });
        await row(store, "t1:a", "notes/1");
        const rows = await list(store, query({ owner: { ...ALICE, tenantId: "t1" } }));
        expect(rows.map((r: { session: unknown }) => r.session)).toEqual([
          { flowKind: "notes-flow", flowId: "notes-flow", userId: "alice", orgId: "acme", tenantId: "t1" }
        ]);
      });
    });

    it("never answers another owner's row, a row with no session, or a row outside the collection", async () => {
      await withStore(async (store) => {
        await session(store, "mine");
        await session(store, "bob", { userId: "bob" });
        await session(store, "other-org", { orgId: "globex" });
        await session(store, "t2:other-tenant", { tenantId: "t2" });
        await session(store, "no-org", { orgId: null });
        for (const key of ["mine", "bob", "other-org", "t2:other-tenant", "no-org", "gone"]) await row(store, key, "notes/1");
        await row(store, "mine", "notes/dead");
        await store.resourceState.delete("session", "mine", "notes/dead", "any");
        await row(store, "mine", "other/1");
        await row(store, "mine", "notesx/1");
        await store.resourceState.set("lineage", "mine", "notes/shared", { text: "lineage" }, "any");
        await store.resourceState.set("user", "mine", "notes/user", { text: "user" }, "any");
        expect(keysOf(await list(store, query()))).toEqual(["mine notes/1"]);
      });
    });

    it("scopes a tenant-bound owner to that tenant, and an unbound one to unbound sessions", async () => {
      await withStore(async (store) => {
        await session(store, "t1:a", { tenantId: "t1" });
        await session(store, "a");
        await row(store, "t1:a", "notes/1");
        await row(store, "a", "notes/1");
        expect(keysOf(await list(store, query({ owner: { ...ALICE, tenantId: "t1" } })))).toEqual(["t1:a notes/1"]);
        expect(keysOf(await list(store, query()))).toEqual(["a notes/1"]);
      });
    });

    it("pages by the last row read, across session boundaries, neither repeating nor skipping", async () => {
      await withStore(async (store) => {
        const expected: string[] = [];
        for (const s of ["p1", "p2", "p3"]) {
          await session(store, s);
          for (const k of ["notes/a", "notes/b", "notes/c"]) {
            await row(store, s, k);
            expected.push(`${s} ${k}`);
          }
        }
        const seen: string[] = [];
        let after: AcrossSessionsQuery["after"];
        for (let pages = 0; pages < 10; pages += 1) {
          const rows = await list(store, query({ limit: 2, ...(after !== undefined ? { after } : {}) }));
          seen.push(...keysOf(rows));
          if (rows.length < 2) break;
          const last = rows.at(-1)!;
          after = { sessionKey: last.sessionKey, key: last.key };
        }
        expect(seen).toEqual(expected);
      });
    });

    it("orders session keys and row keys by code point, as the SQL stores compare bytes", async () => {
      await withStore(async (store) => {
        // U+FF5E sorts before U+1F600 by code point, after it by UTF-16 code unit.
        for (const s of ["s\u{1F600}", "s～", "sZ"]) {
          await session(store, s);
          await row(store, s, "notes/\u{1F600}");
          await row(store, s, "notes/～");
        }
        expect(keysOf(await list(store, query()))).toEqual([
          "sZ notes/～",
          "sZ notes/\u{1F600}",
          "s～ notes/～",
          "s～ notes/\u{1F600}",
          "s\u{1F600} notes/～",
          "s\u{1F600} notes/\u{1F600}"
        ]);
      });
    });

    it("reads one row a session for a key filter", async () => {
      await withStore(async (store) => {
        for (const s of ["k1", "k2"]) {
          await session(store, s);
          await row(store, s, "notes/task-1");
          await row(store, s, "notes/task-10");
        }
        expect(keysOf(await list(store, query({ key: "notes/task-1" })))).toEqual(["k1 notes/task-1", "k2 notes/task-1"]);
      });
    });

    it("reads an index filter from a built index, and every row where it isn't built", async () => {
      await withStore(async (store) => {
        const indexes = store.resourceState.indexes;
        const write = (sessionKey: string, key: string, status: string) =>
          store.resourceState.set("session", sessionKey, key, { status }, "any", {
            indexEntries: [{ collection: COLLECTION, index: INDEX, values: [JSON.stringify(status)] }]
          });
        await session(store, "built");
        await session(store, "unbuilt");
        await write("built", "notes/1", "open");
        await write("built", "notes/2", "done");
        await write("unbuilt", "notes/1", "open");
        await write("unbuilt", "notes/2", "done");
        if (indexes !== undefined) {
          const build = await indexes.beginBuild("session", "built", COLLECTION, INDEX);
          await indexes.completeBuild("session", "built", COLLECTION, INDEX, build, [
            { key: "notes/1", values: [JSON.stringify("open")] },
            { key: "notes/2", values: [JSON.stringify("done")] }
          ]);
        }
        const rows = await list(store, query({ index: { collection: COLLECTION, index: INDEX, value: JSON.stringify("open") } }));
        expect(keysOf(rows)).toEqual(
          indexes === undefined
            ? ["built notes/1", "built notes/2", "unbuilt notes/1", "unbuilt notes/2"]
            : ["built notes/1", "unbuilt notes/1", "unbuilt notes/2"]
        );
      });
    });

    it("answers a page in one statement that joins sessions, on a SQL store", async () => {
      await withStore(async (store) => {
        if (store.statements === undefined) return;
        await session(store, "one");
        await row(store, "one", "notes/1");
        store.statements.length = 0;
        await list(store, query({ index: { collection: COLLECTION, index: INDEX, value: "\"open\"" } }));
        const reads = store.statements.filter((sql) => /\bselect\b/i.test(sql));
        expect(reads).toHaveLength(1);
        expect(reads[0]).toMatch(/\bfrom\s+sessions\b/i);
        expect(reads[0]).toMatch(/\bresource_state\b/i);
      });
    });
  });
}
