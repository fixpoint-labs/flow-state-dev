/**
 * Null-prototype records for maps keyed by resource accessors and storage keys.
 *
 * Accessor names are author-supplied and unrestricted, and a storage key is an
 * accessor or a `ref`. On a plain `{}` a key that collides with an
 * `Object.prototype` member breaks the map both ways: writing `__proto__` goes
 * through the inherited setter and creates no own entry, and reading
 * `toString` / `constructor` / … returns the inherited function, so `key in map`
 * and `map[key] ?? fallback` answer for a key nobody stored. Nothing that reads
 * these maps needs `Object.prototype`, so they carry none (FIX-1254; the same
 * call FIX-1158 made for the storage-key and handle maps).
 */

/** An empty record with no prototype, safe for any string key. */
export function ownKeyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/**
 * Merge `sources` into a fresh null-prototype record, later sources winning —
 * the own-key equivalent of `{ ...a, ...b }`. Assigning onto a target without
 * a prototype has no inherited `__proto__` setter to hit, so every key lands
 * as an own entry.
 */
export function mergeOwnKeyRecords<T>(
  ...sources: ReadonlyArray<Readonly<Record<string, T>>>
): Record<string, T> {
  return Object.assign(ownKeyRecord<T>(), ...sources);
}
