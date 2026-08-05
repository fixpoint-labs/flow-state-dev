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
import { runResourceCAS, type ResourceCASIntent } from "../../src/stores/resource-cas";
import { createStateContainer } from "../../src/stores/state-container";
import { ResourceDeletedError } from "../../src/errors/flow-error";
import type { ExpectedVersion, SetResult } from "../../src/stores/types";

/**
 * Stand-ins for `createExecutionContext`'s resource-state providers, over a
 * plain map.
 *
 * These run the REAL CAS driver against a versioned row set rather than
 * stubbing the seam with a map assignment. A stub would pass every test in this
 * file while losing every write the driver exists to protect, so the mock has
 * to carry versions and conflicts or it is not testing the thing it fronts.
 *
 * `state` doubles as the per-context cache the registry reads; `rows` is the
 * durable side, where a delete leaves a version-retaining tombstone.
 *
 * @param persistDelay - yield a microtask inside the store write, so a
 * concurrent read-modify-write interleaves the way it does against a real store.
 */
function makeStateProviders(
  state: Record<string, JsonObject>,
  { persistDelay = false }: { persistDelay?: boolean } = {}
) {
  const rows = new Map<string, { state: JsonObject; version: number; deleted: boolean }>();
  const versions: Record<string, number> = {};
  // A key seeded into the cache is a row that already exists. Version 1 matches
  // the rule the adapters use for a row written before versioning existed.
  for (const [key, value] of Object.entries(state)) {
    rows.set(key, { state: structuredClone(value), version: 1, deleted: false });
    versions[key] = 1;
  }

  const liveVersionOf = (key: string): number => {
    const row = rows.get(key);
    return row !== undefined && !row.deleted ? row.version : 0;
  };

  const set = async (
    key: string,
    next: JsonObject,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<JsonObject>> => {
    if (persistDelay) await Promise.resolve();
    const row = rows.get(key);
    const liveVersion = liveVersionOf(key);
    if (expectedVersion !== "any" && expectedVersion !== liveVersion) {
      return {
        ok: false,
        conflict: {
          currentValue: liveVersion === 0 ? undefined : structuredClone(row!.state),
          currentVersion: row?.version ?? 0
        }
      };
    }
    const version = (row?.version ?? 0) + 1;
    rows.set(key, { state: structuredClone(next), version, deleted: false });
    return { ok: true, version };
  };

  return {
    rows,
    versions,
    mutateResourceKey: async (
      key: string,
      mutator: (current: JsonObject) => JsonObject | Promise<JsonObject>,
      opts?: { intent?: ResourceCASIntent; seed?: JsonObject }
    ): Promise<{ committed: boolean }> => {
      const container = createStateContainer<JsonObject>(
        opts?.seed ?? state[key] ?? {},
        versions[key] ?? 0
      );
      const result = await runResourceCAS({
        key,
        container,
        mutator,
        intent: opts?.intent ?? "mutate",
        persist: (next, expectedVersion) => set(key, next, expectedVersion),
        reread: async () => {
          const row = rows.get(key);
          return row === undefined || row.deleted
            ? undefined
            : { state: structuredClone(row.state), version: row.version };
        }
      });
      if (result.committed) {
        state[key] = result.state;
        versions[key] = result.version;
      }
      return { committed: result.committed };
    },
    deleteResourceKey: async (key: string): Promise<boolean> => {
      if (!(key in state)) return false;
      const expected = versions[key] ?? 0;
      if (expected !== liveVersionOf(key)) throw new ResourceDeletedError(key);
      const row = rows.get(key);
      if (row !== undefined) {
        row.deleted = true;
        row.state = {};
      }
      delete state[key];
      delete versions[key];
      return true;
    }
  };
}

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
  const providers = makeStateProviders(state);

  return createScopeResourceRegistry({
    scope: "session",
    scopeId: "sess_1",
    configs: options.configs ?? {},
    readResources: () => state,
    readResourceContent: () => content,
    mutateResourceKey: providers.mutateResourceKey,
    deleteResourceKey: providers.deleteResourceKey,
    persistResourceContentKey: async (key, value) => { content[key] = value; },
    deleteResourceContentKey: async (key) => { delete content[key]; },
    onResourceChanged: options.onResourceChanged
  });
}

