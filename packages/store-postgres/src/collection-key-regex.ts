/**
 * A collection pattern as a Postgres regular expression over resource keys.
 *
 * The resource state store clears an index's build marker when a write lands
 * on a key the index's collection covers but does not list (see
 * `ResourceStateIndexes`). Doing that inside the write's own statement needs
 * the pattern test in SQL, so a marker carries its pattern as a regex.
 *
 * It must answer exactly as core's `matchesPattern` does, and is tested
 * against it. Only ASCII regex metacharacters are escaped, with a backslash:
 * in a Postgres advanced regular expression a backslash before a
 * non-alphanumeric character stands for that character, and `.` matches a
 * newline, as `matchesPattern`'s `startsWith` test does.
 */
import { getPatternPrefix, isParameterizedPattern } from "@flow-state-dev/core/types";

/**
 * The regex that matches the keys `pattern` covers, or `null` when it covers
 * none (a pattern with no wildcard and no parameter, which `matchesPattern`
 * matches against nothing).
 */
export function collectionKeyRegex(pattern: string): string | null {
  if (isParameterizedPattern(pattern)) {
    const segments = pattern
      .split("/")
      .map((segment) => (/^\[.+\]$/.test(segment) ? "[^/]+" : escapeRegex(segment)));
    return `^${segments.join("/")}$`;
  }
  const prefix = escapeRegex(getPatternPrefix(pattern));
  // The wildcard tests are core's `isDeepWildcard` / `isSingleWildcard`.
  if (pattern.endsWith("/**")) return `^${prefix}/.+$`;
  if (pattern.includes("*") && !pattern.includes("**")) return `^${prefix}/[^/]+$`;
  return null;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
