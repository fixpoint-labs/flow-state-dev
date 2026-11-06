/**
 * Centralized Zod-internals introspection module.
 *
 * Every `_def` access in `@flow-state-dev/core` routes through this file so
 * a Zod-internal change is a single-site fix instead of a multi-file hunt.
 * The grep guard in `zod-introspect.test.ts` enforces this invariant.
 */
import { z, type ZodTypeAny } from "zod";
import { deepEqual } from "./deep-equal";

// ---------------------------------------------------------------------------
// Primitive accessors
// ---------------------------------------------------------------------------

/** Read a Zod schema's discriminating `_def.typeName` (e.g. `"ZodObject"`). */
export function getZodTypeName(schema: ZodTypeAny): string | undefined {
  return (schema as any)._def?.typeName;
}

/** Returns `true` when the schema is a `z.object({...})`. */
export function isZodObject(schema: ZodTypeAny): boolean {
  return getZodTypeName(schema) === "ZodObject";
}

/** Returns the top-level shape of a `z.object()`, or `undefined` for non-objects. */
export function getZodObjectShape(schema: ZodTypeAny): Record<string, ZodTypeAny> | undefined {
  if (!isZodObject(schema)) return undefined;
  return (schema as any)._def.shape() as Record<string, ZodTypeAny>;
}

/** Returns the element schema of a `z.array()`, or `undefined` for non-arrays. */
export function getZodArrayElement(schema: ZodTypeAny): ZodTypeAny | undefined {
  if (getZodTypeName(schema) !== "ZodArray") return undefined;
  return (schema as any)._def.type as ZodTypeAny;
}

/**
 * Returns the variant schemas of a `z.union()` or `z.discriminatedUnion()`, or
 * `undefined` for any other schema. Both union kinds expose their variants on
 * `_def.options`.
 */
export function getZodUnionOptions(schema: ZodTypeAny): ZodTypeAny[] | undefined {
  const typeName = getZodTypeName(schema);
  if (typeName !== "ZodUnion" && typeName !== "ZodDiscriminatedUnion") return undefined;
  return (schema as any)._def.options as ZodTypeAny[];
}

/**
 * Returns the value schema of a `z.record()` (the type behind every key), or
 * `undefined` for non-records. A record's value type lives on `_def.valueType`.
 */
export function getZodRecordValueType(schema: ZodTypeAny): ZodTypeAny | undefined {
  if (getZodTypeName(schema) !== "ZodRecord") return undefined;
  return (schema as any)._def.valueType as ZodTypeAny;
}

/**
 * Unwrap one layer of ZodOptional / ZodDefault / ZodNullable (`_def.innerType`)
 * or ZodEffects (`_def.schema`). Returns `undefined` for non-wrapper types.
 */
export function getZodInnerType(schema: ZodTypeAny): ZodTypeAny | undefined {
  const def = (schema as any)._def;
  if (!def) return undefined;
  return def.innerType ?? def.schema ?? undefined;
}

/**
 * A schema's kind, read from zod 3 (`_def.typeName`, e.g. `"ZodReadonly"`) or
 * zod 4 (`_def.type`, e.g. `"readonly"`), normalized to zod 4's lowercase
 * spelling. An app may hand the framework a schema from either.
 */
function zodKind(schema: unknown): string | undefined {
  const def = (schema as { _def?: { typeName?: unknown; type?: unknown } } | undefined)?._def;
  if (typeof def?.typeName === "string") return def.typeName.replace(/^Zod/, "").toLowerCase();
  return typeof def?.type === "string" ? def.type : undefined;
}

/** The wrappers {@link getReadonlyStateKeys} reads a root object through (zod 4 spellings; zod 3 normalized). */
const ROOT_WRAPPER_KINDS = new Set(["optional", "nullable", "default", "readonly", "effects", "pipe"]);

