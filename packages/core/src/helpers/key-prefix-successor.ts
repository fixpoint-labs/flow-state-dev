/**
 * The upper bound of a key-prefix range, for a store that answers
 * `getByPrefix` from an index on the key instead of comparing a function of
 * every key in the scope.
 *
 * A prefix read is `key >= prefix AND key < successor`, compared in byte
 * order (Postgres `COLLATE "C"`, SQLite `BINARY`). For UTF-8 text, byte order
 * is code-point order, so the successor is computed on code points: it is
 * the smallest string that sorts after every key starting with the prefix.
 * A range compare has no wildcards, so `%` and `_` in a key stay literal.
 */

/** The highest Unicode code point, which has no successor. */
const MAX_CODE_POINT = 0x10ffff;
/** The last code point before the surrogate block, which no text can hold. */
const BEFORE_SURROGATES = 0xd7ff;
/** The first code point after the surrogate block. */
const AFTER_SURROGATES = 0xe000;

/**
 * The exclusive upper bound of the keys that start with `prefix`, in byte
 * (code-point) order: the prefix with its last code point incremented, after
 * dropping trailing code points that are already the highest.
 *
 * Returns `null` when no upper bound exists: an empty prefix (every key
 * matches), or one made only of U+10FFFF. The caller then reads
 * `key >= prefix` alone.
 */
export function keyPrefixSuccessor(prefix: string): string | null {
  const points = Array.from(prefix, (char) => char.codePointAt(0) as number);
  while (points.length > 0) {
    const last = points.pop() as number;
    if (last === MAX_CODE_POINT) continue;
    return String.fromCodePoint(...points, last === BEFORE_SURROGATES ? AFTER_SURROGATES : last + 1);
  }
  return null;
}
