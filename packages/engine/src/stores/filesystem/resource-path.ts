/**
 * Resource key ↔ nested on-disk path mapping for filesystem content/state stores.
 *
 * Keys split on `/` into segments; each segment is URI-encoded with dots and `*`
 * escaped so leaf files can carry a structural extension (`.md` / `.json`) without
 * colliding with directory names.
 */
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

const WINDOWS_RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9"
]);

const METADATA_FILE_DENYLIST = new Set([
  ".ds_store",
  "thumbs.db",
  ".gitignore",
  ".gitkeep"
]);

const METADATA_DIR_DENYLIST = new Set([".git", ".obsidian", ".svn", ".hg"]);

export const LAYOUT_MARKER_NAME = ".fsdev-store-layout";
export const NESTED_LAYOUT_VERSION = "nested-v1";

function isWindows(): boolean {
  return process.platform === "win32";
}

function isReservedDeviceSegment(segment: string): boolean {
  if (!isWindows()) {
    return false;
  }
  const base = segment.includes(".") ? segment.slice(0, segment.indexOf(".")) : segment;
  return WINDOWS_RESERVED.has(base.toLowerCase());
}

function validateSegmentShape(segment: string): void {
  if (segment.length === 0) {
    throw new Error("Filesystem store resource key has an empty path segment");
  }
  if (isReservedDeviceSegment(segment)) {
    throw new Error(`Filesystem store resource key segment is reserved on Windows: "${segment}"`);
  }
}

/** Encode one key segment for use as a single path component (throws on invalid shapes). */
export function encodeSegment(segment: string): string {
  validateSegmentShape(segment);
  return encodeURIComponent(segment).replaceAll(".", "%2E").replaceAll("*", "%2A");
}

/** Best-effort segment encode for prefix narrowing; returns null when the segment is unrepresentable. */
export function tryEncodeSegment(segment: string): string | null {
  if (segment.length === 0 || isReservedDeviceSegment(segment)) {
    return null;
  }
  return encodeURIComponent(segment).replaceAll(".", "%2E").replaceAll("*", "%2A");
}

/** Decode one path component back to a key segment. */
export function decodeSegment(encoded: string): string {
  const withDots = encoded.replaceAll("%2E", ".").replaceAll("%2A", "*");
  return decodeURIComponent(withDots);
}

function splitKey(resourceKey: string): string[] {
  if (resourceKey.length === 0) {
    throw new Error("Filesystem store resource key must not be empty");
  }
  if (resourceKey.startsWith("/") || resourceKey.endsWith("/") || resourceKey.includes("//")) {
    throw new Error("Filesystem store resource key has an invalid slash placement");
  }
  return resourceKey.split("/");
}

/** Map a resource key to a path relative to the scope directory, including the leaf extension. */
export function keyToRelativePath(resourceKey: string, ext: string): string {
  const segments = splitKey(resourceKey).map(encodeSegment);
  const leaf = segments.pop();
  if (leaf === undefined) {
    throw new Error("Filesystem store resource key must not be empty");
  }
  const dir = segments.length > 0 ? path.join(...segments) : "";
  const fileName = `${leaf}${ext}`;
  return dir.length > 0 ? path.join(dir, fileName) : fileName;
}

/** Reconstruct a resource key from a relative on-disk path (always uses `/` in the key). */
export function relativePathToKey(relPath: string, ext: string): string {
  const normalized = relPath.split(path.sep).join("/");
  const parts = normalized.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new Error("Invalid resource path");
  }
  const leaf = parts[parts.length - 1]!;
  if (!leaf.endsWith(ext)) {
    throw new Error("Path does not end with the expected extension");
  }
  const leafBase = leaf.slice(0, -ext.length);
  const segments = [...parts.slice(0, -1).map(decodeSegment), decodeSegment(leafBase)];
  return segments.join("/");
}

export function assertPathUnderRoot(absPath: string, rootDir: string): void {
  const resolved = path.resolve(absPath);
  const root = path.resolve(rootDir);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error(`Refusing path outside store root: ${absPath}`);
  }
}

