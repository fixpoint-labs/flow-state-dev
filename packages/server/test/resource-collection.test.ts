import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
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
  scope: "session",
  pattern: "files/**",
  stateSchema: fileSchema,
  maxInstances: 5,
  eviction: "none",
});

const lruFilesCollection = defineResourceCollection({
  scope: "session",
  pattern: "lrufiles/**",
  stateSchema: fileSchema,
  maxInstances: 3,
  eviction: "lru",
});

const oldestFilesCollection = defineResourceCollection({
  scope: "session",
  pattern: "oldestfiles/**",
  stateSchema: fileSchema,
  maxInstances: 2,
  eviction: "oldest",
});

const topicObsCollection = defineResourceCollection({
  scope: "session",
  pattern: "[topic]/observations",
  stateSchema: z.object({ entries: z.array(z.string()).default([]) }),
});

function makeFlow(collections: Record<string, ReturnType<typeof defineResourceCollection>>) {
  const block = handler({
    name: "noop",
    resources: collections,
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
  return ctx.resources.files as any;
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

    const got = await ns.get("readme.md");
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
    await expect(ns.get("nope.ts")).rejects.toThrow("not found");
  });

  it("getOptional() returns undefined for non-existent", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);
    expect(await ns.getOptional("nope.ts")).toBeUndefined();
  });

  it("getOrCreate() creates if absent", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    const ref = await ns.getOrCreate("new.ts", { language: "typescript" });
    expect(ref.state.language).toBe("typescript");
    expect(await ns.count()).toBe(1);
  });

  it("getOrCreate() returns existing if present", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("exist.ts", { language: "typescript" });
    const ref = await ns.getOrCreate("exist.ts", { language: "DIFFERENT" });
    expect(ref.state.language).toBe("typescript"); // original value
    expect(await ns.count()).toBe(1);
  });

  it("delete() removes instance", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("del.ts", { language: "typescript" });
    expect(await ns.count()).toBe(1);
    await ns.delete("del.ts");
    expect(await ns.count()).toBe(0);
    expect(await ns.getOptional("del.ts")).toBeUndefined();
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

    expect(await ns.count()).toBe(0);
    await ns.create("a.ts", { language: "typescript" });
    expect(await ns.count()).toBe(1);
    await ns.create("b.ts", { language: "typescript" });
    expect(await ns.count()).toBe(2);
    await ns.delete("a.ts");
    expect(await ns.count()).toBe(1);
  });

  it("deep nested paths work with ** pattern", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("src/utils/helpers.ts", { language: "typescript" });
    const ref = await ns.get("src/utils/helpers.ts");
    expect(ref.name).toBe("files/src/utils/helpers.ts");
    expect(ref.state.language).toBe("typescript");
  });
});

// ---------------------------------------------------------------------------
// create({ replace })
// ---------------------------------------------------------------------------

describe("create({ replace })", () => {
  it("replaces existing state instead of throwing", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript", metadata: { old: true } });
    const replaced = await ns.create(
      "a.ts",
      { language: "python" },
      { replace: true },
    );
    expect(replaced.state.language).toBe("python");
    // Original metadata is dropped — replace is setState semantics, not merge
    expect(replaced.state.metadata).toBeUndefined();
  });

  it("creates if missing — same as create() without the option", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    const ref = await ns.create(
      "fresh.ts",
      { language: "typescript" },
      { replace: true },
    );
    expect(ref.state.language).toBe("typescript");
    expect(await ns.count()).toBe(1);
  });

  it("does not double-count toward maxInstances when replacing", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    // filesCollection has maxInstances: 5
    for (let i = 0; i < 5; i++) {
      await ns.create(`f${i}.ts`, { language: "typescript" });
    }
    expect(await ns.count()).toBe(5);

    // Replace one of them — must not trip the maxInstances guard.
    await ns.create("f3.ts", { language: "python" }, { replace: true });
    expect(await ns.count()).toBe(5);
    expect((await ns.get("f3.ts")).state.language).toBe("python");
  });

  it("fires onInstanceUpdated on the replace branch", async () => {
    const created: string[] = [];
    const updated: Array<{ key: string; prev: unknown; next: unknown }> = [];
    const hookColl = defineResourceCollection({
      scope: "session",
      pattern: "hooked/**",
      stateSchema: z.object({ value: z.string() }),
      onInstanceCreated: (key) => {
        created.push(key);
      },
      onInstanceUpdated: (key, next, prev) => {
        updated.push({ key, prev, next });
      },
    });

    const { ctx } = await createCtx({ hooked: hookColl });
    const ns = ctx.resources.hooked as ResourceCollectionRef<{ value: string }>;

    await ns.create("x", { value: "first" });
    expect(created).toEqual(["hooked/x"]);
    expect(updated).toEqual([]);

    await ns.create("x", { value: "second" }, { replace: true });
    expect(created).toEqual(["hooked/x"]);
    expect(updated).toHaveLength(1);
    expect(updated[0].key).toBe("hooked/x");
    expect((updated[0].next as { value: string }).value).toBe("second");
    expect((updated[0].prev as { value: string }).value).toBe("first");
  });

  it("explicit { replace: false } behaves like the default (throws on exists)", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript" });
    await expect(
      ns.create("a.ts", { language: "python" }, { replace: false }),
    ).rejects.toThrow("already exists");
  });
});