/**
 * The top-level keys of an object schema declared `.readonly()`: on a session
 * `stateSchema`, the fields set when a session is created that never change.
 *
 * The top is a `z.object({...})`, read through any `.optional()`,
 * `.nullable()`, `.default()`, `.readonly()` or refinement wrapped around it:
 * a scope record is always that object, so a wrapper there must not hide its
 * readonly keys. Anything else (a union, an intersection, a lazy) has no
 * readonly keys, rather than a guess. A key counts when a readonly wrapper sits anywhere in its own
 * wrapper chain (`.readonly().default(x)` and `.default(x).readonly()` both
 * count). `.readonly()` deeper inside a field's value doesn't make the field
 * readonly. Reads zod 3 and zod 4 schemas alike.
 */
export function getReadonlyStateKeys(schema: ZodTypeAny | undefined): string[] {
  const seenRoot = new Set<unknown>();
  while (schema !== undefined && !seenRoot.has(schema) && ROOT_WRAPPER_KINDS.has(zodKind(schema) ?? "")) {
    seenRoot.add(schema);
    const def = (schema as { _def?: { innerType?: ZodTypeAny; schema?: ZodTypeAny } })._def;
    schema = def?.innerType ?? def?.schema;
  }
  if (schema === undefined || zodKind(schema) !== "object") return [];
  const shape = (schema as unknown as { shape?: unknown }).shape;
  if (typeof shape !== "object" || shape === null) return [];
  const keys: string[] = [];
  for (const [key, field] of Object.entries(shape as Record<string, unknown>)) {
    let current: unknown = field;
    const seen = new Set<unknown>();
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      if (zodKind(current) === "readonly") {
        keys.push(key);
        break;
      }
      const def = (current as { _def?: { innerType?: unknown; schema?: unknown } })._def;
      current = def?.innerType ?? def?.schema;
    }
  }
  return keys;
}

/**
 * Peel wrapper layers (`.default()`, `.optional()`, `.nullable()`, effects) off
 * a schema until a `ZodObject` is reached, and return it — or `undefined` when
 * the schema isn't object-shaped (scalar/array/record). Handles the dominant
 * `z.object({...}).default({})` config pattern that a single-layer unwrap misses.
 */
export function unwrapToZodObject(schema: ZodTypeAny): ZodTypeAny | undefined {
  let s: ZodTypeAny | undefined = schema;
  const seen = new Set<unknown>();
  while (s && !seen.has(s)) {
    seen.add(s);
    if (isZodObject(s)) return s;
    s = getZodInnerType(s);
  }
  return undefined;
}

/**
 * Rebuild `schema` with the `ZodObject` that {@link unwrapToZodObject} finds
 * replaced by `map(object)`, keeping every wrapper above it (`.default()`,
 * `.optional()`, effects). Returns `schema` itself when `map` returns the
 * object unchanged, and `undefined` when the schema isn't object-shaped.
 */
export function mapZodObjectRoot(
  schema: ZodTypeAny,
  map: (object: ZodTypeAny) => ZodTypeAny
): ZodTypeAny | undefined {
  if (isZodObject(schema)) return map(schema);
  const inner = getZodInnerType(schema);
  if (inner === undefined) return undefined;
  const mapped = mapZodObjectRoot(inner, map);
  if (mapped === undefined) return undefined;
  if (mapped === inner) return schema;
  const def = (schema as any)._def;
  const innerKey = def.innerType !== undefined ? "innerType" : "schema";
  const Wrapper = schema.constructor as new (def: unknown) => ZodTypeAny;
  return new Wrapper({ ...def, [innerKey]: mapped });
}

/**
 * A `ZodObject`'s unknown-key policy: `"strip"` (default — silently drops
 * unknown keys), `"strict"` (rejects them), or `"passthrough"` (keeps them).
 * `undefined` for non-objects. Lets callers tell a closed object (whose key set
 * is exhaustive) from a passthrough one (which accepts arbitrary keys).
 */
