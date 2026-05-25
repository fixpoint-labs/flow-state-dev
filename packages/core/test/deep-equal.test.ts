import { describe, expect, it } from "vitest";
import { deepEqual, looseDeepEqual } from "../src/helpers/deep-equal";

describe("deepEqual", () => {
  it("returns true for equal primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
  });

  it("returns false for different primitives", () => {
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual("a", "b")).toBe(false);
    expect(deepEqual(true, false)).toBe(false);
  });

  it("treats null and undefined as distinct", () => {
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(undefined, null)).toBe(false);
  });

  it("treats NaN as equal to NaN (Object.is semantics)", () => {
    expect(deepEqual(NaN, NaN)).toBe(true);
  });

  it("treats +0 and -0 as distinct (Object.is semantics)", () => {
    expect(deepEqual(0, -0)).toBe(false);
    expect(deepEqual(-0, +0)).toBe(false);
  });

  it("returns true for structurally equal objects with different references", () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it("ignores key order when comparing objects", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("returns false when objects differ in nested values", () => {
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it("returns true for nested objects + arrays of equal shape", () => {
    expect(
      deepEqual(
        { items: [{ id: "x", tags: ["a", "b"] }] },
        { items: [{ id: "x", tags: ["a", "b"] }] }
      )
    ).toBe(true);
  });

  it("compares arrays element-wise including length", () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false);
  });

  it("distinguishes a missing key from a value of undefined", () => {
    const a = { x: undefined };
    const b: Record<string, unknown> = {};
    expect(deepEqual(a, b)).toBe(false);
  });

  it("compares Date by getTime()", () => {
    expect(deepEqual(new Date(1), new Date(1))).toBe(true);
    expect(deepEqual(new Date(1), new Date(2))).toBe(false);
  });

  it("Date vs non-Date with same timestamp value is not equal", () => {
    expect(deepEqual(new Date(1), 1)).toBe(false);
  });

  it("rejects Map", () => {
    expect(() => deepEqual(new Map(), new Map())).toThrow(TypeError);
  });

  it("rejects Set", () => {
    expect(() => deepEqual(new Set(), new Set())).toThrow(TypeError);
  });

  it("rejects RegExp", () => {
    expect(() => deepEqual(/x/, /x/)).toThrow(TypeError);
  });

  it("rejects functions", () => {
    expect(() => deepEqual(() => 1, () => 1)).toThrow(TypeError);
  });

  it("rejects symbols", () => {
    expect(() => deepEqual(Symbol("a"), Symbol("a"))).toThrow(TypeError);
  });

  it("rejects TypedArrays", () => {
    expect(() => deepEqual(new Uint8Array([1]), new Uint8Array([1]))).toThrow(
      TypeError
    );
  });

  it("throws RangeError on cycles", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    const b: Record<string, unknown> = {};
    b.self = b;
    expect(() => deepEqual(a, b)).toThrow(RangeError);
  });
});

describe("looseDeepEqual", () => {
  it("matches deepEqual on JSON-shaped structural equality", () => {
    expect(looseDeepEqual({ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 })).toBe(true);
    expect(looseDeepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    expect(looseDeepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it("does not throw on exotic shapes that deepEqual rejects", () => {
    // The whole point of the loose variant: UI memoization must never crash
    // a render when projected data contains a non-JSON shape.
    expect(() => looseDeepEqual(new Map(), new Map())).not.toThrow();
    expect(() => looseDeepEqual(() => 1, () => 2)).not.toThrow();
    expect(() => looseDeepEqual(/x/, /y/)).not.toThrow();
  });

  it("treats reference-equal exotic values as equal", () => {
    const fn = () => 1;
    expect(looseDeepEqual(fn, fn)).toBe(true);
  });
});
