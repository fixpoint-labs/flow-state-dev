/**
 * Transforms a Zod schema so all object properties become required.
 *
 * OpenAI's structured output API requires every property in the JSON schema's
 * `required` array. Zod's `.optional()` and `.default()` both omit properties
 * from `required`, causing OpenAI to reject the schema. This utility strips
 * those wrappers so the JSON schema sent to the provider has all properties
 * required.
 *
 * The *original* schema is still used for response validation via
 * `schema.safeParse()`, which applies `.default()` values automatically.
 * This means authors can write natural Zod schemas with defaults and
 * optionals — the framework handles the provider constraint transparently.
 */
import { z, type ZodTypeAny } from "zod";

/**
 * Recursively unwraps ZodOptional, ZodDefault, and ZodEffects wrappers from a
 * single schema node, returning the innermost non-optional/non-default type.
 *
 * ZodEffects (from `.superRefine()` / `.refine()` / `.transform()`) is
 * unwrapped to its inner schema — the runtime refinements only run against
 * the original schema during response validation, so dropping them for the
 * strict-provider schema is safe.
 */
function unwrapOptionalAndDefault(schema: ZodTypeAny): ZodTypeAny {
  const typeName = (schema as any)._def?.typeName as string | undefined;

  if (typeName === "ZodOptional" || typeName === "ZodDefault") {
    return unwrapOptionalAndDefault((schema as any)._def.innerType);
  }

  if (typeName === "ZodEffects") {
    return unwrapOptionalAndDefault((schema as any)._def.schema);
  }

  if (typeName === "ZodNullable") {
    const inner = unwrapOptionalAndDefault((schema as any)._def.innerType);
    return inner;
  }

  // Recurse into nested objects
  if (typeName === "ZodObject") {
    return makeSchemaStrict(schema);
  }

  // Recurse into array element types
  if (typeName === "ZodArray") {
    const elementType = (schema as any)._def.type as ZodTypeAny;
    const strictElement = unwrapOptionalAndDefault(elementType);
    if (strictElement !== elementType) {
      return z.array(strictElement);
    }
    return schema;
  }

  return schema;
}

/**
 * Returns a copy of a ZodObject schema where every property is required
 * (no `.optional()`, `.default()`, or `.superRefine()` wrappers hiding
 * nested objects). Nested objects and arrays are handled recursively.
 *
 * Non-object schemas are returned as-is — this is a no-op for primitives,
 * strings, enums, etc.
 */
export function makeSchemaStrict(schema: ZodTypeAny): ZodTypeAny {
  // Unwrap ZodEffects so `.superRefine()` at the root doesn't bypass the
  // strict-mode transform. Runtime refinements still apply to the original
  // schema during response validation — this copy is provider-only.
  const rootTypeName = (schema as any)._def?.typeName as string | undefined;
  if (rootTypeName === "ZodEffects") {
    return makeSchemaStrict((schema as any)._def.schema);
  }

  if (rootTypeName !== "ZodObject") {
    return schema;
  }

  const shape = (schema as any)._def.shape() as Record<string, ZodTypeAny>;
  const newShape: Record<string, ZodTypeAny> = {};

  for (const [key, value] of Object.entries(shape)) {
    newShape[key] = unwrapOptionalAndDefault(value);
  }

  return z.object(newShape);
}
