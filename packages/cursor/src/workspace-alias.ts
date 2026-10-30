/**
 * A working directory Cursor's local runtime can keep its own state for.
 *
 * The SDK keeps per-workspace state under `~/.cursor/projects/<name>`, where
 * `<name>` is the whole working directory flattened into one directory name
 * (every run of non-alphanumerics becomes `-`), with no truncation. A directory
 * name over 255 bytes is refused by the filesystem, so a run in a deep
 * directory fails with `ENAMETOOLONG` before it does any work. A harness-manager
 * checkout under an ordinary runs folder is that deep: its own segments are
 * about 240 characters before the root is counted.
 *
 * So a directory whose flattened name would not fit is handed to the SDK
 * through a short link instead: `<tmpdir>/fsd-cursor-<uid>/<digest of the path>`,
 * pointing at the real directory. The agent's files and commits land in the
 * real directory; only the name the SDK flattens is short. The link's name is a
 * function of the path, so a resumed agent is handed the same link its first
 * turn was and finds the state that turn left. A directory that already fits
 * is handed over as it is, so its state stays where it always was.
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, readlink, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** The longest directory name the filesystems Cursor runs on accept, in bytes. */
export const CURSOR_PROJECT_NAME_LIMIT = 255;

/**
 * The directory name the Cursor SDK (as of the tested version) gives a
 * working directory's state under `~/.cursor/projects`.
 */
export function cursorProjectName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * The directory to hand the SDK as `local.cwd` for a run in `cwd`: `cwd`
 * itself when its state name fits, else a short link to it (created or
 * repointed here).
 */
export async function cursorWorkingDirectory(cwd: string): Promise<string> {
  if (cursorProjectName(cwd).length <= CURSOR_PROJECT_NAME_LIMIT) return cwd;

  const target = resolve(cwd);
  const root = await ownLinkRoot();
  const link = join(root, createHash("sha256").update(target).digest("hex").slice(0, 16));
  try {
    // `junction` is Windows' directory link that needs no privilege; the type
    // is ignored everywhere else.
    await symlink(target, link, "junction");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    // Another run (or an earlier turn) made it: the same path makes the same
    // link, so it is already right unless something else took the name.
    if (resolve(await readlink(link)) !== target) {
      await unlink(link);
      await symlink(target, link, "junction");
    }
  }
  return link;
}

/**
 * This OS user's own folder of links, private to it.
 *
 * `tmpdir()` is often one `/tmp` shared by every account on the machine. A
 * folder there that another account made (first, or on purpose) would refuse
 * this one's links, or let that account repoint a link at a directory of its
 * choosing and have the agent write there. So each account gets its own,
 * made `0700`, and one this account does not own is refused.
 */
async function ownLinkRoot(): Promise<string> {
  const uid = process.getuid?.();
  const root = join(tmpdir(), uid === undefined ? "fsd-cursor" : `fsd-cursor-${uid}`);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (uid !== undefined) {
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0) {
      throw new Error(
        `[cursor] ${root} holds the short links deep working directories reach Cursor through, ` +
          "and it is not a private directory this user owns. Remove it and run again.",
      );
    }
  }
  return root;
}
