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
import { moduleDir } from "../prompt-file-loader";

/** True when `value` is an `AnchoredPath` (`{ path, importerUrl }`). A
 * parsed `ResourceTemplate` never matches — it has no `path` field. */
export function isAnchoredPath(value: unknown): value is AnchoredPath {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { path?: unknown }).path === "string"
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
  const anchor = moduleDir(value.importerUrl);
  const candidates = [
    ...(anchor !== undefined ? [path.resolve(anchor, value.path)] : []),
    path.resolve(process.cwd(), value.path),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Failed to resolve ${field} for resource "${accessor}" (path: ${value.path}). ` +
      `Tried: ${candidates.join(", ")}`
  );
}
