/**
 * The static prefix of a resource collection pattern. Lives here so browser
 * packages can value-import it (a live panel matching a change notice's path
 * to its collection); `@flow-state-dev/core/types` re-exports it beside the
 * other pattern helpers in `collection-patterns.ts`.
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