describe("concurrent resource writes", () => {
  it("serializes per-resource writes so parallel patches to distinct fields don't clobber", async () => {
    const state: Record<string, JsonObject> = {};
    const concurrentProviders = makeStateProviders(state, { persistDelay: true });
    const registry = createScopeResourceRegistry({
      scope: "session",
      scopeId: "sess_1",
      configs: {
        spine: makeResourceConfig({ stateSchema: z.object({}).passthrough(), default: {} }),
      },
      readResources: () => state,
      readResourceContent: () => ({}),
      // Mirror the real `createExecutionContext` persist: the in-request cache is
      // written only AFTER the store await. Without per-resource serialization,
      // concurrent read-modify-write patches each read the pre-write cache and
      // the last writer clobbers the others' fields.
      mutateResourceKey: concurrentProviders.mutateResourceKey,
      deleteResourceKey: concurrentProviders.deleteResourceKey,
      persistResourceContentKey: async () => {},
      deleteResourceContentKey: async () => {},
    });

    const ref = registry.get("spine");
    await Promise.all([
      ref.patchState({ a: 1 }),
      ref.patchState({ b: 2 }),
      ref.patchState({ c: 3 }),
    ]);

    expect(ref.state).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("getOrPatchState fills distinct keys concurrently without losing fields", async () => {
    const state: Record<string, JsonObject> = {};
    const concurrentProviders = makeStateProviders(state, { persistDelay: true });
    const registry = createScopeResourceRegistry({
      scope: "session",
      scopeId: "sess_1",
      configs: {
        spine: makeResourceConfig({ stateSchema: z.object({}).passthrough(), default: {} }),
      },
      readResources: () => state,
      readResourceContent: () => ({}),
      mutateResourceKey: concurrentProviders.mutateResourceKey,
      deleteResourceKey: concurrentProviders.deleteResourceKey,
      persistResourceContentKey: async () => {},
      deleteResourceContentKey: async () => {},
    });

    const ref = registry.get("spine");
    const [x, y] = await Promise.all([
      ref.getOrPatchState("x", async () => 10),
      ref.getOrPatchState("y", async () => 20),
    ]);

    expect(x).toBe(10);
    expect(y).toBe(20);
    expect(ref.state).toEqual({ x: 10, y: 20 });
  });

  it("getOrPatchState coalesces concurrent misses on the same key to a single compute (single-flight)", async () => {
    const state: Record<string, JsonObject> = {};
    const concurrentProviders = makeStateProviders(state, { persistDelay: true });
    const registry = createScopeResourceRegistry({
      scope: "session",
      scopeId: "sess_1",
      configs: {
        spine: makeResourceConfig({ stateSchema: z.object({}).passthrough(), default: {} }),
      },
      readResources: () => state,
      readResourceContent: () => ({}),
      mutateResourceKey: concurrentProviders.mutateResourceKey,
      deleteResourceKey: concurrentProviders.deleteResourceKey,
      persistResourceContentKey: async () => {},
      deleteResourceContentKey: async () => {},
    });

    const ref = registry.get("spine");
    let computeCalls = 0;
    const compute = async () => {
      computeCalls += 1;
      await Promise.resolve();
      return 7;
    };

    const results = await Promise.all([
      ref.getOrPatchState("v", compute),
      ref.getOrPatchState("v", compute),
      ref.getOrPatchState("v", compute),
    ]);

    // One upstream compute, shared by all three concurrent misses.
    expect(results).toEqual([7, 7, 7]);
    expect(computeCalls).toBe(1);
    expect(ref.state).toEqual({ v: 7 });

    // A later call reads the stored value as a hit — compute is not re-run.
    const after = await ref.getOrPatchState("v", compute);
    expect(after).toBe(7);
    expect(computeCalls).toBe(1);
  });
});

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

  it("resolves an anchored path relative to the declaring module, not cwd", () => {
    // "./fixtures/..." does not exist relative to the test cwd (the package
    // root) — only relative to this spec file. Module-relative must win.
    const config = makeResourceConfig({
      contentTemplate: { path: "./fixtures/anchored-template.md", importerUrl: import.meta.url },
    });
    resolveStringContentTemplates({ doc: config });
    const template = config.contentTemplate as { name?: string; sections: { system: string } };
    expect(template.name).toBe("anchored");
    expect(template.sections.system).toContain("{{ state.role }}");
  });

  it("prefers the module-relative candidate when the file exists at both", () => {
    // fixtures/precedence-template.md exists BOTH relative to this spec file
    // (name: module-copy) and relative to the package root, the test cwd
    // (name: cwd-copy). The module-relative candidate must win — this pins
    // the candidate ordering, the headline contract of anchored paths.
    const config = makeResourceConfig({
      contentTemplate: { path: "./fixtures/precedence-template.md", importerUrl: import.meta.url },
    });
    resolveStringContentTemplates({ doc: config });
    expect((config.contentTemplate as { name?: string }).name).toBe("module-copy");
  });

  it("falls back to cwd when the anchor is a bundler-rewritten URL", () => {
    // Path exists relative to the package root (the test cwd) but the anchor
    // is unusable — the cwd candidate must carry it.
    const config = makeResourceConfig({
      contentTemplate: {
        path: "./test/context/fixtures/anchored-template.md",
        importerUrl: "turbopack://[project]/flows/x.js",
      },
    });
    resolveStringContentTemplates({ doc: config });
    expect((config.contentTemplate as { name?: string }).name).toBe("anchored");
  });

  it("throws naming every candidate when an anchored path matches nothing", () => {
    const config = makeResourceConfig({
      contentTemplate: { path: "./does-not-exist.md", importerUrl: import.meta.url },
    });
    expect(() => resolveStringContentTemplates({ doc: config })).toThrow(
      /Failed to resolve contentTemplate[\s\S]*Tried:/
    );
  });
});