export function getZodObjectUnknownKeysMode(
  schema: ZodTypeAny
): "strip" | "strict" | "passthrough" | undefined {
  if (!isZodObject(schema)) return undefined;
  return (schema as any)._def.unknownKeys;
}

/**
 * True when a `z.object()` carries a real `.catchall(...)` — a per-key schema
 * for everything not declared.
 *
 * Worth its own accessor because a catchall does NOT interact with
 * `unknownKeys` the way it looks like it should: zod consults the catchall
 * first and only falls back to strip/strict/passthrough when the catchall is
 * `ZodNever` (the default). So `.strict()` on a schema with a catchall closes
 * nothing, and a caller that wants a genuinely closed object has to ask this
 * question separately from {@link getZodObjectUnknownKeysMode}.
 */
export function hasZodObjectCatchall(schema: ZodTypeAny): boolean {
  if (!isZodObject(schema)) return false;
  const catchall = (schema as any)._def.catchall;
  return catchall !== undefined && getZodTypeName(catchall) !== "ZodNever";
}

// ---------------------------------------------------------------------------
// Structural comparison
// ---------------------------------------------------------------------------

export type ZodSchemaCompareResult = {
  declaredKind: string | undefined;
  inferredKind: string | undefined;
  reason: string;
} | null;

/**
 * Conservative one-level structural comparison between two Zod schemas.
 * Returns the first incompatibility, or `null` when structurally compatible.
 *
 * Checks: top-level kind, object key sets, one level of object value kinds,
 * and array element kind. Does NOT recurse into nested shapes, refinements,
 * brands, or union variants.
 */
export function compareZodSchemasStructurally(
  declared: ZodTypeAny,
  inferred: ZodTypeAny
): ZodSchemaCompareResult {
  const dKind = getZodTypeName(declared);
  const iKind = getZodTypeName(inferred);
  if (dKind !== iKind) {
    return { reason: `declared ${dKind} but chain produces ${iKind}`, declaredKind: dKind, inferredKind: iKind };
  }
  if (dKind === "ZodObject") {
    const dShape = getZodObjectShape(declared)!;
    const iShape = getZodObjectShape(inferred)!;
    const dKeys = Object.keys(dShape).sort();
    const iKeys = Object.keys(iShape).sort();
    if (dKeys.length !== iKeys.length || dKeys.some((k, idx) => k !== iKeys[idx])) {
      return {
        reason: `object key sets differ — declared [${dKeys.join(", ")}] vs chain [${iKeys.join(", ")}]`,
        declaredKind: dKind,
        inferredKind: iKind
      };
    }
    for (const k of dKeys) {
      const dvKind = getZodTypeName(dShape[k]);
      const ivKind = getZodTypeName(iShape[k]);
      if (dvKind !== ivKind) {
        return {
          reason: `object value kind differs at "${k}" — declared ${dvKind} vs chain ${ivKind}`,
          declaredKind: dvKind,
          inferredKind: ivKind
        };
      }
    }
  }
  if (dKind === "ZodArray") {
    const dElemKind = getZodTypeName(getZodArrayElement(declared)!);
    const iElemKind = getZodTypeName(getZodArrayElement(inferred)!);
    if (dElemKind !== iElemKind) {
      return {
        reason: `array element kind differs — declared ${dElemKind} vs chain ${iElemKind}`,
        declaredKind: dElemKind,
        inferredKind: iElemKind
      };
    }
  }
  return null;
}

/** True for a `.transform()`, whose output kind can't be read from the schema. */
function isZodTransform(schema: ZodTypeAny): boolean {
  return getZodTypeName(schema) === "ZodEffects" && (schema as any)._def.effect?.type === "transform";
}

/**
 * Unwrap `.default()` / `.optional()` / `.nullable()` / brand / `z.lazy()` and the other wrappers.
 * Deeper than {@link unwrapToZodObject} (brand, lazy) because it compares a state field's kind;
 * {@link compareZodSchemasStructurally} compares output schemas as written, wrappers included.
 * Stops at a `.transform()`: its input kind says nothing about its output.
 */
