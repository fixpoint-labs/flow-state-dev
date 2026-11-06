/**
 * Scope state defaults on load: the read-path step that makes `ctx.session`,
 * `ctx.user` and `ctx.org` `.state` hold what `z.infer` of the flow's scope
 * `stateSchema` promises, a default for every defaulted field the stored
 * record lacks.
 *
 * The schema a read fills from is {@link scopeStateSchema}: the flow's own
 * `stateSchema` merged at `defineFlow` with what its blocks and capabilities
 * declare, so a field only a block declares reads its default too. Every read
 * of stored scope state takes its schema from there.
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
import type { FlowInstance, JsonObject } from "@flow-state-dev/core/types";
import {
  dynamicDefaultFactories,
  getZodDeclaredDefault,
  getZodInnerType,
  getZodObjectShape,
  getZodTypeName,
  isZodObject
} from "@flow-state-dev/core/helpers";
import { isJsonObject } from "../utils/json-helpers";

/**
 * The schema `scope`'s reads fill defaults from, and its readonly fields are
 * read off: the flow's merged one, which
 * `defineFlow` builds from the flow's own `stateSchema` and every declaration
 * its reachable blocks and their capabilities make. An instance built without
 * `defineFlow` carries none, and reads its own `stateSchema`.
 */
export function scopeStateSchema(
  flow: Pick<FlowInstance, "scopeStateSchemas"> & Partial<Pick<FlowInstance, "session" | "user" | "org">>,
  scope: "session" | "user" | "org"
): ZodTypeAny | undefined {
  if (flow.scopeStateSchemas !== undefined) return flow.scopeStateSchemas[scope];
  return (flow[scope] as { stateSchema?: ZodTypeAny } | undefined)?.stateSchema;
}

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
    return parsesWithoutFactories(schema, stored) ? (fillDefaults(schema, stored) as JsonObject) : stored;
  }

  let out: JsonObject | undefined;
  for (const [key, field] of Object.entries(shape)) {
    const current = stored[key];
    if (!parsesWithoutFactories(field, current)) continue;
    const filled = fillDefaults(field, current);
    if (filled === current || filled === undefined) continue;
    out ??= { ...stored };
    out[key] = filled as JsonObject[string];
  }
  return out ?? stored;
}

/**
 * Whether `value` fits `schema`, checked without running a default factory.
 * A parse runs every default it reaches, so the check parses a copy of the
 * schema with each author's factory default made `.optional()` instead
 * ({@link factoryFree}). A schema that copy can't be built for is treated as
 * not fitting, so its value is left as stored rather than guessed at.
 */
function parsesWithoutFactories(schema: ZodTypeAny, value: unknown): boolean {
  const guard = factoryFree(schema);
  return guard !== undefined && guard.safeParse(value).success;
}

/** {@link factoryFree}'s result per schema: built once, `null` when it can't be. */
const factoryFreeCache = new WeakMap<ZodTypeAny, ZodTypeAny | null>();

/**
 * `schema` with every author's factory default replaced by `.optional()`, so
 * a parse of it accepts exactly what `schema` accepts but runs no factory. The
 * schema itself when it declares none. Each node is rebuilt with its own
 * `_def` and only its children swapped, so its checks, unknown-keys mode,
 * refinements and static defaults stay. `undefined` for a kind holding a
 * factory that this can't rebuild.
 */
function factoryFree(schema: ZodTypeAny): ZodTypeAny | undefined {
  const cached = factoryFreeCache.get(schema);
  if (cached !== undefined) return cached ?? undefined;
  const built = dynamicDefaultFactories(schema).size === 0 ? schema : rebuildFactoryFree(schema);
  factoryFreeCache.set(schema, built ?? null);
  return built;
}

function rebuildFactoryFree(schema: ZodTypeAny): ZodTypeAny | undefined {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  const Ctor = (schema as unknown as { constructor: new (def: Record<string, unknown>) => ZodTypeAny }).constructor;
  const child = (key: string): ZodTypeAny | undefined => factoryFree(def[key] as ZodTypeAny);
  const remake = (changes: Record<string, unknown>): ZodTypeAny | undefined =>
    Object.values(changes).some((value) => value === undefined) ? undefined : new Ctor({ ...def, ...changes });
  const many = (list: unknown): ZodTypeAny[] | undefined => {
    const out = (list as ZodTypeAny[]).map(factoryFree);
    return out.some((item) => item === undefined) ? undefined : (out as ZodTypeAny[]);
  };
  switch (getZodTypeName(schema)) {
    case "ZodDefault": {
      const inner = child("innerType");
      if (inner === undefined) return undefined;
      return getZodDeclaredDefault(schema)?.kind === "dynamic" ? inner.optional() : remake({ innerType: inner });
    }
    case "ZodOptional":
    case "ZodNullable":
    case "ZodReadonly":
    case "ZodCatch":
      return remake({ innerType: child("innerType") });
    case "ZodArray":
    case "ZodBranded":
    case "ZodPromise":
      return remake({ type: child("type") });
    case "ZodSet":
      return remake({ valueType: child("valueType") });
    case "ZodRecord":
    case "ZodMap":
      return remake({ keyType: child("keyType"), valueType: child("valueType") });
    case "ZodEffects":
      return remake({ schema: child("schema") });
    case "ZodPipeline":
      return remake({ in: child("in"), out: child("out") });
    case "ZodIntersection":
      return remake({ left: child("left"), right: child("right") });
    case "ZodUnion": {
      const options = many(def.options);
      return options === undefined ? undefined : remake({ options });
    }
    case "ZodTuple": {
      const items = many(def.items);
      const rest = def.rest === null || def.rest === undefined ? def.rest : child("rest");
      return items === undefined || rest === undefined ? undefined : remake({ items, rest });
    }
    case "ZodObject": {
      const shape = getZodObjectShape(schema) ?? {};
      const fields: Record<string, ZodTypeAny> = {};
      for (const [key, field] of Object.entries(shape)) {
        const rebuilt = factoryFree(field);
        if (rebuilt === undefined) return undefined;
        fields[key] = rebuilt;
      }
      const catchall = factoryFree(def.catchall as ZodTypeAny);
      return catchall === undefined ? undefined : new Ctor({ ...def, shape: () => fields, catchall });
    }
    default:
      // A discriminated union keeps a value-to-option map, a lazy a getter:
      // rather than rebuild those, a factory inside one isn't validated.
      return undefined;
  }
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

/**
 * The value a `.default()` fills with on a read: its static value, or
 * `undefined` for an author's factory. A read never runs a factory: only a
 * new session's birth does, by parsing the flow's own schema, so one stored
 * record always reads one value.
 */
function staticDefault(schema: ZodTypeAny): { value: unknown } | undefined {
  const declared = getZodDeclaredDefault(schema);
  return declared?.kind === "static" ? { value: declared.value() } : undefined;
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
      if (stored === undefined) {
        // A factory default stays unfilled on a read: only birth runs it.
        const fill = staticDefault(schema);
        if (fill === undefined) return stored;
        return inner === undefined ? fill.value : fillDefaults(inner, fill.value);
      }
      return inner === undefined ? stored : fillDefaults(inner, stored);
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
