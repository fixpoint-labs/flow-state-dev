/**
 * User and org collections with no session (FIX-2624): entries listed and read
 * by scope and key, and written and deleted only through the flow `runBy` names.
 *
 * The checks are on the stores: a read leaves the session and request stores
 * as they were; a write lands in the caller's own cell at the version it read;
 * and every route takes the caller from the declaring flow's sign-in, so a
 * second user, a second org, or a userId forged in the body reaches nothing
 * that isn't theirs.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler, ownerSegment } from "@flow-state-dev/core";
import type { ChangeNotice } from "../src/bus/types";
import type { JsonObject } from "@flow-state-dev/core/types";
import type { StoreRegistry } from "../src";
import { resolveResourceScopeId } from "../src/stores/scope-keys";
import {
  alice,
  bob,
  buildRouter,
  carol,
  disposeRoutersAfterEach,
  get,
  ORG_A,
  send,
  sessionAndRequests,
  signIn,
  type Caller,
  type Router
} from "./support/scope-http";

disposeRoutersAfterEach();

const drafts = defineResourceCollection({
  pattern: "drafts/*",
  scope: "user",
  stateSchema: z.object({ title: z.string().max(40).default(""), body: z.string().default(""), score: z.number().default(0) }),
  // The score is the server's: kept as stored on a client write.
  client: { state: { read: true }, exclude: ["score"] },
  runBy: "default"
});

const projects = defineResourceCollection({
  pattern: "projects/*",
  scope: "org",
  stateSchema: z.object({ name: z.string().default(""), lead: z.string().default("") }),
  client: { state: { read: true } },
  runBy: "default",
  // Nobody renames a project to an empty name, and only its lead deletes it.
  canWrite: ({ prev, next, userId }) => (next === undefined ? prev?.lead === userId : next.name.length > 0)
});

const boards = defineResourceCollection({
  pattern: "boards/[owner]/[id]",
  scope: "org",
  // Everyone in the org reads every board; only its owner writes or deletes it.
  ownerWrites: { param: "owner" },
  stateSchema: z.object({ text: z.string().default("") }),
  client: { state: { read: true } },
  runBy: "default",
  canWrite: () => true
});

const noop = handler({ name: "noop", inputSchema: z.object({}).passthrough(), execute: () => ({}) });

function threadsFlow(kind = "threads") {
  return defineFlow({
    kind,
    resources: { drafts, projects, boards },
    actions: { noop: { block: noop } },
    authentication: { resolvePrincipal: signIn }
  } as never)();
}

/** Seed one entry in a caller's cell, as a server flow's write would. */
async function seed(stores: StoreRegistry, scope: "user" | "org", caller: Caller, key: string, state: JsonObject) {
  const cell = resolveResourceScopeId({ userId: caller.user!, orgId: caller.org! }, { id: "threads" }, scope, false);
  const written = await stores.resourceState.set(scope, cell, key, state, "any");
  expect(written.ok).toBe(true);
}

type Listed = { items: Array<{ topic: string; storageKey: string; value: Record<string, unknown>; version: number }>; nextCursor?: string };

async function list(router: Router, scope: string, key: string, caller: Caller, query = ""): Promise<Listed> {
  const res = await get(router, ["resources", scope, key, "entries"], caller, query);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Listed;
}

async function entry(router: Router, scope: string, key: string, topic: string, caller: Caller) {
  const res = await get(router, ["resources", scope, key, "entries", topic], caller);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as { topic: string; storageKey: string; value: Record<string, unknown>; version: number } | null;
}

