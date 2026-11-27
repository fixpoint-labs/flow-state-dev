// FIX-2519.
/**
 * A temp folder private to this OS user, for files a harness hands its agent
 * outside any checkout (Cursor's short links, Codex's per-turn images).
 *
 * `tmpdir()` is often one `/tmp` shared by every account on the machine. A
 * folder there that another account made (first, or on purpose) would refuse
 * this one's files, or let that account swap them for its own and have the
 * agent read or write there. So each account gets its own, made `0700`, and
 * one this account does not own, or that anyone else can enter, is refused.
 */
import { lstat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `<tmpdir>/<name>-<uid>`, made if missing, checked private to this user.
 * On a platform with no uid (Windows), `<tmpdir>/<name>`, unchecked: its temp
 * folder is already per-user.
 *
 * @param purpose What the folder holds, for the refusal: `"the short links deep working directories reach Cursor through"`.
 * @throws When the folder exists and is not a directory this user owns that only it can enter.
 */
export async function privateTempRoot(name: string, purpose: string): Promise<string> {
  const uid = process.getuid?.();
  const root = join(tmpdir(), uid === undefined ? name : `${name}-${uid}`);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (uid !== undefined) {
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0) {
      throw new Error(`${root} holds ${purpose}, and it is not a private directory this user owns. Remove it and run again.`);
    }
  }
  return root;
}
