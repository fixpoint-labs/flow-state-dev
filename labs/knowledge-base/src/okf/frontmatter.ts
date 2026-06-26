// ---------------------------------------------------------------------------
// Frontmatter split + canonical re-emission for the OKF adapter.
//
// Import parses with gray-matter configured onto the eemeli `yaml` engine so
// frontmatter is read as YAML 1.2, not js-yaml's YAML 1.1. This is the
// "Norway problem" mitigation: under 1.1 a bare `NO` parses to boolean `false`
// and `on`/`off` to booleans; under 1.2 only `true`/`false`/`null` are
// keywords, so `country: NO` stays the string "NO" and `enabled: on` stays
// "on". (Numeric forms like `1.20` are a legitimate float in both versions and
// normalize to `1.2` either way — that is not a YAML-1.1 artifact.)
//
// Export does NOT round-trip through gray-matter's stringifier — it emits the
// frontmatter block itself with a fixed key order and YAML 1.2 quoting, so a
// re-export is byte-identical (the idempotency gate in the round-trip test).
// ---------------------------------------------------------------------------

import matter from "gray-matter";
import YAML from "yaml";

/** gray-matter engine backed by eemeli `yaml` (YAML 1.2). */
const yamlEngine = {
  // YAML.parse may return any node type (object, array, scalar, null). gray-matter's
  // Engine type insists the result is `object`, so the cast satisfies that boundary;
  // splitFrontmatter does the real narrowing to a mapping at runtime.
  parse: (input: string): object => YAML.parse(input) as object,
  // gray-matter requires a stringify member; export emits frontmatter directly,
  // so this is only a fallback for callers that stringify through gray-matter.
  stringify: (data: object): string => YAML.stringify(data),
};

/** True for a plain YAML mapping — not an array, scalar, or null. */
function isFrontmatterObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Split a markdown document into its YAML frontmatter map and body. Returns an
 * empty `data` map when the document has no frontmatter block OR when the
 * frontmatter is not a YAML mapping (a bare scalar/array/null) — OKF frontmatter
 * MUST be a mapping (SPEC §4.1), and best-effort consumption (§9) means a
 * malformed block is treated as "no recognized fields" rather than crashing or
 * corrupting state with index keys. The body is the content after the closing
 * delimiter, with the single leading newline gray-matter leaves and any trailing
 * whitespace stripped, so a re-emitted body is stable.
 */
export function splitFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const parsed = matter(raw, { engines: { yaml: yamlEngine }, language: "yaml" });
  const data = isFrontmatterObject(parsed.data) ? parsed.data : {};
  return { data, body: normalizeBody(parsed.content) };
}

/** Strip leading blank lines and trailing whitespace so re-emitted bodies are stable. */
export function normalizeBody(body: string): string {
  return body.replace(/^\s*\n/, "").replace(/\s+$/, "");
}

/**
 * Emit a complete OKF concept file: a canonical frontmatter block followed by
 * the body. The frontmatter object is stringified as YAML 1.2; the caller is
 * responsible for having ordered its keys (see `buildFrontmatterObject`). The
 * body is written verbatim with exactly one trailing newline.
 */
export function emitConceptFile(frontmatter: Record<string, unknown>, body: string): string {
  const fm = YAML.stringify(frontmatter);
  return `---\n${fm}---\n\n${body}\n`;
}

/**
 * Emit the bundle-root `index.md`. OKF permits frontmatter only on the root
 * index, and only to declare `okf_version` (SPEC §6, §11). `listing` is the
 * already-formatted progressive-disclosure body.
 */
export function emitRootIndex(okfVersion: string, listing: string): string {
  return `---\n${YAML.stringify({ okf_version: okfVersion })}---\n\n${listing}\n`;
}

/** Serialize an arbitrary YAML value to a stable scalar string for `state.extra`. */
export function serializeExtraValue(value: unknown): string {
  // YAML.stringify(undefined) returns undefined; coerce so .trim() is safe.
  const serialized = YAML.stringify(value);
  return serialized === undefined ? "" : serialized.trim();
}

/** Parse a `state.extra` scalar string back into a YAML value for re-emission. */
export function parseExtraValue(value: string): unknown {
  return YAML.parse(value);
}