function peelZodWrappers(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  const seen = new Set<unknown>();
  while (!seen.has(current) && !isZodTransform(current)) {
    seen.add(current);
    const typeName = getZodTypeName(current);
    const def = (current as any)._def;
    const inner =
      typeName === "ZodBranded" ? (def.type as ZodTypeAny)
      : typeName === "ZodLazy" ? (def.getter() as ZodTypeAny)
      : getZodInnerType(current);
    if (inner === undefined) break;
    current = inner;
  }
  return current;
}

/** True for the two Zod kinds that accept any value. */
function isOpenZodKind(kind: string | undefined): boolean {
  return kind === "ZodAny" || kind === "ZodUnknown";
}

const TRANSFORM_REASON =
  "a .transform() on either side can't be checked, since its output kind isn't in the schema; " +
  "declare the field without one, or share one schema between both sides";

/**
 * Why `declared` and `required` disagree, or `null` when the kind under the
 * wrappers matches (array elements too). `z.any()` / `z.unknown()` match
 * anything; a `.transform()` matches only the same schema. Nested shapes are
 * not compared.
 */
export function compareStateFieldKinds(declared: ZodTypeAny, required: ZodTypeAny): string | null {
  return compareKindsUnderWrappers(declared, required, false);
}

/** {@link compareStateFieldKinds} at one level; `inArray` compares an array's elements. */
function compareKindsUnderWrappers(declared: ZodTypeAny, required: ZodTypeAny, inArray: boolean): string | null {
  if (declared === required) return null;
  const declaredInner = peelZodWrappers(declared);
  const requiredInner = peelZodWrappers(required);
  const declaredKind = getZodTypeName(declaredInner);
  const requiredKind = getZodTypeName(requiredInner);
  if (isOpenZodKind(declaredKind) || isOpenZodKind(requiredKind)) return null;
  if (isZodTransform(declaredInner) || isZodTransform(requiredInner)) return TRANSFORM_REASON;
  if (declaredKind !== requiredKind) {
    return inArray
      ? `declared an array of ${declaredKind} but a block requires an array of ${requiredKind}`
      : `declared ${declaredKind} but a block requires ${requiredKind}`;
  }
  if (!inArray && declaredKind === "ZodArray") {
    return compareKindsUnderWrappers(getZodArrayElement(declaredInner)!, getZodArrayElement(requiredInner)!, true);
  }
  return null;
}

// ---------------------------------------------------------------------------
// State-key introspection (original export — kept as-is)
// ---------------------------------------------------------------------------

/**
 * Best-effort Zod schema introspection. Returns the top-level keys of a
 * `ZodObject` schema, or `undefined` when the schema is anything else
 * (union, discriminated union, effects, primitives, null/undefined).
 *
 * Used at build time to validate `expose` / `exclude` field lists against a
 * state schema. Callers MUST treat `undefined` as "skip validation" rather
 * than "no keys" — the silent-skip contract is what lets `expose` work
 * against schemas that the framework can't reflect into.
 *
 * NOTE: This uses a defensive `schema.shape` read for `unknown` input — it is
 * intentionally distinct from `getZodObjectShape` which takes `ZodTypeAny`
 * and reads `_def.shape()`.
 */
export function introspectStateKeys(stateSchema: unknown): Set<string> | undefined {
  if (stateSchema === null || stateSchema === undefined) return undefined;
  const schema = stateSchema as { _def?: { typeName?: string }; shape?: unknown };
  if (schema._def?.typeName !== "ZodObject") return undefined;
  const shape = typeof schema.shape === "function"
    ? (schema as unknown as { shape: () => Record<string, unknown> }).shape()
    : (schema.shape as Record<string, unknown> | undefined);
  if (shape === undefined || shape === null || typeof shape !== "object") return undefined;
  return new Set(Object.keys(shape));
}