// ---------------------------------------------------------------------------
// upsert
// ---------------------------------------------------------------------------

describe("upsert", () => {
  it("2-arg form creates when missing", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    const ref = await ns.upsert("new.ts", { language: "typescript" });
    expect(ref.state.language).toBe("typescript");
    expect(await ns.count()).toBe(1);
  });

  it("2-arg form patches when exists — preserves untouched fields", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript", metadata: { kept: true } });
    await ns.upsert("a.ts", { language: "python" });
    const got = await ns.get("a.ts");
    expect(got.state.language).toBe("python");
    // metadata was NOT in the update, so it must persist (patch semantics)
    expect(got.state.metadata).toEqual({ kept: true });
  });

  it("3-arg form creates with { ...createOnly, ...update } on missing", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.upsert(
      "new.ts",
      { language: "typescript" },
      { metadata: { initOnly: true } },
    );
    const ref = await ns.get("new.ts");
    expect(ref.state.language).toBe("typescript");
    expect(ref.state.metadata).toEqual({ initOnly: true });
  });

  it("3-arg form: update wins over createOnly on overlapping keys (create branch)", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.upsert(
      "new.ts",
      { language: "python" },
      { language: "typescript", metadata: { kept: true } },
    );
    const ref = await ns.get("new.ts");
    expect(ref.state.language).toBe("python");
    expect(ref.state.metadata).toEqual({ kept: true });
  });

  it("3-arg form: createOnly is ignored on the patch branch", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript" });
    await ns.upsert(
      "a.ts",
      { language: "python" },
      { metadata: { shouldNotAppear: true } },
    );
    const ref = await ns.get("a.ts");
    expect(ref.state.language).toBe("python");
    // createOnly was supplied but the resource already existed, so the
    // extras are not applied — only the update is patched in.
    expect(ref.state.metadata).toBeUndefined();
  });

  it("fires onInstanceCreated on create branch, onInstanceUpdated on patch branch", async () => {
    const created: string[] = [];
    const updated: string[] = [];
    const hookColl = defineResourceCollection({
      scope: "session",
      pattern: "hooked/**",
      stateSchema: z.object({ value: z.string() }),
      onInstanceCreated: (key) => {
        created.push(key);
      },
      onInstanceUpdated: (key) => {
        updated.push(key);
      },
    });

    const { ctx } = await createCtx({ hooked: hookColl });
    const ns = ctx.resources.hooked as ResourceCollectionRef<{ value: string }>;

    await ns.upsert("k1", { value: "first" });
    expect(created).toEqual(["hooked/k1"]);
    expect(updated).toEqual([]);

    await ns.upsert("k1", { value: "second" });
    expect(created).toEqual(["hooked/k1"]);
    expect(updated).toEqual(["hooked/k1"]);
  });

  it("throws on schema-invalid update on the patch branch (symmetric with create)", async () => {
    // Greptile review: prior to the fix, an invalid update on the patch
    // branch would silently overwrite the resource with `{}` (the
    // safeParse-fallback behavior in persistNamespaceInstanceState).
    // We now pre-validate the merged state so callers get a loud error,
    // matching create's behavior on bad input.
    const strictColl = defineResourceCollection({
      scope: "session",
      pattern: "strict/**",
      stateSchema: z.object({ count: z.number().int().nonnegative() }),
    });
    const { ctx } = await createCtx({ strict: strictColl });
    const ns = ctx.resources.strict as ResourceCollectionRef<{ count: number }>;

    await ns.create("k", { count: 1 });
    // Patch branch with an invalid value → must throw, not silently
    // overwrite with `{}`.
    await expect(
      ns.upsert("k", { count: -5 } as Partial<{ count: number }>),
    ).rejects.toThrow(/state validation failed/);

    // Resource must remain at its prior valid state — failed patch
    // must not have written anything.
    expect((await ns.get("k")).state.count).toBe(1);
  });

  it("honors maxInstances on the create branch only", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    // Fill to limit
    for (let i = 0; i < 5; i++) {
      await ns.upsert(`f${i}.ts`, { language: "typescript" });
    }
    expect(await ns.count()).toBe(5);

    // Patch existing — must not trip the maxInstances guard.
    await ns.upsert("f3.ts", { language: "python" });
    expect(await ns.count()).toBe(5);

    // Try to upsert a new key — maxInstances is hit and eviction is "none",
    // so this throws.
    await expect(ns.upsert("f5.ts", { language: "ruby" })).rejects.toThrow(
      "maxInstances",
    );
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
    const ref = await ns.get("a.ts");
    await ref.patchState({ language: "javascript" });

    const updated = await ns.get("a.ts");
    expect(updated.state.language).toBe("javascript");
  });

  it("setState replaces entire state", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript", metadata: { old: true } });
    const ref = await ns.get("a.ts");
    await ref.setState({ language: "python" } as any);

    const updated = await ns.get("a.ts");
    expect(updated.state.language).toBe("python");
  });

  it("updateState uses functional updater", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript" });
    const ref = await ns.get("a.ts");
    await ref.updateState((s) => ({ ...s, language: s.language + "!" }));

    const updated = await ns.get("a.ts");
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
    const ref = await ns.get("a.ts");
    expect(await ref.readContent()).toBeNull();
    expect(await ref.readContentRaw()).toBeNull();
  });

  it("writeContent and readContent round-trip", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript" });
    const ref = await ns.get("a.ts");
    await ref.writeContent("const x = 1;");

    // Re-get to ensure persistence
    const ref2 = await ns.get("a.ts");
    expect(await ref2.readContent()).toBe("const x = 1;");
    expect(await ref2.readContentRaw()).toBe("const x = 1;");
  });

  it("content is deleted when instance is deleted", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript" });
    const ref = await ns.get("a.ts");
    await ref.writeContent("hello");

    await ns.delete("a.ts");

    // Re-create and check content is gone
    await ns.create("a.ts", { language: "typescript" });
    const ref2 = await ns.get("a.ts");
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

    const all = await ns.list();
    expect(all).toHaveLength(3);
  });

  it("list(prefix) filters by prefix", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript" });
    await ns.create("src/b.ts", { language: "typescript" });
    await ns.create("src/utils/c.ts", { language: "typescript" });
    await ns.create("docs/readme.md", { language: "markdown" });

    const srcFiles = await ns.list("src/");
    expect(srcFiles).toHaveLength(2);
    expect(srcFiles.map((r) => r.name).sort()).toEqual([
      "files/src/b.ts",
      "files/src/utils/c.ts",
    ]);

    const docFiles = await ns.list("docs/");
    expect(docFiles).toHaveLength(1);
    expect(docFiles[0]!.name).toBe("files/docs/readme.md");
  });

  it("list(prefix) returns empty when no match", async () => {
    const { ctx } = await createCtx({ files: filesCollection });
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "typescript" });
    expect(await ns.list("src/")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Parameterized patterns
// ---------------------------------------------------------------------------

describe("parameterized collection", () => {
  it("create and get with object key", async () => {
    const { ctx } = await createCtx({ topicObs: topicObsCollection });
    const ns = ctx.resources.topicObs as any as ResourceCollectionRef<{ entries: string[] }>;

    await ns.create({ topic: "react" }, { entries: ["first"] });
    const ref = await ns.get({ topic: "react" });
    expect(ref.state.entries).toEqual(["first"]);
    expect(ref.name).toBe("react/observations");
  });

  it("list returns all parameterized instances", async () => {
    const { ctx } = await createCtx({ topicObs: topicObsCollection });
    const ns = ctx.resources.topicObs as any as ResourceCollectionRef<{ entries: string[] }>;

    await ns.create({ topic: "react" }, {});
    await ns.create({ topic: "rust" }, {});

    const all = await ns.list();
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
    expect(await ns.count()).toBe(5);

    await expect(ns.create("overflow.ts", { language: "typescript" })).rejects.toThrow("maxInstances");
  });
});

describe("maxInstances with eviction: lru", () => {
  it("evicts LRU instance and persists the deletion", async () => {
    const { ctx, stores } = await createCtx({ lrufiles: lruFilesCollection });
    const ns = ctx.resources.lrufiles as any as ResourceCollectionRef<{ language: string }>;

    // Fill to capacity
    await ns.create("a.ts", { language: "a" });
    await ns.create("b.ts", { language: "b" });
    await ns.create("c.ts", { language: "c" });
    expect(await ns.count()).toBe(3);

    // Access b and c but not a — a should be LRU
    await ns.get("b.ts");
    await ns.get("c.ts");

    // Create one more — should evict a
    await ns.create("d.ts", { language: "d" });
    expect(await ns.count()).toBe(3);
    expect(await ns.getOptional("a.ts")).toBeUndefined();
    expect(await ns.getOptional("d.ts")).toBeDefined();

    // Verify persistence — collection-instance state lives in the
    // ResourceStateStore (FIX-689), not inline in the scope record.
    const persisted = await stores.resourceState.getAll("session", "sess_1");
    expect(persisted["lrufiles/a.ts"]).toBeUndefined();
    expect(persisted["lrufiles/d.ts"]).toBeDefined();
  });
});

describe("maxInstances with eviction: oldest", () => {
  it("evicts oldest (first inserted) instance", async () => {
    const { ctx } = await createCtx({ oldestfiles: oldestFilesCollection });
    const ns = ctx.resources.oldestfiles as any as ResourceCollectionRef<{ language: string }>;

    await ns.create("first.ts", { language: "first" });
    await ns.create("second.ts", { language: "second" });
    expect(await ns.count()).toBe(2);

    // This should evict first.ts
    await ns.create("third.ts", { language: "third" });
    expect(await ns.count()).toBe(2);
    expect(await ns.getOptional("first.ts")).toBeUndefined();
    expect(await ns.getOptional("third.ts")).toBeDefined();
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
      scope: "session",
      pattern: "strict/**",
      stateSchema: strictSchema,
    });

    const { ctx } = await createCtx({ strict: strictNs });
    const ns = ctx.resources.strict as any as ResourceCollectionRef<{ required: string }>;

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
      scope: "session",
      pattern: "hookfiles/**",
      stateSchema: fileSchema,
      onInstanceCreated: (key, _state, ctx) => {
        receivedKey = key;
        receivedCtx = ctx;
      },
    });

    const { ctx } = await createCtx({ hookfiles: hookNs });
    const ns = ctx.resources.hookfiles as any as ResourceCollectionRef<any>;

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
      scope: "session",
      pattern: "hookfiles/**",
      stateSchema: fileSchema,
      onInstanceUpdated: (_key, _state, prevState, _ctx) => {
        updated = true;
        updatedPrev = prevState;
      },
    });

    const { ctx } = await createCtx({ hookfiles: hookNs });
    const ns = ctx.resources.hookfiles as any as ResourceCollectionRef<any>;

    await ns.create("test.ts", { language: "typescript" });
    const ref = await ns.get("test.ts");
    await ref.patchState({ language: "javascript" });

    expect(updated).toBe(true);
    expect(updatedPrev.language).toBe("typescript");
  });

  it("onInstanceDeleted fires on delete and eviction", async () => {
    const deletedKeys: string[] = [];

    const hookNs = defineResourceCollection({
      scope: "session",
      pattern: "hookevict/**",
      stateSchema: fileSchema,
      maxInstances: 2,
      eviction: "oldest",
      onInstanceDeleted: (key, _ctx) => {
        deletedKeys.push(key);
      },
    });

    const { ctx } = await createCtx({ hookevict: hookNs });
    const ns = ctx.resources.hookevict as any as ResourceCollectionRef<any>;

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

    // Collection-instance state is keyed flatly by path-based storage key in
    // the ResourceStateStore (FIX-689), not inline in the scope record.
    const resources = await stores.resourceState.getAll("session", "sess_1");

    expect(resources["files/readme.md"]).toEqual({ language: "markdown" });
    expect(resources["files/src/utils.ts"]).toEqual({ language: "typescript" });
  });
});

