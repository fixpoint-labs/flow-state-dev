import { describe, expect, it } from "vitest";
import {
  aggregateContextEntries,
  objectFormHasNestedFunction,
} from "../src/blocks/context-aggregator";
import { renderTaggedContext } from "../src/prompt";
import type { BlockContext } from "../src/types/block";

const fakeCtx = {} as unknown as BlockContext;

describe("aggregateContextEntries", () => {
  it("passes string entries through in order", async () => {
    const result = await aggregateContextEntries(["a", "b"], {}, fakeCtx);
    expect(result.passThrough).toEqual(["a", "b"]);
    expect(result.tagged).toEqual({});
    expect(result.taggedOrder).toEqual([]);
  });

  it("skips empty strings", async () => {
    const result = await aggregateContextEntries(["", "a", ""], {}, fakeCtx);
    expect(result.passThrough).toEqual(["a"]);
  });

  it("skips null and undefined entries", async () => {
    const result = await aggregateContextEntries([null, undefined, "ok"], {}, fakeCtx);
    expect(result.passThrough).toEqual(["ok"]);
  });

  it("collects a single object entry under its tag key", async () => {
    const result = await aggregateContextEntries(
      [{ documents: "doc body" }],
      {},
      fakeCtx
    );
    expect(result.taggedOrder).toEqual(["documents"]);
    expect(result.tagged).toEqual({ documents: ["doc body"] });
  });

  it("aggregates same-key string contributions across two object entries", async () => {
    const result = await aggregateContextEntries(
      [{ documents: "a" }, { documents: "b" }],
      {},
      fakeCtx
    );
    expect(result.taggedOrder).toEqual(["documents"]);
    expect(result.tagged).toEqual({ documents: ["a", "b"] });
  });

  it("normalizes camelCase, snake_case, and kebab-case keys to the same canonical form", async () => {
    const result = await aggregateContextEntries(
      [
        { userPreferences: "a" },
        { user_preferences: "b" },
        { "user-preferences": "c" },
      ],
      {},
      fakeCtx
    );
    expect(result.taggedOrder).toEqual(["user-preferences"]);
    expect(result.tagged).toEqual({ "user-preferences": ["a", "b", "c"] });
  });

  it("preserves first-insertion order across multiple keys", async () => {
    const result = await aggregateContextEntries(
      [
        { documents: "a" },
        { memory: "b" },
        { documents: "a2" },
      ],
      {},
      fakeCtx
    );
    expect(result.taggedOrder).toEqual(["documents", "memory"]);
  });

  it("merges nested objects recursively", async () => {
    const result = await aggregateContextEntries(
      [
        { memory: { shortTerm: "a" } },
        { memory: { longTerm: "b" } },
      ],
      {},
      fakeCtx
    );
    expect(result.tagged).toEqual({
      memory: {
        "short-term": ["a"],
        "long-term": ["b"],
      },
    });
  });

  it("treats null values as placeholders that reserve order but emit nothing", async () => {
    const result = await aggregateContextEntries(
      [{ documents: null, memory: "m" }],
      {},
      fakeCtx
    );
    expect(result.taggedOrder).toEqual(["documents", "memory"]);
    expect(result.tagged).toEqual({ documents: [], memory: ["m"] });
    expect(renderTaggedContext(result.tagged, result.taggedOrder)).toBe(
      "<memory>\n  m\n</memory>"
    );
  });

  it("placeholder fills get appended under the placeholder's reserved position", async () => {
    const result = await aggregateContextEntries(
      [
        { documents: null, memory: "m" },
        { documents: "d" },
      ],
      {},
      fakeCtx
    );
    expect(result.taggedOrder).toEqual(["documents", "memory"]);
    expect(result.tagged.documents).toEqual(["d"]);
  });

  it("placeholder remains type-neutral until a contributor commits a leaf shape", async () => {
    const result = await aggregateContextEntries(
      [
        { documents: null, memory: "m" },
        { documents: { recent: "a" } },
      ],
      {},
      fakeCtx
    );
    expect(result.taggedOrder).toEqual(["documents", "memory"]);
    expect(result.tagged).toEqual({
      documents: { recent: ["a"] },
      memory: ["m"],
    });
  });

  it("resolves a function value and re-enters the algorithm", async () => {
    const result = await aggregateContextEntries(
      [{ documents: () => "lazy doc" }],
      {},
      fakeCtx
    );
    expect(result.tagged).toEqual({ documents: ["lazy doc"] });
  });

  it("resolves a function returning an object into nested tags", async () => {
    const result = await aggregateContextEntries(
      [{ memory: () => ({ shortTerm: "a", longTerm: "b" }) }],
      {},
      fakeCtx
    );
    expect(result.tagged).toEqual({
      memory: {
        "short-term": ["a"],
        "long-term": ["b"],
      },
    });
  });

  it("resolves async function values", async () => {
    const result = await aggregateContextEntries(
      [{ documents: async () => "later" }],
      {},
      fakeCtx
    );
    expect(result.tagged).toEqual({ documents: ["later"] });
  });

  it("flattens arrays of context entries", async () => {
    const result = await aggregateContextEntries(
      [[{ a: "1" }, { b: "2" }]],
      {},
      fakeCtx
    );
    expect(result.taggedOrder).toEqual(["a", "b"]);
  });

  it("throws on type mismatch — string after nested object", async () => {
    await expect(
      aggregateContextEntries(
        [{ memory: { shortTerm: "a" } }, { memory: "b" }],
        {},
        fakeCtx
      )
    ).rejects.toThrow(/type mismatch/);
  });

  it("throws on type mismatch — nested object after string", async () => {
    await expect(
      aggregateContextEntries(
        [{ memory: "a" }, { memory: { shortTerm: "b" } }],
        {},
        fakeCtx
      )
    ).rejects.toThrow(/type mismatch/);
  });

  it("throws on a reserved tag key", async () => {
    await expect(
      aggregateContextEntries([{ "tool_use": "x" }], {}, fakeCtx)
    ).rejects.toThrow(/Reserved context tag name/);
  });

  it("throws on an invalid tag key (leading digit)", async () => {
    await expect(
      aggregateContextEntries([{ "1stplace": "x" }], {}, fakeCtx)
    ).rejects.toThrow(/Invalid context tag name/);
  });

  it("propagates errors thrown by function values without swallowing them", async () => {
    await expect(
      aggregateContextEntries(
        [{ documents: () => { throw new Error("oops"); } }],
        {},
        fakeCtx
      )
    ).rejects.toThrow("oops");
  });

  it("passes through pre-built {role, content} message objects unchanged", async () => {
    const msg = { role: "system", content: "preset" };
    const result = await aggregateContextEntries([msg], {}, fakeCtx);
    expect(result.passThrough).toEqual([msg]);
    expect(result.tagged).toEqual({});
  });
});

describe("objectFormHasNestedFunction", () => {
  it("returns true when a nested value is a function", () => {
    expect(objectFormHasNestedFunction({ documents: () => "x" })).toBe(true);
  });

  it("returns true for a deeper nested function", () => {
    expect(
      objectFormHasNestedFunction({ memory: { shortTerm: () => "x" } })
    ).toBe(true);
  });

  it("returns false for an object with only static values", () => {
    expect(
      objectFormHasNestedFunction({ documents: "a", memory: { recent: "b" } })
    ).toBe(false);
  });

  it("returns false for null/undefined/string/array", () => {
    expect(objectFormHasNestedFunction(null)).toBe(false);
    expect(objectFormHasNestedFunction(undefined)).toBe(false);
    expect(objectFormHasNestedFunction("abc")).toBe(false);
    expect(objectFormHasNestedFunction(["a"])).toBe(false);
  });

  it("ignores pre-built {role, content} messages", () => {
    expect(
      objectFormHasNestedFunction({ role: "system", content: "x" })
    ).toBe(false);
  });
});