describe("a direct read of a collection's entries", () => {
  it("lists the caller's own user entries and their org's, projected, with versions, and makes no session or request", async () => {
    const { router, stores } = buildRouter([threadsFlow()]);
    await seed(stores, "user", alice, "drafts/a", { title: "A", body: "alice", score: 9 });
    await seed(stores, "user", bob, "drafts/b", { title: "B", body: "bob", score: 1 });
    await seed(stores, "org", alice, "projects/p", { name: "P", lead: "alice" });
    await seed(stores, "org", carol, "projects/q", { name: "Q", lead: "carol" });
    const before = await sessionAndRequests(stores);

    const mine = await list(router, "user", "drafts/*", alice);
    expect(mine.items).toEqual([{ topic: "a", storageKey: "drafts/a", value: { title: "A", body: "alice" }, version: 1 }]);
    expect((await list(router, "user", "drafts/*", bob)).items.map((item) => item.storageKey)).toEqual(["drafts/b"]);
    expect((await list(router, "org", "projects/*", bob)).items.map((item) => item.storageKey)).toEqual(["projects/p"]);
    expect((await list(router, "org", "projects/*", carol)).items.map((item) => item.storageKey)).toEqual(["projects/q"]);
    expect(await sessionAndRequests(stores)).toBe(before);
  });

  it("reads one entry by its topic, another user's as absent, and pages a list by cursor", async () => {
    const { router, stores } = buildRouter([threadsFlow()]);
    await seed(stores, "user", alice, "drafts/a", { title: "A", body: "", score: 0 });
    await seed(stores, "user", alice, "drafts/b", { title: "B", body: "", score: 0 });
    await seed(stores, "user", bob, "drafts/c", { title: "C", body: "", score: 0 });
    expect(await entry(router, "user", "drafts/*", "a", alice)).toEqual({
      topic: "a",
      storageKey: "drafts/a",
      value: { title: "A", body: "" },
      version: 1
    });
    expect(await entry(router, "user", "drafts/*", "c", alice)).toBeNull();
    const first = await list(router, "user", "drafts/*", alice, "?limit=1");
    expect(first.items.map((item) => item.topic)).toEqual(["a"]);
    const second = await list(router, "user", "drafts/*", alice, `?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.items.map((item) => item.topic)).toEqual(["b"]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("ignores a userId forged in the query under a resolver, and answers a caller it doesn't sign in as an unused key", async () => {
    const { router, stores } = buildRouter([threadsFlow()]);
    await seed(stores, "user", bob, "drafts/b", { title: "B", body: "", score: 0 });
    expect((await list(router, "user", "drafts/*", alice, "?userId=bob")).items).toEqual([]);
    // Answered as an unused key would be: an unsigned caller learns nothing about which keys exist.
    expect((await get(router, ["resources", "user", "drafts/*", "entries"], {}, "?userId=bob")).status).toBe(404);
  });

  it("refuses the single-resource read of a collection, naming its entries route", async () => {
    const { router } = buildRouter([threadsFlow()]);
    const res = await get(router, ["resources", "user", "drafts/*"], alice);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("entries");
  });
});

/** A write's record, its request, and the error it ended with, if any. */
async function sendEntry(router: Router, stores: StoreRegistry, scope: string, key: string, action: string, caller: Caller, input: unknown) {
  return send(router, stores, scope, key, action, caller, { input });
}

function errorCode(record: { result?: unknown }): string | undefined {
  return (record.result as { error?: { code?: string } } | undefined)?.error?.code;
}

describe("an entry written through the default write flow", () => {
  it("creates at version 0, updates at the version read, keeps hidden fields, and lands in the caller's own cell", async () => {
    const { router, stores } = buildRouter([threadsFlow()]);
    await seed(stores, "user", alice, "drafts/a", { title: "A", body: "", score: 9 });
    const created = await sendEntry(router, stores, "user", "drafts/*", "set", alice, {
      entry: "b",
      state: { title: "B", body: "new" },
      version: 0
    });
    expect(created.status, JSON.stringify(created.result)).toBe("completed");
    const updated = await sendEntry(router, stores, "user", "drafts/*", "set", alice, {
      entry: "a",
      state: { title: "A2", body: "", score: 100 },
      version: 1
    });
    expect(updated.status, JSON.stringify(updated.result)).toBe("completed");
    expect((await list(router, "user", "drafts/*", alice)).items).toEqual([
      { topic: "a", storageKey: "drafts/a", value: { title: "A2", body: "" }, version: 2 },
      { topic: "b", storageKey: "drafts/b", value: { title: "B", body: "new" }, version: 1 }
    ]);
    // The score is the server's: a client write keeps it as stored.
    const cell = resolveResourceScopeId({ userId: "alice", orgId: ORG_A }, { id: "threads" }, "user", false);
    expect((await stores.resourceState.get("user", cell, "drafts/a"))?.state).toEqual({ title: "A2", body: "", score: 9 });
    expect((await list(router, "user", "drafts/*", bob)).items).toEqual([]);
  });

  it("refuses a stale version with the current one, and a create over an entry that exists", async () => {
    const { router, stores } = buildRouter([threadsFlow()]);
    await seed(stores, "org", alice, "projects/p", { name: "P", lead: "alice" });
    // Alice and Bob both read version 1; Alice's lands, Bob's is refused and lands on re-read.
    const [first, second] = await Promise.all([
      sendEntry(router, stores, "org", "projects/*", "set", alice, { entry: "p", state: { name: "P", lead: "alice2" }, version: 1 }),
      sendEntry(router, stores, "org", "projects/*", "set", bob, { entry: "p", state: { name: "Pb", lead: "alice" }, version: 1 })
    ]);
    const codes = [first, second].map((record) => (record.status === "completed" ? "ok" : errorCode(record)));
    expect(codes.sort()).toEqual(["ok", "stale_version"]);
    const again = await sendEntry(router, stores, "org", "projects/*", "set", bob, {
      entry: "p",
      state: { ...((await entry(router, "org", "projects/*", "p", bob))!.value as JsonObject), name: "Pb" },
      version: 2
    });
    expect(again.status, JSON.stringify(again.result)).toBe("completed");
    const stored = (await entry(router, "org", "projects/*", "p", alice))!;
    expect(stored.version).toBe(3);
    expect(stored.value.name).toBe("Pb");
    const recreate = await sendEntry(router, stores, "org", "projects/*", "set", alice, {
      entry: "p",
      state: { name: "X", lead: "alice" },
      version: 0
    });
    expect(errorCode(recreate)).toBe("stale_version");
  });

  it("runs every entry write of one writer in one write session per collection, never one per entry", async () => {
    const { router, stores } = buildRouter([threadsFlow()]);
    await Promise.all(
      ["a", "b", "c"].map((topic) =>
        sendEntry(router, stores, "user", "drafts/*", "set", alice, { entry: topic, state: { title: topic, body: "" }, version: 0 })
      )
    );
    const requests = await stores.request.list({});
    expect(requests).toHaveLength(3);
    expect(requests.every((record) => record.status === "completed")).toBe(true);
    expect(new Set(requests.map((record) => record.sessionId)).size).toBe(1);
  });

  it("refuses canWrite, a schema refusal, and an entry outside the pattern", async () => {
    const { router, stores } = buildRouter([threadsFlow()]);
    const empty = await sendEntry(router, stores, "org", "projects/*", "set", alice, { entry: "p", state: { name: "", lead: "" }, version: 0 });
    expect(errorCode(empty)).toBe("write_refused");
    const long = await sendEntry(router, stores, "user", "drafts/*", "set", alice, {
      entry: "a",
      state: { title: "x".repeat(41), body: "" },
      version: 0
    });
    expect(long.status).toBe("failed");
    const outside = await sendEntry(router, stores, "user", "drafts/*", "set", alice, {
      entry: "a/b/c",
      state: { title: "", body: "" },
      version: 0
    });
    expect(errorCode(outside)).toBe("not_writable");
    expect((await list(router, "user", "drafts/*", alice)).items).toEqual([]);
    expect((await list(router, "org", "projects/*", alice)).items).toEqual([]);
  });

  it("ignores a userId forged in the body under a resolver: the write lands in the signed-in caller's cell", async () => {
    const { router, stores } = buildRouter([threadsFlow()]);
    const forged = await send(router, stores, "user", "drafts/*", "set", alice, {
      userId: "bob",
      input: { entry: "a", state: { title: "mine", body: "" }, version: 0 }
    });
    expect(forged.status, JSON.stringify(forged.result)).toBe("completed");
    expect((await list(router, "user", "drafts/*", bob)).items).toEqual([]);
    expect((await list(router, "user", "drafts/*", alice)).items.map((item) => item.value.title)).toEqual(["mine"]);
  });
});

describe("an entry deleted through the default write flow", () => {
  it("deletes at the version read, refuses a stale delete, and reads absent after", async () => {
    const { router, stores } = buildRouter([threadsFlow()]);
    await seed(stores, "user", alice, "drafts/a", { title: "A", body: "", score: 0 });
    const staleDelete = await sendEntry(router, stores, "user", "drafts/*", "delete", alice, { entry: "a", version: 0 });
    expect(errorCode(staleDelete)).toBe("stale_version");
    expect(await entry(router, "user", "drafts/*", "a", alice)).not.toBeNull();
    const deleted = await sendEntry(router, stores, "user", "drafts/*", "delete", alice, { entry: "a", version: 1 });
    expect(deleted.status, JSON.stringify(deleted.result)).toBe("completed");
    expect(await entry(router, "user", "drafts/*", "a", alice)).toBeNull();
    // A create after the delete starts the entry again from version 0.
    const again = await sendEntry(router, stores, "user", "drafts/*", "set", alice, { entry: "a", state: { title: "A", body: "" }, version: 0 });
    expect(again.status, JSON.stringify(again.result)).toBe("completed");
  });

  it("deletes only what the caller may: canWrite on the delete, and nothing in another org", async () => {
    const { router, stores } = buildRouter([threadsFlow()]);
    await seed(stores, "org", alice, "projects/p", { name: "P", lead: "alice" });
    // Bob is in the org but not the lead: the project's rule refuses his delete.
    const byBob = await sendEntry(router, stores, "org", "projects/*", "delete", bob, { entry: "p", version: 1 });
    expect(errorCode(byBob)).toBe("write_refused");
    // Carol is in another org: her cell holds no such entry, so org A's is untouched.
    const byCarol = await sendEntry(router, stores, "org", "projects/*", "delete", carol, { entry: "p", version: 1 });
    expect(errorCode(byCarol)).toBe("stale_version");
    expect((await entry(router, "org", "projects/*", "p", alice))?.version).toBe(1);
    const byLead = await sendEntry(router, stores, "org", "projects/*", "delete", alice, { entry: "p", version: 1 });
    expect(byLead.status, JSON.stringify(byLead.result)).toBe("completed");
    expect(await entry(router, "org", "projects/*", "p", bob)).toBeNull();
  });

  it("lets everyone in the org read an owner-writes entry, and only its owner write or delete it", async () => {
    const { router, stores } = buildRouter([threadsFlow()]);
    const aliceBoard = `${ownerSegment("alice")}/b1`;
    const created = await sendEntry(router, stores, "org", "boards/[owner]/[id]", "set", alice, {
      entry: aliceBoard,
      state: { text: "hi" },
      version: 0
    });
    expect(created.status, JSON.stringify(created.result)).toBe("completed");
    expect((await entry(router, "org", "boards/[owner]/[id]", aliceBoard, bob))?.value).toEqual({ text: "hi" });
    const bobWrites = await sendEntry(router, stores, "org", "boards/[owner]/[id]", "set", bob, {
      entry: aliceBoard,
      state: { text: "bob was here" },
      version: 1
    });
    expect(errorCode(bobWrites)).toBe("write_refused");
    const bobDeletes = await sendEntry(router, stores, "org", "boards/[owner]/[id]", "delete", bob, { entry: aliceBoard, version: 1 });
    expect(errorCode(bobDeletes)).toBe("write_refused");
    expect((await entry(router, "org", "boards/[owner]/[id]", aliceBoard, alice))).toMatchObject({ value: { text: "hi" }, version: 1 });
  });
});

describe("the change notice an entry write publishes", () => {
  it("publishes each entry write and delete on its scope's topic, naming the entry and the request", async () => {
    const { router, stores } = buildRouter([threadsFlow()]);
    const heard: ChangeNotice[] = [];
    stores.bus.subscribe({ scope: "org", id: ORG_A, tenantId: "" }, (notice) => heard.push(notice));
    const set = await sendEntry(router, stores, "org", "projects/*", "set", bob, { entry: "p", state: { name: "P", lead: "bob" }, version: 0 });
    const removed = await sendEntry(router, stores, "org", "projects/*", "delete", bob, { entry: "p", version: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(heard.map((notice) => [notice.topic.resource, notice.origin?.requestId])).toEqual([
      ["projects/p", set.id],
      ["projects/p", removed.id]
    ]);
  });
});

describe("a projected collection read by entry", () => {
  // Codex review 4543906399.
  it("hands its backing the requesting tenant, from the tenant header every route takes", async () => {
    const { defineProjectedResourceCollection } = await import("@flow-state-dev/core");
    const positions = defineProjectedResourceCollection({
      pattern: "positions/*",
      scope: "user",
      stateSchema: z.object({ qty: z.number() }),
      client: { state: { read: true } },
      read: async ({ ctx }: { ctx: { tenantId?: string } }) => (ctx.tenantId === "t1" ? { qty: 1 } : null),
      search: async ({ ctx }: { ctx: { tenantId?: string } }) => ({
        hits: ctx.tenantId === "t1" ? [{ key: "a", state: { qty: 1 } }] : []
      })
    } as never);
    const flow = defineFlow({
      kind: "desk",
      resources: { positions },
      actions: { noop: { block: noop } },
      authentication: { resolvePrincipal: signIn }
    } as never)();
    const { router } = buildRouter([flow]);
    const at = (tenant: string, path: string[]) =>
      router.GET(
        new Request(`http://localhost/api/flows/${path.map(encodeURIComponent).join("/")}`, {
          headers: { "x-user": "alice", "x-org": ORG_A, "x-tenant-id": tenant }
        }),
        { params: { path } }
      );
    const one = ["resources", "user", "positions/*", "entries", "a"];
    expect(((await (await at("t1", one)).json()) as { value?: unknown } | null)?.value).toEqual({ qty: 1 });
    expect(await (await at("t2", one)).json()).toBeNull();
    const list = ["resources", "user", "positions/*", "entries"];
    expect(((await (await at("t1", list)).json()) as { items: unknown[] }).items).toHaveLength(1);
    expect(((await (await at("t2", list)).json()) as { items: unknown[] }).items).toHaveLength(0);
  });
});

