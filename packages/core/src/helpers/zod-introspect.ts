/**
 * Centralized Zod-internals introspection module.
 *
 * Every `_def` access in `@flow-state-dev/core` routes through this file so
 * a Zod-internal change is a single-site fix instead of a multi-file hunt.
 * The grep guard in `zod-introspect.test.ts` enforces this invariant.
 */
import type { ZodTypeAny } from "zod";

// ---------------------------------------------------------------------------
// Primitive accessors
// ---------------------------------------------------------------------------

/** Read a Zod schema's discriminating `_def.typeName` (e.g. `"ZodObject"`). */
export function getZodTypeName(schema: ZodTypeAny): string | undefined {
  return (schema as any)._def?.typeName;
}

/** Returns `true` when the schema is a `z.object({...})`. */
export function isZodObject(schema: ZodTypeAny): boolean {
  return getZodTypeName(schema) === "ZodObject";
}

/** Returns the top-level shape of a `z.object()`, or `undefined` for non-objects. */
export function getZodObjectShape(schema: ZodTypeAny): Record<string, ZodTypeAny> | undefined {
  if (!isZodObject(schema)) return undefined;
  return (schema as any)._def.shape() as Record<string, ZodTypeAny>;
}

/** Returns the element schema of a `z.array()`, or `undefined` for non-arrays. */
export function getZodArrayElement(schema: ZodTypeAny): ZodTypeAny | undefined {
  if (getZodTypeName(schema) !== "ZodArray") return undefined;
  return (schema as any)._def.type as ZodTypeAny;
}

/**
 * Returns the variant schemas of a `z.union()` or `z.discriminatedUnion()`, or
 * `undefined` for any other schema. Both union kinds expose their variants on
 * `_def.options`.
 */
export function getZodUnionOptions(schema: ZodTypeAny): ZodTypeAny[] | undefined {
  const typeName = getZodTypeName(schema);
  if (typeName !== "ZodUnion" && typeName !== "ZodDiscriminatedUnion") return undefined;
  return (schema as any)._def.options as ZodTypeAny[];
}

/**
 * Returns the value schema of a `z.record()` (the type behind every key), or
 * `undefined` for non-records. A record's value type lives on `_def.valueType`.
 */
export function getZodRecordValueType(schema: ZodTypeAny): ZodTypeAny | undefined {
  if (getZodTypeName(schema) !== "ZodRecord") return undefined;
  return (schema as any)._def.valueType as ZodTypeAny;
}

/**
 * Unwrap one layer of ZodOptional / ZodDefault / ZodNullable (`_def.innerType`)
 * or ZodEffects (`_def.schema`). Returns `undefined` for non-wrapper types.
 */
export function getZodInnerType(schema: ZodTypeAny): ZodTypeAny | undefined {
  const def = (schema as any)._def;
  if (!def) return undefined;
  return def.innerType ?? def.schema ?? undefined;
}

/**
 * A schema's kind, read from zod 3 (`_def.typeName`, e.g. `"ZodReadonly"`) or
 * zod 4 (`_def.type`, e.g. `"readonly"`), normalized to zod 4's lowercase
 * spelling. An app may hand the framework a schema from either.
 */
function zodKind(schema: unknown): string | undefined {
  const def = (schema as { _def?: { typeName?: unknown; type?: unknown } } | undefined)?._def;
  if (typeof def?.typeName === "string") return def.typeName.replace(/^Zod/, "").toLowerCase();
  return typeof def?.type === "string" ? def.type : undefined;
}

/**
 * The top-level keys of an object schema declared `.readonly()`: on a session
 * `stateSchema`, the fields set when a session is created that never change.
 *
 * Only a plain `z.object({...})` at the top is read; anything else (a union,
 * an intersection, a lazy or wrapped root) has no readonly keys, rather than
 * a guess. A key counts when a readonly wrapper sits anywhere in its own
 * wrapper chain (`.readonly().default(x)` and `.default(x).readonly()` both
 * count). `.readonly()` deeper inside a field's value doesn't make the field
 * readonly. Reads zod 3 and zod 4 schemas alike.
 */
export function getReadonlyStateKeys(schema: ZodTypeAny | undefined): string[] {
  if (schema === undefined || zodKind(schema) !== "object") return [];
  const shape = (schema as unknown as { shape?: unknown }).shape;
  if (typeof shape !== "object" || shape === null) return [];
  const keys: string[] = [];
  for (const [key, field] of Object.entries(shape as Record<string, unknown>)) {
    let current: unknown = field;
    const seen = new Set<unknown>();
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      if (zodKind(current) === "readonly") {
        keys.push(key);
        break;
      }
      const def = (current as { _def?: { innerType?: unknown; schema?: unknown } })._def;
      current = def?.innerType ?? def?.schema;
    }
  }
  return keys;
}

/**
 * Peel wrapper layers (`.default()`, `.optional()`, `.nullable()`, effects) off
 * a schema until a `ZodObject` is reached, and return it — or `undefined` when
 * the schema isn't object-shaped (scalar/array/record). Handles the dominant
 * `z.object({...}).default({})` config pattern that a single-layer unwrap misses.
 */
