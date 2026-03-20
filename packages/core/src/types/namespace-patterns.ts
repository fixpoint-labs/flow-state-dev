// ---------------------------------------------------------------------------
// Pattern utilities for resource namespaces.
// Pure functions — no side effects, no dependencies beyond string ops.
// ---------------------------------------------------------------------------

const VALID_PATTERN = /^(?:[a-zA-Z0-9_\-.*[\]]+)(?:\/[a-zA-Z0-9_\-.*[\]]+)*$/;

/**
 * Validate a namespace pattern at definition time.
 * Must contain `*`, `**`, or `[param]`. `**` only at end.
 */
export function validatePattern(pattern: string): void {
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new Error("Resource namespace pattern must be a non-empty string");
  }

  if (!VALID_PATTERN.test(pattern)) {
    throw new Error(`Invalid resource namespace pattern: "${pattern}"`);
  }

  // Must contain at least one wildcard or parameterized segment
  const hasWildcard = pattern.includes("*");
  const hasParam = /\[[a-zA-Z0-9_]+\]/.test(pattern);
  if (!hasWildcard && !hasParam) {
    throw new Error(
      `Resource namespace pattern must contain *, **, or [param]: "${pattern}"`
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
 * Check if a storage key matches a namespace pattern.
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
 * Resolve a key (string or param object) into a storage path for a given pattern.
 *
 * - For wildcard patterns (`files/*`, `files/**`): key is a string appended to the prefix.
 * - For parameterized patterns (`[topic]/observations`): key is an object like `{ topic: 'react' }`.
 */
export function resolveNamespaceKey(
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
