/**
 * An empty map with no prototype, for every place a key is a name somebody
 * else chose — a document's ref, a module's ref, a frontmatter key.
 *
 * On an ordinary object, `map["__proto__"] = value` reaches the legacy
 * prototype setter instead of creating a property: with an object value it
 * REPLACES the map's prototype, so the entry never appears in `Object.keys`,
 * never survives a spread, and the thing it named disappears without a word.
 * The engine's own resource registries are null-prototype for exactly this
 * reason (`createExecutionContext`), and nothing the convention builds needs
 * `Object.prototype`.
 *
 * One copy, shared by both install halves. The reason is subtle enough that a
 * second copy is how one of them loses it.
 */

/** A `Record<string, T>` with a null prototype. See the module header. */
export function emptyMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}
