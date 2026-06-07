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
