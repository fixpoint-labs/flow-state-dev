import { describe, it, expect } from "vitest";
import { z } from "zod";
import { makeSchemaStrict } from "../../src/models/makeSchemaStrict";

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
