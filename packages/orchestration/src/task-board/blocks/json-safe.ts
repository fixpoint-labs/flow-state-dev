/**
 * Recursive JSON-value validation for a dispatched payload (FIX-982 P3a §7.5).
 *
 * A handed-off worker's input crosses a process boundary and a durable store, so
 * it has to be a JSON value. The obvious check is not one:
 * `JSON.parse(JSON.stringify(v))` throws on exactly two things — `BigInt` and a
 * cycle — and silently *mangles* the rest. A `Date` becomes a string, a `Map`,
 * `Set` or class instance becomes `{}`, a null-prototype object comes back an
 * ordinary one, a function or `undefined` in object position disappears, and a
 * `symbol` disappears with it. Each of those reaches the worker as a value that
 * is the wrong shape but not obviously wrong, which is the failure this
 * validation exists to make loud.
 *
 * So this walks the value and rejects anything that is not a plain JSON shape,
 * naming the path where it found it — the path is the whole point, since the
 * offending value is usually several levels inside a dependency's output that
 * some other worker authored.
 */

/** What a JSON round-trip preserves exactly. */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * A plain object — one whose prototype is `Object.prototype`, and nothing else.
 *
 * Class instances are rejected on this test rather than on their contents: an
 * instance serializes to a bare property bag, so its methods and its identity
 * are gone on the other side while its data survives, which reads as success.
 *
 * **A null prototype is not plain either**, and admitting it was the same defect
 * facing the other way — the data survived and the prototype did not. It is
 * refused above with a message of its own, because "not a plain object" would
 * describe it accurately and tell its author nothing.
 */
function isPlainObject(value: object): boolean {
  return Object.getPrototypeOf(value) === Object.prototype;
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
  // quadratic in depth; a dispatched payload carrying a deep dependency graph is
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
      // `-0` serializes to `0`, and the difference is observable on the other
      // side with `Object.is`. Marginal, but it is the same silent-change class
      // as the rest, and a gate that admits one exception invites the next.
      if (Object.is(node, -0)) {
        throw new Error(
          `${options.label} is not JSON-safe: ${joinPath(path)} is -0, which serializes to 0. ` +
            `Use 0 if the sign does not matter.`
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

    // The other two ways a property escapes the walk below, which reads
    // `Object.entries` — own, enumerable, string-keyed, and read once:
    //
    // - a NON-ENUMERABLE property (`Object.defineProperty(o, "token", { value:
    //   "x" })`) is skipped by `Object.entries` AND by `JSON.stringify`. It is
    //   the symbol-key case in a different spelling: dropped entirely, with
    //   nothing on either side saying a property was there.
    // - an ACCESSOR is read here and read AGAIN by `JSON.stringify`, and
    //   nothing makes the two reads agree. A getter that counts, or that
    //   returns a `Date` on its second call, ships a payload this gate never
    //   saw — so what was validated is not what crosses.
    //
    // Two more are checked here that are not about a property escaping the walk
    // at all, but about its ATTRIBUTES not surviving. `JSON.parse` rebuilds
    // every property as an ordinary one, so a NON-WRITABLE or NON-CONFIGURABLE
    // property arrives writable and configurable: the value crosses, the
    // guarantee does not, and a payload that could not be modified before it was
    // sent can be after. That is the same silent change as the branches above,
    // one level down from the value — and no exception is made on the argument
    // that a guarantee matters less than a value, because a gate that admits one
    // exception invites the next.
    //
    // Checked on every object for the reason the symbol check is, arrays
    // included: an array's own non-index property is dropped whether or not it
    // is enumerable, and the extras check below sees only the enumerable ones.
    // An array's indices are properties too, so `Object.freeze([1, 2])` is
    // caught here rather than sliding past on `Array.isArray`. An array's
    // `length` is non-enumerable and non-configurable by specification rather
    // than by anyone's declaration, which is the one exemption.
    const descriptors = Object.getOwnPropertyDescriptors(obj);
    for (const key of Object.keys(descriptors)) {
      if (key === "length" && Array.isArray(node)) continue;
      const descriptor = descriptors[key]!;
      if (descriptor.get !== undefined || descriptor.set !== undefined) {
        throw new Error(
          `${options.label} is not JSON-safe: ${joinPath(path)}.${key} is an accessor property. ` +
            `Serialization reads it a second time, so the value that crosses need not be the one ` +
            `checked here. Assign a plain value instead.`
        );
      }
      if (!descriptor.enumerable) {
        throw new Error(
          `${options.label} is not JSON-safe: ${joinPath(path)}.${key} is a non-enumerable ` +
            `property, which is dropped entirely. Make it enumerable, or omit it.`
        );
      }
      if (descriptor.writable === false) {
        throw new Error(
          `${options.label} is not JSON-safe: ${joinPath(path)}.${key} is a non-writable ` +
            `property, and arrives writable. The value crosses and the guarantee does not, with ` +
            `nothing on either side saying so. Send it as an ordinary property, and re-freeze on ` +
            `the far side if the worker needs it read-only.`
        );
      }
      if (!descriptor.configurable) {
        throw new Error(
          `${options.label} is not JSON-safe: ${joinPath(path)}.${key} is a non-configurable ` +
            `property, and arrives configurable — redefinable and deletable where the one that ` +
            `was sent was neither. Send it as an ordinary property.`
        );
      }
    }

    // A null prototype survives nothing. `JSON.stringify` writes the data and
    // `JSON.parse` rebuilds an ORDINARY object, so what arrives has
    // `Object.prototype`: `hasOwnProperty` goes from `undefined` to a function,
    // `toString` appears, and a lookup that could never reach an inherited key
    // now can. That is the class-instance case in reverse — the data crosses and
    // the identity does not — and `Object.create(null)` is a real idiom for a
    // dictionary, so this is reachable rather than exotic.
    //
    // REFUSED rather than normalized, deliberately. This gate's whole contract
    // is to refuse what the round-trip would silently change; normalizing here
    // would make the gate perform one of those changes itself, and it would have
    // to do it by mutating the caller's payload — `assertJsonSafe` asserts, it
    // does not transform, and every other branch here refuses rather than
    // repairs. The author's fix is one spread, which is what makes refusing
    // cheap.
    //
    // Ahead of the array branch so a null-prototype array is caught too, rather
    // than slipping through on `Array.isArray`.
    if (Object.getPrototypeOf(obj) === null) {
      throw new Error(
        `${options.label} is not JSON-safe: ${joinPath(path)} has a null prototype, and arrives ` +
          `with Object.prototype instead — so \`hasOwnProperty\`, \`toString\` and every other ` +
          `inherited member differ on the other side. Spread it into a plain object ` +
          `({ ...value }) before sending.`
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
      // An array's own ENUMERABLE string-keyed properties beyond its indices
      // are dropped the same way a symbol key is: `const a = [1]; a.total = 1`
      // serializes to `[1]`, and the index loop above would never look at
      // `total`. A non-enumerable one is dropped too and was already refused by
      // the descriptor pass, which is why this reads `Object.keys` and needs
      // no widening.
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
