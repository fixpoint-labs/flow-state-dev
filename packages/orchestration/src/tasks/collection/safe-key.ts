/**
 * Guards for strings that become object-property keys at runtime — task
 * board capability accessor keys (`ctx.cap.<name>`) and durable-collection
 * ids (which form a resource pattern and a `ctx.resources.<key>` lookup).
 *
 * A board name flows verbatim into `ctx.cap[<name>]`. Because that object is
 * a plain record, a name like `__proto__` or `toString` would either shadow a
 * prototype member or corrupt the prototype chain. These guards reject such
 * names at construction time — the layer that owns the key — so the failure is
 * an obvious throw rather than silent corruption at access time.
 */

/** Keys that are dangerous even though some are not enumerable on the prototype. */
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * True when `key` is safe to use as a plain-object property key: non-empty and
 * not a member of `Object.prototype` (`toString`, `hasOwnProperty`, …) nor one
 * of the prototype-poisoning names.
 */
function isSafeAccessorKey(key: string): boolean {
  if (key.length === 0) return false;
  if (UNSAFE_KEYS.has(key)) return false;
  // `key in Object.prototype` catches `toString`, `valueOf`, `hasOwnProperty`,
  // `__proto__` (an accessor on Object.prototype), etc.
  if (key in Object.prototype) return false;
  return true;
}

/** Throw if `name` is not a safe capability accessor key. */
export function assertSafeCapabilityKey(name: string): void {
  if (!isSafeAccessorKey(name)) {
    throw new Error(
      `[task-board] capability name "${name}" is not a safe accessor key — ` +
        `it collides with a JavaScript object prototype member (e.g. __proto__, ` +
        `constructor, toString). Rename the board.`
    );
  }
}

/**
 * Throw if `id` is not a valid `defineTaskCollection` id. The id becomes the
 * resource pattern (`<id>/*`), the `ctx.resources` lookup key, and the board's
 * `collectionId`, so it must be a plain single literal segment — no pattern
 * tokens, no path separators, no prototype-poisoning names.
 */
export function assertSafeCollectionId(id: string): void {
  if (id.length === 0) {
    throw new Error(`[tasks] defineTaskCollection id must be a non-empty string`);
  }
  if (/[*/[\]]/.test(id)) {
    throw new Error(
      `[tasks] defineTaskCollection id "${id}" must be a plain literal — no ` +
        `pattern tokens ("*", "[", "]") or path separators ("/")`
    );
  }
  if (!isSafeAccessorKey(id)) {
    throw new Error(
      `[tasks] defineTaskCollection id "${id}" collides with a JavaScript object ` +
        `prototype member (e.g. __proto__, constructor, toString)`
    );
  }
}
