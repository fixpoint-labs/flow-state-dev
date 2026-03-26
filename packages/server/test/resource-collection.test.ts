import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, defineResourceCollection, handler } from "@flow-state-dev/core";
import { createExecutionContext, createInMemoryStores } from "../src";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { JsonObject } from "@flow-state-dev/core/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fileSchema = z.object({
  language: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

const filesCollection = defineResourceCollection({
  pattern: "files/**",
  stateSchema: fileSchema,
  maxInstances: 5,
  eviction: "none",
});

const lruFilesCollection = defineResourceCollection({
  pattern: "lrufiles/**",
  stateSchema: fileSchema,
  maxInstances: 3,
  eviction: "lru",
});

const oldestFilesCollection = defineResourceCollection({
  pattern: "oldestfiles/**",
  stateSchema: fileSchema,
  maxInstances: 2,
  eviction: "oldest",
});

const topicObsCollection = defineResourceCollection({
  pattern: "[topic]/observations",
  stateSchema: z.object({ entries: z.array(z.string()).default([]) }),
});

function makeFlow(collections: Record<string, ReturnType<typeof defineResourceCollection>>) {
  const block = handler({
    name: "noop",
    sessionResources: collections,
    execute: () => "ok",
  });

  return defineFlow({
    kind: "coll-test",
    actions: { run: { inputSchema: z.string(), block } },
  })();
}

async function createCtx(collections: Record<string, ReturnType<typeof defineResourceCollection>>) {
  const stores = createInMemoryStores();
  const flow = makeFlow(collections);
  const ctx = await createExecutionContext({
    flow,
    actionName: "run",
    requestId: "req_1",
    sessionId: "sess_1",
    userId: "user_1",
    stores,
  });
  return { ctx, stores };
}

function getFilesNs(ctx: any): ResourceCollectionRef<{ language: string; metadata?: Record<string, unknown> }> {
  return ctx.session.resources.files as any;
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

describe("collection CRUD", () => {
  it("create() and get() round-trip", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    const ref = await ns.create("readme.md", { language: "markdown" });
    expect(ref.state.language).toBe("markdown");
    expect(ref.name).toBe("files/readme.md");

    const got = ns.get("readme.md");
    expect(got.state.language).toBe("markdown");
  });

  it("create() throws on duplicate key", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript" });
    await expect(ns.create("a.ts", { language: "typescript" })).rejects.toThrow("already exists");
  });

  it("get() throws for non-existent key", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);
    expect(() => ns.get("nope.ts")).toThrow("not found");
  });

  it("getOptional() returns undefined for non-existent", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);
    expect(ns.getOptional("nope.ts")).toBeUndefined();
  });

  it("getOrCreate() creates if absent", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    const ref = await ns.getOrCreate("new.ts", { language: "typescript" });
    expect(ref.state.language).toBe("typescript");
    expect(ns.count()).toBe(1);
  });

  it("getOrCreate() returns existing if present", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("exist.ts", { language: "typescript" });
    const ref = await ns.getOrCreate("exist.ts", { language: "DIFFERENT" });
    expect(ref.state.language).toBe("typescript"); // original value
    expect(ns.count()).toBe(1);
  });

  it("delete() removes instance", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("del.ts", { language: "typescript" });
    expect(ns.count()).toBe(1);
    await ns.delete("del.ts");
    expect(ns.count()).toBe(0);
    expect(ns.getOptional("del.ts")).toBeUndefined();
  });

  it("delete() is idempotent — no-op on non-existent", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);
    // Should not throw
    await ns.delete("nonexistent.ts");
  });

  it("count() tracks instances", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    expect(ns.count()).toBe(0);
    await ns.create("a.ts", { language: "typescript" });
    expect(ns.count()).toBe(1);
    await ns.create("b.ts", { language: "typescript" });
    expect(ns.count()).toBe(2);
    await ns.delete("a.ts");
    expect(ns.count()).toBe(1);
  });

  it("deep nested paths work with ** pattern", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("src/utils/helpers.ts", { language: "typescript" });
    const ref = ns.get("src/utils/helpers.ts");
    expect(ref.name).toBe("files/src/utils/helpers.ts");
    expect(ref.state.language).toBe("typescript");
  });
});

// ---------------------------------------------------------------------------
// State mutations
// ---------------------------------------------------------------------------

describe("collection instance state mutations", () => {
  it("patchState updates partial state", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript" });
    const ref = ns.get("a.ts");
    await ref.patchState({ language: "javascript" });

    const updated = ns.get("a.ts");
    expect(updated.state.language).toBe("javascript");
  });

  it("setState replaces entire state", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript", metadata: { old: true } });
    const ref = ns.get("a.ts");
    await ref.setState({ language: "python" } as any);

    const updated = ns.get("a.ts");
    expect(updated.state.language).toBe("python");
  });

  it("updateState uses functional updater", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript" });
    const ref = ns.get("a.ts");
    await ref.updateState((s) => ({ ...s, language: s.language + "!" }));

    const updated = ns.get("a.ts");
    expect(updated.state.language).toBe("typescript!");
  });
});

