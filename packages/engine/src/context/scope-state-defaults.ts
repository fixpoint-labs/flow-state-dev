/**
 * Scope state defaults on load: the read-path step that makes `ctx.session`,
 * `ctx.user` and `ctx.org` `.state` hold what `z.infer` of the flow's scope
 * `stateSchema` promises, a default for every defaulted field the stored
 * record lacks.
 *
 * Defaults are filled in, nothing else changes. A user or org record is one
 * blob shared by every flow registered on the server, so keys this flow does
 * not declare, and keys inside a declared object another flow's compatible
 * schema extends, are kept as stored. A strip-mode parse would delete them on
 * the next save. Values already present are kept as stored too: a transform
 * or coercion in the schema does not rewrite them on read.
 *
 * Array elements are filled from the element schema, one element at a time,
 * never by lining the stored array up against a parsed one (a transform may
 * reorder or resize it). A field whose present value fails its schema, which
 * includes a union or record no variant matches, is left exactly as stored.
 *
 * Cost: each top-level field is parsed on every read of a stored record (the
 * load, and the record a write or a conflict hands back), so a schema's
 * transforms, refinements and default factories run on each read.
 */
import type { ZodTypeAny } from "zod";
import type { JsonObject } from "@flow-state-dev/core/types";
import { getZodArrayElement, getZodInnerType, getZodObjectShape, isZodObject } from "@flow-state-dev/core/helpers";
import { isJsonObject } from "../utils/json-helpers";

/**
 * Return `state` with the defaults of `schema` filled in where `state` has no
 * value. Each top-level field is parsed on its own, so a field that fails its
 * schema (a session created half-filled on purpose, a record older than the
 * schema) is left as stored and does not stop its siblings getting theirs.
 * Returns `state` itself when nothing was missing.
 */
export function applyScopeStateDefaults(
  schema: ZodTypeAny | undefined,
  state: unknown
): JsonObject {
  const stored: JsonObject = isJsonObject(state) ? state : {};
  if (schema === undefined) return stored;

  const shape = objectShapeOf(schema);
  if (shape === undefined) {
    const parsed = schema.safeParse(stored);
    return parsed.success ? (fillMissing(schema, stored, parsed.data) as JsonObject) : stored;
  }

  let out: JsonObject | undefined;
  for (const [key, field] of Object.entries(shape)) {
    const current = stored[key];
    const parsed = field.safeParse(current);
    if (!parsed.success || parsed.data === undefined) continue;
    const filled = fillMissing(field, current, parsed.data);
    if (filled === current) continue;
    out ??= { ...stored };
    out[key] = filled as JsonObject[string];
  }
  return out ?? stored;
}

/** The first schema under `schema`'s wrappers (`.default()`, `.optional()`, effects) that `pick` accepts. */
function unwrapTo<T>(schema: ZodTypeAny | undefined, pick: (s: ZodTypeAny) => T | undefined): T | undefined {
  const seen = new Set<ZodTypeAny>();
  for (let s = schema; s !== undefined && !seen.has(s); s = getZodInnerType(s)) {
    seen.add(s);
    const found = pick(s);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The shape of the `z.object` under a schema's wrappers, or `undefined` when there is none. */
function objectShapeOf(schema: ZodTypeAny | undefined): Record<string, ZodTypeAny> | undefined {
  return unwrapTo(schema, (s) => (isZodObject(s) ? getZodObjectShape(s) : undefined));
}

/** The element schema of the `z.array` under a schema's wrappers, or `undefined` when there is none. */
function arrayElementOf(schema: ZodTypeAny | undefined): ZodTypeAny | undefined {
  return unwrapTo(schema, getZodArrayElement);
}

/**
 * `stored` with every value `parsed` has and `stored` lacks copied in,
 * recursing into objects by key. An array is filled element by element from
 * its element schema, never from `parsed`'s positions. Returns `stored`
 * itself when nothing was missing, so callers can tell a no-op by identity.
 */
function fillMissing(schema: ZodTypeAny | undefined, stored: unknown, parsed: unknown): unknown {
  if (stored === undefined) return parsed;
  if (Array.isArray(stored)) {
    const element = arrayElementOf(schema);
    if (element === undefined) return stored;
    let out: unknown[] | undefined;
    stored.forEach((value, i) => {
      const own = element.safeParse(value);
      if (!own.success) return;
      const filled = fillMissing(element, value, own.data);
      if (filled === value) return;
      out ??= [...stored];
      out[i] = filled;
    });
    return out ?? stored;
  }
  if (isJsonObject(stored) && isJsonObject(parsed)) {
    const shape = objectShapeOf(schema);
    let out: Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(parsed)) {
      const filled = fillMissing(shape?.[key], stored[key], value);
      if (filled === stored[key]) continue;
      out ??= { ...stored };
      out[key] = filled;
    }
    return out ?? stored;
  }
  return stored;
}
