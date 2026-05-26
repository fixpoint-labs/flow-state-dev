import { describe, expect, it } from "vitest";
import { cloneValue } from "../src/helpers/clone";

describe("cloneValue", () => {
  it("returns a structurally equal copy of nested objects and arrays", () => {
    const original = { a: 1, b: { c: [1, 2, { d: "x" }] }, e: null };
    const copy = cloneValue(original);
    expect(copy).toEqual(original);
  });

  it("returns an independent copy that does not share nested references", () => {
    const original = { nested: { count: 0 }, list: [1, 2] };
    const copy = cloneValue(original);

    copy.nested.count = 99;
    copy.list.push(3);

    expect(original.nested.count).toBe(0);
    expect(original.list).toEqual([1, 2]);
    expect(copy.nested).not.toBe(original.nested);
  });

  it("passes primitives through unchanged", () => {
    expect(cloneValue(42)).toBe(42);
    expect(cloneValue("text")).toBe("text");
    expect(cloneValue(null)).toBe(null);
  });
});