// ---------------------------------------------------------------------------
// Scope-state declaration reads (the merge in `scope-state-merge.ts`)
// ---------------------------------------------------------------------------

/**
 * The source text of the thunk zod 3 wraps a static `.default(value)` in.
 * Read once off a probe, so a static default is told apart from an author's
 * factory without calling either.
 */
const STATIC_DEFAULT_SOURCE: string | undefined = (() => {
  const thunk = (z.string().default("") as any)._def?.defaultValue;
  return typeof thunk === "function" ? String(thunk) : undefined;
})();

/** A `.default()`'s declared default, read without running an author's factory. */
export type ZodDeclaredDefault =
  /** `.default(value)`: `value()` returns the declared value (zod's own thunk). */
  | { kind: "static"; factory: () => unknown; value: () => unknown }
  /** `.default(() => ...)`: an author's factory, compared by identity and never called here. */
  | { kind: "dynamic"; factory: () => unknown };

/**
 * The default a `.default()` declares, or `undefined` for any other schema.
 *
 * zod 3 keeps no raw value: `.default(value)` stores the thunk `() => def`,
 * and `.default(fn)` stores `fn`. So a default is read as static only when
 * both hold: its text is exactly zod's thunk, which is a read of one binding
 * and so has no side effect to run; and two calls return the same value
 * (`Object.is`), which a closure that recomputes (a getter behind the name,
 * say) does not. That value is kept, so the thunk runs twice at most. Any
 * other function is an author's factory: returned as is and never called.
 */
export function getZodDeclaredDefault(schema: ZodTypeAny): ZodDeclaredDefault | undefined {
  if (getZodTypeName(schema) !== "ZodDefault") return undefined;
  const raw = (schema as any)._def.defaultValue;
  if (typeof raw !== "function") return { kind: "static", factory: () => raw, value: () => raw };
  const factory = raw as () => unknown;
  if (STATIC_DEFAULT_SOURCE === undefined || String(factory) !== STATIC_DEFAULT_SOURCE) {
    return { kind: "dynamic", factory };
  }
  let first: unknown;
  let second: unknown;
  try {
    first = factory();
    second = factory();
  } catch {
    return { kind: "dynamic", factory };
  }
  return Object.is(first, second) ? { kind: "static", factory, value: () => first } : { kind: "dynamic", factory };
}

/**
 * Every author's default factory `schema` declares anywhere a read could fill
 * from it: under its wrappers, in an object's fields, an array's or a set's
 * items, a record's or a map's values, a tuple, a union, an intersection.
 * A lazy is never expanded (a recursive one builds a fresh schema on each
 * call), so no factory is found inside one. Never calls a factory.
 */
export function dynamicDefaultFactories(
  schema: ZodTypeAny,
  out: Set<() => unknown> = new Set(),
  seen: Set<ZodTypeAny> = new Set()
): Set<() => unknown> {
  if (seen.has(schema)) return out;
  seen.add(schema);
  const def = (schema as any)._def;
  const walk = (child: unknown) => {
    if (child !== undefined && child !== null) dynamicDefaultFactories(child as ZodTypeAny, out, seen);
  };
  switch (getZodTypeName(schema)) {
    case "ZodDefault": {
      const declared = getZodDeclaredDefault(schema)!;
      if (declared.kind === "dynamic") out.add(declared.factory);
      walk(def.innerType);
      break;
    }
    case "ZodObject":
      Object.values(getZodObjectShape(schema) ?? {}).forEach(walk);
      walk(def.catchall);
      break;
    case "ZodArray":
    case "ZodSet":
      walk(def.type ?? def.valueType);
      break;
    case "ZodRecord":
    case "ZodMap":
      walk(def.valueType);
      break;
    case "ZodTuple":
      (def.items as ZodTypeAny[]).forEach(walk);
      walk(def.rest);
      break;
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      [...(def.options instanceof Map ? def.options.values() : def.options)].forEach(walk);
      break;
    case "ZodIntersection":
      walk(def.left);
      walk(def.right);
      break;
    case "ZodLazy":
      // Never expanded: a recursive lazy builds a fresh schema on each call.
      // A lazy is an opaque leaf, with no factory found inside it.
      break;
    case "ZodBranded":
      walk(def.type);
      break;
    case "ZodPipeline":
      walk(def.in);
      walk(def.out);
      break;
    case "ZodCatch":
      walk(def.innerType);
      break;
    default:
      walk(getZodInnerType(schema));
  }
  return out;
}