describe("normalizeScopeResourceContent — anchored contentFile", () => {
  it("loads an anchored contentFile relative to the declaring module", () => {
    const config = makeResourceConfig({
      contentFile: { path: "./fixtures/anchored-content.txt", importerUrl: import.meta.url },
    });
    const result = normalizeScopeResourceContent({ doc: config }, undefined);
    expect(result.doc).toBe("anchored file content\n");
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
    // emission, with no projection delta (3rd arg undefined → the client falls
    // back to a refetch) and a `contentWrite` marker (4th arg) that routes the
    // reaction to `contentUpdated` (FIX-843).
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("doc", "updated", undefined, { contentWrite: true });
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

  it("instance updateState aborts cleanly when the updater throws (FIX-951)", async () => {
    // Pins the contract the task substrate's advisory write-backs rely on to
    // decline a write atomically. The updater runs inside the per-key write
    // serialization, so throwing out of it must (a) leave the stored state
    // untouched, (b) skip the change notification entirely — a declined write
    // announcing a `resource_change` would wake a `reactTo.stateUpdated` block
    // for a write that never happened — and (c) surface the rejection to the
    // caller rather than swallowing it.
    const onChange = vi.fn();
    const onUpdated = vi.fn();
    const nsConfig = makeCollectionConfig("items/*", {
      stateSchema: z.object({ v: z.number() }).passthrough(),
      onInstanceUpdated: onUpdated
    });
    const registry = makeRegistry({
      configs: { items: nsConfig },
      initialState: { "items/doc1": { v: 1 } },
      onResourceChanged: onChange
    });
    const ref = await (registry as any).items.get("doc1");
    onChange.mockClear();

    const boom = new Error("declined");
    await expect(
      ref.updateState(() => {
        throw boom;
      })
    ).rejects.toBe(boom);

    expect(ref.state).toEqual({ v: 1 });
    expect(onChange).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();

    // And the failed write must not wedge the key's write chain — the next
    // writer still lands. Without this the abort would be a denial of service
    // on the resource rather than a no-op.
    await ref.updateState((s: any) => ({ ...s, v: s.v + 1 }));
    expect(ref.state).toEqual({ v: 2 });
    expect(onChange).toHaveBeenCalledTimes(1);
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
    // Content-only write: exactly one emission, no projection delta (3rd arg
    // undefined → the client falls back to a batched refetch) and a `contentWrite`
    // marker (4th arg) routing the reaction to `contentUpdated` (FIX-843).
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("items/doc1", "updated", undefined, { contentWrite: true });
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

  it("suppresses onResourceChanged for a verified no-op write (FIX-992, D8)", async () => {
    const onChange = vi.fn();
    const nsConfig = makeCollectionConfig("items/*", {
      stateSchema: z.object({ v: z.number().default(0) }).passthrough()
    });
    const registry = makeRegistry({
      configs: { items: nsConfig },
      onResourceChanged: onChange
    });

    await (registry as any).items.create("doc1", { v: 1 });
    const ref = await (registry as any).items.get("doc1");
    onChange.mockClear();

    // Writing the value already held is a no-op the driver has VERIFIED against
    // a re-read version, so nothing is persisted and nothing is emitted.
    await ref.patchState({ v: 1 });
    expect(onChange).not.toHaveBeenCalled();

    // A real change still emits exactly one event.
    await ref.patchState({ v: 2 });
    expect(onChange).toHaveBeenCalledTimes(1);
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
    // Content carries no state projection — even for a live resource the 3rd arg
    // (projection delta) stays undefined: no delta is ever computed from state on
    // a content write. The 4th arg is the `contentWrite` marker (FIX-843).
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("doc", "updated", undefined, { contentWrite: true });
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

describe("createScopeResourceRegistry — llmReadable/llmWritable flags (FIX-842)", () => {
  it("threads collection-level llmReadable/llmWritable onto every instance ref's config", async () => {
    // The generic content + search tools gate on `ref.config.llmReadable` /
    // `.llmWritable`. A collection declares the flags once; this asserts they
    // reach each instance ref's config (the seam that makes the tools cover
    // collection instances).
    const nsConfig = makeCollectionConfig("artifacts/*", {
      llmReadable: true,
      llmWritable: true,
      stateSchema: z.object({ title: z.string().default("") }).passthrough()
    });
    const registry = makeRegistry({
      configs: { artifacts: nsConfig },
      initialState: { "artifacts/a": { title: "A" } }
    });
    const ref = await (registry as any).artifacts.get("a");
    expect(ref.config.llmReadable).toBe(true);
    expect(ref.config.llmWritable).toBe(true);
  });

  it("leaves instance config flags unset when the collection does not opt in", async () => {
    const nsConfig = makeCollectionConfig("artifacts/*");
    const registry = makeRegistry({
      configs: { artifacts: nsConfig },
      initialState: { "artifacts/a": {} }
    });
    const ref = await (registry as any).artifacts.get("a");
    expect(ref.config.llmReadable).toBeUndefined();
    expect(ref.config.llmWritable).toBeUndefined();
  });
});
