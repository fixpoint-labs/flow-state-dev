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
 * must do identically is **fail loudly**. The reconcile this replaces read a
 * failed walk as an empty one, and an empty walk is a claim that the run
 * deleted everything. The projection is what turns a thrown listing into the
 * `PlaceUnreadableError` its callers key on, so a plain error is enough here.
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
 * Walk the mount prefixes through the sandbox's exec channel.
 *
 * The prefixes and nothing else: this lists what the run OWNED. A file written
 * beside the mounts is not the projection's to reason about, and enumerating a
 * root the caller may have handed us through `cwd` after every command is not
 * a cost a flush should take. Such a file stays in the workspace and goes when
 * the workspace does.
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
  const walkPaths = prefixes.map((p) => path.posix.join(destination, p));
  if (walkPaths.length === 0) return [];
  const mounted = await execFind(sandbox, walkPaths, "-type f");
  const prefix = destination.endsWith("/") ? destination : `${destination}/`;
  return mounted.map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p));
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
    throw new Error(
      `[bash] workspace walk failed (exit ${result.exitCode}) under ${targets.join(", ")}: ${result.stderr || "no stderr"}`,
    );
  }
  if (!result.stdout.trim()) return [];
  return result.stdout.trim().split("\n").filter(Boolean);
}

/**
 * Walk the mount prefixes directly on the host filesystem the sandbox is
 * bind-mounted from. Same files the container sees, without the IPC.
 *
 * A missing prefix directory is a mount whose collection is empty — genuinely
 * nothing to sync. Every other error is a broken walk.
 */
async function walkViaHostFs(
  hostMountSource: string,
  prefixes: readonly string[],
): Promise<string[]> {
  const out: string[] = [];
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

/** The same, with a missing mount directory read as an empty collection. */
async function readdirMount(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { recursive: true, withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`[bash] workspace walk failed under ${dir}`, { cause: err });
  }
}
