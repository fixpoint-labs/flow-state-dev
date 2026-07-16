/**
 * Shared, dependency-free key↔path mapping for the filesystem keyed-resource
 * stores (content + resource-state). A resource key like
 * `concepts/flow-state-dev/overview` maps to a nested on-disk path with a leaf
 * extension (`concepts/flow-state-dev/overview.md`), turning the store root
 * into a real browsable file tree instead of one flat
 * `encodeURIComponent(wholeKey)` file per resource.
 *
 * The encoding escapes every literal "." (and "*") inside a path segment so the
 * ONLY "." in any component is the structural leaf extension — a directory
 * segment can never collide with `<base>.md`/`<base>.json`, and "."/".."/leading
 * dot are neutralized for free (they can never traverse or hide on disk).
 */
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Windows reserved device basenames. A path segment (or scope id) equal to one
 * of these — case-insensitively — is unrepresentable on Windows and rejected by
 * {@link validateSegment}.
 */
const WINDOWS_RESERVED_NAMES: ReadonlySet<string> = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`)
]);

/** True if `name` (case-insensitively) is a Windows reserved device basename. */
export function isWindowsReservedName(name: string): boolean {
  return WINDOWS_RESERVED_NAMES.has(name.toLowerCase());
}

/**
 * Encode a single key segment into a filesystem-safe on-disk name.
 *
 * `encodeURIComponent`, then escape every remaining "." → "%2E" and "*" →
 * "%2A". Escaping "." guarantees the only literal "." in a component is the
 * appended leaf extension (closing the `a` vs `a.md/b` collision); it also maps
 * "."/".."/leading-dot to "%2E"/"%2E%2E"/"%2E…" so they never traverse or
 * dot-hide. "*" is the one Windows-invalid char `encodeURIComponent` leaves
 * through.
 */
export function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/\./g, "%2E").replace(/\*/g, "%2A");
}

/**
 * Exact inverse of {@link encodeSegment}. `decodeURIComponent` maps "%2E"→".",
 * "%2A"→"*", etc. Throws `URIError` on a malformed %-sequence (e.g. "100%") —
 * callers wrap this so a non-canonical on-disk name is caught, not fatal.
 */
export function decodeSegment(segment: string): string {
  return decodeURIComponent(segment);
}

/**
 * Reject a key segment that cannot be represented as a durable, reversible
 * on-disk name: an empty string, or a Windows reserved device basename
 * (case-insensitive). Applied to every segment — leaf and directory. A
 * leading-"." segment is NOT rejected (dot-escaping already makes it safe).
 */
export function validateSegment(segment: string): void {
  if (segment === "") {
    throw new Error("Invalid resource key: empty path segment");
  }
  if (isWindowsReservedName(segment)) {
    throw new Error(
      `Invalid resource key segment "${segment}": Windows reserved device name`
    );
  }
}

/**
 * Map a resource key to a scope-relative on-disk path with `ext` on the leaf.
 * Splits on "/", validates + encodes each segment, joins with the OS separator,
 * appends `ext` to the leaf only.
 *
 *   ("concepts/flow-state-dev/overview", ".md") -> "concepts/flow-state-dev/overview.md"
 *   ("a.md/b", ".md")                            -> "a%2Emd/b.md"
 *   ("files/src/utils.ts", ".md")                -> "files/src/utils%2Ets.md"
 */
export function keyToRelativePath(resourceKey: string, ext: string): string {
  const segments = resourceKey.split("/");
  for (const segment of segments) {
    validateSegment(segment);
  }
  const encoded = segments.map(encodeSegment);
  return path.join(...encoded) + ext;
}

/**
 * Inverse of {@link keyToRelativePath}. Strips ONE trailing `ext` from the leaf,
 * splits on the OS separator, decodes each segment, and rejoins with a literal
 * "/" so a reconstructed key is byte-identical across OSes (a Windows "\" never
 * leaks into a key). May throw `URIError` via {@link decodeSegment} on a
 * malformed on-disk name — callers treat that as non-canonical.
 */
export function relativePathToKey(relPath: string, ext: string): string {
  const stripped = relPath.endsWith(ext) ? relPath.slice(0, relPath.length - ext.length) : relPath;
  return stripped
    .split(path.sep)
    .map(decodeSegment)
    .join("/");
}

/** A file discovered by {@link collectRecords}: its reconstructed key + path. */
export type ResourceRecord = {
  resourceKey: string;
  absolutePath: string;
};

/**
 * Narrow the walk start directory using the prefix's COMPLETE leading segments
 * (BP-033: filter at source). Splits `keyPrefix` on "/"; the all-but-last
 * segments are complete and select a subdirectory, the trailing piece is a
 * partial match handled by the caller's `startsWith`. Returns `undefined` when a
 * complete leading segment is unrepresentable (empty or Windows-reserved) — such
 * a prefix can never match a stored key, so the caller returns [].
 */
function narrowStartDir(scopeDir: string, keyPrefix: string | undefined): string | undefined {
  if (!keyPrefix) return scopeDir;
  const segments = keyPrefix.split("/");
  const completeLeading = segments.slice(0, -1);
  let dir = scopeDir;
  for (const segment of completeLeading) {
    if (segment === "" || isWindowsReservedName(segment)) {
      return undefined;
    }
    dir = path.join(dir, encodeSegment(segment));
  }
  return dir;
}

/**
 * Recursively walk `scopeDir`, yielding a record for every file whose name ends
 * in `ext`. The vault is user-editable, so reconstruction is defensive:
 *
 *  - Dot-prefixed entries (files AND dirs) are skipped — editor/VCS metadata
 *    (`.obsidian/`, `.git/`, `.DS_Store`, the layout marker).
 *  - A record is identified SOLELY by the `ext` suffix, which already excludes
 *    crash temp files (`<leaf>.md.tmp-…`) — a real key `build.tmp-1` survives.
 *  - Each key is reconstructed then canonicalized: a name that does not
 *    round-trip (`keyToRelativePath(relativePathToKey(rel)) !== rel`, or whose
 *    decode throws) is non-canonical (e.g. `a%2Fb.md` aliases `a/b.md`,
 *    `100%.md` throws) and is skipped with a `console.warn`, never yielded.
 *  - Symlink-safe: the start dir and every subdirectory are `lstat`ed; a
 *    symlinked directory (or file) is skipped, never followed/yielded.
 *  - `keyPrefix` narrows the start dir (see {@link narrowStartDir}); the caller
 *    still applies the exact `startsWith` on reconstructed keys.
 */
export async function collectRecords(
  scopeDir: string,
  ext: string,
  keyPrefix?: string
): Promise<ResourceRecord[]> {
  const startDir = narrowStartDir(scopeDir, keyPrefix);
  if (startDir === undefined) return [];

  const records: ResourceRecord[] = [];

  // lstat the start dir: missing -> nothing; symlink -> skip (never follow).
  let startStat;
  try {
    startStat = await lstat(startDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return records;
    throw error;
  }
  if (startStat.isSymbolicLink() || !startStat.isDirectory()) return records;

  await walk(startDir, scopeDir, ext, records);
  return records;
}

/** Recursive worker for {@link collectRecords}. `relPath` is kept from `scopeDir`. */
async function walk(
  dir: string,
  scopeDir: string,
  ext: string,
  records: ResourceRecord[]
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // editor/VCS metadata + layout marker
    if (entry.isSymbolicLink()) continue; // never follow / yield a symlink

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(fullPath, scopeDir, ext, records);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(ext)) continue; // excludes temp files + wrong-ext files

    const relPath = path.relative(scopeDir, fullPath);
    let resourceKey: string;
    try {
      resourceKey = relativePathToKey(relPath, ext);
      // Canonicalize defensively: a name that doesn't round-trip is an alias.
      if (keyToRelativePath(resourceKey, ext) !== relPath) {
        throw new Error("non-canonical");
      }
    } catch {
      console.warn(
        `[flow-state] filesystem store: skipping non-canonical resource file "${fullPath}"`
      );
      continue;
    }
    records.push({ resourceKey, absolutePath: fullPath });
  }
}
