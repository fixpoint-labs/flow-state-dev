/**
 * Unit tests for the single canonical resource-state normalizer. `route-utils`
 * and `context/resource-registry` each held a copy of this ladder before it was
 * extracted, so these pin the rung order — declared `default`, then
 * `safeParse(undefined)`, then `safeParse({})`, then `{}` — that both call
 * paths now depend on.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ResourceConfig } from "@flow-state-dev/core/types";
import { ValidationError } from "../src/errors/flow-error";
import {
  normalizeResourceDefault,
  normalizeResourceState,
  parseResourceWriteState
} from "../src/resources/normalize-resource-state";

/** A resource config carrying only the fields these normalizers read. */
function config(
  stateSchema: z.ZodTypeAny,
  defaultValue?: unknown
): ResourceConfig {
  return { stateSchema, default: defaultValue } as unknown as ResourceConfig;
}

describe("normalizeResourceDefault", () => {
  it("prefers a declared object default over anything the schema yields", () => {
    const schema = z.object({ n: z.number().default(1) });
    expect(normalizeResourceDefault(config(schema, { n: 99 }))).toEqual({ n: 99 });
  });

  it("clones the declared default so callers cannot mutate the shared config", () => {
    const declared = { nested: { count: 0 } };
    const result = normalizeResourceDefault(config(z.object({}), declared));

    (result as { nested: { count: number } }).nested.count = 7;

    expect(declared.nested.count).toBe(0);
  });

  it("ignores a non-object default and falls through to the schema", () => {
    const schema = z.object({ n: z.number().default(1) });
    expect(normalizeResourceDefault(config(schema, "not-an-object"))).toEqual({ n: 1 });
  });

  it("parses undefined before {} — a schema that only accepts {} still resolves", () => {
    const schema = z.object({ n: z.number() });
    expect(normalizeResourceDefault(config(schema))).toEqual({});
  });

  it("returns {} when the schema accepts neither undefined nor {}", () => {
    const schema = z.object({ required: z.string() });
    expect(normalizeResourceDefault(config(schema))).toEqual({});
  });
});

describe("normalizeResourceState", () => {
  it("returns the persisted value when it validates", () => {
    const schema = z.object({ n: z.number() });
    expect(normalizeResourceState(config(schema), { n: 5 })).toEqual({ n: 5 });
  });

  it("falls back to the default when the persisted value is rejected", () => {
    const schema = z.object({ n: z.number().default(1) });
    expect(normalizeResourceState(config(schema, { n: 42 }), { n: "nope" })).toEqual({
      n: 42
    });
  });

  it("falls back to the default when nothing is persisted", () => {
    const schema = z.object({ n: z.number().default(1) });
    expect(normalizeResourceState(config(schema), undefined)).toEqual({ n: 1 });
  });

  it("never surfaces a non-object, even when the schema would accept one", () => {
    const schema = z.union([z.object({ n: z.number() }), z.string()]);
    expect(normalizeResourceState(config(schema), "a string")).toEqual({});
  });
});

describe("parseResourceWriteState", () => {
  it("returns the parsed object when the write validates", () => {
    const schema = z.object({ n: z.number().nonnegative(), keep: z.string() });
    expect(parseResourceWriteState(schema, { n: 5, keep: "ok" }, "counter")).toEqual({
      n: 5,
      keep: "ok"
    });
  });

  it("throws ValidationError and does not return a default on refinement failure", () => {
    const schema = z.object({ n: z.number().nonnegative(), keep: z.string() });
    expect(() => parseResourceWriteState(schema, { n: -1, keep: "ok" }, "counter")).toThrow(
      ValidationError
    );
    expect(() => parseResourceWriteState(schema, { n: -1, keep: "ok" }, "counter")).toThrow(
      /Resource "counter" write failed stateSchema validation at "n"/
    );
  });

  it("throws when the schema accepts a non-object", () => {
    const schema = z.union([z.object({ n: z.number() }), z.string()]);
    expect(() => parseResourceWriteState(schema, "a string", "counter")).toThrow(
      /parsed value is not a JSON object/
    );
  });
});
