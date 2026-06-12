/**
 * Tests for the resource-registry module extracted from createExecutionContext.
 *
 * Covers: normalization helpers, isCollectionConfig, static resource CRUD,
 * collection CRUD with lifecycle hooks, LRU eviction, onResourceChanged
 * callbacks, template resolution, and filterFlowLevelEager.
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { JsonObject, ResourceConfig, ResourceCollectionConfig } from "@flow-state-dev/core/types";
import {
  createScopeResourceRegistry,
  normalizeScopeResources,
  normalizeScopeResourceContent,
  resolveStringContentTemplates,
  filterFlowLevelEager,
  isCollectionConfig,
  normalizeStateDefault
} from "../../src/context/resource-registry";

function makeResourceConfig(overrides: Partial<ResourceConfig> = {}): ResourceConfig {
  return {
    scope: "session",
    stateSchema: z.object({}).passthrough(),
    ...overrides
  };
}

function makeCollectionConfig(
  pattern: string,
  overrides: Partial<ResourceCollectionConfig> = {}
): ResourceCollectionConfig {
  return {
    pattern,
    scope: "session",
    stateSchema: z.object({}).passthrough(),
    ...overrides
  };
}

function makeRegistry(options: {
  configs?: Record<string, ResourceConfig | ResourceCollectionConfig>;
  initialState?: Record<string, JsonObject>;
  initialContent?: Record<string, string>;
  onResourceChanged?: (
    path: string,
    type: "created" | "updated" | "deleted",
    projection?: { delta: unknown }
  ) => void;
}) {
  const state = { ...(options.initialState ?? {}) };
  const content = { ...(options.initialContent ?? {}) };

  return createScopeResourceRegistry({
    scope: "session",
    scopeId: "sess_1",
    configs: options.configs ?? {},
    readResources: () => state,
    readResourceContent: () => content,
    persistResourceKey: async (key, value) => { state[key] = value; },
    deleteResourceKey: async (key) => { delete state[key]; },
    persistResourceContentKey: async (key, value) => { content[key] = value; },
    deleteResourceContentKey: async (key) => { delete content[key]; },
    onResourceChanged: options.onResourceChanged
  });
}

describe("normalizeStateDefault", () => {
  it("returns {} when no schema is provided", () => {
    expect(normalizeStateDefault(undefined)).toEqual({});
  });

  it("returns parsed value from undefined when schema has defaults", () => {
    const schema = z.object({ count: z.number().default(0) });
    expect(normalizeStateDefault(schema)).toEqual({ count: 0 });
  });

  it("falls back to parsing {} when undefined fails", () => {
    const schema = z.object({ name: z.string().default("untitled") });
    expect(normalizeStateDefault(schema)).toEqual({ name: "untitled" });
  });

  it("returns {} when both undefined and {} fail parsing", () => {
    const schema = z.object({ name: z.string() });
    expect(normalizeStateDefault(schema)).toEqual({});
  });
});

describe("isCollectionConfig", () => {
  it("returns true for objects with a pattern string", () => {
    expect(isCollectionConfig({ pattern: "items/*", scope: "session", stateSchema: z.object({}) })).toBe(true);
  });

  it("returns false for a static resource config", () => {
    expect(isCollectionConfig({ scope: "session", stateSchema: z.object({}) })).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isCollectionConfig(null)).toBe(false);
    expect(isCollectionConfig(undefined)).toBe(false);
  });
});

describe("normalizeScopeResources", () => {
  it("normalizes static resources from seed", () => {
    const config = makeResourceConfig({ stateSchema: z.object({ count: z.number() }).passthrough() });
    const result = normalizeScopeResources(
      { counter: config },
      { counter: { count: 5 } }
    );
    expect(result.counter).toEqual({ count: 5 });
  });

  it("uses schema defaults when seed has no entry", () => {
    const config = makeResourceConfig({
      stateSchema: z.object({ count: z.number().default(0) })
    });
    const result = normalizeScopeResources({ counter: config }, undefined);
    expect(result.counter).toEqual({ count: 0 });
  });

  it("skips collection configs", () => {
    const staticConfig = makeResourceConfig();
    const collectionConfig = makeCollectionConfig("items/*");
    const result = normalizeScopeResources(
      { doc: staticConfig, items: collectionConfig },
      undefined
    );
    expect("doc" in result).toBe(true);
    expect("items" in result).toBe(false);
  });

  it("preserves seed entries not matching any static config (collection instances)", () => {
    const result = normalizeScopeResources(
      {},
      { "items/a": { title: "A" }, "items/b": { title: "B" } }
    );
    expect(result["items/a"]).toEqual({ title: "A" });
    expect(result["items/b"]).toEqual({ title: "B" });
  });
});

describe("normalizeScopeResourceContent", () => {
  it("normalizes content from seed", () => {
    const config = makeResourceConfig({ content: "default content" });
    const result = normalizeScopeResourceContent(
      { doc: config },
      { doc: "stored content" }
    );
    expect(result.doc).toBe("stored content");
  });

  it("uses config.content as default when no seed entry", () => {
    const config = makeResourceConfig({ content: "default content" });
    const result = normalizeScopeResourceContent({ doc: config }, undefined);
    expect(result.doc).toBe("default content");
  });
});

describe("resolveStringContentTemplates", () => {
  it("no-ops configs that have no string contentTemplate", () => {
    const config = makeResourceConfig();
    const configs = { doc: config };
    resolveStringContentTemplates(configs);
    expect(configs.doc).toBe(config);
    expect(configs.doc.contentTemplate).toBeUndefined();
  });

  it("throws when a string contentTemplate path does not exist", () => {
    const config = makeResourceConfig({ contentTemplate: "/nonexistent/template.md" });
    expect(() => resolveStringContentTemplates({ doc: config })).toThrow(/Failed to load contentTemplate/);
  });
});

describe("filterFlowLevelEager", () => {
  it("keeps only configs whose accessor is in flowLevelKeys", () => {
    const a = makeResourceConfig();
    const b = makeResourceConfig();
    const c = makeResourceConfig();
    const result = filterFlowLevelEager(
      { a, b, c },
      new Set(["a", "c"])
    );
    expect(Object.keys(result)).toEqual(["a", "c"]);
  });

  it("excludes lazy prefetchMode configs", () => {
    const eager = makeResourceConfig();
    const lazy = makeResourceConfig({ prefetchMode: "lazy" });
    const result = filterFlowLevelEager(
      { eager, lazy },
      new Set(["eager", "lazy"])
    );
    expect(Object.keys(result)).toEqual(["eager"]);
  });
});

describe("createScopeResourceRegistry — static resources", () => {
  it("reads state from the backing store", () => {
    const config = makeResourceConfig({
      stateSchema: z.object({ count: z.number() }).passthrough()
    });
    const registry = makeRegistry({
      configs: { counter: config },
      initialState: { counter: { count: 42 } }
    });
    const ref = registry.get("counter");
    expect(ref.state).toEqual({ count: 42 });
  });

  it("patchState merges partial updates", async () => {
    const config = makeResourceConfig({
      stateSchema: z.object({ a: z.number(), b: z.number() }).passthrough()
    });
    const registry = makeRegistry({
      configs: { data: config },
      initialState: { data: { a: 1, b: 2 } }
    });
    const ref = registry.get("data");
    await ref.patchState({ a: 10 });
    expect(ref.state).toEqual({ a: 10, b: 2 });
  });

  it("setState replaces state entirely", async () => {
    const config = makeResourceConfig({
      stateSchema: z.object({ x: z.number() }).passthrough()
    });
    const registry = makeRegistry({
      configs: { data: config },
      initialState: { data: { x: 1 } }
    });
    const ref = registry.get("data");
    await ref.setState({ x: 99 });
    expect(ref.state).toEqual({ x: 99 });
  });

  it("updateState applies an updater function", async () => {
    const config = makeResourceConfig({
      stateSchema: z.object({ count: z.number() }).passthrough()
    });
    const registry = makeRegistry({
      configs: { counter: config },
      initialState: { counter: { count: 5 } }
    });
    const ref = registry.get("counter");
    await ref.updateState((s) => ({ ...s, count: (s as any).count + 1 }));
    expect(ref.state).toEqual({ count: 6 });
  });

  it("throws on patchState for read-only resources", async () => {
    const config = makeResourceConfig({ writable: false });
    const registry = makeRegistry({
      configs: { doc: config },
      initialState: { doc: {} }
    });
    const ref = registry.get("doc");
    await expect(ref.patchState({ x: 1 })).rejects.toThrow(/read-only/);
  });

  it("throws when getting an unregistered resource", () => {
    const registry = makeRegistry({ configs: {} });
    expect(() => registry.get("nonexistent")).toThrow(/not registered/);
  });

  it("list() returns all registered handles", () => {
    const a = makeResourceConfig();
    const b = makeResourceConfig();
    const registry = makeRegistry({
      configs: { a, b },
      initialState: { a: {}, b: {} }
    });
    expect(registry.list()).toHaveLength(2);
  });

  it("readContent returns stored content", async () => {
    const config = makeResourceConfig();
    const registry = makeRegistry({
      configs: { doc: config },
      initialState: { doc: {} },
      initialContent: { doc: "hello world" }
    });
    const ref = registry.get("doc");
    expect(await ref.readContent()).toBe("hello world");
  });

  it("writeContent persists content and emits change", async () => {
    const onChange = vi.fn();
    const config = makeResourceConfig();
    const registry = makeRegistry({
      configs: { doc: config },
      initialState: { doc: {} },
      onResourceChanged: onChange
    });
    const ref = registry.get("doc");
    await ref.writeContent("new content");
    expect(await ref.readContent()).toBe("new content");
    // Parity with the collection-instance content path (FIX-756): exactly one
    // emission, with no projection delta and no state delta (exact arity).
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("doc", "updated");
  });

  it("writeContent throws for read-only resources", async () => {
    const onChange = vi.fn();
    const config = makeResourceConfig({ writable: false });
    const registry = makeRegistry({
      configs: { doc: config },
      initialState: { doc: {} },
      onResourceChanged: onChange
    });
    const ref = registry.get("doc");
    await expect(ref.writeContent("fail")).rejects.toThrow(/read-only/);
    // The guard throws before persist — a failed write must not announce.
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("createScopeResourceRegistry — collections", () => {
  it("create() adds an instance and get() retrieves it", async () => {
    const nsConfig = makeCollectionConfig("items/*", {
      stateSchema: z.object({ title: z.string() }).passthrough()
    });
    const registry = makeRegistry({ configs: { items: nsConfig } });
    const ref = await (registry as any).items.create("doc1", { title: "Doc 1" });
    expect(ref.state).toEqual({ title: "Doc 1" });

    const fetched = await (registry as any).items.get("doc1");
    expect(fetched.state).toEqual({ title: "Doc 1" });
  });

  it("create() throws when instance already exists without replace", async () => {
    const nsConfig = makeCollectionConfig("items/*");
    const registry = makeRegistry({
      configs: { items: nsConfig },
      initialState: { "items/doc1": {} }
    });
    await expect(
      (registry as any).items.create("doc1", {})
    ).rejects.toThrow(/already exists/);
  });

  it("create({ replace: true }) overwrites an existing instance", async () => {
    const nsConfig = makeCollectionConfig("items/*", {
      stateSchema: z.object({ v: z.number().default(0) }).passthrough()
    });
    const registry = makeRegistry({
      configs: { items: nsConfig },
      initialState: { "items/doc1": { v: 1 } }
    });
    const ref = await (registry as any).items.create("doc1", { v: 99 }, { replace: true });
    expect(ref.state).toEqual({ v: 99 });
  });

  it("get() throws for non-existent instances", async () => {
    const nsConfig = makeCollectionConfig("items/*");
    const registry = makeRegistry({ configs: { items: nsConfig } });
    await expect(
      (registry as any).items.get("nonexistent")
    ).rejects.toThrow(/not found/);
  });

  it("getOptional() returns undefined for non-existent instances", async () => {
    const nsConfig = makeCollectionConfig("items/*");
    const registry = makeRegistry({ configs: { items: nsConfig } });
    const result = await (registry as any).items.getOptional("nonexistent");
    expect(result).toBeUndefined();
  });

  it("getOrCreate() returns existing or creates new", async () => {
    const nsConfig = makeCollectionConfig("items/*", {
      stateSchema: z.object({ v: z.number().default(0) }).passthrough()
    });
    const registry = makeRegistry({
      configs: { items: nsConfig },
      initialState: { "items/existing": { v: 5 } }
    });

    const existing = await (registry as any).items.getOrCreate("existing", { v: 0 });
    expect(existing.state).toEqual({ v: 5 });

    const created = await (registry as any).items.getOrCreate("new-one", { v: 10 });
    expect(created.state).toEqual({ v: 10 });
  });

  it("delete() removes an instance", async () => {
    const nsConfig = makeCollectionConfig("items/*");
    const registry = makeRegistry({
      configs: { items: nsConfig },
      initialState: { "items/doc1": {} }
    });
    await (registry as any).items.delete("doc1");
    const result = await (registry as any).items.getOptional("doc1");
    expect(result).toBeUndefined();
  });

  it("delete() is idempotent for non-existent instances", async () => {
    const nsConfig = makeCollectionConfig("items/*");
    const registry = makeRegistry({ configs: { items: nsConfig } });
    await expect((registry as any).items.delete("nonexistent")).resolves.toBeUndefined();
  });

  it("list() returns all instances matching the pattern", async () => {
    const nsConfig = makeCollectionConfig("items/*");
    const registry = makeRegistry({
      configs: { items: nsConfig },
      initialState: {
        "items/a": {},
        "items/b": {},
        "items/c": {},
        other: {}
      }
    });
    const items = await (registry as any).items.list();
    expect(items).toHaveLength(3);
  });

  it("count() returns the number of instances", async () => {
    const nsConfig = makeCollectionConfig("items/*");
    const registry = makeRegistry({
      configs: { items: nsConfig },
      initialState: { "items/a": {}, "items/b": {} }
    });
    expect(await (registry as any).items.count()).toBe(2);
  });

  it("instance patchState updates state and fires onInstanceUpdated", async () => {
    const onUpdated = vi.fn();
    const nsConfig = makeCollectionConfig("items/*", {
      stateSchema: z.object({ v: z.number() }).passthrough(),
      onInstanceUpdated: onUpdated
    });
    const registry = makeRegistry({
      configs: { items: nsConfig },
      initialState: { "items/doc1": { v: 1 } }
    });
    const ref = await (registry as any).items.get("doc1");
    await ref.patchState({ v: 2 });
    expect(ref.state).toEqual({ v: 2 });
    expect(onUpdated).toHaveBeenCalledOnce();
    expect(onUpdated.mock.calls[0][0]).toBe("items/doc1");
  });

  it("instance writeContent persists content and emits change (FIX-756 parity)", async () => {
    const onChange = vi.fn();
    const nsConfig = makeCollectionConfig("items/*");
    const registry = makeRegistry({
      configs: { items: nsConfig },
      onResourceChanged: onChange
    });
    await (registry as any).items.create("doc1", {});
    const ref = await (registry as any).items.get("doc1");
    onChange.mockClear();

    await ref.writeContent("body");
    // Content-only write: exactly one emission, no projection delta and no
    // state delta (exact arity) — the client falls back to a batched refetch.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("items/doc1", "updated");
  });

  it("instance setState replaces state and fires onInstanceUpdated", async () => {
    const onUpdated = vi.fn();
    const nsConfig = makeCollectionConfig("items/*", {
      stateSchema: z.object({ v: z.number() }).passthrough(),
      onInstanceUpdated: onUpdated
    });
    const registry = makeRegistry({
      configs: { items: nsConfig },
      initialState: { "items/doc1": { v: 1 } }
    });
    const ref = await (registry as any).items.get("doc1");
    await ref.setState({ v: 99 });
    expect(ref.state).toEqual({ v: 99 });
    expect(onUpdated).toHaveBeenCalledOnce();
  });
});

describe("createScopeResourceRegistry — lifecycle hooks", () => {
  it("onInstanceCreated fires on create()", async () => {
    const onCreate = vi.fn();
    const nsConfig = makeCollectionConfig("items/*", { onInstanceCreated: onCreate });
    const registry = makeRegistry({ configs: { items: nsConfig } });
    await (registry as any).items.create("doc1", {});
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreate.mock.calls[0][0]).toBe("items/doc1");
  });

  it("onInstanceDeleted fires on delete()", async () => {
    const onDelete = vi.fn();
    const nsConfig = makeCollectionConfig("items/*", { onInstanceDeleted: onDelete });
    const registry = makeRegistry({
      configs: { items: nsConfig },
      initialState: { "items/doc1": {} }
    });
    await (registry as any).items.delete("doc1");
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onDelete.mock.calls[0][0]).toBe("items/doc1");
  });

  it("onResourceChanged fires on create/update/delete", async () => {
    const onChange = vi.fn();
    const nsConfig = makeCollectionConfig("items/*", {
      stateSchema: z.object({ v: z.number().default(0) }).passthrough()
    });
    const registry = makeRegistry({
      configs: { items: nsConfig },
      onResourceChanged: onChange
    });

    await (registry as any).items.create("doc1", {});
    // Non-live collection: third (projection) arg is undefined. The fourth
    // (change) arg carries the state delta for the reactive dispatcher (FIX-751).
    expect(onChange).toHaveBeenLastCalledWith("items/doc1", "created", undefined, {
      state: { v: 0 },
      prevState: undefined,
      evicted: false
    });

    const ref = await (registry as any).items.get("doc1");
    await ref.patchState({ v: 1 });
    expect(onChange).toHaveBeenLastCalledWith("items/doc1", "updated", undefined, {
      state: { v: 1 },
      prevState: { v: 0 },
      evicted: false
    });

    await (registry as any).items.delete("doc1");
    expect(onChange).toHaveBeenLastCalledWith("items/doc1", "deleted", undefined, {
      state: undefined,
      prevState: { v: 1 },
      evicted: false
    });
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});

describe("createScopeResourceRegistry — live projection (FIX-739)", () => {
  it("passes the projected delta on a live collection mutation", async () => {
    const onChange = vi.fn();
    const nsConfig = makeCollectionConfig("memos/*", {
      stateSchema: z.object({ status: z.string(), secret: z.string().default("x") }).passthrough(),
      client: { state: { read: true }, live: true, exclude: ["secret"] }
    });
    const registry = makeRegistry({
      configs: { memos: nsConfig },
      onResourceChanged: onChange
    });

    await (registry as any).memos.create("m1", { status: "pending" });
    // Assert only the projection (3rd) arg here — the 4th change arg is covered
    // by the non-live test above; live projection is the focus of this case.
    expect(onChange.mock.lastCall?.slice(0, 3)).toEqual(["memos/m1", "created", {
      delta: { status: "pending" } // `secret` excluded by the projection
    }]);

    const ref = await (registry as any).memos.get("m1");
    await ref.patchState({ status: "writing" });
    expect(onChange.mock.lastCall?.slice(0, 3)).toEqual(["memos/m1", "updated", {
      delta: { status: "writing" }
    }]);

    await (registry as any).memos.upsert("m1", { status: "published" });
    expect(onChange.mock.lastCall?.slice(0, 3)).toEqual(["memos/m1", "updated", {
      delta: { status: "published" }
    }]);

    // Deletes on a live collection carry a null delta so the client drops the
    // item without a refetch.
    await (registry as any).memos.delete("m1");
    expect(onChange.mock.lastCall?.slice(0, 3)).toEqual(["memos/m1", "deleted", { delta: null }]);
  });

  it("omits the delete delta for a non-live collection", async () => {
    const onChange = vi.fn();
    const nsConfig = makeCollectionConfig("memos/*", {
      stateSchema: z.object({ status: z.string() }).passthrough(),
      client: { state: { read: true } }
    });
    const registry = makeRegistry({ configs: { memos: nsConfig }, onResourceChanged: onChange });
    await (registry as any).memos.create("m1", { status: "pending" });
    await (registry as any).memos.delete("m1");
    expect(onChange.mock.lastCall?.slice(0, 3)).toEqual(["memos/m1", "deleted", undefined]);
  });

  it("omits the delta for a non-live collection (batched-refetch path)", async () => {
    const onChange = vi.fn();
    const nsConfig = makeCollectionConfig("memos/*", {
      stateSchema: z.object({ status: z.string() }).passthrough(),
      client: { state: { read: true } }
    });
    const registry = makeRegistry({ configs: { memos: nsConfig }, onResourceChanged: onChange });

    await (registry as any).memos.create("m1", { status: "pending" });
    expect(onChange.mock.lastCall?.slice(0, 3)).toEqual(["memos/m1", "created", undefined]);
  });

  it("emits a live delta for a live single resource (and nothing for non-live)", async () => {
    const onLive = vi.fn();
    const liveReg = makeRegistry({
      configs: {
        doc: makeResourceConfig({
          stateSchema: z.object({ status: z.string().default("pending") }).passthrough(),
          client: { expose: ["status"], live: true }
        })
      },
      initialState: { doc: { status: "pending" } },
      onResourceChanged: onLive
    });
    await liveReg.get("doc").patchState({ status: "writing" });
    expect(onLive.mock.lastCall?.slice(0, 3)).toEqual(["doc", "updated", { delta: { status: "writing" } }]);

    const onSilent = vi.fn();
    const silentReg = makeRegistry({
      configs: {
        doc: makeResourceConfig({
          stateSchema: z.object({ status: z.string().default("pending") }).passthrough(),
          client: { expose: ["status"] }
        })
      },
      initialState: { doc: { status: "pending" } },
      onResourceChanged: onSilent
    });
    await silentReg.get("doc").patchState({ status: "writing" });
    expect(onSilent).not.toHaveBeenCalled();
  });

  it("emits with no projection delta for a live single-resource content write (FIX-756)", async () => {
    const onChange = vi.fn();
    const registry = makeRegistry({
      configs: {
        doc: makeResourceConfig({
          stateSchema: z.object({ status: z.string().default("pending") }).passthrough(),
          client: { expose: ["status"], live: true }
        })
      },
      initialState: { doc: { status: "pending" } },
      onResourceChanged: onChange
    });

    await registry.get("doc").writeContent("body");
    // Content carries no state projection — even for a live resource the
    // emission has exact arity (key, "updated"): no delta is ever computed
    // from state on a content-only write.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("doc", "updated");
  });

  it("degrades to no delta when a live client.data projection throws", async () => {
    const onChange = vi.fn();
    const nsConfig = makeCollectionConfig("memos/*", {
      stateSchema: z.object({ status: z.string() }).passthrough(),
      client: {
        state: { read: true },
        live: true,
        data: () => { throw new Error("boom"); }
      }
    });
    const registry = makeRegistry({ configs: { memos: nsConfig }, onResourceChanged: onChange });

    // The mutation must still succeed; the delta degrades to undefined.
    await (registry as any).memos.create("m1", { status: "pending" });
    expect(onChange.mock.lastCall?.slice(0, 3)).toEqual(["memos/m1", "created", undefined]);
  });
});

describe("createScopeResourceRegistry — LRU eviction", () => {
  it("evicts the least-recently-used instance when maxInstances is reached", async () => {
    const nsConfig = makeCollectionConfig("items/*", {
      maxInstances: 2,
      eviction: "lru"
    });
    const registry = makeRegistry({
      configs: { items: nsConfig },
      initialState: { "items/a": {}, "items/b": {} }
    });

    // Access "a" to make "b" the LRU candidate
    await (registry as any).items.get("a");

    // Create "c" — should evict "b"
    await (registry as any).items.create("c", {});

    const result = await (registry as any).items.getOptional("b");
    expect(result).toBeUndefined();

    const a = await (registry as any).items.getOptional("a");
    expect(a).toBeDefined();
  });

  it("eviction on a live collection fires a deleted change with null delta (FIX-751)", async () => {
    const onChange = vi.fn();
    const nsConfig = makeCollectionConfig("items/*", {
      maxInstances: 1,
      eviction: "oldest",
      client: { live: true } as ResourceCollectionConfig["client"]
    });
    const registry = makeRegistry({
      configs: { items: nsConfig },
      initialState: { "items/a": {} },
      onResourceChanged: onChange
    });

    // Creating "b" evicts "a"; the eviction must tombstone the live client the
    // same way an explicit delete does (projection `{ delta: null }`).
    await (registry as any).items.create("b", {});
    const deletedCall = onChange.mock.calls.find((c) => c[1] === "deleted");
    expect(deletedCall).toBeDefined();
    expect(deletedCall![2]).toEqual({ delta: null });
  });

  it("throws when maxInstances reached with eviction=none", async () => {
    const nsConfig = makeCollectionConfig("items/*", {
      maxInstances: 1,
      eviction: "none"
    });
    const registry = makeRegistry({
      configs: { items: nsConfig },
      initialState: { "items/a": {} }
    });
    await expect(
      (registry as any).items.create("b", {})
    ).rejects.toThrow(/maxInstances/);
  });

  it("evicts oldest (insertion order) with eviction=oldest", async () => {
    const nsConfig = makeCollectionConfig("items/*", {
      maxInstances: 2,
      eviction: "oldest"
    });
    const registry = makeRegistry({
      configs: { items: nsConfig },
      initialState: { "items/a": {}, "items/b": {} }
    });
    await (registry as any).items.create("c", {});

    const result = await (registry as any).items.getOptional("a");
    expect(result).toBeUndefined();
  });

  it("fires onInstanceDeleted during eviction", async () => {
    const onDelete = vi.fn();
    const nsConfig = makeCollectionConfig("items/*", {
      maxInstances: 1,
      eviction: "lru",
      onInstanceDeleted: onDelete
    });
    const registry = makeRegistry({
      configs: { items: nsConfig },
      initialState: { "items/a": {} }
    });
    await (registry as any).items.create("b", {});
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onDelete.mock.calls[0][0]).toBe("items/a");
  });
});

describe("createScopeResourceRegistry — upsert", () => {
  it("patches existing instance on upsert", async () => {
    const nsConfig = makeCollectionConfig("items/*", {
      stateSchema: z.object({ v: z.number(), label: z.string() }).passthrough()
    });
    const registry = makeRegistry({
      configs: { items: nsConfig },
      initialState: { "items/doc1": { v: 1, label: "hello" } }
    });
    const ref = await (registry as any).items.upsert("doc1", { v: 99 });
    expect(ref.state).toEqual({ v: 99, label: "hello" });
  });

  it("creates new instance on upsert when not found", async () => {
    const nsConfig = makeCollectionConfig("items/*", {
      stateSchema: z.object({ v: z.number().default(0) }).passthrough()
    });
    const registry = makeRegistry({ configs: { items: nsConfig } });
    const ref = await (registry as any).items.upsert("doc1", { v: 5 });
    expect(ref.state).toEqual({ v: 5 });
  });

  it("merges update over createOnly on new upsert", async () => {
    const nsConfig = makeCollectionConfig("items/*", {
      stateSchema: z.object({ v: z.number(), label: z.string() }).passthrough()
    });
    const registry = makeRegistry({ configs: { items: nsConfig } });
    const ref = await (registry as any).items.upsert(
      "doc1",
      { v: 10 },
      { v: 0, label: "scaffold" }
    );
    expect(ref.state).toEqual({ v: 10, label: "scaffold" });
  });
});

describe("createScopeResourceRegistry — edges slot", () => {
  it("attaches an .edges API to a static resource ref when edges is declared", async () => {
    const config = makeResourceConfig({
      edges: true,
      stateSchema: z.object({ facts: z.array(z.string()), edges: z.array(z.any()).default([]) }).passthrough(),
      default: { facts: [], edges: [] }
    });
    const registry = makeRegistry({ configs: { kb: config } });
    const ref = registry.get("kb");
    expect(ref.edges).toBeDefined();

    await ref.edges!.add({ from: "a", to: "b", type: "drives" });
    await ref.edges!.add({ from: "b", to: "c", type: "drives" });

    expect((ref.state as any).edges).toHaveLength(2);
    const path = ref.edges!.shortestPath("a", "c", { depth: 3 });
    expect(path).not.toBeNull();
    expect(path).toHaveLength(2);
  });

  it("passes an object edges config through to the API (vocabulary enforced)", async () => {
    const config = makeResourceConfig({
      edges: { vocabulary: ["drives"] },
      stateSchema: z.object({ edges: z.array(z.any()).default([]) }).passthrough(),
      default: { edges: [] }
    });
    const registry = makeRegistry({ configs: { kb: config } });
    const ref = registry.get("kb");
    await expect(ref.edges!.add({ from: "a", to: "b", type: "owns" })).rejects.toThrow(/vocabulary/);
  });

  it("does not attach .edges when edges is not declared", () => {
    const config = makeResourceConfig({
      stateSchema: z.object({ facts: z.array(z.string()) }).passthrough()
    });
    const registry = makeRegistry({ configs: { kb: config } });
    expect(registry.get("kb").edges).toBeUndefined();
  });

  it("attaches an .edges API to collection instances when declared", async () => {
    const nsConfig = makeCollectionConfig("graphs/*", {
      edges: true,
      stateSchema: z.object({ edges: z.array(z.any()).default([]) }).passthrough()
    });
    const registry = makeRegistry({
      configs: { graphs: nsConfig },
      initialState: { "graphs/g1": { edges: [] } }
    });
    // Resolve a concrete instance ref (createNamespaceInstanceRef is where the
    // collection-side edge wiring lives).
    const inst = await (registry as any).graphs.upsert("g1", {});
    expect(inst.edges).toBeDefined();
    await inst.edges.add({ from: "x", to: "y", type: "rel" });
    expect((inst.state as any).edges).toHaveLength(1);
  });
});
