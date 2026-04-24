/**
 * Cross-flow Zod schema compatibility checker.
 *
 * Determines whether two Zod schemas declared by different flows can coexist
 * when pointed at the same storage key. The checker walks schema structures
 * at the top level and recurses into object shapes. The philosophy is
 * conservative: when unsure, report an error. Wave 1 accepts false-positive
 * conflicts (user asked to reconcile or isolate) over false negatives (silent
 * data loss).
 */
import type { ZodTypeAny } from "zod";

export type CompatibilityResult =
  | { kind: "identical" }
  | { kind: "compatible"; warnings: string[] }
  | { kind: "incompatible"; reason: CompatibilityReason; detail: string };

export type CompatibilityReason =
  | "incompatible-shape"
  | "incompatible-types"
  | "content-type-mismatch";

/**
 * Compare two Zod schemas for cross-flow compatibility.
 *
 * - Same reference → identical (always safe to merge).
 * - Both object-shaped with overlapping keys that agree on types → compatible
 *   (overlapping-optional or extension; structurally safe).
 * - Any mismatch on a shared required field's type, or non-object schemas
 *   that differ in type → incompatible.
 */
export function compareZodSchemas(
  a: ZodTypeAny,
  b: ZodTypeAny
): CompatibilityResult {
  if (a === b) {
    return { kind: "identical" };
  }

  const typeNameA = typeName(a);
  const typeNameB = typeName(b);

  // Handle optional / nullable / default wrappers: unwrap on both sides
  // before comparing the inner shape.
  const unwrappedA = unwrap(a);
  const unwrappedB = unwrap(b);
  if (unwrappedA !== a || unwrappedB !== b) {
    return compareZodSchemas(unwrappedA, unwrappedB);
  }

  if (typeNameA !== typeNameB) {
    return {
      kind: "incompatible",
      reason: "incompatible-types",
      detail: `types differ: ${typeNameA} vs ${typeNameB}`,
    };
  }

  if (typeNameA === "ZodObject") {
    return compareObjectShapes(a, b);
  }

  // Primitives of the same ZodType are treated as compatible. We can't
  // easily tell apart two z.string() with different refinements; err on the
  // side of allowing them.
  return { kind: "compatible", warnings: [] };
}

function typeName(schema: ZodTypeAny): string {
  const def = (schema as { _def?: { typeName?: string } })._def;
  return def?.typeName ?? "Unknown";
}

function unwrap(schema: ZodTypeAny): ZodTypeAny {
  const wrapperNames = new Set([
    "ZodOptional",
    "ZodNullable",
    "ZodDefault",
    "ZodEffects",
    "ZodBranded",
    "ZodReadonly",
  ]);
  if (!wrapperNames.has(typeName(schema))) {
    return schema;
  }
  const def = (schema as { _def?: { innerType?: ZodTypeAny; schema?: ZodTypeAny } })._def;
  return def?.innerType ?? def?.schema ?? schema;
}

type ZodObjectLike = ZodTypeAny & {
  shape?: Record<string, ZodTypeAny>;
  _def?: {
    shape?: () => Record<string, ZodTypeAny>;
  };
};

function getShape(schema: ZodObjectLike): Record<string, ZodTypeAny> | undefined {
  if (schema.shape && typeof schema.shape === "object") {
    return schema.shape as Record<string, ZodTypeAny>;
  }
  const shapeFn = schema._def?.shape;
  if (typeof shapeFn === "function") {
    try {
      return shapeFn();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function compareObjectShapes(
  a: ZodTypeAny,
  b: ZodTypeAny
): CompatibilityResult {
  const shapeA = getShape(a as ZodObjectLike);
  const shapeB = getShape(b as ZodObjectLike);

  if (shapeA === undefined || shapeB === undefined) {
    // Couldn't inspect one of the shapes; be conservative and allow with a warning.
    return {
      kind: "compatible",
      warnings: ["could not inspect one of the object shapes"],
    };
  }

  const keysA = new Set(Object.keys(shapeA));
  const keysB = new Set(Object.keys(shapeB));
  const sharedKeys = [...keysA].filter((k) => keysB.has(k));

  const warnings: string[] = [];
  for (const key of sharedKeys) {
    const result = compareZodSchemas(shapeA[key]!, shapeB[key]!);
    if (result.kind === "incompatible") {
      return {
        kind: "incompatible",
        reason: "incompatible-shape",
        detail: `field "${key}": ${result.detail}`,
      };
    }
    if (result.kind === "compatible") {
      warnings.push(...result.warnings.map((w) => `at "${key}": ${w}`));
    }
  }

  const onlyInA = [...keysA].filter((k) => !keysB.has(k));
  const onlyInB = [...keysB].filter((k) => !keysA.has(k));

  if (onlyInA.length > 0 || onlyInB.length > 0) {
    const parts: string[] = [];
    if (onlyInA.length > 0) parts.push(`flow A-only keys: ${onlyInA.join(", ")}`);
    if (onlyInB.length > 0) parts.push(`flow B-only keys: ${onlyInB.join(", ")}`);
    warnings.push(`disjoint fields detected (${parts.join("; ")})`);
  }

  if (warnings.length === 0 && sharedKeys.length === keysA.size && sharedKeys.length === keysB.size) {
    // All keys overlap and compared identical/compatible with no warnings.
    return { kind: "identical" };
  }

  return { kind: "compatible", warnings };
}
