/**
 * Path resolution for resource content files (`contentFile`) and template
 * files (string / anchored `contentTemplate`). Bare strings keep their
 * historical working-directory resolution; `AnchoredPath` values resolve
 * relative to the declaring module first, with a working-directory fallback,
 * so flows load the same files regardless of where the process started
 * (the FIX-786 candidate semantics, applied server-side).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { AnchoredPath } from "@flow-state-dev/core/types";
import type { ResourceTemplate } from "@flow-state-dev/core/resource-template";
import { moduleDir } from "@flow-state-dev/core/prompt-file/node";

/** True when `value` is an `AnchoredPath` (`{ path, importerUrl? }`). A
 * parsed `ResourceTemplate` never matches — it has no `path` field. */
export function isAnchoredPath(value: unknown): value is AnchoredPath {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { path?: unknown }).path === "string"
  );
}

/** True when a `contentTemplate` value is already a parsed
 * `ResourceTemplate`, as opposed to an unresolved string path or
 * `AnchoredPath` awaiting resolution. */
export function isParsedResourceTemplate(value: unknown): value is ResourceTemplate {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { source?: unknown }).source === "string" &&
    typeof (value as { sections?: unknown }).sections === "object"
  );
}

/**
 * Resolve a content path to an absolute file path.
 *
 * Bare strings keep their historical behavior: absolute used as-is, relative
 * resolved from the working directory (the subsequent read reports any
 * failure). Anchored paths: absolute used as-is; relative resolved against
 * the declaring module's directory when `importerUrl` is a usable `file:`
 * URL and the file exists there, else against the working directory.
 * Bundler-rewritten anchors therefore degrade to working-directory
 * resolution rather than failing.
 *
 * @throws {Error} for an anchored relative path that exists under no
 *   candidate — the message names every path tried.
 */
export function resolveContentPath(
  value: string | AnchoredPath,
  field: string,
  accessor: string
): string {
  if (typeof value === "string") {
    return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
  }
  if (path.isAbsolute(value.path)) return value.path;
  const anchor = value.importerUrl !== undefined ? moduleDir(value.importerUrl) : undefined;
  const candidates = [
    anchor !== undefined ? path.resolve(anchor, value.path) : undefined,
    path.resolve(process.cwd(), value.path),
  ].filter((c): c is string => c !== undefined);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Failed to resolve ${field} for resource "${accessor}" (path: ${value.path}). ` +
      `Tried: ${candidates.join(", ")}`
  );
}