// ---------------------------------------------------------------------------
// Per-key write routing (FIX-689): the headline behaviour — a collection
// mutation writes only its own key to the ResourceStateStore and never
// rewrites the whole scope record.
// ---------------------------------------------------------------------------

describe("per-key state write routing", () => {
  function spyStores() {
    const stores = createInMemoryStores();
    const stateSetKeys: string[] = [];
    const stateDeleteKeys: string[] = [];
    let sessionSetCount = 0;

    const realStateSet = stores.resourceState.set.bind(stores.resourceState);
    stores.resourceState.set = async (scope, id, key, value) => {
      stateSetKeys.push(key);
      return realStateSet(scope, id, key, value);
    };
    const realStateDelete = stores.resourceState.delete.bind(stores.resourceState);
    stores.resourceState.delete = async (scope, id, key) => {
      stateDeleteKeys.push(key);
      return realStateDelete(scope, id, key);
    };
    const realSessionSet = stores.session.set.bind(stores.session);
    stores.session.set = async (...args) => {
      sessionSetCount += 1;
      return realSessionSet(...args);
    };

    return { stores, stateSetKeys, stateDeleteKeys, get sessionSetCount() { return sessionSetCount; } };
  }

  async function ctxWith(stores: ReturnType<typeof createInMemoryStores>) {
    const flow = makeFlow({ files: filesCollection });
    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_1",
      sessionId: "sess_1",
      userId: "user_1",
      stores,
    });
    return ctx;
  }

  it("create writes exactly one resourceState key and never the scope record", async () => {
    const spy = spyStores();
    const ctx = await ctxWith(spy.stores);
    const ns = getFilesNs(ctx);

    // Context setup legitimately persists the scope record once; measure that
    // the mutation itself adds zero further scope-record writes.
    const sessionSetsBefore = spy.sessionSetCount;
    await ns.create("a.ts", { language: "a" });

    expect(spy.stateSetKeys).toEqual(["files/a.ts"]);
    expect(spy.sessionSetCount).toBe(sessionSetsBefore);
  });

  it("patchState on one instance writes only that instance's key", async () => {
    const spy = spyStores();
    const ctx = await ctxWith(spy.stores);
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "a" });
    await ns.create("b.ts", { language: "b" });
    spy.stateSetKeys.length = 0;
    const sessionSetsBefore = spy.sessionSetCount;

    await (await ns.get("a.ts")).patchState({ language: "typescript" });

    expect(spy.stateSetKeys).toEqual(["files/a.ts"]);
    expect(spy.sessionSetCount).toBe(sessionSetsBefore);
  });

  it("delete routes a single resourceState.delete and never the scope record", async () => {
    const spy = spyStores();
    const ctx = await ctxWith(spy.stores);
    const ns = getFilesNs(ctx);

    await ns.create("a.ts", { language: "a" });
    const sessionSetsBefore = spy.sessionSetCount;
    await ns.delete("a.ts");

    expect(spy.stateDeleteKeys).toEqual(["files/a.ts"]);
    expect(spy.sessionSetCount).toBe(sessionSetsBefore);
  });
});
