/**
 * Tests for the centralized Zod introspection module.
 */
import { describe, expect, it } from "vitest";
import { z, type ZodTypeAny } from "zod";
import {
  introspectStateKeys,
  getZodTypeName,
  isZodObject,
  getZodObjectShape,
  getZodArrayElement,
  getZodInnerType,
  getZodUnionOptions,
  getZodRecordValueType,
  compareZodSchemasStructurally,
  compareStateFieldKinds,
  mapZodObjectRoot,
} from "../src/helpers/zod-introspect";
import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// introspectStateKeys (existing tests, preserved)
// ---------------------------------------------------------------------------

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
    const fakeSchema = {
      _def: { typeName: "ZodObject" },
      shape: () => ({ x: 1, y: 2 }),
    };
    const keys = introspectStateKeys(fakeSchema);
    expect([...(keys ?? [])].sort()).toEqual(["x", "y"]);
  });
});

// ---------------------------------------------------------------------------
// getZodTypeName
// ---------------------------------------------------------------------------

describe("getZodTypeName", () => {
  it("returns 'ZodObject' for z.object()", () => {
    expect(getZodTypeName(z.object({ a: z.string() }))).toBe("ZodObject");
  });

  it("returns 'ZodString' for z.string()", () => {
    expect(getZodTypeName(z.string())).toBe("ZodString");
  });

  it("returns 'ZodArray' for z.array()", () => {
    expect(getZodTypeName(z.array(z.number()))).toBe("ZodArray");
  });

  it("returns 'ZodOptional' for z.optional()", () => {
    expect(getZodTypeName(z.string().optional())).toBe("ZodOptional");
  });

  it("returns undefined for a non-Zod value cast as ZodTypeAny", () => {
    expect(getZodTypeName({} as ZodTypeAny)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isZodObject
// ---------------------------------------------------------------------------

describe("isZodObject", () => {
  it("returns true for z.object()", () => {
    expect(isZodObject(z.object({}))).toBe(true);
  });

  it("returns false for z.string()", () => {
    expect(isZodObject(z.string())).toBe(false);
  });

  it("returns false for z.array(z.object({}))", () => {
    expect(isZodObject(z.array(z.object({})))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getZodObjectShape
// ---------------------------------------------------------------------------

describe("getZodObjectShape", () => {
  it("returns the shape record for z.object()", () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const shape = getZodObjectShape(schema);
    expect(shape).toBeDefined();
    expect(Object.keys(shape!).sort()).toEqual(["age", "name"]);
  });

  it("returns undefined for non-object schemas", () => {
    expect(getZodObjectShape(z.string())).toBeUndefined();
    expect(getZodObjectShape(z.array(z.string()))).toBeUndefined();
  });

  it("returns an empty record for z.object({})", () => {
    const shape = getZodObjectShape(z.object({}));
    expect(shape).toBeDefined();
    expect(Object.keys(shape!)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getZodArrayElement
// ---------------------------------------------------------------------------

describe("getZodArrayElement", () => {
  it("returns the element schema for z.array()", () => {
    const inner = z.number();
    const schema = z.array(inner);
    expect(getZodArrayElement(schema)).toBe(inner);
  });

  it("returns undefined for non-array schemas", () => {
    expect(getZodArrayElement(z.string())).toBeUndefined();
    expect(getZodArrayElement(z.object({}))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getZodInnerType
// ---------------------------------------------------------------------------

describe("getZodInnerType", () => {
  it("unwraps z.optional()", () => {
    const inner = z.string();
    expect(getZodInnerType(inner.optional())).toBe(inner);
  });

  it("unwraps z.default()", () => {
    const inner = z.string();
    expect(getZodInnerType(inner.default("x"))).toBe(inner);
  });

  it("unwraps z.nullable()", () => {
    const inner = z.string();
    expect(getZodInnerType(inner.nullable())).toBe(inner);
  });

  it("unwraps z.superRefine() (ZodEffects)", () => {
    const inner = z.string();
    const refined = inner.superRefine(() => {});
    expect(getZodInnerType(refined)).toBe(inner);
  });

  it("returns undefined for a plain type", () => {
    expect(getZodInnerType(z.string())).toBeUndefined();
    expect(getZodInnerType(z.number())).toBeUndefined();
    expect(getZodInnerType(z.object({}))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getZodUnionOptions
// ---------------------------------------------------------------------------

describe("getZodUnionOptions", () => {
  it("returns the variants of a z.union()", () => {
    const a = z.string();
    const b = z.number();
    const options = getZodUnionOptions(z.union([a, b]));
    expect(options).toEqual([a, b]);
  });

  it("returns the variants of a z.discriminatedUnion()", () => {
    const options = getZodUnionOptions(
      z.discriminatedUnion("k", [
        z.object({ k: z.literal("a") }),
        z.object({ k: z.literal("b") }),
      ]),
    );
    expect(options).toHaveLength(2);
  });

  it("returns undefined for non-union schemas", () => {
    expect(getZodUnionOptions(z.string())).toBeUndefined();
    expect(getZodUnionOptions(z.object({}))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getZodRecordValueType
// ---------------------------------------------------------------------------

describe("getZodRecordValueType", () => {
  it("returns the value type of a z.record()", () => {
    const value = z.number();
    expect(getZodRecordValueType(z.record(z.string(), value))).toBe(value);
  });

  it("returns undefined for non-record schemas", () => {
    expect(getZodRecordValueType(z.string())).toBeUndefined();
    expect(getZodRecordValueType(z.object({}))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// compareZodSchemasStructurally
// ---------------------------------------------------------------------------

describe("compareZodSchemasStructurally", () => {
  it("returns null for identical schemas", () => {
    const s = z.object({ a: z.string() });
    expect(compareZodSchemasStructurally(s, s)).toBeNull();
  });

  it("returns null for structurally matching objects", () => {
    const a = z.object({ x: z.string(), y: z.number() });
    const b = z.object({ x: z.string(), y: z.number() });
    expect(compareZodSchemasStructurally(a, b)).toBeNull();
  });

  it("detects top-level kind mismatch", () => {
    const result = compareZodSchemasStructurally(z.string(), z.number());
    expect(result).not.toBeNull();
    expect(result!.declaredKind).toBe("ZodString");
    expect(result!.inferredKind).toBe("ZodNumber");
  });

  it("detects object key-set mismatch", () => {
    const a = z.object({ x: z.string() });
    const b = z.object({ x: z.string(), y: z.number() });
    const result = compareZodSchemasStructurally(a, b);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("key sets differ");
  });

  it("detects object value-kind mismatch", () => {
    const a = z.object({ x: z.string() });
    const b = z.object({ x: z.number() });
    const result = compareZodSchemasStructurally(a, b);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("value kind differs");
    expect(result!.declaredKind).toBe("ZodString");
    expect(result!.inferredKind).toBe("ZodNumber");
  });

  it("detects array element kind mismatch", () => {
    const a = z.array(z.string());
    const b = z.array(z.number());
    const result = compareZodSchemasStructurally(a, b);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("array element kind differs");
  });

  it("returns null for matching arrays", () => {
    const a = z.array(z.string());
    const b = z.array(z.string());
    expect(compareZodSchemasStructurally(a, b)).toBeNull();
  });

  it("returns null for matching primitives", () => {
    expect(compareZodSchemasStructurally(z.string(), z.string())).toBeNull();
    expect(compareZodSchemasStructurally(z.number(), z.number())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Grep guard — no raw `_def` access outside zod-introspect.ts
// ---------------------------------------------------------------------------

describe("compareStateFieldKinds", () => {
  it("accepts a sequencer field whose wrappers differ from the block's (a default, a brand, a lazy)", () => {
    expect(compareStateFieldKinds(z.number().default(0), z.number())).toBeNull();
    expect(compareStateFieldKinds(z.string().brand("id"), z.string())).toBeNull();
    expect(compareStateFieldKinds(z.lazy(() => z.number()), z.number().optional())).toBeNull();
  });

  it("refuses a different kind under the wrappers", () => {
    expect(compareStateFieldKinds(z.string().nullable().default(null), z.number())).toMatch(
      /declared ZodString but a block requires ZodNumber/
    );
  });

  it("compares an array's element kind", () => {
    expect(compareStateFieldKinds(z.array(z.string()).default([]), z.array(z.number()))).toMatch(
      /array of ZodString/
    );
    expect(compareStateFieldKinds(z.array(z.string()), z.array(z.string().optional()))).toBeNull();
  });

  it("treats any and unknown as compatible with everything", () => {
    expect(compareStateFieldKinds(z.unknown(), z.number())).toBeNull();
    expect(compareStateFieldKinds(z.array(z.any()), z.array(z.number()))).toBeNull();
  });

  it("refuses a transform on either side, whose output kind it cannot read", () => {
    // `.transform(String)` starts the child with a string where it asked for a
    // number; the input kind matching says nothing about what the child gets.
    expect(compareStateFieldKinds(z.number().default(1).transform(String), z.number())).toMatch(/transform/);
    expect(compareStateFieldKinds(z.string().transform(Number), z.number())).toMatch(/transform/);
    expect(compareStateFieldKinds(z.array(z.string().transform(Number)), z.array(z.number()))).toMatch(
      /transform/
    );
  });

  it("still sees through a refinement, a preprocess, and one schema shared by both sides", () => {
    expect(compareStateFieldKinds(z.number().refine((n) => n >= 0).default(0), z.number())).toBeNull();
    expect(compareStateFieldKinds(z.preprocess((value) => Number(value), z.number()), z.number())).toBeNull();
    const shared = z.string().transform(Number);
    expect(compareStateFieldKinds(shared, shared)).toBeNull();
  });
});

describe("mapZodObjectRoot", () => {
  const addB = (object: ZodTypeAny) => (object as z.AnyZodObject).extend({ b: z.number().default(2) });

  it("replaces the object under a default and a refinement, keeping both", () => {
    const wrapped = z
      .object({ a: z.number().default(1) })
      .refine((value) => value.a > 0, "a must be positive")
      .default({});
    const mapped = mapZodObjectRoot(wrapped, addB)!;

    expect(mapped.parse(undefined)).toEqual({ a: 1, b: 2 });
    expect(mapped.safeParse({ a: -1 }).success).toBe(false);
  });

  it("returns the schema itself when the object is unchanged, and undefined for a non-object", () => {
    const wrapped = z.object({ a: z.number() }).optional();
    expect(mapZodObjectRoot(wrapped, (object) => object)).toBe(wrapped);
    expect(mapZodObjectRoot(z.array(z.string()), addB)).toBeUndefined();
  });
});

describe("_def access guard", () => {
  it("no raw _def access outside zod-introspect.ts (with documented exceptions)", () => {
    const coreSrc = path.resolve(__dirname, "../src");
    expect(existsSync(coreSrc)).toBe(true);
    const result = execSync(
      `grep -rn '\\._def' "${coreSrc}" --include='*.ts'` +
      ` | grep -v 'zod-introspect.ts'` +
      ` | grep -v 'action-schema.ts'` +
      ` | grep -v 'arg-shapes.ts'` +
      ` || true`,
      { encoding: "utf-8" }
    ).trim();
    expect(result).toBe("");
  });
});
