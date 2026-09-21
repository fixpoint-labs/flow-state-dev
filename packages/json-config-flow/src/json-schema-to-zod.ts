/**
 * Minimal JSON Schema → Zod converter for the lab catalog.
 *
 * Core only ships Zod → JSON Schema (`zod-to-json-schema`). This lab helper
 * covers the reverse for the subset authors need in demo configs: object,
 * string (+ enum), number/integer, boolean, null, array, anyOf/oneOf.
 * Unknown constructs fall back to `z.unknown()` with a warning path via throw
 * only when `type` is missing and no composition key is present.
 */
import { z, type ZodTypeAny } from "zod";
import type { JsonSchema } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function jsonSchemaToZod(schema: JsonSchema | undefined): ZodTypeAny {
  if (schema === undefined) return z.unknown();
  return convert(schema);
}

function convert(schema: JsonSchema): ZodTypeAny {
  const record = schema as Record<string, unknown>;

  if (Array.isArray(record.anyOf) && record.anyOf.length > 0) {
    const variants = (record.anyOf as JsonSchema[]).map(convert);
    if (variants.length === 1) return variants[0]!;
    return z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }
  if (Array.isArray(record.oneOf) && record.oneOf.length > 0) {
    const variants = (record.oneOf as JsonSchema[]).map(convert);
    if (variants.length === 1) return variants[0]!;
    return z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  const type = record.type;
  if (type === "string") {
    if (Array.isArray(record.enum) && record.enum.length > 0) {
      const values = record.enum as string[];
      if (values.length === 1) return z.literal(values[0]!);
      return z.enum(values as [string, ...string[]]);
    }
    return z.string();
  }
  if (type === "number") return z.number();
  if (type === "integer") return z.number().int();
  if (type === "boolean") return z.boolean();
  if (type === "null") return z.null();
  if (type === "array") {
    const items = record.items as JsonSchema | undefined;
    return z.array(items !== undefined ? convert(items) : z.unknown());
  }
  if (type === "object" || (type === undefined && isRecord(record.properties))) {
    const properties = (record.properties ?? {}) as Record<string, JsonSchema>;
    const required = new Set(
      Array.isArray(record.required) ? (record.required as string[]) : [],
    );
    const shape: Record<string, ZodTypeAny> = {};
    for (const [key, propSchema] of Object.entries(properties)) {
      const zodProp = convert(propSchema);
      shape[key] = required.has(key) ? zodProp : zodProp.optional();
    }
    const objectSchema = z.object(shape);
    const additional = record.additionalProperties;
    if (additional === false) {
      return objectSchema.strict();
    }
    if (additional === true) {
      return objectSchema.passthrough();
    }
    if (isRecord(additional)) {
      return objectSchema.catchall(convert(additional as JsonSchema));
    }
    return objectSchema;
  }

  throw new Error(
    `jsonSchemaToZod: unsupported schema ${JSON.stringify(schema)}. ` +
      `Supported types: string|number|integer|boolean|null|array|object (+ anyOf/oneOf).`,
  );
}
