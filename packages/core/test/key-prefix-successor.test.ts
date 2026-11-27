/**
 * `keyPrefixSuccessor` is the upper bound every SQL store's prefix read
 * stops at. If it is too low the read drops rows under the prefix; if it is
 * too high the read returns rows from the next collection. Both are checked
 * against a plain `startsWith` over keys sorted in code-point order, the
 * order Postgres `COLLATE "C"` and SQLite `BINARY` compare UTF-8 in.
 */
import { describe, expect, it } from "vitest";
import { keyPrefixSuccessor } from "../src/helpers";

/** Code-point order, as a byte-order compare of UTF-8 sees it. */
function codePointCompare(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0) as number);
  const y = Array.from(b, (c) => c.codePointAt(0) as number);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
  }
  return x.length - y.length;
}

/** The keys the range `[prefix, successor)` selects, as a store reads them. */
function inRange(keys: string[], prefix: string): string[] {
  const upper = keyPrefixSuccessor(prefix);
  return keys.filter(
    (k) => codePointCompare(k, prefix) >= 0 && (upper === null || codePointCompare(k, upper) < 0)
  );
}

const KEYS = [
  "",
  "a",
  "docs",
  "docs/",
  "docs/one",
  "docs/two/three",
  "docs0",
  "docs.",
  "docr",
  "50%_off",
  "5000_off",
  "50%",
  "café/menu",
  "café/zz",
  "cafë",
  "z\u{10FFFF}",
  "z\u{10FFFF}a",
  "z\u{10FFFF}\u{10FFFF}",
  "{",
  "\u{D7FF}x",
  "\u{E000}",
  "😀/a",
  "😁"
];

describe("keyPrefixSuccessor", () => {
  it("has no upper bound for an empty prefix, so every key matches", () => {
    expect(keyPrefixSuccessor("")).toBeNull();
    expect(inRange(KEYS, "")).toEqual(KEYS);
  });

  it("increments the last code point", () => {
    expect(keyPrefixSuccessor("docs/")).toBe("docs0");
    expect(keyPrefixSuccessor("café")).toBe("cafê");
    expect(keyPrefixSuccessor("😀")).toBe("😁");
  });

  it("drops a trailing highest code point and increments the one before it", () => {
    expect(keyPrefixSuccessor("z\u{10FFFF}")).toBe("{");
    expect(keyPrefixSuccessor("\u{10FFFF}\u{10FFFF}")).toBeNull();
  });

  it("steps over the surrogate block, which no text can hold", () => {
    expect(keyPrefixSuccessor("\u{D7FF}")).toBe("\u{E000}");
  });

  it.each([
    "docs",
    "docs/",
    "50%_",
    "50%",
    "café/",
    "caf",
    "z\u{10FFFF}",
    "\u{D7FF}",
    "😀",
    "😀/"
  ])("selects exactly the keys that start with %j", (prefix) => {
    expect(inRange(KEYS, prefix)).toEqual(KEYS.filter((k) => k.startsWith(prefix)));
  });
});
