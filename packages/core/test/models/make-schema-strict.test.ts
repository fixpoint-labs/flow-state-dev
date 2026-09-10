import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  makeSchemaStrict,
  assertStrictCompatible,
} from "../../src/models/makeSchemaStrict";
import { StrictSchemaError } from "../../src/errors/strict-schema-error";

describe("makeSchemaStrict", () => {
  it("strips .optional() from object properties", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().optional(),
    });

    const strict = makeSchemaStrict(schema);
    // age should now be required — parsing without it should fail
    const result = strict.safeParse({ name: "test" });
    expect(result.success).toBe(false);

    // parsing with both should succeed
    const valid = strict.safeParse({ name: "test", age: 25 });
    expect(valid.success).toBe(true);
  });

  it("strips .default() from object properties", () => {
    const schema = z.object({
      name: z.string(),
      active: z.boolean().default(true),
    });

    const strict = makeSchemaStrict(schema);
    // active should now be required (no default applied)
    const result = strict.safeParse({ name: "test" });
    expect(result.success).toBe(false);

    const valid = strict.safeParse({ name: "test", active: false });
    expect(valid.success).toBe(true);
  });

  it("handles nested objects", () => {
    const schema = z.object({
      outer: z.object({
        inner: z.string().optional(),
      }),
    });

    const strict = makeSchemaStrict(schema);
    // inner should now be required
    const result = strict.safeParse({ outer: {} });
    expect(result.success).toBe(false);

    const valid = strict.safeParse({ outer: { inner: "hello" } });
    expect(valid.success).toBe(true);
  });

  it("handles arrays of objects", () => {
    const schema = z.object({
      items: z.array(z.object({
        id: z.string(),
        label: z.string().optional(),
      })),
    });

    const strict = makeSchemaStrict(schema);
    // label inside array items should be required
    const result = strict.safeParse({ items: [{ id: "1" }] });
    expect(result.success).toBe(false);

    const valid = strict.safeParse({ items: [{ id: "1", label: "test" }] });
    expect(valid.success).toBe(true);
  });

  it("handles .nullable() by removing nullable wrapper", () => {
    const schema = z.object({
      name: z.string().nullable(),
    });

    const strict = makeSchemaStrict(schema);
    // Should parse successfully with a string
    const valid = strict.safeParse({ name: "test" });
    expect(valid.success).toBe(true);
  });

  it("handles combined .optional().default()", () => {
    const schema = z.object({
      pinned: z.boolean().optional().default(false),
      replaces: z.string().optional().default(""),
    });

    const strict = makeSchemaStrict(schema);
    // Both should now be required
    const result = strict.safeParse({});
    expect(result.success).toBe(false);

    const valid = strict.safeParse({ pinned: true, replaces: "old" });
    expect(valid.success).toBe(true);
  });

  it("unwraps ZodEffects so .superRefine() at the root doesn't skip strict mode", () => {
    // Regression: intent-classifier wraps its output schema with
    // `.superRefine()`, which returned ZodEffects. Before this fix, the strict
    // transform bailed on non-ZodObject inputs, letting `.default()` properties
    // leak through as non-required into the provider schema.
    const schema = z
      .object({
        category: z.string(),
        confidence: z.number(),
        reasoning: z.string().default(""),
      })
      .superRefine(() => {});

    const strict = makeSchemaStrict(schema);
    const missingReasoning = strict.safeParse({ category: "x", confidence: 1 });
    expect(missingReasoning.success).toBe(false);

    const complete = strict.safeParse({ category: "x", confidence: 1, reasoning: "because" });
    expect(complete.success).toBe(true);
  });

  it("returns non-object schemas unchanged", () => {
    const stringSchema = z.string();
    expect(makeSchemaStrict(stringSchema)).toBe(stringSchema);

    const arraySchema = z.array(z.string());
    expect(makeSchemaStrict(arraySchema)).toBe(arraySchema);
  });

  it("preserves validation on the original schema with defaults", () => {
    const original = z.object({
      name: z.string(),
      pinned: z.boolean().default(false),
      replaces: z.string().default(""),
    });

    // Original schema should apply defaults
    const parsed = original.parse({ name: "test" });
    expect(parsed).toEqual({ name: "test", pinned: false, replaces: "" });

    // Strict version should not apply defaults
    const strict = makeSchemaStrict(original);
    const result = strict.safeParse({ name: "test" });
    expect(result.success).toBe(false);
  });
});

