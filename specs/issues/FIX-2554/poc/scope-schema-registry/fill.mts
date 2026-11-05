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
 * A filled value never comes from a parse's output. The fill walks the
 * declared schemas themselves: `z.object` by key, `z.array` by element and
 * `z.record` by value, through `.optional()`, `.nullable()`, `.readonly()` and
 * `.default()`, where a `.default()` supplies its declared value. A transform
 * (or refine) fills only through its input schema, so it can never reorder,
 * swap or resize what lands in the record. Any other composition (a union,
 * discriminated union, intersection, lazy, pipe or catch) is left as stored:
 * defaults inside it may stay unfilled, but it is never given a wrong value.
 * A top-level field whose present value fails its schema is left exactly as
 * stored.
 *
 * Cost: each top-level field is parsed on every read of a stored record (the
 * load, and the record a write or a conflict hands back), so a schema's
 * transforms, refinements and default factories run on each read.
 */
import type { ZodTypeAny } from "zod";
import { getZodInnerType, getZodObjectShape, getZodTypeName, isZodObject } from "../../../../../packages/core/src/helpers/index";

// POC: vendored verbatim from FIX-2554's head 8f9bf63
// (packages/engine/src/context/scope-state-defaults.ts); only the imports differ.
type JsonObject = Record<string, any>;
const isJsonObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Return `state` with the defaults of `schema` filled in where `state` has no
 * value. Each top-level field is checked on its own, so a field that fails its
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

  const shape = rootShapeOf(schema);
  if (shape === undefined) {
    return schema.safeParse(stored).success ? (fillDefaults(schema, stored) as JsonObject) : stored;
  }

  let out: JsonObject | undefined;
  for (const [key, field] of Object.entries(shape)) {
    const current = stored[key];
    if (!field.safeParse(current).success) continue;
    const filled = fillDefaults(field, current);
    if (filled === current || filled === undefined) continue;
    out ??= { ...stored };
    out[key] = filled as JsonObject[string];
  }
  return out ?? stored;
}

/** Wrappers the fill reads through to their inner schema (a transform's: its input). */
const WRAPPERS = new Set(["ZodOptional", "ZodNullable", "ZodReadonly", "ZodDefault", "ZodEffects"]);

/** The shape of the `z.object` under the root schema's wrappers, or `undefined` when there is none. */
function rootShapeOf(schema: ZodTypeAny): Record<string, ZodTypeAny> | undefined {
  const seen = new Set<ZodTypeAny>();
  for (let s: ZodTypeAny | undefined = schema; s !== undefined && !seen.has(s); s = getZodInnerType(s)) {
    seen.add(s);
    if (isZodObject(s)) return getZodObjectShape(s);
    if (!WRAPPERS.has(getZodTypeName(s) ?? "")) return undefined;
  }
  return undefined;
}

/** The declared value of a `.default()`; zod 3 keeps it on `_def.defaultValue`, usually as a thunk. */
function declaredDefault(schema: ZodTypeAny): unknown {
  const value = (schema as { _def?: { defaultValue?: unknown } })._def?.defaultValue;
  return typeof value === "function" ? (value as () => unknown)() : value;
}

/** A child schema read off `_def` (an array's element, a record's value type). */
function defChild(schema: ZodTypeAny, key: "type" | "valueType"): ZodTypeAny | undefined {
  return (schema as { _def?: Record<string, ZodTypeAny | undefined> })._def?.[key];
}

/** `out` copy-on-write: the edited copy if any entry changed, else `stored` itself. */
function fillEntries<T extends unknown[] | Record<string, unknown>>(
  stored: T,
  entries: Array<[string | number, ZodTypeAny | undefined]>
): T {
  let out: T | undefined;
  for (const [key, schema] of entries) {
    const value = (stored as Record<string | number, unknown>)[key];
    if (schema === undefined) continue;
    const filled = fillDefaults(schema, value);
    if (filled === value || filled === undefined) continue;
    out ??= (Array.isArray(stored) ? [...stored] : { ...stored }) as T;
    (out as Record<string | number, unknown>)[key] = filled;
  }
  return out ?? stored;
}

/**
 * `stored` with the declared defaults of `schema` filled in wherever it has no
 * value, walking the schema and never a parse result. Returns `stored` itself
 * when nothing was missing, so callers can tell a no-op by identity.
 */
function fillDefaults(schema: ZodTypeAny, stored: unknown): unknown {
  switch (getZodTypeName(schema)) {
    case "ZodDefault": {
      const inner = getZodInnerType(schema);
      const value = stored === undefined ? declaredDefault(schema) : stored;
      return inner === undefined ? value : fillDefaults(inner, value);
    }
    case "ZodOptional":
    case "ZodNullable":
    case "ZodReadonly":
    case "ZodEffects": {
      const name = getZodTypeName(schema);
      if ((name === "ZodOptional" && stored === undefined) || (name === "ZodNullable" && stored === null)) {
        return stored;
      }
      const inner = getZodInnerType(schema);
      return inner === undefined ? stored : fillDefaults(inner, stored);
    }
    case "ZodObject":
      if (!isJsonObject(stored)) return stored;
      return fillEntries(stored, Object.entries(getZodObjectShape(schema) ?? {}));
    case "ZodArray": {
      if (!Array.isArray(stored)) return stored;
      const element = defChild(schema, "type");
      return fillEntries(stored, stored.map((_, i): [number, ZodTypeAny | undefined] => [i, element]));
    }
    case "ZodRecord": {
      if (!isJsonObject(stored)) return stored;
      const valueType = defChild(schema, "valueType");
      return fillEntries(stored, Object.keys(stored).map((k): [string, ZodTypeAny | undefined] => [k, valueType]));
    }
    default:
      return stored;
  }
}
