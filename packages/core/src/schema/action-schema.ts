/**
 * JSON-serializable representation of action input schemas for devtool form rendering.
 * Introspects Zod schema `_def` internals to extract field types, constraints, and defaults.
 */
import type { ZodTypeAny } from "zod";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ActionFieldType =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "object"
  | "array"
  | "unknown";

export type ActionFieldSchema = {
  type: ActionFieldType;
  required: boolean;
  default?: unknown;
  description?: string;
  // String constraints
  minLength?: number;
  maxLength?: number;
  // Number constraints
  min?: number;
  max?: number;
  // Enum values
  enumValues?: string[];
  // Array element type
  itemType?: ActionFieldType;
  // Nested object fields (one level)
  fields?: Record<string, ActionFieldSchema>;
};

export type ActionInputSchema =
  | { type: "object"; fields: Record<string, ActionFieldSchema> }
  | { type: "unsupported" };

// ---------------------------------------------------------------------------
// Zod _def accessor helpers
// ---------------------------------------------------------------------------

type ZodDef = {
  typeName?: string;
  description?: string;
  shape?: () => Record<string, ZodTypeAny>;
  values?: readonly string[];
  checks?: readonly { kind: string; value?: unknown }[];
  type?: ZodTypeAny;        // ZodArray element type
  innerType?: ZodTypeAny;   // ZodOptional / ZodNullable inner
  defaultValue?: () => unknown;
  schema?: ZodTypeAny;      // ZodEffects inner
};

function def(schema: ZodTypeAny): ZodDef {
  return (schema as unknown as { _def: ZodDef })._def;
}

// ---------------------------------------------------------------------------
// Field-level serialization
// ---------------------------------------------------------------------------

function resolveFieldType(typeName: string): ActionFieldType {
  switch (typeName) {
    case "ZodString": return "string";
    case "ZodNumber": return "number";
    case "ZodBoolean": return "boolean";
    case "ZodEnum": case "ZodNativeEnum": return "enum";
    case "ZodObject": return "object";
    case "ZodArray": return "array";
    default: return "unknown";
  }
}

function extractStringChecks(checks: readonly { kind: string; value?: unknown }[]): Pick<ActionFieldSchema, "minLength" | "maxLength"> {
  const result: Pick<ActionFieldSchema, "minLength" | "maxLength"> = {};
  for (const check of checks) {
    if (check.kind === "min" && typeof check.value === "number") result.minLength = check.value;
    if (check.kind === "max" && typeof check.value === "number") result.maxLength = check.value;
  }
  return result;
}

function extractNumberChecks(checks: readonly { kind: string; value?: unknown }[]): Pick<ActionFieldSchema, "min" | "max"> {
  const result: Pick<ActionFieldSchema, "min" | "max"> = {};
  for (const check of checks) {
    if (check.kind === "min" && typeof check.value === "number") result.min = check.value;
    if (check.kind === "max" && typeof check.value === "number") result.max = check.value;
  }
  return result;
}

/**
 * Serialize a single Zod schema into an ActionFieldSchema.
 * Unwraps ZodOptional, ZodDefault, and ZodEffects wrappers.
 */
function serializeField(schema: ZodTypeAny, required = true): ActionFieldSchema {
  const d = def(schema);

  // Unwrap wrappers first
  if (d.typeName === "ZodOptional" && d.innerType) {
    return serializeField(d.innerType, false);
  }
  if (d.typeName === "ZodNullable" && d.innerType) {
    return serializeField(d.innerType, required);
  }
  if (d.typeName === "ZodDefault" && d.innerType) {
    const inner = serializeField(d.innerType, false);
    inner.default = typeof d.defaultValue === "function" ? d.defaultValue() : undefined;
    return inner;
  }
  if (d.typeName === "ZodEffects" && d.schema) {
    return serializeField(d.schema, required);
  }

  const fieldType = resolveFieldType(d.typeName ?? "");
  const result: ActionFieldSchema = {
    type: fieldType,
    required,
  };

  if (d.description) {
    result.description = d.description;
  }

  switch (fieldType) {
    case "string":
      if (d.checks) Object.assign(result, extractStringChecks(d.checks));
      break;
    case "number":
      if (d.checks) Object.assign(result, extractNumberChecks(d.checks));
      break;
    case "enum":
      if (d.values) result.enumValues = [...d.values];
      break;
    case "object":
      if (typeof d.shape === "function") {
        const shape = d.shape();
        result.fields = {};
        for (const [key, fieldSchema] of Object.entries(shape)) {
          result.fields[key] = serializeField(fieldSchema);
        }
      }
      break;
    case "array":
      if (d.type) {
        const itemDef = def(d.type);
        result.itemType = resolveFieldType(itemDef.typeName ?? "");
      }
      break;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Top-level serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a Zod action input schema into a JSON-serializable representation.
 * Returns `{ type: "object", fields }` for ZodObject schemas, or `{ type: "unsupported" }`
 * for non-object top-level schemas.
 */
export function serializeActionSchema(schema: ZodTypeAny): ActionInputSchema {
  const d = def(schema);

  // Unwrap top-level wrappers
  if ((d.typeName === "ZodDefault" || d.typeName === "ZodEffects") && (d.innerType ?? d.schema)) {
    return serializeActionSchema((d.innerType ?? d.schema)!);
  }

  if (d.typeName !== "ZodObject" || typeof d.shape !== "function") {
    return { type: "unsupported" };
  }

  const shape = d.shape();
  const fields: Record<string, ActionFieldSchema> = {};
  for (const [key, fieldSchema] of Object.entries(shape)) {
    fields[key] = serializeField(fieldSchema);
  }

  return { type: "object", fields };
}