export function encodeScopeId(scopeId: string): string {
  if (scopeId.length === 0 || scopeId === "." || scopeId === "..") {
    throw new Error(`Filesystem store scope id is not supported: "${scopeId}"`);
  }
  if (isReservedDeviceSegment(scopeId)) {
    throw new Error(`Filesystem store scope id is reserved on Windows: "${scopeId}"`);
  }
  return encodeURIComponent(scopeId);
}

function prefixStartDir(scopeDir: string, keyPrefix: string): string | null {
  if (keyPrefix.length === 0) {
    return scopeDir;
  }
  const endsWithSlash = keyPrefix.endsWith("/");
  const rawParts = keyPrefix.split("/");
  const completeCount = endsWithSlash ? rawParts.length - 1 : rawParts.length - 1;
  if (completeCount <= 0) {
    return scopeDir;
  }
  let current = scopeDir;
  for (let i = 0; i < completeCount; i += 1) {
    const part = rawParts[i]!;
    const encoded = tryEncodeSegment(part);
    if (encoded === null) {
      return null;
    }
    current = path.join(current, encoded);
  }
  return current;
}

function normalizeRelPath(relPath: string): string {
  return relPath.split(path.sep).join("/");
}

function isCanonicalRelativePath(relPath: string, ext: string): boolean {
  try {
    const key = relativePathToKey(relPath, ext);
    return normalizeRelPath(keyToRelativePath(key, ext)) === normalizeRelPath(relPath);
  } catch {
    return false;
  }
}

async function walkRecords(
  dir: string,
  scopeDir: string,
  ext: string,
  keyPrefix: string | undefined,
  out: Array<{ resourceKey: string; absolutePath: string }>
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith(".")) {
      continue;
    }
    const abs = path.join(dir, name);
    if (entry.isDirectory()) {
      if (METADATA_DIR_DENYLIST.has(name.toLowerCase())) {
        continue;
      }
      const link = await lstat(abs);
      if (link.isSymbolicLink()) {
        continue;
      }
      await walkRecords(abs, scopeDir, ext, keyPrefix, out);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const link = await lstat(abs);
    if (link.isSymbolicLink()) {
      continue;
    }
    if (!name.endsWith(ext)) {
      continue;
    }
    const relFromScope = path.relative(scopeDir, abs);
    if (relFromScope.startsWith("..")) {
      continue;
    }
    if (!isCanonicalRelativePath(relFromScope, ext)) {
      console.warn(`[flow-state] Skipping non-canonical filesystem resource path: ${abs}`);
      continue;
    }
    let resourceKey: string;
    try {
      resourceKey = relativePathToKey(relFromScope, ext);
    } catch {
      console.warn(`[flow-state] Skipping unreadable filesystem resource path: ${abs}`);
      continue;
    }
    if (keyPrefix !== undefined && keyPrefix.length > 0 && !resourceKey.startsWith(keyPrefix)) {
      continue;
    }
    out.push({ resourceKey, absolutePath: abs });
  }
}

/**
 * Recursively collect resource files under `scopeDir` whose leaf names end with `ext`.
 * Optional `keyPrefix` narrows the walk start directory (BP-033).
 */
export async function collectRecords(
  scopeDir: string,
  ext: string,
  keyPrefix?: string
): Promise<Array<{ resourceKey: string; absolutePath: string }>> {
  const prefix = keyPrefix ?? "";
  const start = prefixStartDir(scopeDir, prefix);
  if (start === null) {
    return [];
  }
  try {
    const link = await lstat(start);
    if (link.isSymbolicLink()) {
      return [];
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const out: Array<{ resourceKey: string; absolutePath: string }> = [];
  await walkRecords(start, scopeDir, ext, keyPrefix, out);
  return out;
}

export function isLayoutMarkerFileName(name: string): boolean {
  return name === LAYOUT_MARKER_NAME;
}

export function isMetadataFileName(name: string): boolean {
  return METADATA_FILE_DENYLIST.has(name.toLowerCase());
}

export function isMetadataDirName(name: string): boolean {
  return METADATA_DIR_DENYLIST.has(name.toLowerCase());
}
