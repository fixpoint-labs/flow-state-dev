/**
 * What kind of root a generator's `outputSchema` has, as the model call sees it.
 *
 * One rule, one home. A generator sends a **bare** `z.string()` root as a plain
 * text request and forwards every other root to the provider as a
 * structured-output root, which must be an object. Both halves of that fact live
 * here so a caller outside `generator.ts` (an agent materializer deciding what an
 * author may declare, say) tests the same predicate the generator routes on,
 * rather than restating it and drifting — a wrapped string like
 * `z.string().nullable()` is *not* text here, and must not be treated as text
 * anywhere else either.
 */
import type { ZodTypeAny } from "zod";
import { getZodTypeName, getZodInnerType, isZodObject } from "../helpers/zod-introspect";

/**
 * True when `schema` is a bare `z.string()` — the one root a generator asks for
 * as plain text. A wrapper (`.nullable()`, `.optional()`, `.refine()`) is not
 * text: it goes to the provider as a structured-output root.
 */
export function isTextOutputSchema(schema: ZodTypeAny): boolean {
  return getZodTypeName(schema) === "ZodString";
}

/**
 * True when `schema` is an object root the provider can accept, including one
 * behind `.refine()` / `.superRefine()` — `makeSchemaStrict` unwraps a root
 * `ZodEffects` before building the strict schema, so the provider sees the
 * object underneath. Any other wrapper survives into the request and is not an
 * object root.
 */
export function isObjectOutputRoot(schema: ZodTypeAny): boolean {
  let current: ZodTypeAny | undefined = schema;
  const seen = new Set<ZodTypeAny>();
  while (current !== undefined && !seen.has(current)) {
    if (getZodTypeName(current) !== "ZodEffects") return isZodObject(current);
    seen.add(current);
    current = getZodInnerType(current);
  }
  return false;
}
