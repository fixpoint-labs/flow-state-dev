/**
 * Topic Matching
 *
 * Glob-style pattern matching for eventActors topic routing. Patterns
 * match against entry keys in `${type}:${topic}` format.
 *
 * Syntax:
 * - `*` matches a single segment (between `:` or `.` delimiters)
 * - `**` matches any number of segments (including zero)
 * - Literal characters match themselves
 *
 * Examples:
 *   matchTopic("observation:*", "observation:slack")          → true
 *   matchTopic("observation:slack.*", "observation:slack.msg") → true
 *   matchTopic("observation:**", "observation:a.b.c")         → true
 *   matchTopic("*:slack", "event:slack")                      → true
 */

const patternCache = new Map<string, RegExp>();

/**
 * Compiles a glob pattern into a RegExp. Results are cached for repeated use.
 */
export function compilePattern(pattern: string): RegExp {
  const cached = patternCache.get(pattern);
  if (cached) return cached;

  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      regex += ".*";
      i += 2;
    } else if (pattern[i] === "*") {
      regex += "[^:.]*";
      i += 1;
    } else if (".+^${}()|[]\\".includes(pattern[i])) {
      regex += "\\" + pattern[i];
      i += 1;
    } else {
      regex += pattern[i];
      i += 1;
    }
  }

  const compiled = new RegExp(`^${regex}$`);
  patternCache.set(pattern, compiled);
  return compiled;
}

/** Tests whether a topic key matches a glob pattern. */
export function matchTopic(pattern: string, topicKey: string): boolean {
  return compilePattern(pattern).test(topicKey);
}
