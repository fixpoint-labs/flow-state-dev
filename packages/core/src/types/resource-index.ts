/**
 * Declared field indexes on a resource collection: the declaration shape, its
 * validation, and the one canonical value form.
 *
 * A collection declares `indexes: { name: (key, state) => value }` and is then
 * looked up with `findBy(name, value)`. The engine computes a row's entries
 * from these declarations on every write and answers a lookup from them. Both
 * sides turn values into strings here, and only here, so an entry written by
 * one path is always found by the other: a SQL store's write and a scan over
 * rows must agree on every byte.
 */
import type { JsonObject } from "../schema/common";

/** A value a row can be found by: equality on a string, number or boolean. */
export type ResourceIndexValue = string | number | boolean;

/**
 * An index function. Sees the row's storage key and its state only, and must
 * answer from them alone: one that reads the clock or other rows drifts, and a
 * lookup can filter a stale entry but never recover a missing one. Returns a
 * value, an array of values (the row is found by each), or `null` /
 * `undefined` when the row has no value for this index.
 */
export type ResourceIndexFunction<TState extends JsonObject = JsonObject> = (
  key: string,
  state: TState
) => ResourceIndexValue | null | undefined | ReadonlyArray<ResourceIndexValue | null | undefined>;

/**
 * One declared index: a function (version 1), or `{ version, value }`. Bump
 * `version` when the function changes what it returns for existing rows; the
 * next lookup in each scope then rebuilds the index from the rows.
 */
export type ResourceIndexDeclaration<TState extends JsonObject = JsonObject> =
  | ResourceIndexFunction<TState>
  | { version: number; value: ResourceIndexFunction<TState> };

/** A declared index, normalised. */
export type DeclaredResourceIndex = {
  /** The name `findBy` takes. */
  name: string;
  /** The declared version, `1` when the declaration is a bare function. */
  version: number;
  /** The name stores keep the entries under: name and version together. */
  stored: string;
  /** The index function. */
  value: ResourceIndexFunction;
};

/** Separates an index's name from its version in its stored name. */
const VERSION_SEPARATOR = "@";

/** The name an index's entries are stored under, so entries of another version are never read. */
function storedIndexName(name: string, version: number): string {
  return `${name}${VERSION_SEPARATOR}${version}`;
}

/**
 * Validate a collection's `indexes` declaration. Throws on an empty name, a
 * name containing `@`, a version that is not a positive integer, or an entry
 * that is not a function or `{ version, value }` with a function.
 */
export function validateIndexDeclarations(pattern: string, indexes: unknown): void {
  if (indexes === undefined) return;
  if (indexes === null || typeof indexes !== "object" || Array.isArray(indexes)) {
    throw new Error(`Collection "${pattern}": indexes must be an object of index declarations.`);
  }
  for (const [name, declaration] of Object.entries(indexes)) {
    if (name.length === 0 || name.includes(VERSION_SEPARATOR)) {
      throw new Error(
        `Collection "${pattern}": index name ${JSON.stringify(name)} must be non-empty and must not contain "${VERSION_SEPARATOR}".`
      );
    }
    if (typeof declaration === "function") continue;
    const shaped = declaration as { version?: unknown; value?: unknown } | null;
    if (shaped === null || typeof shaped !== "object" || typeof shaped.value !== "function") {
      throw new Error(
        `Collection "${pattern}": index "${name}" must be a function or { version, value } with a value function.`
      );
    }
    if (typeof shaped.version !== "number" || !Number.isInteger(shaped.version) || shaped.version < 1) {
      throw new Error(
        `Collection "${pattern}": index "${name}" version must be a positive integer (got ${JSON.stringify(shaped.version)}).`
      );
    }
  }
}

/** The indexes a collection declares, normalised, in declaration order. */
export function declaredIndexes(config: { indexes?: Record<string, unknown> }): DeclaredResourceIndex[] {
  const out: DeclaredResourceIndex[] = [];
  for (const [name, declaration] of Object.entries(config.indexes ?? {})) {
    const { version, value } =
      typeof declaration === "function"
        ? { version: 1, value: declaration as ResourceIndexFunction }
        : (declaration as { version: number; value: ResourceIndexFunction });
    out.push({ name, version, stored: storedIndexName(name, version), value });
  }
  return out;
}

/**
 * The canonical string of one index value, or `undefined` when it indexes
 * nothing (`null`, `undefined`, a non-finite number). Types stay apart: `1`,
 * `"1"` and `true` give three strings. Throws on anything else.
 */
export function canonicalIndexValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    // JSON writes -0 as "0", so the two are one value.
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  throw new Error(
    `An index value must be a string, number or boolean, or an array of them (got ${describe(value)}).`
  );
}

/**
 * The canonical strings an index function's result gives: one per distinct
 * value, in first-seen order. Empty when the row has no value for the index.
 */
export function canonicalIndexValues(result: unknown): string[] {
  const values = Array.isArray(result) ? result : [result];
  const out: string[] = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      throw new Error(
        "An index value must be a string, number or boolean, or an array of them (got a nested array)."
      );
    }
    const canonical = canonicalIndexValue(value);
    if (canonical !== undefined && !out.includes(canonical)) out.push(canonical);
  }
  return out;
}

function describe(value: unknown): string {
  return Array.isArray(value) ? "an array" : typeof value === "object" ? "an object" : typeof value;
}
