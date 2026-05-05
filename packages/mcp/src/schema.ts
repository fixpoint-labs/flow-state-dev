/**
 * Zod → JSON Schema conversion for MCP tool input schemas.
 *
 * Wraps `zod-to-json-schema` with options tuned to MCP expectations:
 *   - Draft 2020-12 dialect (current MCP spec).
 *   - No definitions / refs (MCP clients want self-contained tool schemas).
 *   - Strip the `$schema` and `$ref` keys we never use.
 *   - Empty Zod objects produce `{ type: "object" }` with explicit
 *     `additionalProperties: false`, which is what the spec requires for
 *     parameterless tools.
 */
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/** JSON Schema object shape — minimal, only the fields we touch. */
export type JsonSchemaObject = {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean | unknown;
  [key: string]: unknown;
};

/**
 * Convert a Zod schema to a JSON Schema suitable for MCP `tools/list`
 * `inputSchema`. The result always has `type: "object"` at the top level
 * — MCP requires tool inputs to be objects.
 */
export function toolInputJsonSchema(schema: ZodTypeAny): JsonSchemaObject {
  const json = zodToJsonSchema(schema, {
    target: "jsonSchema2019-09",
    $refStrategy: "none"
  }) as Record<string, unknown>;

  // Drop `$schema` — MCP clients tolerate it but it's noise.
  delete json.$schema;

  if (json.type !== "object") {
    return {
      type: "object",
      properties: {},
      additionalProperties: false
    };
  }

  if (json.properties === undefined || (typeof json.properties === "object" && Object.keys(json.properties as object).length === 0)) {
    return {
      type: "object",
      properties: {},
      additionalProperties: false
    };
  }

  return json as JsonSchemaObject;
}