export function unwrapToZodObject(schema: ZodTypeAny): ZodTypeAny | undefined {
  let s: ZodTypeAny | undefined = schema;
  const seen = new Set<unknown>();
  while (s && !seen.has(s)) {
    seen.add(s);
    if (isZodObject(s)) return s;
    s = getZodInnerType(s);
  }
  return undefined;
}

/**
 * A `ZodObject`'s unknown-key policy: `"strip"` (default — silently drops
 * unknown keys), `"strict"` (rejects them), or `"passthrough"` (keeps them).
 * `undefined` for non-objects. Lets callers tell a closed object (whose key set
 * is exhaustive) from a passthrough one (which accepts arbitrary keys).
 */
export function getZodObjectUnknownKeysMode(
  schema: ZodTypeAny
): "strip" | "strict" | "passthrough" | undefined {
  if (!isZodObject(schema)) return undefined;
  return (schema as any)._def.unknownKeys;
}

/**
 * True when a `z.object()` carries a real `.catchall(...)` — a per-key schema
 * for everything not declared.
 *
 * Worth its own accessor because a catchall does NOT interact with
 * `unknownKeys` the way it looks like it should: zod consults the catchall
 * first and only falls back to strip/strict/passthrough when the catchall is
 * `ZodNever` (the default). So `.strict()` on a schema with a catchall closes
 * nothing, and a caller that wants a genuinely closed object has to ask this
 * question separately from {@link getZodObjectUnknownKeysMode}.
 */
export function hasZodObjectCatchall(schema: ZodTypeAny): boolean {
  if (!isZodObject(schema)) return false;
  const catchall = (schema as any)._def.catchall;
  return catchall !== undefined && getZodTypeName(catchall) !== "ZodNever";
}

// ---------------------------------------------------------------------------
// Structural comparison
// ---------------------------------------------------------------------------

export type ZodSchemaCompareResult = {
  declaredKind: string | undefined;
  inferredKind: string | undefined;
  reason: string;
} | null;

/**
 * Conservative one-level structural comparison between two Zod schemas.
 * Returns the first incompatibility, or `null` when structurally compatible.
 *
 * Checks: top-level kind, object key sets, one level of object value kinds,
 * and array element kind. Does NOT recurse into nested shapes, refinements,
 * brands, or union variants.
 */
export function compareZodSchemasStructurally(
  declared: ZodTypeAny,
  inferred: ZodTypeAny
): ZodSchemaCompareResult {
  const dKind = getZodTypeName(declared);
  const iKind = getZodTypeName(inferred);
  if (dKind !== iKind) {
    return { reason: `declared ${dKind} but chain produces ${iKind}`, declaredKind: dKind, inferredKind: iKind };
  }
  if (dKind === "ZodObject") {
    const dShape = getZodObjectShape(declared)!;
    const iShape = getZodObjectShape(inferred)!;
    const dKeys = Object.keys(dShape).sort();
    const iKeys = Object.keys(iShape).sort();
    if (dKeys.length !== iKeys.length || dKeys.some((k, idx) => k !== iKeys[idx])) {
      return {
        reason: `object key sets differ — declared [${dKeys.join(", ")}] vs chain [${iKeys.join(", ")}]`,
        declaredKind: dKind,
        inferredKind: iKind
      };
    }
    for (const k of dKeys) {
      const dvKind = getZodTypeName(dShape[k]);
      const ivKind = getZodTypeName(iShape[k]);
      if (dvKind !== ivKind) {
        return {
          reason: `object value kind differs at "${k}" — declared ${dvKind} vs chain ${ivKind}`,
          declaredKind: dvKind,
          inferredKind: ivKind
        };
      }
    }
  }
  if (dKind === "ZodArray") {
    const dElemKind = getZodTypeName(getZodArrayElement(declared)!);
    const iElemKind = getZodTypeName(getZodArrayElement(inferred)!);
    if (dElemKind !== iElemKind) {
      return {
        reason: `array element kind differs — declared ${dElemKind} vs chain ${iElemKind}`,
        declaredKind: dElemKind,
        inferredKind: iElemKind
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// State-key introspection (original export — kept as-is)
// ---------------------------------------------------------------------------

/**
 * Best-effort Zod schema introspection. Returns the top-level keys of a
 * `ZodObject` schema, or `undefined` when the schema is anything else
 * (union, discriminated union, effects, primitives, null/undefined).
 *
 * Used at build time to validate `expose` / `exclude` field lists against a
 * state schema. Callers MUST treat `undefined` as "skip validation" rather
 * than "no keys" — the silent-skip contract is what lets `expose` work
 * against schemas that the framework can't reflect into.
 *
 * NOTE: This uses a defensive `schema.shape` read for `unknown` input — it is
 * intentionally distinct from `getZodObjectShape` which takes `ZodTypeAny`
 * and reads `_def.shape()`.
 */
export function introspectStateKeys(stateSchema: unknown): Set<string> | undefined {
  if (stateSchema === null || stateSchema === undefined) return undefined;
  const schema = stateSchema as { _def?: { typeName?: string }; shape?: unknown };
  if (schema._def?.typeName !== "ZodObject") return undefined;
  const shape = typeof schema.shape === "function"
    ? (schema as unknown as { shape: () => Record<string, unknown> }).shape()
    : (schema.shape as Record<string, unknown> | undefined);
  if (shape === undefined || shape === null || typeof shape !== "object") return undefined;
  return new Set(Object.keys(shape));
}
