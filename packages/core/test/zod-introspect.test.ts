/**
 * Unit tests for the `introspectStateKeys` shared util — used at definition
 * time to validate `expose`/`exclude` field lists against a Zod schema.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { introspectStateKeys } from "../src/helpers/zod-introspect";

describe("introspectStateKeys", () => {
  it("returns the top-level keys for a ZodObject", () => {
    const schema = z.object({ a: z.string(), b: z.number(), c: z.boolean() });
    const keys = introspectStateKeys(schema);
    expect(keys).toBeInstanceOf(Set);
    expect([...(keys ?? [])].sort()).toEqual(["a", "b", "c"]);
  });

  it("returns undefined for ZodUnion", () => {
    const schema = z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]);
    expect(introspectStateKeys(schema)).toBeUndefined();
  });

  it("returns undefined for null/undefined input", () => {
    expect(introspectStateKeys(null)).toBeUndefined();
    expect(introspectStateKeys(undefined)).toBeUndefined();
  });

  it("returns undefined for a primitive schema", () => {
    expect(introspectStateKeys(z.string())).toBeUndefined();
  });

  it("handles a schema whose .shape is a callable accessor", () => {
    // Newer Zod versions expose `.shape` as a getter that returns an object;
    // older shapes were callable. The util tolerates both — synthesize a
    // callable-shape schema by hand.
    const fakeSchema = {
      _def: { typeName: "ZodObject" },
      shape: () => ({ x: 1, y: 2 }),
    };
    const keys = introspectStateKeys(fakeSchema);
    expect([...(keys ?? [])].sort()).toEqual(["x", "y"]);
  });
});
