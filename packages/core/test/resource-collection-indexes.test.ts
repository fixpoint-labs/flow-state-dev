/**
 * Declared field indexes on `defineResourceCollection`, and the one canonical
 * value form every index writer and reader agrees on.
 *
 * The canonical form is what makes a lookup find a row: the engine writes a
 * row's entries in it and `findBy` asks for a value in it, on every store. If
 * two forms disagreed (a number written as `1`, asked for as `"1"`), the row
 * would be silently unfindable, so these cases pin that the form keeps types
 * apart and that `null` / `undefined` index nothing.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  canonicalIndexValue,
  canonicalIndexValues,
  declaredIndexes,
  defineResourceCollection,
} from "../src/types";

const taskSchema = z.object({ id: z.string(), tags: z.array(z.string()).default([]) });

describe("defineResourceCollection · indexes", () => {
  it("accepts a function (version 1) and { version, value }, and reads them back with their stored names", () => {
    const work = defineResourceCollection({
      pattern: "work/**",
      scope: "user",
      stateSchema: taskSchema,
      indexes: {
        byTaskId: (_key, state) => state.id,
        byTag: { version: 2, value: (_key, state) => state.tags },
      },
    });
    const indexes = declaredIndexes(work);
    expect(indexes.map(({ name, version, stored }) => ({ name, version, stored }))).toEqual([
      { name: "byTaskId", version: 1, stored: "byTaskId@1" },
      { name: "byTag", version: 2, stored: "byTag@2" },
    ]);
    expect(indexes[1]!.value("work/a", { id: "t1", tags: ["x", "y"] })).toEqual(["x", "y"]);
  });

  it("a collection without indexes declares none", () => {
    const plain = defineResourceCollection({ pattern: "notes/*", scope: "user", stateSchema: taskSchema });
    expect(declaredIndexes(plain)).toEqual([]);
  });

  it.each([
    ["an empty name", { "": () => "x" }, /index name/],
    ["a name with the version separator", { "by@id": () => "x" }, /index name/],
    ["a version of zero", { byId: { version: 0, value: () => "x" } }, /version/],
    ["a fractional version", { byId: { version: 1.5, value: () => "x" } }, /version/],
    ["a declaration with no function", { byId: { version: 2 } }, /function/],
    ["a non-function declaration", { byId: "id" }, /function/],
  ])("refuses %s", (_label, indexes, message) => {
    expect(() =>
      defineResourceCollection({
        pattern: "work/**",
        scope: "user",
        stateSchema: taskSchema,
        indexes: indexes as never,
      })
    ).toThrow(message);
  });
});

describe("canonical index values", () => {
  it("keeps strings, numbers and booleans apart", () => {
    const forms = [canonicalIndexValue("1"), canonicalIndexValue(1), canonicalIndexValue(true), canonicalIndexValue("true")];
    expect(new Set(forms).size).toBe(4);
  });

  it("is stable: the same value always gives the same string", () => {
    expect(canonicalIndexValue("task-7")).toBe(canonicalIndexValue("task-7"));
    expect(canonicalIndexValue(-0)).toBe(canonicalIndexValue(0));
  });

  it("indexes nothing for null, undefined and non-finite numbers", () => {
    expect(canonicalIndexValues(null)).toEqual([]);
    expect(canonicalIndexValues(undefined)).toEqual([]);
    expect(canonicalIndexValues(Number.NaN)).toEqual([]);
    expect(canonicalIndexValue(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("an array indexes each element once, skipping null", () => {
    expect(canonicalIndexValues(["a", "b", "a", null, 2])).toEqual([
      canonicalIndexValue("a"),
      canonicalIndexValue("b"),
      canonicalIndexValue(2),
    ]);
  });

  it("refuses an object or a nested array: an index is equality on a scalar", () => {
    expect(() => canonicalIndexValues({ id: "x" } as never)).toThrow(/string, number or boolean/);
    expect(() => canonicalIndexValues([["x"]] as never)).toThrow(/string, number or boolean/);
  });
});
