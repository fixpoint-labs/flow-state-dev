// ---------------------------------------------------------------------------
// Pattern utilities for resource collections.
// Pure functions — no side effects, no dependencies beyond string ops.
// ---------------------------------------------------------------------------

const VALID_PATTERN = /^(?:[a-zA-Z0-9_\-.*[\]]+)(?:\/[a-zA-Z0-9_\-.*[\]]+)*$/;

/**
 * Validate a collection pattern at definition time.
 * Must contain `*`, `**`, or `[param]`. `**` only at end.
 */
export function validatePattern(pattern: string): void {
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new Error("Resource collection pattern must be a non-empty string");
  }

  if (!VALID_PATTERN.test(pattern)) {
    throw new Error(`Invalid resource collection pattern: "${pattern}"`);
  }

  // Must contain at least one wildcard or parameterized segment
  const hasWildcard = pattern.includes("*");
  const hasParam = /\[[a-zA-Z0-9_]+\]/.test(pattern);
  if (!hasWildcard && !hasParam) {
    throw new Error(
      `Resource collection pattern must contain *, **, or [param]: "${pattern}"`
    );
  }

  // Check that wildcards are used correctly
  const segments = pattern.split("/");
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg === "**" && i !== segments.length - 1) {
      throw new Error(`"**" globstar must be the last segment in pattern: "${pattern}"`);
    }
  }
}

/**
 * Extract parameter names from a pattern like `[topic]/observations`.
 */
export function extractPatternParams(pattern: string): string[] {
  const params: string[] = [];
  const paramRegex = /\[([a-zA-Z0-9_]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = paramRegex.exec(pattern)) !== null) {
    params.push(match[1]!);
  }
  return params;
}

/**
 * Check whether a pattern uses parameterized segments.
 */
export function isParameterizedPattern(pattern: string): boolean {
  return /\[[a-zA-Z0-9_]+\]/.test(pattern);
}

/**
 * Check whether a pattern uses deep wildcard.
 */
export function isDeepWildcard(pattern: string): boolean {
  return pattern.endsWith("/**");
}

/**
 * Check whether a pattern uses single-level wildcard.
 */
export function isSingleWildcard(pattern: string): boolean {
  return pattern.includes("*") && !pattern.includes("**");
}

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
 * The inverse of {@link resolveCollectionKey} for wildcard patterns:
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

/**
 * Check if a storage key matches a collection pattern.
 */
export function matchesPattern(pattern: string, storageKey: string): boolean {
  if (isParameterizedPattern(pattern)) {
    return matchesParameterizedPattern(pattern, storageKey);
  }

  const prefix = getPatternPrefix(pattern);

  if (isDeepWildcard(pattern)) {
    // `files/**` matches `files/anything/at/any/depth`
    return storageKey.startsWith(prefix + "/") && storageKey.length > prefix.length + 1;
  }

  if (isSingleWildcard(pattern)) {
    // `files/*` matches `files/something` but not `files/a/b`
    if (!storageKey.startsWith(prefix + "/")) return false;
    const rest = storageKey.slice(prefix.length + 1);
    return rest.length > 0 && !rest.includes("/");
  }

  return false;
}

