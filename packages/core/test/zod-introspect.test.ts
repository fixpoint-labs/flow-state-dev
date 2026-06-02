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
  compareZodSchemasStructurally,
} from "../src/helpers/zod-introspect";
import { execSync } from "child_process";
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

describe("_def access guard", () => {
  it("no raw _def access outside zod-introspect.ts (with documented exceptions)", () => {
    const coreSrc = path.resolve(__dirname, "../src");
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
