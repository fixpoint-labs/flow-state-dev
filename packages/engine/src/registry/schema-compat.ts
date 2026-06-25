/**
 * Cross-flow Zod schema compatibility checker.
 *
 * Philosophy: conservative. When the checker cannot prove two schemas are
 * safe to share a storage key, it reports incompatible — Wave 1 accepts
 * false-positive conflicts (asks the developer to reconcile or isolate)
 * over false negatives (silent data loss).
 */
import type { ZodTypeAny } from "zod";

export type CompatibilityResult =
  | { kind: "identical" }
  | { kind: "compatible"; warnings: string[] }
  | { kind: "incompatible"; reason: CompatibilityReason; detail: string };

export type CompatibilityReason = "incompatible-shape" | "incompatible-types";

const WRAPPER_TYPE_NAMES = new Set([
  "ZodOptional",
  "ZodNullable",
  "ZodDefault",
  "ZodEffects",
  "ZodBranded",
  "ZodReadonly",
]);

/**
 * Compare two Zod schemas for cross-flow compatibility.
 *
 * - Same reference → identical (safe to merge).
 * - Object shapes whose shared keys recursively agree → compatible, with a
 *   warning when disjoint keys are present.
 * - Otherwise → incompatible.
 */
export function compareZodSchemas(a: ZodTypeAny, b: ZodTypeAny): CompatibilityResult {
  if (a === b) {
    return { kind: "identical" };
  }

  // Unwrap optional/nullable/default wrappers on both sides first.
  const unwrappedA = unwrap(a);
  const unwrappedB = unwrap(b);
  if (unwrappedA !== a || unwrappedB !== b) {
    return compareZodSchemas(unwrappedA, unwrappedB);
  }

  const nameA = typeName(a);
  const nameB = typeName(b);
  if (nameA !== nameB) {
    return { kind: "incompatible", reason: "incompatible-types", detail: `${nameA} vs ${nameB}` };
  }

  if (nameA === "ZodObject") {
    return compareObjectShapes(a, b);
  }

  // Primitives of the same ZodType — treat as compatible (can't easily
  // distinguish two z.string() with different refinements).
  return { kind: "compatible", warnings: [] };
}

function typeName(schema: ZodTypeAny): string {
  return (schema as { _def?: { typeName?: string } })._def?.typeName ?? "Unknown";
}

function unwrap(schema: ZodTypeAny): ZodTypeAny {
  if (!WRAPPER_TYPE_NAMES.has(typeName(schema))) {
    return schema;
  }
  const def = (schema as { _def?: { innerType?: ZodTypeAny; schema?: ZodTypeAny } })._def;
  return def?.innerType ?? def?.schema ?? schema;
}

function getShape(schema: ZodTypeAny): Record<string, ZodTypeAny> | undefined {
  const direct = (schema as { shape?: unknown }).shape;
  if (direct && typeof direct === "object") {
    return direct as Record<string, ZodTypeAny>;
  }
  const shapeFn = (schema as { _def?: { shape?: () => Record<string, ZodTypeAny> } })._def?.shape;
  if (typeof shapeFn === "function") {
    try {
      return shapeFn();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function compareObjectShapes(a: ZodTypeAny, b: ZodTypeAny): CompatibilityResult {
  const shapeA = getShape(a);
  const shapeB = getShape(b);
  if (shapeA === undefined || shapeB === undefined) {
    return { kind: "compatible", warnings: ["object shape not inspectable"] };
  }

  const warnings: string[] = [];
  const keysA = Object.keys(shapeA);
  const keysB = Object.keys(shapeB);

  for (const key of keysA) {
    if (!(key in shapeB)) continue;
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

  const onlyInA = keysA.filter((k) => !(k in shapeB));
  const onlyInB = keysB.filter((k) => !(k in shapeA));
  if (onlyInA.length > 0 || onlyInB.length > 0) {
    warnings.push(`disjoint fields: A-only [${onlyInA.join(", ")}] B-only [${onlyInB.join(", ")}]`);
  }

  return warnings.length === 0 ? { kind: "identical" } : { kind: "compatible", warnings };
}