describe("assertStrictCompatible", () => {
  it("throws on a reachable z.record with the offending path", () => {
    const schema = z.object({
      summary: z.string(),
      metrics: z.record(z.string(), z.number()),
    });

    expect(() => assertStrictCompatible(schema)).toThrow(StrictSchemaError);
    try {
      assertStrictCompatible(schema);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StrictSchemaError);
      const e = err as StrictSchemaError;
      expect(e.violations).toHaveLength(1);
      expect(e.violations[0]).toMatchObject({
        path: "$.metrics",
        typeName: "ZodRecord",
      });
    }
  });

  it("throws on a record nested inside an array with a `[]` path segment", () => {
    const schema = z.object({
      rows: z.array(
        z.object({
          tags: z.record(z.string(), z.string()),
        }),
      ),
    });

    try {
      assertStrictCompatible(schema);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as StrictSchemaError;
      expect(e).toBeInstanceOf(StrictSchemaError);
      expect(e.violations[0].path).toBe("$.rows[].tags");
      expect(e.violations[0].typeName).toBe("ZodRecord");
    }
  });

  it("throws on a non-literal union", () => {
    const schema = z.object({
      payload: z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]),
    });

    try {
      assertStrictCompatible(schema);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as StrictSchemaError;
      expect(e).toBeInstanceOf(StrictSchemaError);
      expect(e.violations[0].path).toBe("$.payload");
      expect(e.violations[0].typeName).toBe("ZodUnion");
    }
  });

  it("throws on a discriminated union of differing shapes", () => {
    const schema = z.object({
      result: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("ok"), value: z.string() }),
        z.object({ kind: z.literal("err"), reason: z.string() }),
      ]),
    });

    expect(() => assertStrictCompatible(schema)).toThrow(StrictSchemaError);
  });

  it("surfaces a violation nested inside a record value in the same throw", () => {
    // A record (itself a violation) whose value object contains a union. Both
    // the record and the nested union should be reported at once, so the author
    // does not have to fix the record, re-run, then discover the union.
    const schema = z.object({
      byKey: z.record(
        z.string(),
        z.object({ choice: z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]) }),
      ),
    });

    try {
      assertStrictCompatible(schema);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as StrictSchemaError;
      expect(e).toBeInstanceOf(StrictSchemaError);
      const paths = e.violations.map((v) => v.path);
      expect(paths).toContain("$.byKey"); // the record itself
      expect(paths).toContain("$.byKey[*].choice"); // the nested union under the open value
    }
  });

  it("does not over-report a record of safe values", () => {
    const schema = z.object({ counts: z.record(z.string(), z.number()) });
    try {
      assertStrictCompatible(schema);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as StrictSchemaError;
      // Only the record itself — the number value type is strict-safe.
      expect(e.violations).toHaveLength(1);
      expect(e.violations[0].path).toBe("$.counts");
    }
  });

  it("exposes violations via both `violations` and `details.violations`", () => {
    const schema = z.object({ metrics: z.record(z.string(), z.number()) });
    try {
      assertStrictCompatible(schema);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as StrictSchemaError;
      expect(e.violations).toBe(e.details.violations);
    }
  });

  it("passes an enum-style union of literals", () => {
    const schema = z.object({
      status: z.union([z.literal("a"), z.literal("b"), z.literal("c")]),
    });

    expect(() => assertStrictCompatible(schema)).not.toThrow();
  });

  it("passes object properties wrapped in optional/default/nullable (stripped first)", () => {
    const schema = z.object({
      a: z.string().optional(),
      b: z.boolean().default(false),
      c: z.number().nullable(),
      nested: z.object({ d: z.string().optional() }),
    });

    expect(() => assertStrictCompatible(schema)).not.toThrow();
  });

  it("passes non-object roots (string, unknown)", () => {
    expect(() => assertStrictCompatible(z.string())).not.toThrow();
    expect(() => assertStrictCompatible(z.unknown())).not.toThrow();
  });

  it("passes a schema whose root is wrapped in .superRefine() (ZodEffects)", () => {
    const schema = z
      .object({ category: z.string(), confidence: z.number() })
      .superRefine(() => {});

    expect(() => assertStrictCompatible(schema)).not.toThrow();
  });

  it("prefixes the label onto the thrown message", () => {
    const schema = z.object({ metrics: z.record(z.string(), z.number()) });

    expect(() => assertStrictCompatible(schema, 'Generator "x"')).toThrow(
      /Generator "x" output schema is not OpenAI strict-mode compatible/,
    );
  });
});

