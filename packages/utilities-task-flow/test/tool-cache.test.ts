/**
 * Unit tests for the in-memory tool cache store and the
 * `canonicalizeToolArgs` helper re-exported from
 * `@flow-state-dev/utilities-task-flow` (FIX-610 Wave 1, Layer B).
 */
import { describe, expect, it } from "vitest";
import {
  canonicalizeToolArgs,
  createInMemoryToolCacheStore,
  type ToolCacheEntry,
} from "../src/index";

function makeEntry(toolName: string, output: unknown): ToolCacheEntry {
  return { output, storedAt: Date.now(), toolName };
}

describe("createInMemoryToolCacheStore", () => {
  it("get returns undefined for missing keys", () => {
    const store = createInMemoryToolCacheStore();
    expect(store.get("missing")).toBeUndefined();
  });

  it("set then get returns the stored value", () => {
    const store = createInMemoryToolCacheStore();
    const entry = makeEntry("t", { a: 1 });
    store.set("k", entry);
    expect(store.get("k")).toBe(entry);
  });

  it("evicts the least-recently used entry once maxEntries is exceeded", () => {
    const store = createInMemoryToolCacheStore({ maxEntries: 3 });
    store.set("a", makeEntry("t", 1));
    store.set("b", makeEntry("t", 2));
    store.set("c", makeEntry("t", 3));
    store.set("d", makeEntry("t", 4));
    // `a` is the oldest and should be evicted.
    expect(store.size()).toBe(3);
    expect(store.get("a")).toBeUndefined();
    expect(store.get("b")).toBeDefined();
    expect(store.get("c")).toBeDefined();
    expect(store.get("d")).toBeDefined();
  });

  it("invalidate by exact key returns 1 and deletes the entry", () => {
    const store = createInMemoryToolCacheStore();
    store.set("alpha", makeEntry("t", 1));
    store.set("beta", makeEntry("t", 2));
    expect(store.invalidate("alpha")).toBe(1);
    expect(store.get("alpha")).toBeUndefined();
    expect(store.get("beta")).toBeDefined();
  });

  it("invalidate by prefix returns count and deletes matching entries", () => {
    const store = createInMemoryToolCacheStore();
    store.set("tool:a:1", makeEntry("t", 1));
    store.set("tool:a:2", makeEntry("t", 2));
    store.set("tool:b:1", makeEntry("t", 3));
    expect(store.invalidate("tool:a")).toBe(2);
    expect(store.get("tool:a:1")).toBeUndefined();
    expect(store.get("tool:a:2")).toBeUndefined();
    expect(store.get("tool:b:1")).toBeDefined();
  });

  it("size() returns the current count", () => {
    const store = createInMemoryToolCacheStore();
    expect(store.size()).toBe(0);
    store.set("a", makeEntry("t", 1));
    store.set("b", makeEntry("t", 2));
    expect(store.size()).toBe(2);
    store.delete("a");
    expect(store.size()).toBe(1);
  });
});

describe("canonicalizeToolArgs", () => {
  it("two objects with different key order produce the same canonical string", () => {
    const a = canonicalizeToolArgs({ x: 1, y: 2, z: { b: 3, a: 4 } });
    const b = canonicalizeToolArgs({ z: { a: 4, b: 3 }, y: 2, x: 1 });
    expect(a).toBe(b);
  });

  it("Date values get ISO-stringified", () => {
    const d = new Date("2026-01-02T03:04:05.000Z");
    const out = canonicalizeToolArgs({ when: d });
    expect(out).toContain("2026-01-02T03:04:05.000Z");
  });

  it("throws naming the type for function values", () => {
    expect(() => canonicalizeToolArgs({ f: () => 1 })).toThrow(/function/);
  });

  it("throws naming the type for symbol values", () => {
    expect(() => canonicalizeToolArgs({ s: Symbol("x") })).toThrow(/symbol/);
  });
});
