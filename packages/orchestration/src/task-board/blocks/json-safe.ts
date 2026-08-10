/**
 * Recursive JSON-value validation for a detached payload (FIX-982 P3a §7.5).
 *
 * A detached worker's input crosses a process boundary and a durable store, so
 * it has to be a JSON value. The obvious check is not one:
 * `JSON.parse(JSON.stringify(v))` throws on exactly two things — `BigInt` and a
 * cycle — and silently *mangles* the rest. A `Date` becomes a string, a `Map`,
 * `Set` or class instance becomes `{}`, a function or `undefined` in object
 * position disappears, and a `symbol` disappears with it. Each of those reaches
 * the worker as a value that is the wrong shape but not obviously wrong, which
 * is the failure this validation exists to make loud.
 *
 * So this walks the value and rejects anything that is not a plain JSON shape,
 * naming the path where it found it — the path is the whole point, since the
 * offending value is usually several levels inside a dependency's output that
 * some other worker authored.
 */

/** What a JSON round-trip preserves exactly. */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * A plain object — one whose prototype is `Object.prototype` or `null`.
 *
 * Class instances are rejected on this test rather than on their contents: an
 * instance serializes to a bare property bag, so its methods and its identity
 * are gone on the other side while its data survives, which reads as success.
 */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Human-readable path into the value, for the refusal message. */
function joinPath(path: readonly string[]): string {
  return path.length === 0 ? "<root>" : path.join("");
}

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "function") return "a function";
  if (typeof value === "symbol") return "a symbol";
  if (typeof value === "bigint") return "a BigInt";
  if (typeof value === "number") return Number.isNaN(value) ? "NaN" : `${value}`;
  if (value instanceof Date) return "a Date (it would arrive as a string)";
  if (value instanceof Map) return "a Map (it would arrive as {})";
  if (value instanceof Set) return "a Set (it would arrive as {})";
  const name = value?.constructor?.name;
  return name !== undefined && name !== "Object"
    ? `a ${name} instance (it would arrive as a plain object, without its methods)`
    : "a non-JSON value";
}

/**
 * Throw unless `value` is a JSON value all the way down.
 *
 * @param value The materialized payload to check.
 * @param options.label Prefix for the thrown message, naming the caller's context.
 * @throws {Error} naming the path and what was found there.
 */
export function assertJsonSafe(
  value: unknown,
  options: { label: string }
): asserts value is JsonValue {
  // Tracks the objects on the CURRENT path, not every object seen. A value that
  // legitimately appears twice in two branches is fine — it round-trips as two
  // copies — while one that contains itself does not terminate.
  const onPath = new Set<object>();

  // A single mutable path, pushed and popped as the walk descends. The obvious
  // `[...path, segment]` at each node allocates a fresh array per node and is
  // quadratic in depth; a detached payload carrying a deep dependency graph is
  // exactly where that would be paid.
  const path: string[] = [];

  const walk = (node: unknown): void => {
    if (node === null) return;

    const type = typeof node;
    if (type === "boolean" || type === "string") return;
    if (type === "number") {
      // `NaN` and the infinities serialize to `null`, which is a silent value
      // change rather than a failure — exactly the class this rejects.
      if (!Number.isFinite(node as number)) {
        throw new Error(
          `${options.label} is not JSON-safe: ${joinPath(path)} is ${describe(node)}, which ` +
            `serializes to null.`
        );
      }
      return;
    }

    if (type !== "object") {
      throw new Error(
        `${options.label} is not JSON-safe: ${joinPath(path)} is ${describe(node)}.`
      );
    }

    const obj = node as object;
    // A symbol-keyed property is invisible to `Object.entries` AND to
    // `JSON.stringify` — so `{ [Symbol("token")]: "x" }` arrives as `{}` with
    // nothing anywhere saying a property was dropped. Checked on every object,
    // arrays included.
    const symbols = Object.getOwnPropertySymbols(obj);
    if (symbols.length > 0) {
      throw new Error(
        `${options.label} is not JSON-safe: ${joinPath(path)} has symbol-keyed ` +
          `${symbols.length === 1 ? "property" : "properties"} ` +
          `(${symbols.map((s) => s.toString()).join(", ")}), which are dropped entirely.`
      );
    }

    if (onPath.has(obj)) {
      throw new Error(
        `${options.label} is not JSON-safe: ${joinPath(path)} contains itself, so it cannot be ` +
          `serialized.`
      );
    }
    onPath.add(obj);

    if (Array.isArray(node)) {
      // Indexed rather than `forEach`, which SKIPS holes. A sparse array's hole
      // is not absent on the other side — `JSON.stringify` writes it as `null`,
      // so `[ , 2]` arrives as `[null, 2]`. That is a silent change to the
      // worker's input, which is the whole class this gate rejects, and
      // `forEach` would have walked straight past it.
      for (let index = 0; index < node.length; index += 1) {
        path.push(`[${index}]`);
        if (!Object.prototype.hasOwnProperty.call(node, index)) {
          throw new Error(
            `${options.label} is not JSON-safe: ${joinPath(path)} is a hole in a sparse array, ` +
              `which serializes to null. Fill it, or use a shorter array.`
          );
        }
        walk(node[index]);
        path.pop();
      }
      // An array's own string-keyed properties beyond its indices are dropped
      // the same way a symbol key is: `const a = [1]; a.total = 1` serializes to
      // `[1]`, and the index loop above would never look at `total`.
      const extras = Object.keys(node).filter(
        (key) => !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= node.length
      );
      if (extras.length > 0) {
        throw new Error(
          `${options.label} is not JSON-safe: ${joinPath(path)} is an array carrying ` +
            `non-index ${extras.length === 1 ? "property" : "properties"} ` +
            `(${extras.join(", ")}), which are dropped entirely. Use an object instead.`
        );
      }
      onPath.delete(obj);
      return;
    }

    if (!isPlainObject(obj)) {
      throw new Error(
        `${options.label} is not JSON-safe: ${joinPath(path)} is ${describe(node)}.`
      );
    }

    for (const [key, entry] of Object.entries(obj)) {
      // `undefined` in object position is dropped by `JSON.stringify`, so the
      // key silently vanishes rather than arriving empty.
      path.push(`.${key}`);
      if (entry === undefined) {
        throw new Error(
          `${options.label} is not JSON-safe: ${joinPath(path)} is undefined, ` +
            `so the key would be dropped entirely. Omit it, or use null.`
        );
      }
      walk(entry);
      path.pop();
    }
    onPath.delete(obj);
  };

  walk(value);
}
