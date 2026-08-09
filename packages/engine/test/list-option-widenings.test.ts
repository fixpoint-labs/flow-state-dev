/**
 * FIX-1010 — the four additive list-option widenings, on the two in-process
 * adapters. The SQL adapters mirror this matrix in their own packages, case
 * for case; an adapter that diverges is exactly the failure this coverage
 * exists to catch.
 *
 * Every case pairs the new behaviour with the assertion that an existing
 * caller — one that omits the option entirely — is unchanged (BP-030). A
 * widening that quietly narrows the default is the failure mode here, and it
 * is invisible from a test that only exercises the new option.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFilesystemStores,
  createInMemoryStores,
  type RequestRecord,
  type RequestStore,
  type SessionRecord,
  type SessionStore
} from "../src";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

const adapters = [
  {
    name: "memory",
    create: async () => createInMemoryStores()
  },
  {
    name: "filesystem",
    create: async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), "fsd-list-options-"));
      tempDirs.push(rootDir);
      return createFilesystemStores({ rootDir });
    }
  }
];

function session(id: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id,
    flowKind: "chat",
    userId: "alice",
    state: {},
    version: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    journal: [],
    ...overrides
  };
}

function request(id: string, overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    id,
    flowKind: "chat",
    actionName: "run",
    userId: "alice",
    sessionId: "sess",
    source: "http",
    status: "completed",
    startedAtMs: 1_000,
    state: {},
    version: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides
  };
}

describe.each(adapters)("list-option widenings — $name adapter", ({ create }) => {
  // -------------------------------------------------------------------------
  // orgId, on both list-option types
  // -------------------------------------------------------------------------

  async function seedOrgs(store: SessionStore): Promise<void> {
    await store.set("bound", session("bound", { orgId: "acme", parentSessionId: "p" }), "any");
    await store.set("other", session("other", { orgId: "globex", parentSessionId: "p" }), "any");
    await store.set("unbound", session("unbound", { parentSessionId: "p" }), "any");
  }

  it("session orgId filters exactly, and an absent key filters nothing", async () => {
    const { session: store } = await create();
    await seedOrgs(store);

    expect(
      (await store.list({ orgId: "acme", parentage: { parentOf: "p" } })).map((r) => r.id)
    ).toEqual(["bound"]);
    // An existing caller passing no `orgId` key still sees every record.
    expect(
      (await store.list({ parentage: { parentOf: "p" } })).map((r) => r.id).sort()
    ).toEqual(["bound", "other", "unbound"]);
  });

  it("an explicit undefined orgId matches only unbound records", async () => {
    const { session: store } = await create();
    await seedOrgs(store);

    // The case a plain equality predicate silently drops. `undefined` is a
    // value here, not an absence.
    expect(
      (await store.list({ orgId: undefined, parentage: { parentOf: "p" } })).map(
        (r) => r.id
      )
    ).toEqual(["unbound"]);
  });

  it("request orgId filters exactly, with the same present-vs-absent rule", async () => {
    const { request: store } = await create();
    await store.set("r_acme", request("r_acme", { orgId: "acme" }), "any");
    await store.set("r_globex", request("r_globex", { orgId: "globex" }), "any");
    await store.set("r_unbound", request("r_unbound"), "any");

    expect((await store.list({ orgId: "acme" })).map((r) => r.id)).toEqual(["r_acme"]);
    expect((await store.list({ orgId: undefined })).map((r) => r.id)).toEqual([
      "r_unbound"
    ]);
    expect((await store.list({})).map((r) => r.id).sort()).toEqual([
      "r_acme",
      "r_globex",
      "r_unbound"
    ]);
  });

  // -------------------------------------------------------------------------
  // A set-valued request status filter
  // -------------------------------------------------------------------------

  async function seedStatuses(store: RequestStore): Promise<void> {
    for (const status of [
      "in_progress",
      "suspended",
      "interrupted",
      "completed",
      "failed"
    ] as const) {
      await store.set(`r_${status}`, request(`r_${status}`, { status }), "any");
    }
  }

  it("a status array matches set membership", async () => {
    const { request: store } = await create();
    await seedStatuses(store);

    const rows = await store.list({ status: ["in_progress", "suspended"] });
    expect(rows.map((r) => r.id).sort()).toEqual(["r_in_progress", "r_suspended"]);
  });

  it("a single status still matches by equality", async () => {
    const { request: store } = await create();
    await seedStatuses(store);

    expect((await store.list({ status: "failed" })).map((r) => r.id)).toEqual([
      "r_failed"
    ]);
  });

  it("an empty status array matches nothing — it is a filter, not an absence", async () => {
    const { request: store } = await create();
    await seedStatuses(store);

    expect(await store.list({ status: [] })).toEqual([]);
    expect((await store.list({})).length).toBe(5);
  });

  // -------------------------------------------------------------------------
  // The unordered mode
  // -------------------------------------------------------------------------

  it("orderBy: none returns the matching set, and limit 1 still stops at one", async () => {
    const { request: store } = await create();
    await seedStatuses(store);

    const rows = await store.list({
      status: ["in_progress", "suspended"],
      orderBy: "none",
      limit: 1
    });
    expect(rows).toHaveLength(1);
    expect(["r_in_progress", "r_suspended"]).toContain(rows[0]!.id);
  });

  it("orderBy: none does not change which records match", async () => {
    const { request: store } = await create();
    await seedStatuses(store);

    const ordered = await store.list({ status: ["completed", "failed"] });
    const unordered = await store.list({
      status: ["completed", "failed"],
      orderBy: "none"
    });
    expect(unordered.map((r) => r.id).sort()).toEqual(ordered.map((r) => r.id).sort());
  });

  // -------------------------------------------------------------------------
  // The immutable session sort key, and the request tie-break
  // -------------------------------------------------------------------------

  it("session orderBy: createdAt is stable when a record's updatedAt is rewritten", async () => {
    const { session: store } = await create();
    for (let i = 0; i < 4; i++) {
      await store.set(
        `s_${i}`,
        session(`s_${i}`, {
          parentSessionId: "p",
          createdAt: 1_000 + i,
          updatedAt: 1_000 + i
        }),
        "any"
      );
    }
    const options = { parentage: { parentOf: "p" } as const, orderBy: "createdAt" as const };
    const before = (await store.list(options)).map((r) => r.id);

    // Exactly what a run starting does to a child session record.
    const moved = await store.get("s_0");
    await store.set(
      "s_0",
      { ...(moved as SessionRecord), latestRequestId: "req_x", updatedAt: 9_999 },
      "any"
    );

    expect((await store.list(options)).map((r) => r.id)).toEqual(before);
    // And the shipped default still moves, unchanged (BP-030).
    expect((await store.list({ parentage: { parentOf: "p" } }))[0]!.id).toBe("s_0");
  });

  it("session orderBy defaults to updatedAt", async () => {
    const { session: store } = await create();
    await store.set("older", session("older", { updatedAt: 1 }), "any");
    await store.set("newer", session("newer", { updatedAt: 2 }), "any");

    expect((await store.list()).map((r) => r.id)).toEqual(["newer", "older"]);
    expect((await store.list({ orderBy: "updatedAt" })).map((r) => r.id)).toEqual([
      "newer",
      "older"
    ]);
  });

  it("request orderBy: startedAtMs breaks an exact tie on id, stably", async () => {
    const { request: store } = await create();
    for (const id of ["r_a", "r_d", "r_b", "r_c"]) {
      await store.set(id, request(id, { startedAtMs: 5_000, createdAt: 5_000 }), "any");
    }

    const first = await store.list({ orderBy: "startedAtMs", limit: 1 });
    const second = await store.list({ orderBy: "startedAtMs", limit: 1 });
    expect(first[0]!.id).toBe("r_d");
    expect(second[0]!.id).toBe(first[0]!.id);
  });

  it("request orderBy: startedAtMs still prefers the later start over the higher id", async () => {
    const { request: store } = await create();
    await store.set(
      "r_zzz",
      request("r_zzz", { startedAtMs: 1_000, createdAt: 1_000 }),
      "any"
    );
    await store.set(
      "r_aaa",
      request("r_aaa", { startedAtMs: 2_000, createdAt: 2_000 }),
      "any"
    );

    // The tie-break is only ever a tie-break — chronology wins where it exists.
    expect((await store.list({ orderBy: "startedAtMs", limit: 1 }))[0]!.id).toBe("r_aaa");
  });
});