describe("an entry's content on delete", () => {
  // Codex review 4543906405.
  it("goes with the entry, so a recreated key starts with none", async () => {
    const { router, stores } = buildRouter([threadsFlow()]);
    const cell = resolveResourceScopeId({ userId: "alice", orgId: ORG_A }, { id: "threads" }, "user", false);
    await seed(stores, "user", alice, "drafts/a", { title: "A", body: "", score: 0 });
    await stores.content.set("user", cell, "drafts/a", "the old body");
    const deleted = await sendEntry(router, stores, "user", "drafts/*", "delete", alice, { entry: "a", version: 1 });
    expect(deleted.status, JSON.stringify(deleted.result)).toBe("completed");
    const again = await sendEntry(router, stores, "user", "drafts/*", "set", alice, { entry: "a", state: { title: "A", body: "" }, version: 0 });
    expect(again.status, JSON.stringify(again.result)).toBe("completed");
    expect(await stores.content.get("user", cell, "drafts/a")).toBeUndefined();
  });
});

describe("a collection's cap on entries written through the default write flow", () => {
  // Gitar review 4543837880.
  it("counts every entry in the org's cell, whoever owns it", async () => {
    const seats = defineResourceCollection({
      pattern: "seats/[owner]/[id]",
      scope: "org",
      ownerWrites: { param: "owner" },
      stateSchema: z.object({ label: z.string().default("") }),
      client: { state: { read: true } },
      maxInstances: 2,
      runBy: "default",
      canWrite: () => true
    });
    const flow = defineFlow({
      kind: "threads",
      resources: { seats },
      actions: { noop: { block: noop } },
      authentication: { resolvePrincipal: signIn }
    } as never)();
    const { router, stores } = buildRouter([flow]);
    const create = (caller: Caller, id: string) =>
      sendEntry(router, stores, "org", "seats/[owner]/[id]", "set", caller, {
        entry: `${ownerSegment(caller.user!)}/${id}`,
        state: { label: id },
        version: 0
      });
    expect((await create(alice, "a")).status).toBe("completed");
    expect((await create(bob, "b")).status).toBe("completed");
    expect(errorCode(await create(alice, "c"))).toBe("write_refused");
  });
});

