/**
 * FIX-1009 listing behaviour for the two in-process session stores (memory and
 * filesystem). The SQL adapters mirror the same matrix in their own packages —
 * an adapter that diverges here is exactly the failure this issue exists to
 * prevent, so the cases are deliberately identical in shape.
 *
 * Every default-behaviour case seeds at least one **parented** row. A test that
 * only seeds parentless rows would pass against the old unrestricted default
 * and encode the bug.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFilesystemStores,
  createInMemoryStores,
  type SessionRecord,
  type SessionStore
} from "../src";

function makeSessionRecord(
  id: string,
  overrides?: Partial<SessionRecord>
): SessionRecord {
  const ts = Date.now();
  return {
    id,
    flowKind: "chat",
    userId: "user_1",
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    journal: [],
    ...overrides
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const adapters: Array<{ name: string; create: () => Promise<SessionStore> }> = [
  {
    name: "memory",
    create: async () => createInMemoryStores().session
  },
  {
    name: "filesystem",
    create: async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), "fsd-parentage-"));
      tempDirs.push(rootDir);
      return createFilesystemStores({ rootDir }).session;
    }
  }
];

describe.each(adapters)("session parentage listing — $name adapter", ({ create }) => {
  /** One top-level session, plus two children of `sess_parent`. */
  async function seed(store: SessionStore): Promise<void> {
    await store.set("sess_parent", makeSessionRecord("sess_parent"), "any");
    await store.set(
      "sess_child_a",
      makeSessionRecord("sess_child_a", { parentSessionId: "sess_parent" }),
      "any"
    );
    await store.set(
      "sess_child_b",
      makeSessionRecord("sess_child_b", { parentSessionId: "sess_parent" }),
      "any"
    );
  }

  it("defaults to top-level only — a parented row is omitted from an unfiltered list", async () => {
    const store = await create();
    await seed(store);

    const rows = await store.list();
    expect(rows.map((r) => r.id)).toEqual(["sess_parent"]);
  });

  it("still narrows to top-level when other predicates are passed but parentage is not", async () => {
    const store = await create();
    await seed(store);

    const rows = await store.list({ flowKind: "chat", userId: "user_1" });
    expect(rows.map((r) => r.id)).toEqual(["sess_parent"]);
  });

  it("explicit \"top-level\" matches the default", async () => {
    const store = await create();
    await seed(store);

    const explicit = await store.list({ parentage: "top-level" });
    const implicit = await store.list();
    expect(explicit.map((r) => r.id)).toEqual(implicit.map((r) => r.id));
  });

  it("\"all\" returns every session, parented or not", async () => {
    const store = await create();
    await seed(store);

    const rows = await store.list({ parentage: "all" });
    expect(rows.map((r) => r.id).sort()).toEqual([
      "sess_child_a",
      "sess_child_b",
      "sess_parent"
    ]);
  });

  it("{ parentOf } returns exactly that parent's children", async () => {
    const store = await create();
    await seed(store);

    const rows = await store.list({ parentage: { parentOf: "sess_parent" } });
    expect(rows.map((r) => r.id).sort()).toEqual(["sess_child_a", "sess_child_b"]);
  });

  it("{ parentOf } matching nothing returns an empty list, not an error", async () => {
    const store = await create();
    await seed(store);

    expect(await store.list({ parentage: { parentOf: "sess_absent" } })).toEqual([]);
  });

  it("BP-030: a record written without the field reads as top-level", async () => {
    const store = await create();
    // Exactly the shape a pre-FIX-1009 writer produced — no `parentSessionId`
    // key at all, which is every row in every deployment on merge day.
    await store.set("sess_legacy", makeSessionRecord("sess_legacy"), "any");
    await store.set(
      "sess_child",
      makeSessionRecord("sess_child", { parentSessionId: "sess_legacy" }),
      "any"
    );

    const rows = await store.list();
    expect(rows.map((r) => r.id)).toEqual(["sess_legacy"]);
  });

  it("every other predicate behaves identically in all three modes", async () => {
    const store = await create();
    await store.set(
      "sess_top_chat",
      makeSessionRecord("sess_top_chat", { flowKind: "chat" }),
      "any"
    );
    await store.set(
      "sess_child_chat",
      makeSessionRecord("sess_child_chat", {
        flowKind: "chat",
        parentSessionId: "sess_top_chat"
      }),
      "any"
    );
    await store.set(
      "sess_child_report",
      makeSessionRecord("sess_child_report", {
        flowKind: "report",
        parentSessionId: "sess_top_chat"
      }),
      "any"
    );

    // flowKind conjoins with parentage rather than being disabled by it.
    expect(
      (await store.list({ flowKind: "chat", parentage: "all" })).map((r) => r.id).sort()
    ).toEqual(["sess_child_chat", "sess_top_chat"]);
    expect(
      (await store.list({ flowKind: "chat", parentage: { parentOf: "sess_top_chat" } })).map(
        (r) => r.id
      )
    ).toEqual(["sess_child_chat"]);
    expect((await store.list({ flowKind: "chat" })).map((r) => r.id)).toEqual([
      "sess_top_chat"
    ]);
  });

  it("BP-031/BP-035: { parentOf } conjoined with a tenant filter never crosses tenants", async () => {
    const store = await create();
    // Two tenants whose sessions share a bare parent id — the collision the
    // tenant filter exists to keep apart. `parentOf` must only narrow, never
    // reach past the tenant clause.
    await store.set(
      "acme:sess_child",
      makeSessionRecord("acme:sess_child", {
        tenantId: "acme",
        parentSessionId: "sess_parent"
      }),
      "any"
    );
    await store.set(
      "globex:sess_child",
      makeSessionRecord("globex:sess_child", {
        tenantId: "globex",
        parentSessionId: "sess_parent"
      }),
      "any"
    );

    const rows = await store.list({
      tenantId: "acme",
      parentage: { parentOf: "sess_parent" }
    });
    expect(rows.map((r) => r.id)).toEqual(["acme:sess_child"]);
  });
});
