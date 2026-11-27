// FIX-2894.
/**
 * A zod schema as one self-contained JSON Schema document (draft-07), for a
 * reader that takes it whole, such as a model reading what a tool or a
 * delegate takes: every definition inlined, so it holds no `$ref` and no
 * `definitions`. Through the same `zod-to-json-schema` core uses everywhere
 * else, so no package keeps a converter of its own.
 */
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * `schema` as a draft-07 JSON Schema with every reference inlined.
 *
 * @param schema The zod schema. A recursive one has no inlined form: its
 *   recursion is cut where it repeats, as `zod-to-json-schema` cuts it.
 */
export function inlinedJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  return zodToJsonSchema(schema, { target: "jsonSchema7", $refStrategy: "none" }) as Record<string, unknown>;
}
