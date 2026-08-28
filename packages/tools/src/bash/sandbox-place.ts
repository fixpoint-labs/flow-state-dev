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
export const KEEP_MARKER = ".fsdev-keep";

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
      const absolute = path.join(destination, relativePath);
      try {
        return await sandbox.readFile(absolute);
      } catch (err) {
        // The adapters signal "no such file" by throwing and do not agree on
        // the error shape, so the failure cannot be classified from the error.
        // Ask the sandbox instead.
        //
        // Both answers matter and they are opposites. A path that is GONE is
        // the benign case the flush is built for — a temp file replaced, an
        // editor's swap — and `null` means "the place does not hold this", so
        // the flush passes over it. A path that is still THERE and would not
        // read is a permission, I/O or encoding failure, and the same `null`
        // would tell the flush the run deleted a file it edited: the edit
        // never reaches the collection and the command reports success.
        //
        // Loud, therefore, and not a `PlaceUnreadableError`: that one says the
        // walk decided nothing and is safe to swallow, while this says one
        // file's content is unaccounted for.
        if (await stillPresent(sandbox, absolute)) {
          throw new Error(
            `[bash] ${relativePath} is in the workspace but could not be read: ` +
              `${(err as Error)?.message ?? String(err)}`,
          );
        }
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
      // The marker is dropped from the listing, and its NAME is why that is
      // safe to do. `.keep` is a file people put in repositories, so a
      // collection may hold one at `<prefix>/.keep` — the exact path this
      // seeds — and no filter can then tell the marker from the file. Whether
      // it matched by basename or by path, hydrate had written and baselined
      // the collection's copy, the listing omitted it, and the flush deleted
      // the entry. `.fsdev-keep` is reserved, so the collision cannot arise.
      const seeded = new Set(
        [TMP_DIR, ...prefixes].map((p) => path.posix.join(p, KEEP_MARKER)),
      );
      // Nested prefixes are supported and the walk runs per prefix, so a file
      // under `artifacts/drafts` is reached by both walks. Deciding one file
      // twice reports `written` then `unchanged` for the same path.
      return [...new Set(paths)].filter(
        (p) => !seeded.has(p) && !isScratch(p) && !isGenerated(p),
      );
    },
  };
}

/**
 * Directory names a flush never walks into.
 *
 * A run that installs dependencies or initialises a repository inside a
 * writable mount generates thousands of files that are not its work — and
 * `.git` holds binary objects, which a place that reads utf-8 cannot even
 * report honestly. Persisting either fills the collection with content nobody
 * asked for and can fail an otherwise successful command during its flush.
 *
 * The walk this replaced pruned both in its `find`; keeping that pruning is
 * why it is named here rather than left to the caller.
 */
const NEVER_WALKED = ["node_modules", ".git"] as const;

/** `find` arguments that stop it descending into any of them. */
const PRUNE_GENERATED = NEVER_WALKED.map((dir) => `-not -path '*/${dir}/*'`).join(" ");

/**
 * Is this workspace-relative path inside one of those trees?
 *
 * Applied to the RESULT as well as pruned in the walk, because the two walks
 * prune differently — one through `find`, one through `readdir` — and this is
 * the check the flush's correctness rests on. The pruning is what keeps it
 * from enumerating the tree in the first place.
 */
function isGenerated(relativePath: string): boolean {
  return NEVER_WALKED.some(
    (dir) => relativePath.startsWith(`${dir}/`) || relativePath.includes(`/${dir}/`),
  );
}

/** Is this path the run's scratch space, which never reaches a collection? */
export function isScratch(relativePath: string): boolean {
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
  const mounted =
    walkPaths.length === 0
      ? []
      : await execFind(sandbox, walkPaths, `-type f ${PRUNE_GENERATED}`);
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
/**
 * Whether the sandbox still holds `absolute`.
 *
 * Asked only after a read has already failed, so the extra round trip costs
 * nothing on the ordinary path. A probe that cannot run at all is reported as
 * present: the honest answer to "did this file vanish" is then "no idea", and
 * the failure that follows is louder than a silently dropped edit.
 */
async function stillPresent(sandbox: Sandbox, absolute: string): Promise<boolean> {
  try {
    const probe = await sandbox.executeCommand(`test -e ${JSON.stringify(absolute)}`);
    return probe.exitCode === 0;
  } catch {
    return true;
  }
}

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
      // `readdir` has no prune, so the tree is enumerated and dropped here.
      // The listing filter would catch these anyway; skipping now avoids
      // building paths for a dependency tree one entry at a time.
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
    throw new Error(`[bash] workspace walk failed under ${dir}`, { cause: err });
  }
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
