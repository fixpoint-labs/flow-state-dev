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
 * through a short link instead: `<tmpdir>/fsd-cursor/<digest of the path>`,
 * pointing at the real directory. The agent's files and commits land in the
 * real directory; only the name the SDK flattens is short. The link's name is a
 * function of the path, so a resumed agent is handed the same link its first
 * turn was and finds the state that turn left. A directory that already fits
 * is handed over as it is, so its state stays where it always was.
 */
import { createHash } from "node:crypto";
import { mkdir, readlink, symlink, unlink } from "node:fs/promises";
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
  const root = join(tmpdir(), "fsd-cursor");
  const link = join(root, createHash("sha256").update(target).digest("hex").slice(0, 16));
  await mkdir(root, { recursive: true });
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