describe("a user entry's change notice", () => {
  // Cursor review 4543992817: the user topic is the user's in every org, while the cell is per org.
  it("names no entry, so a page in the user's other org learns no key from a write in this one", async () => {
    const { router, stores } = buildRouter([threadsFlow()]);
    const heard: ChangeNotice[] = [];
    // Alice's page in org B listens on her user topic, the same topic in every org.
    stores.bus.subscribe({ scope: "user", id: "alice", tenantId: "" }, (notice) => heard.push(notice));
    const set = await sendEntry(router, stores, "user", "drafts/*", "set", alice, { entry: "secret-plan", state: { title: "x", body: "" }, version: 0 });
    expect(set.status, JSON.stringify(set.result)).toBe("completed");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(heard.length).toBeGreaterThan(0);
    expect(heard.every((notice) => notice.topic.resource === undefined)).toBe(true);
    expect(JSON.stringify(heard)).not.toContain("secret-plan");
  });

  it("is chosen in one place for every writer: a run's write and the default write flow's", async () => {
    const { noticePathFor } = await import("../src/bus/scope-changes");
    expect(noticePathFor(drafts, "drafts/secret-plan", "user")).toBeUndefined();
    // An org entry and a session entry keep their path; a single resource's key is the same for everyone.
    expect(noticePathFor(projects, "projects/p", "org")).toBe("projects/p");
    expect(noticePathFor(undefined, "pins", "user")).toBe("pins");
  });
});