function matchesParameterizedPattern(pattern: string, storageKey: string): boolean {
  // Convert pattern to regex: `[topic]/observations` → `^[^/]+/observations$`
  const regexStr = pattern
    .split("/")
    .map((seg) => {
      if (/^\[.+\]$/.test(seg)) return "[^/]+";
      return escapeRegex(seg);
    })
    .join("/");

  return new RegExp(`^${regexStr}$`).test(storageKey);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The org roster's browser collection. One segment, so a nested
 * `workforce/roster/~user/seat` key never matches it.
 */
export const HIRED_ROSTER_BROWSER_PATTERN = "workforce/roster/*";

/**
 * Server-side writer for a user-owned roster row. Two segments, no browser
 * read. The only multi-segment pattern admitted under `workforce/roster/`.
 */
export const HIRED_ROSTER_PRIVATE_PATTERN = "workforce/roster/[owner]/[seat]";

/** A key the browser roster must not list, and a deep glob must not be able to. */
const PRIVATE_ROSTER_PROBE = "workforce/roster/~alice/research";

/**
 * Whether `pattern` can address a user-owned roster row.
 *
 * A bare `**` is included: the single-segment matcher does not treat it as
 * a deep glob, and it would still be a collection over every key.
 */
export function patternReadsPrivateRoster(pattern: string): boolean {
  if (pattern === "**") return true;
  return matchesPattern(pattern, PRIVATE_ROSTER_PROBE);
}

/**
 * Refuse a collection that can read user-owned roster rows on the server.
 *
 * The private sub-prefix hides those rows from the browser collection only.
 * A `workforce/roster/**` (or any other deep pattern that reaches the same
 * keys) would hand them back to every flow in the org. The browser pattern
 * and the one server-side writer, with no browser read, are the exceptions.
 */
export function assertRosterCollectionIsNotDeep(config: {
  pattern: string;
  client?: { state?: { read?: boolean } };
}): void {
  const { pattern } = config;
  if (pattern === HIRED_ROSTER_BROWSER_PATTERN) return;
  if (pattern === HIRED_ROSTER_PRIVATE_PATTERN) {
    if (config.client?.state?.read === true) {
      throw new Error(
        `Collection pattern "${pattern}" must not enable a browser read. ` +
          `User-owned roster rows stay off the browser collection.`
      );
    }
    return;
  }
  if (!patternReadsPrivateRoster(pattern)) return;
  throw new Error(
    `Collection pattern "${pattern}" can read user-owned roster rows on the server. ` +
      `Declare "${HIRED_ROSTER_BROWSER_PATTERN}" for the org roster. ` +
      `A deep pattern such as "workforce/roster/**" is refused.`
  );
}

/**
 * Resolve a key (string or param object) into a storage path for a given pattern.
 *
 * - For wildcard patterns (`files/*`, `files/**`): key is a string appended to the prefix.
 * - For parameterized patterns (`[topic]/observations`): key is an object like `{ topic: 'react' }`.
 */
export function resolveCollectionKey(
  pattern: string,
  key: string | Record<string, string>
): string {
  if (typeof key === "string") {
    if (isParameterizedPattern(pattern)) {
      throw new Error(
        `Pattern "${pattern}" requires an object key with parameters, not a string`
      );
    }
    // Wildcard pattern: prefix + key
    const prefix = getPatternPrefix(pattern);
    const normalizedKey = normalizeResourcePath(key);
    return prefix.length > 0 ? `${prefix}/${normalizedKey}` : normalizedKey;
  }

  // Parameterized pattern: substitute params
  const params = extractPatternParams(pattern);
  if (params.length === 0) {
    throw new Error(`Pattern "${pattern}" has no parameters but received an object key`);
  }

  let resolved = pattern;
  for (const param of params) {
    const value = key[param];
    if (value === undefined) {
      throw new Error(`Missing parameter "${param}" for pattern "${pattern}"`);
    }
    validatePathSegment(value);
    resolved = resolved.replace(`[${param}]`, value);
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Key validation & normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a resource path:
 * - Replace backslashes with forward slashes
 * - Strip leading/trailing slashes
 * - Collapse consecutive slashes
 * - Reject path traversal (`..`)
 * - Reject null bytes and control characters
 */
export function normalizeResourcePath(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("Resource key must be a non-empty string");
  }

  // Reject null bytes and control characters
  if (/[\x00-\x1f]/.test(raw)) {
    throw new Error("Resource key must not contain null bytes or control characters");
  }

  // Normalize separators
  let path = raw.replace(/\\/g, "/");

  // Strip leading/trailing slashes
  path = path.replace(/^\/+|\/+$/g, "");

  if (path.length === 0) {
    throw new Error("Resource key resolves to empty after normalization");
  }

  // Reject path traversal
  const segments = path.split("/");
  for (const seg of segments) {
    if (seg === "..") {
      throw new Error("Resource key must not contain path traversal (..)");
    }
  }

  // Collapse consecutive slashes
  path = segments.filter((s) => s.length > 0).join("/");

  return path;
}

function validatePathSegment(segment: string): void {
  if (/[\x00-\x1f]/.test(segment)) {
    throw new Error("Path segment must not contain control characters");
  }
  if (segment.includes("/") || segment.includes("\\")) {
    throw new Error("Path segment must not contain separators");
  }
  if (segment === "..") {
    throw new Error("Path segment must not be '..'");
  }
}
