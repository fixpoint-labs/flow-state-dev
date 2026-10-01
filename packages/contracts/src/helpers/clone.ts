/**
 * Canonical deep-clone primitive for the framework's state-shape helpers.
 *
 * Sits alongside `deepEqual` and `deepMerge` — the three operate on the same
 * JSON-serializable state trees. Stores clone records on read/write so callers
 * cannot mutate stored state through a retained reference.
 */

/**
 * Returns a structural deep copy of `value`. Uses the platform
 * `structuredClone` when available and falls back to a JSON round-trip
 * otherwise. The fallback only handles JSON-serializable shapes, matching the
 * framework's state-tree contract (no Map, Set, functions, symbols).
 */
export function cloneValue<TValue>(value: TValue): TValue {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value) as TValue;
  }

  return JSON.parse(JSON.stringify(value)) as TValue;
}
