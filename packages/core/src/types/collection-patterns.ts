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
 * read. Admitted only when the object carries {@link HIRED_ROSTER_PRIVATE_BRAND},
 * which `defineHiredRosterPrivateCollection` sets. Any other declaration of
 * this pattern, and any other two-or-more-segment pattern under
 * `workforce/roster/`, is refused.
 */
export const HIRED_ROSTER_PRIVATE_PATTERN = "workforce/roster/[owner]/[seat]";

/**
 * Brand on the workforce-owned private roster writer.
 *
 * Non-enumerable, so copying the config with a spread drops it. Registration
 * admits {@link HIRED_ROSTER_PRIVATE_PATTERN} only while this is set.
 */
export const HIRED_ROSTER_PRIVATE_BRAND: symbol = Symbol.for(
  "@flow-state-dev/hired-roster-private",
);

/** Stamp `collection` as the workforce-owned private roster writer. */
export function markHiredRosterPrivateCollection<T extends object>(collection: T): T {
  Object.defineProperty(collection, HIRED_ROSTER_PRIVATE_BRAND, {
    value: true,
    enumerable: false,
  });
  return collection;
}

/** Whether `value` is the workforce-owned private roster writer. */
export function isHiredRosterPrivateCollection(value: object): boolean {
  return Reflect.get(value, HIRED_ROSTER_PRIVATE_BRAND) === true;
}

const ROSTER_ROOT = "workforce/roster";

/**
 * Whether `pattern` has two or more segments under `workforce/roster/`, or is
 * a deep glob whose prefix can reach that tree.
 *
 * The browser pattern is one segment. The private writer is two, and is not
 * "too deep" here — admission of that one pattern is a separate brand check.
 * A single probe key is not enough: `workforce/roster/[owner]/notes` never
 * matches `workforce/roster/~alice/research` and would still read every user's
 * notes.
 */
export function rosterPatternIsTooDeep(pattern: string): boolean {
  if (pattern === HIRED_ROSTER_BROWSER_PATTERN || pattern === HIRED_ROSTER_PRIVATE_PATTERN) {
    return false;
  }
  if (pattern.includes("**")) {
    const star = pattern.indexOf("**");
    const prefix = pattern.slice(0, star).replace(/\/$/, "");
    return (
      prefix.length === 0 ||
      ROSTER_ROOT.startsWith(prefix) ||
      prefix.startsWith(ROSTER_ROOT)
    );
  }
  if (pattern !== ROSTER_ROOT && !pattern.startsWith(`${ROSTER_ROOT}/`)) return false;
  const rest = pattern.startsWith(`${ROSTER_ROOT}/`)
    ? pattern.slice(ROSTER_ROOT.length + 1)
    : "";
  const segments = rest.split("/").filter((segment) => segment.length > 0);
  return segments.length >= 2;
}

/**
 * Whether `pattern` can address a user-owned roster row on the server.
 *
 * True for the private writer, for any deeper pattern under the roster, and
 * for a deep glob that reaches it. The browser pattern is one segment and is
 * not included.
 */
export function patternReadsPrivateRoster(pattern: string): boolean {
  if (pattern === HIRED_ROSTER_PRIVATE_PATTERN) return true;
  return rosterPatternIsTooDeep(pattern);
}

/**
 * Refuse a collection that can read user-owned roster rows on the server.
 *
 * At definition, the private writer pattern is allowed so the workforce
 * factory can build it, and then {@link markHiredRosterPrivateCollection}
 * brands the result. At registration, that pattern is admitted only with the
 * brand, and still never with a browser read. Every other two-segment roster
 * pattern, and every deep glob that reaches the roster, is refused at both.
 */
export function assertRosterCollectionIsNotDeep(
  config: {
    pattern: string;
    client?: { state?: { read?: boolean } };
  },
  stage: "define" | "register" = "define",
): void {
  const { pattern } = config;
  if (pattern === HIRED_ROSTER_BROWSER_PATTERN) return;
  if (pattern === HIRED_ROSTER_PRIVATE_PATTERN) {
    if (config.client?.state?.read === true) {
      throw new Error(
        `Collection pattern "${pattern}" must not enable a browser read. ` +
          `User-owned roster rows stay off the browser collection.`
      );
    }
    if (stage === "register" && !isHiredRosterPrivateCollection(config)) {
      throw new Error(
        `Collection pattern "${pattern}" is the workforce roster writer and cannot be redeclared. ` +
          `User-owned roster rows are read through the hire and fire helpers, for the caller only.`
      );
    }
    return;
  }
  if (!rosterPatternIsTooDeep(pattern)) return;
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