// ---------------------------------------------------------------------------
// Content read/write
// ---------------------------------------------------------------------------

describe("collection instance content", () => {
  it("readContent returns null initially", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript" });
    const ref = ns.get("a.ts");
    expect(await ref.readContent()).toBeNull();
    expect(await ref.readContentRaw()).toBeNull();
  });

  it("writeContent and readContent round-trip", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript" });
    const ref = ns.get("a.ts");
    await ref.writeContent("const x = 1;");

    // Re-get to ensure persistence
    const ref2 = ns.get("a.ts");
    expect(await ref2.readContent()).toBe("const x = 1;");
    expect(await ref2.readContentRaw()).toBe("const x = 1;");
  });

  it("content is deleted when instance is deleted", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript" });
    const ref = ns.get("a.ts");
    await ref.writeContent("hello");

    await ns.delete("a.ts");

    // Re-create and check content is gone
    await ns.create("a.ts", { language: "typescript" });
    const ref2 = ns.get("a.ts");
    expect(await ref2.readContent()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Prefix filtering
// ---------------------------------------------------------------------------

describe("collection list() prefix filtering", () => {
  it("list() returns all instances", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript" });
    await ns.create("b.ts", { language: "typescript" });
    await ns.create("src/c.ts", { language: "typescript" });

    const all = ns.list();
    expect(all).toHaveLength(3);
  });

  it("list(prefix) filters by prefix", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript" });
    await ns.create("src/b.ts", { language: "typescript" });
    await ns.create("src/utils/c.ts", { language: "typescript" });
    await ns.create("docs/readme.md", { language: "markdown" });

    const srcFiles = ns.list("src/");
    expect(srcFiles).toHaveLength(2);
    expect(srcFiles.map((r) => r.name).sort()).toEqual([
      "files/src/b.ts",
      "files/src/utils/c.ts",
    ]);

    const docFiles = ns.list("docs/");
    expect(docFiles).toHaveLength(1);
    expect(docFiles[0]!.name).toBe("files/docs/readme.md");
  });

  it("list(prefix) returns empty when no match", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript" });
    expect(ns.list("src/")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Parameterized patterns
// ---------------------------------------------------------------------------

describe("parameterized collection", () => {
  it("create and get with object key", async () => {
    const { ctx } = await createCtx({ topicObs: topicObsCollection });
    const ns = ctx.session.resources.topicObs as any as ResourceCollectionRef<{ entries: string[] }>;

    await ns.create({ topic: "react" }, { entries: ["first"] });
    const ref = ns.get({ topic: "react" });
    expect(ref.state.entries).toEqual(["first"]);
    expect(ref.name).toBe("react/observations");
  });

  it("list returns all parameterized instances", async () => {
    const { ctx } = await createCtx({ topicObs: topicObsCollection });
    const ns = ctx.session.resources.topicObs as any as ResourceCollectionRef<{ entries: string[] }>;

    await ns.create({ topic: "react" }, {});
    await ns.create({ topic: "rust" }, {});

    const all = ns.list();
    expect(all).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// maxInstances and eviction
// ---------------------------------------------------------------------------

describe("maxInstances with eviction: none", () => {
  it("throws when maxInstances reached", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    for (let i = 0; i < 5; i++) {
      await ns.create(`f${i}.ts`, { language: "typescript" });
    }
    expect(ns.count()).toBe(5);

    await expect(ns.create("overflow.ts", { language: "typescript" })).rejects.toThrow("maxInstances");
  });
});

describe("maxInstances with eviction: lru", () => {
  it("evicts LRU instance and persists the deletion", async () => {
    const { ctx, stores } = await createCtx({ lrufiles: lruFilesCollection });
    const ns = ctx.session.resources.lrufiles as any as ResourceCollectionRef<{ language: string }>;

    // Fill to capacity
    await ns.create("a.ts", { language: "a" });
    await ns.create("b.ts", { language: "b" });
    await ns.create("c.ts", { language: "c" });
    expect(ns.count()).toBe(3);

    // Access b and c but not a — a should be LRU
    ns.get("b.ts");
    ns.get("c.ts");

    // Create one more — should evict a
    await ns.create("d.ts", { language: "d" });
    expect(ns.count()).toBe(3);
    expect(ns.getOptional("a.ts")).toBeUndefined();
    expect(ns.getOptional("d.ts")).toBeDefined();

    // Verify persistence — check the store directly
    const session = await stores.session.get("sess_1");
    expect(session).toBeDefined();
    expect(session!.resources).toBeDefined();
    expect((session!.resources as any)["lrufiles/a.ts"]).toBeUndefined();
    expect((session!.resources as any)["lrufiles/d.ts"]).toBeDefined();
  });
});

describe("maxInstances with eviction: oldest", () => {
  it("evicts oldest (first inserted) instance", async () => {
    const { ctx } = await createCtx({ oldestfiles: oldestFilesCollection });
    const ns = ctx.session.resources.oldestfiles as any as ResourceCollectionRef<{ language: string }>;

    await ns.create("first.ts", { language: "first" });
    await ns.create("second.ts", { language: "second" });
    expect(ns.count()).toBe(2);

    // This should evict first.ts
    await ns.create("third.ts", { language: "third" });
    expect(ns.count()).toBe(2);
    expect(ns.getOptional("first.ts")).toBeUndefined();
    expect(ns.getOptional("third.ts")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe("schema validation on create", () => {
  it("throws on invalid initial state", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    // language is required string — passing a number should fail
    await expect(
      ns.create("bad.ts", { language: 42 as any })
    ).rejects.toThrow("validation failed");
  });

  it("never silently falls back to empty state", async () => {
    const strictSchema = z.object({
      required: z.string(),
    });
    const strictNs = defineResourceCollection({
      pattern: "strict/**",
      stateSchema: strictSchema,
    });

    const { ctx } = await createCtx({ strict: strictNs });
    const ns = ctx.session.resources.strict as any as ResourceCollectionRef<{ required: string }>;

    // Missing required field should throw, not create with {}
    await expect(ns.create("bad.ts", {})).rejects.toThrow("validation failed");
  });
});

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

describe("lifecycle hooks with context", () => {
  it("onInstanceCreated receives populated context", async () => {
    let receivedCtx: any = null;
    let receivedKey = "";

    const hookNs = defineResourceCollection({
      pattern: "hookfiles/**",
      stateSchema: fileSchema,
      onInstanceCreated: (key, _state, ctx) => {
        receivedKey = key;
        receivedCtx = ctx;
      },
    });

    const { ctx } = await createCtx({ hookfiles: hookNs });
    const ns = ctx.session.resources.hookfiles as any as ResourceCollectionRef<any>;

    await ns.create("test.ts", { language: "typescript" });

    expect(receivedKey).toBe("hookfiles/test.ts");
    expect(receivedCtx).toBeDefined();
    expect(receivedCtx.scopeType).toBe("session");
    expect(typeof receivedCtx.log).toBe("function");
  });

  it("onInstanceUpdated fires on patchState", async () => {
    let updated = false;
    let updatedPrev: any = null;

    const hookNs = defineResourceCollection({
      pattern: "hookfiles/**",
      stateSchema: fileSchema,
      onInstanceUpdated: (_key, _state, prevState, _ctx) => {
        updated = true;
        updatedPrev = prevState;
      },
    });

    const { ctx } = await createCtx({ hookfiles: hookNs });
    const ns = ctx.session.resources.hookfiles as any as ResourceCollectionRef<any>;

    await ns.create("test.ts", { language: "typescript" });
    const ref = ns.get("test.ts");
    await ref.patchState({ language: "javascript" });

    expect(updated).toBe(true);
    expect(updatedPrev.language).toBe("typescript");
  });

  it("onInstanceDeleted fires on delete and eviction", async () => {
    const deletedKeys: string[] = [];

    const hookNs = defineResourceCollection({
      pattern: "hookevict/**",
      stateSchema: fileSchema,
      maxInstances: 2,
      eviction: "oldest",
      onInstanceDeleted: (key, _ctx) => {
        deletedKeys.push(key);
      },
    });

    const { ctx } = await createCtx({ hookevict: hookNs });
    const ns = ctx.session.resources.hookevict as any as ResourceCollectionRef<any>;

    await ns.create("a.ts", { language: "a" });
    await ns.create("b.ts", { language: "b" });

    // This triggers eviction of a.ts
    await ns.create("c.ts", { language: "c" });
    expect(deletedKeys).toContain("hookevict/a.ts");

    // Explicit delete
    await ns.delete("b.ts");
    expect(deletedKeys).toContain("hookevict/b.ts");
  });
});

// ---------------------------------------------------------------------------
// Flat storage model verification
// ---------------------------------------------------------------------------

describe("flat storage model", () => {
  it("collection instances stored with path-based keys alongside static resources", async () => {
    const { ctx, stores } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("readme.md", { language: "markdown" });
    await ns.create("src/utils.ts", { language: "typescript" });

    const session = await stores.session.get("sess_1");
    const resources = session!.resources as Record<string, any>;

    expect(resources["files/readme.md"]).toEqual({ language: "markdown" });
    expect(resources["files/src/utils.ts"]).toEqual({ language: "typescript" });
  });
});