describe("makeSchemaStrict validate option", () => {
  it("returns the strict schema unchanged when validation passes", () => {
    const schema = z.object({ a: z.string().optional() });
    const strict = makeSchemaStrict(schema, { validate: true });
    // optional was stripped → `a` is now required
    expect(strict.safeParse({}).success).toBe(false);
    expect(strict.safeParse({ a: "x" }).success).toBe(true);
  });

  it("throws when validation fails", () => {
    const schema = z.object({ metrics: z.record(z.string(), z.number()) });
    expect(() => makeSchemaStrict(schema, { validate: true })).toThrow(StrictSchemaError);
  });

  it("does not throw without the validate flag (transform only)", () => {
    const schema = z.object({ metrics: z.record(z.string(), z.number()) });
    expect(() => makeSchemaStrict(schema)).not.toThrow();
  });
});

describe("assertStrictCompatible requireTextOrObjectRoot", () => {
  // The rule the generator routes on: a BARE z.string() is asked for as plain
  // text, and every other root is sent to the provider as a structured-output
  // root, which must be an object. Callers that want that failure before the
  // model call — an agent materializer deciding what an author may declare —
  // opt in here rather than restating the predicate and drifting from it.
  const on = { requireTextOrObjectRoot: true } as const;

  it("accepts a bare string root and an object root", () => {
    expect(() => assertStrictCompatible(z.string(), undefined, on)).not.toThrow();
    expect(() =>
      assertStrictCompatible(z.object({ a: z.string() }), undefined, on),
    ).not.toThrow();
  });

  it("accepts an object root behind .refine() — the strict transform unwraps it", () => {
    const schema = z.object({ a: z.string() }).refine(() => true);
    expect(() => assertStrictCompatible(schema, undefined, on)).not.toThrow();
  });

  it("refuses a wrapped string root, which is NOT a text request", () => {
    // z.string().nullable() reads like text and is not: the generator sends it
    // as a structured-output root and the provider rejects it.
    try {
      assertStrictCompatible(z.string().nullable(), 'Agent "a"', on);
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(StrictSchemaError);
      expect((error as StrictSchemaError).violations[0]).toMatchObject({
        path: "$",
        typeName: "ZodNullable",
      });
    }
  });

  it("refuses a primitive and an array root", () => {
    expect(() => assertStrictCompatible(z.number(), undefined, on)).toThrow(StrictSchemaError);
    expect(() => assertStrictCompatible(z.array(z.object({ a: z.string() })), undefined, on)).toThrow(
      StrictSchemaError,
    );
  });

  it("changes nothing when the option is absent — the default for every other caller", () => {
    expect(() => assertStrictCompatible(z.number())).not.toThrow();
    expect(() => assertStrictCompatible(z.string().nullable())).not.toThrow();
    expect(() => assertStrictCompatible(z.array(z.object({ a: z.string() })))).not.toThrow();
  });
});
