// ---------------------------------------------------------------------------
// Pattern utilities for resource collections.
// Pure functions — no side effects, no dependencies beyond string ops.
// ---------------------------------------------------------------------------

import { getPatternPrefix } from "@flow-state-dev/contracts/helpers/pattern-prefix";

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

// The static prefix of a pattern and the bare topic under it live in
// `@flow-state-dev/contracts`, so browser packages can value-import them;
// re-exported here with their siblings.
export { extractBareTopic, getPatternPrefix } from "@flow-state-dev/contracts/helpers/pattern-prefix";

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

/**
 * Whether some storage key matches both patterns, by {@link matchesPattern}'s
 * rules: a wildcard pattern is its static prefix and then one segment (`*`)
 * or one or more (`**`); a parameterized one is its segments, each `[param]`
 * any one segment.
 */
export function patternsOverlap(a: string, b: string): boolean {
  const shape = (pattern: string): { segments: Array<string | null>; deep: boolean } => {
    if (isParameterizedPattern(pattern)) {
      return { segments: pattern.split("/").map((seg) => (/^\[.+\]$/.test(seg) ? null : seg)), deep: false };
    }
    const prefix = getPatternPrefix(pattern);
    return { segments: [...(prefix.length > 0 ? prefix.split("/") : []), null], deep: isDeepWildcard(pattern) };
  };
  const left = shape(a);
  const right = shape(b);
  // A deep pattern's last segment stands for one or more, so it covers any longer tail.
  if (!left.deep && !right.deep && left.segments.length !== right.segments.length) return false;
  if (!left.deep && right.deep && left.segments.length < right.segments.length) return false;
  if (left.deep && !right.deep && right.segments.length < left.segments.length) return false;
  const shared = Math.min(left.segments.length, right.segments.length);
  for (let i = 0; i < shared; i += 1) {
    const l = left.segments[i];
    const r = right.segments[i];
    if (l !== null && r !== null && l !== r) return false;
  }
  return true;
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
 * A user id as one path segment.
 *
 * Opaque ids may contain `/` or `.`. Those are percent-encoded, and `%` is
 * encoded too, so the mapping is injective. {@link ownerSegment} is built from
 * it, so one user's owner segment cannot be a prefix of another's.
 */
export function encodeUserSegment(userId: string): string {
  if (userId.length === 0) {
    throw new Error("a user id must not be empty — it is part of a storage key");
  }
  let out = "";
  for (const char of userId) {
    if (/[a-z0-9-]/.test(char)) {
      out += char;
      continue;
    }
    for (const byte of new TextEncoder().encode(char)) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

/**
 * The key segment that marks a row as `userId`'s: `~` plus
 * {@link encodeUserSegment}.
 *
 * An owner-keyed collection (`ownerPrivate: { param }` or `ownerWrites: { param }`)
 * keys each row with this at its owner parameter: an owner-private one serves
 * the row only to that user, an owner-writes one lets only that user write it. A key's
 * first segment beginning `~` is its owner in every app, so no other
 * collection reads or writes a key carrying one. The escaped id holds no `~`
 * and no `/`, so the segment is one segment with one marker.
 */
export function ownerSegment(userId: string): string {
  return `~${encodeUserSegment(userId)}`;
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
