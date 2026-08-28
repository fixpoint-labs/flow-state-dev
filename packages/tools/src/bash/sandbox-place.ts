/**
 * A `Place` backed by a sandbox.
 *
 * The projection needs three operations — read, write, list — and a sandbox
 * offers all three, so wrapping it is most of what moving the bash tool onto
 * the shared projection takes.
 *
 * The listing is where the care goes. Two walk strategies exist because two
 * kinds of provider exist: bind-mount providers expose the same filesystem on
 * the host, so a direct `readdir` avoids an IPC round-trip per call; the
 * others can only be seen through their adapter's exec channel. What both
 * must do identically is **fail loudly**, as a `WorkspaceWalkError`. The
 * reconcile this replaces read a failed walk as an empty one, and an empty
 * walk is a claim that the run deleted everything.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import type { Place } from "@flow-state-dev/workspace";
import type { Sandbox } from "./types";

/**
 * Marker file seeded under every mount prefix so the directory exists for the
 * walk even when its collection is empty. Never a projected file.
 */
export const KEEP_MARKER = ".keep";

/** The scratch directory a run may write to without it reaching a collection. */
export const TMP_DIR = "tmp";

/**
 * The workspace could not be read.
 *
 * Distinct from every other failure a flush can hit, because it is the only
 * one a caller should swallow: nothing was decided, so nothing was lost. A
 * collection write that fails is the opposite and must reach the caller.
 */
export class WorkspaceWalkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WorkspaceWalkError";
  }
}

/**
 * Wrap `sandbox` as a place rooted at `destination`.
 *
 * Paths crossing this boundary are workspace-relative (`artifacts/foo.md`);
 * everything absolute stays on the sandbox side of it.
 */
export function createSandboxPlace(sandbox: Sandbox, destination: string): Place {
  return {
    async read(relativePath) {
      try {
        return await sandbox.readFile(path.join(destination, relativePath));
      } catch {
        // The adapters signal "no such file" by throwing, and they do not
        // agree on the error shape. A read that fails for another reason
        // looks the same here, which is survivable: the projection treats a
        // null as "the place does not hold this" and moves on without
        // deciding anything about it.
        return null;
      }
    },

    async write(relativePath, content) {
      await sandbox.writeFile(path.join(destination, relativePath), content);
    },

    async list(prefixes) {
      const paths = sandbox.hostMountSource
        ? await walkViaHostFs(sandbox.hostMountSource, prefixes)
        : await walkViaExec(sandbox, destination, prefixes);
      // Only the markers this workspace seeded are dropped, by exact path. A
      // basename filter would also drop a `.keep` a mounted collection
      // legitimately holds — hydrate writes it and baselines it, so a listing
      // that omits it reads as a deletion and the flush removes the entry.
      const seeded = new Set(
        [TMP_DIR, ...prefixes].map((p) => path.posix.join(p, KEEP_MARKER)),
      );
      // Nested prefixes are supported and the walk runs per prefix, so a file
      // under `artifacts/drafts` is reached by both walks. Deciding one file
      // twice reports `written` then `unchanged` for the same path.
      return [...new Set(paths)].filter((p) => !seeded.has(p) && !isScratch(p));
    },
  };
}

/** Is this path the run's scratch space, which never reaches a collection? */
function isScratch(relativePath: string): boolean {
  return relativePath === TMP_DIR || relativePath.startsWith(`${TMP_DIR}/`);
}

/**
 * Walk the mount prefixes through the sandbox's exec channel, plus the files
 * sitting directly in the workspace root.
 *
 * The root scan is what makes an orphan reachable. A command that writes
 * `out.txt` beside the mounts lands outside every prefix, and a walk that
 * only visits the prefixes never sees it — so the file is silently dropped
 * when the sandbox is released, rather than reported. It is depth-limited on
 * purpose: the root can be a directory the caller handed us through `cwd`,
 * and enumerating all of it on every command is not a cost a flush should
 * take. A stray file in an unmounted SUBdirectory is still not reported.
 *
 * Absolute paths anchored at `destination`, because the sandbox's default
 * shell cwd is not guaranteed to match the workspace root — Vercel Sandbox
 * runs commands in `/vercel/sandbox` while the workspace is at
 * `/vercel/sandbox/workspace`, and a relative `find ./artifacts` there looks
 * in the wrong directory and reports zero files.
 */
async function walkViaExec(
  sandbox: Sandbox,
  destination: string,
  prefixes: readonly string[],
): Promise<string[]> {
  const root = await execFind(sandbox, [destination], "-maxdepth 1 -type f");
  const walkPaths = prefixes.map((p) => path.posix.join(destination, p));
  const mounted = walkPaths.length === 0 ? [] : await execFind(sandbox, walkPaths, "-type f");
  const prefix = destination.endsWith("/") ? destination : `${destination}/`;
  return [...root, ...mounted].map((p) =>
    p.startsWith(prefix) ? p.slice(prefix.length) : p,
  );
}

/**
 * One `find` invocation, absolute paths out.
 *
 * Throws on a non-zero exit. `2>/dev/null` already swallows the missing
 * directory case, so a failure that survives it is the walk itself being
 * broken, and the projection must not proceed to its delete pass.
 */
async function execFind(
  sandbox: Sandbox,
  targets: readonly string[],
  predicate: string,
): Promise<string[]> {
  const quoted = targets.map((p) => JSON.stringify(p)).join(" ");
  const result = await sandbox.executeCommand(`find ${quoted} ${predicate} 2>/dev/null`);
  if (result.exitCode !== 0) {
    throw new WorkspaceWalkError(
      `[bash] workspace walk failed (exit ${result.exitCode}) under ${targets.join(", ")}: ${result.stderr || "no stderr"}`,
    );
  }
  if (!result.stdout.trim()) return [];
  return result.stdout.trim().split("\n").filter(Boolean);
}

/**
 * Walk the mount prefixes directly on the host filesystem the sandbox is
 * bind-mounted from, plus the workspace root at depth 1. Same files the
 * container sees, without the IPC.
 *
 * A missing prefix directory is a mount whose collection is empty — genuinely
 * nothing to sync. Every other error is a broken walk.
 */
async function walkViaHostFs(
  hostMountSource: string,
  prefixes: readonly string[],
): Promise<string[]> {
  const out: string[] = [];
  // Not tolerated: if the root itself is gone the place is broken, and a
  // flush must hear about it instead of concluding the run deleted everything.
  for (const dirent of await readdirOrThrow(hostMountSource, false)) {
    if (dirent.isFile()) out.push(dirent.name);
  }
  for (const prefix of prefixes) {
    const root = path.join(hostMountSource, prefix);
    for (const dirent of await readdirMount(root)) {
      if (!dirent.isFile()) continue;
      const parent =
        (dirent as Dirent & { parentPath?: string }).parentPath ?? path.join(root, "");
      const rel = path.relative(root, path.join(parent, dirent.name));
      out.push(path.posix.join(prefix, rel.split(path.sep).join("/")));
    }
  }
  return out;
}

/** `readdir`, with any failure reported as a broken walk. */
async function readdirOrThrow(dir: string, recursive: boolean): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { recursive, withFileTypes: true });
  } catch (err) {
    throw new WorkspaceWalkError(`[bash] workspace walk failed under ${dir}`, { cause: err });
  }
}

/** The same, with a missing mount directory read as an empty collection. */
async function readdirMount(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { recursive: true, withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new WorkspaceWalkError(`[bash] workspace walk failed under ${dir}`, { cause: err });
  }
}