/** `true` for a `z.object` with no catchall, no strict or passthrough mode and no refinement. */
export function isPlainZodObject(schema: ZodTypeAny): boolean {
  if (!isZodObject(schema)) return false;
  const def = (schema as any)._def;
  return (def.unknownKeys ?? "strip") === "strip" && !hasZodObjectCatchall(schema);
}

const opaqueSchemaIds = new WeakMap<object, number>();
let nextOpaqueSchemaId = 0;

/** A per-reference id, for a schema or a factory {@link zodSchemaSignature} does not read into. */
function identityOf(value: object): string {
  let id = opaqueSchemaIds.get(value);
  if (id === undefined) {
    id = nextOpaqueSchemaId++;
    opaqueSchemaIds.set(value, id);
  }
  return `#${id}`;
}

/**
 * `value` as JSON when JSON reads it back exactly, else `undefined`. A value
 * it can't round-trip (`undefined`, `NaN`, `Infinity`, a bigint, a symbol, a
 * `Date`, a function) would encode like another (`NaN` and `null` both as
 * `null`), so the caller fingerprints by identity instead. So does any value
 * the comparison throws on (a `Map`, a `Set`, a class instance, a value
 * nested past `deepEqual`'s depth limit): nothing here may throw.
 */
function exactJson(value: unknown): string | undefined {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return undefined;
    // Canonical: object keys sorted at every depth, as `deepEqual` ignores
    // their order; array order is kept, as it compares arrays in order.
    return deepEqual(JSON.parse(json), value) ? JSON.stringify(sortedKeys(JSON.parse(json))) : undefined;
  } catch {
    return undefined;
  }
}

/** A JSON value with every object's keys sorted, recursively; arrays keep their order. */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortedKeys(record[key])]));
}

/** Whether a `_def.checks` list (a string's `.min()`, a number's `.int()`, …) is empty. */
function hasNoChecks(def: { checks?: unknown[]; coerce?: unknown }): boolean {
  return (def.checks === undefined || def.checks.length === 0) && def.coerce !== true;
}

/**
 * The zod kinds {@link zodSchemaSignature} reads structurally, each with every
 * `_def` parameter that changes what it accepts: a primitive's checks and
 * coercion, an enum's values, a literal's type and value, an array's length
 * checks and items, a record's key and value types, a tuple's items and rest,
 * an object's keys, unknown-keys mode and catchall, a union's options in
 * order, a discriminated union's discriminator and options, and the optional,
 * nullable, readonly and default wrappers. Every other kind, and any kind zod
 * adds later, compares by identity.
 */
export const STRUCTURAL_SIGNATURE_KINDS: ReadonlySet<string> = new Set([
  "ZodString", "ZodNumber", "ZodBigInt", "ZodDate", "ZodBoolean",
  "ZodAny", "ZodUnknown", "ZodNull", "ZodUndefined",
  "ZodEnum", "ZodNativeEnum", "ZodLiteral",
  "ZodArray", "ZodRecord", "ZodTuple", "ZodObject",
  "ZodUnion", "ZodDiscriminatedUnion",
  "ZodOptional", "ZodNullable", "ZodReadonly", "ZodDefault"
]);

