/**
 * Structural equality used by the framework's state-write no-op guard.
 *
 * State trees are JSON-serializable today, so this comparator deliberately
 * rejects shapes that have no JSON form (Map, Set, RegExp, TypedArray,
 * functions, symbols). A `TypeError` from this helper signals "your state
 * contains something that cannot be persisted" — fail fast rather than
 * silently miscompare.
 *
 * Equality rules:
 *   - Primitives compared by `Object.is` (NaN equals NaN; +0 != -0).
 *   - Plain objects compared by own-key-set equality + recursive value equality.
 *   - Arrays compared element-wise (length plus each index).
 *   - `Date` compared by `getTime()`.
 *   - `null` and `undefined` are distinct.
 *   - Recursion depth is capped at 32 to bound work and surface cycles.
 */

const MAX_DEPTH = 32;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function rejectUnsupported(value: unknown, side: "a" | "b"): void {
  if (value === null || value === undefined) return;
  const t = typeof value;
  if (t === "function" || t === "symbol") {
    throw new TypeError(
      `deepEqual: ${side} contains a ${t}; state must be JSON-shaped.`
    );
  }
  if (t !== "object") return;
  if (Array.isArray(value)) return;
  if (value instanceof Date) return;
  if (
    value instanceof Map ||
    value instanceof Set ||
    value instanceof RegExp ||
    ArrayBuffer.isView(value)
  ) {
    const ctor = (value as { constructor?: { name?: string } }).constructor?.name ?? "object";
    throw new TypeError(
      `deepEqual: ${side} contains a ${ctor}; state must be JSON-shaped.`
    );
  }
  if (!isPlainObject(value)) {
    const ctor = (value as { constructor?: { name?: string } }).constructor?.name ?? "object";
    throw new TypeError(
      `deepEqual: ${side} contains a non-plain object (${ctor}); state must be JSON-shaped.`
    );
  }
}

function eq(a: unknown, b: unknown, depth: number): boolean {
  if (depth > MAX_DEPTH) {
    throw new RangeError(
      `deepEqual: recursion depth exceeded ${MAX_DEPTH}; cycle or pathological nesting.`
    );
  }

  if (Object.is(a, b)) return true;

  // Reject unsupported primitive shapes up front so a later `false` from a
  // type mismatch never silently hides a programmer error like passing a
  // function or symbol where state is expected.
  rejectUnsupported(a, "a");
  rejectUnsupported(b, "b");

  // Different primitive value or null/undefined mismatch
  if (a === null || b === null || a === undefined || b === undefined) {
    return false;
  }
  if (typeof a !== "object" || typeof b !== "object") return false;

  if (a instanceof Date || b instanceof Date) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false;
    return a.getTime() === b.getTime();
  }

  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) return false;
  if (aIsArr && bIsArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!eq(a[i], b[i], depth + 1)) return false;
    }
    return true;
  }

  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const aKeys = Object.keys(aRec);
  const bKeys = Object.keys(bRec);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bRec, key)) return false;
    if (!eq(aRec[key], bRec[key], depth + 1)) return false;
  }
  return true;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return eq(a, b, 0);
}

/**
 * Lenient structural equality for UI-side memoization (e.g. skipping a React
 * re-render when projected data is unchanged).
 *
 * Unlike {@link deepEqual}, this never throws: exotic shapes (Map, Set, Date,
 * functions) compare by `===` / own-key recursion rather than failing fast.
 * It is intentionally permissive because the data it compares is arbitrary
 * client-projected state, not the framework's JSON-shaped persisted state. Use
 * {@link deepEqual} for the state-write no-op guard; use this for "did this
 * render input change?" checks where a false negative only costs a re-render.
 */
export function looseDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => looseDeepEqual(aObj[key], bObj[key]));
}
