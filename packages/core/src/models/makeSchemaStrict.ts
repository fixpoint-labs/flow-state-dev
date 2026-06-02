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
import {
  getZodTypeName,
  getZodInnerType,
  getZodArrayElement,
  getZodObjectShape,
} from "../helpers/zod-introspect";

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
  const typeName = getZodTypeName(schema);

  if (typeName === "ZodOptional" || typeName === "ZodDefault") {
    return unwrapOptionalAndDefault(getZodInnerType(schema)!);
  }

  if (typeName === "ZodEffects") {
    return unwrapOptionalAndDefault(getZodInnerType(schema)!);
  }

  if (typeName === "ZodNullable") {
    return unwrapOptionalAndDefault(getZodInnerType(schema)!);
  }

  if (typeName === "ZodObject") {
    return makeSchemaStrict(schema);
  }

  if (typeName === "ZodArray") {
    const elementType = getZodArrayElement(schema)!;
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
  const rootTypeName = getZodTypeName(schema);
  if (rootTypeName === "ZodEffects") {
    return makeSchemaStrict(getZodInnerType(schema)!);
  }

  if (rootTypeName !== "ZodObject") {
    return schema;
  }

  const shape = getZodObjectShape(schema)!;
  const newShape: Record<string, ZodTypeAny> = {};

  for (const [key, value] of Object.entries(shape)) {
    newShape[key] = unwrapOptionalAndDefault(value);
  }

  return z.object(newShape);
}
