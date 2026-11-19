/**
 * The static prefix of a resource collection pattern, and the bare topic a
 * storage key leaves under it. They live here so browser packages can
 * value-import them (a live panel matching a change notice's path to its
 * collection, or naming an entry a notice brought in);
 * `@flow-state-dev/core/types` re-exports both beside the other pattern
 * helpers in `collection-patterns.ts`.
 */

/**
 * Get the static prefix of a pattern (everything before the first wildcard or param).
 */
export function getPatternPrefix(pattern: string): string {
  const segments = pattern.split("/");
  const prefixSegments: string[] = [];

  for (const seg of segments) {
    if (seg === "*" || seg === "**" || /\[.+\]/.test(seg)) {
      break;
    }
    prefixSegments.push(seg);
  }

  return prefixSegments.join("/");
}

/**
 * Strip the static pattern prefix from a full storage key, leaving the
 * "bare topic" — the identifying portion a collection author addresses items
 * by. Returns the full key unchanged when the prefix doesn't match (defensive
 * against caller mismatches).
 *
 * The inverse of `resolveCollectionKey` for wildcard patterns:
 * `extractBareTopic("positions/*", "positions/AAPL")` → `"AAPL"`.
 */
export function extractBareTopic(pattern: string, fullKey: string): string {
  const prefix = getPatternPrefix(pattern);
  if (prefix.length === 0) return fullKey;
  if (fullKey === prefix) return "";
  const sep = prefix + "/";
  if (fullKey.startsWith(sep)) return fullKey.slice(sep.length);
  return fullKey;
}