/**
 * A conservative fingerprint of a schema: two schemas with one signature
 * accept the same values and declare the same defaults, in the same wrapper
 * order.
 *
 * Read structurally only where every part is understood: a primitive with no
 * checks (no `.min()`, `.email()`, `.int()`, no coercion), an enum, a literal,
 * an array with no length checks, a plain `z.object` (strip mode, no
 * catchall), a record, a tuple with no rest, a union, and the optional /
 * nullable / readonly / default wrappers in the order they were applied. A
 * static default is read by value through zod's own thunk. Anything else (a
 * constrained primitive, a refinement or transform, a lazy, an intersection, a
 * brand, a pipe, a catch, an author's default factory) is fingerprinted by
 * reference, so it matches only the same object. No default factory is ever
 * called. Every composite part is JSON-encoded, so a value or key holding a
 * separator can't make two signatures collide.
 */
export function zodSchemaSignature(schema: ZodTypeAny): string {
  const def = (schema as any)._def;
  const name = getZodTypeName(schema) ?? "?";
  if (!STRUCTURAL_SIGNATURE_KINDS.has(name)) return `opaque${identityOf(schema)}`;
  switch (name) {
    case "ZodString":
    case "ZodNumber":
    case "ZodBigInt":
    case "ZodDate":
      return hasNoChecks(def) ? name.slice(3).toLowerCase() : `opaque${identityOf(schema)}`;
    case "ZodBoolean":
      return def.coerce === true ? `opaque${identityOf(schema)}` : "boolean";
    case "ZodAny":
    case "ZodUnknown":
    case "ZodNull":
    case "ZodUndefined":
      return name.slice(3).toLowerCase();
    case "ZodEnum":
      return `enum${JSON.stringify([...(def.values as string[])].sort())}`;
    case "ZodNativeEnum":
      return `native${JSON.stringify(def.values)}`;
    case "ZodLiteral": {
      const exact = exactJson(def.value);
      return exact === undefined ? `opaque${identityOf(schema)}` : `literal${JSON.stringify([typeof def.value, exact])}`;
    }
    case "ZodArray":
      return def.minLength === null && def.maxLength === null && def.exactLength === null
        ? `array${JSON.stringify([zodSchemaSignature(def.type)])}`
        : `opaque${identityOf(schema)}`;
    case "ZodRecord":
      return `record${JSON.stringify([zodSchemaSignature(def.keyType), zodSchemaSignature(def.valueType)])}`;
    case "ZodTuple":
      return def.rest === null || def.rest === undefined
        ? `tuple${JSON.stringify((def.items as ZodTypeAny[]).map(zodSchemaSignature))}`
        : `opaque${identityOf(schema)}`;
    case "ZodObject": {
      if (!isPlainZodObject(schema)) return `opaque${identityOf(schema)}`;
      const shape = getZodObjectShape(schema) ?? {};
      return `object${JSON.stringify(Object.keys(shape).sort().map((k) => [k, zodSchemaSignature(shape[k]!)]))}`;
    }
    case "ZodUnion":
      // In order: a parse takes the first option that matches.
      return `union${JSON.stringify((def.options as ZodTypeAny[]).map(zodSchemaSignature))}`;
    case "ZodDiscriminatedUnion":
      return `discriminatedUnion${JSON.stringify([
        def.discriminator,
        (def.options as ZodTypeAny[]).map(zodSchemaSignature)
      ])}`;
    case "ZodOptional":
      return `optional${JSON.stringify([zodSchemaSignature(def.innerType)])}`;
    case "ZodNullable":
      return `nullable${JSON.stringify([zodSchemaSignature(def.innerType)])}`;
    case "ZodReadonly":
      return `readonly${JSON.stringify([zodSchemaSignature(def.innerType)])}`;
    case "ZodDefault": {
      const declared = getZodDeclaredDefault(schema)!;
      const exact = declared.kind === "static" ? exactJson(declared.value()) : undefined;
      const value = exact ?? `fn${identityOf(declared.factory)}`;
      return `default${JSON.stringify([zodSchemaSignature(def.innerType), value])}`;
    }
    default:
      return `opaque${identityOf(schema)}`;
  }
}
