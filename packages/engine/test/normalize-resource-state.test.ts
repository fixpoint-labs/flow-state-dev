/**
 * Unit tests for the single canonical resource-state normalizer. `route-utils`
 * and `context/resource-registry` each held a copy of this ladder before it was
 * extracted, so these pin the rung order — declared `default`, then
 * `safeParse(undefined)`, then `safeParse({})`, then `{}` — that both call
 * paths now depend on.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ResourceConfig } from "@flow-state-dev/core/types";
import { ValidationError } from "../src/errors/flow-error";
import {
  assertStableResourceState,
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

  it("persists schema-valid null as {} — the documented nullable-single reset", () => {
    const schema = z.object({ ticker: z.string() }).nullable();
    expect(parseResourceWriteState(schema, null, "priceHistory")).toEqual({});
  });

  it("still throws when a nullable schema rejects a partial object", () => {
    const schema = z.object({ ticker: z.string(), range: z.string() }).nullable();
    expect(() => parseResourceWriteState(schema, { ticker: "NVDA" }, "priceHistory")).toThrow(
      ValidationError
    );
    expect(() => parseResourceWriteState(schema, { ticker: "NVDA" }, "priceHistory")).toThrow(
      /at "range"/
    );
  });
});

/**
 * The fixed-point guard, at unit tier. The drift suite drives it through the
 * real registry; these pin the three ways a re-parse can fail the test, because
 * each one sends the schema's author somewhere different and only the first has
 * a field to name.
 */
describe("assertStableResourceState", () => {
  /** Moves `n` again on every pass — the shape the guard exists to reject. */
  const drifting = z.object({ n: z.number().transform((v) => v + 1) });

  it("returns the value when re-parsing leaves it alone", () => {
    const schema = z.object({ n: z.number(), tag: z.string().default("") });
    expect(assertStableResourceState(schema, { n: 1, tag: "x" }, { n: 1 }, "counter")).toEqual({
      n: 1,
      tag: "x"
    });
  });

  it("names the field the second parse moved", () => {
    expect(() => assertStableResourceState(drifting, { n: 1 }, { n: 0 }, "counter")).toThrow(
      ValidationError
    );
    expect(() => assertStableResourceState(drifting, { n: 1 }, { n: 0 }, "counter")).toThrow(
      /Resource "counter" write failed stateSchema validation at "n"/
    );
  });

  it("names the path when the second parse fails outright", () => {
    // A type-changing transform: the output no longer satisfies the input type,
    // so the re-parse errors rather than returning a different value.
    const retyping = z.object({ n: z.string().transform(Number) });
    expect(() => assertStableResourceState(retyping, { n: 1 }, { n: "1" }, "counter")).toThrow(
      /at "n"/
    );
  });

  it("rejects — rather than crashing — when the second parse yields a non-object", () => {
    // A conditional transform that collapses its own output: `{phase:0}` parses
    // to `{phase:1}`, which parses to `null`. There is no moved field to name,
    // and indexing the re-parsed value as an object is how this became a raw
    // TypeError instead of the resource-specific diagnostic the guard promises.
    const collapsing = z
      .object({ phase: z.number() })
      .transform((value) => (value.phase === 0 ? { phase: 1 } : null));

    expect(() =>
      assertStableResourceState(collapsing, { phase: 1 }, { phase: 0 }, "wizard")
    ).toThrow(ValidationError);
    // And it says what actually happened, so the author looks at the transform's
    // null branch rather than hunting for a field that moved.
    expect(() =>
      assertStableResourceState(collapsing, { phase: 1 }, { phase: 0 }, "wizard")
    ).toThrow(/Resource "wizard".*re-parsing its own output produced null, not an object/s);
  });

  it("skips the second parse when the first one changed nothing", () => {
    // The identity fast path. It is the overwhelming majority of writes, and the
    // reason it is safe to skip is that a schema's parse is a pure function of
    // its input — see the guard's doc comment. This pins the skip so removing it
    // is a deliberate act, not a silent regression.
    const schema = z.object({ n: z.number() });
    const spy = vi.spyOn(schema, "safeParse");
    assertStableResourceState(schema, { n: 1 }, { n: 1 }, "counter");
    expect(spy).not.toHaveBeenCalled();
  });
});
