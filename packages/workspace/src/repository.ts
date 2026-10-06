/**
 * What repository a directory belongs to, and whether a ref names a commit in
 * it — the two synchronous git questions a host asks at startup, before
 * anything is claimed.
 *
 * One definition of "the same repository" for every caller. The provisioning
 * path (`./worktree`) asks git asynchronously, inside its budget, and turns the
 * answer into an identity through {@link identityFromCommonDir}; the startup
 * guards ask synchronously through {@link repositoryIdentity}. Two copies of
 * the rule would be two definitions, and the guards that depend on it would
 * stop agreeing.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { realpathSync } from "node:fs";

/**
 * How long a startup git query may take. Short: these are metadata reads
 * against a local repository, answered in milliseconds, so a tight bound turns
 * a wedged filesystem into a clear startup failure.
 */
const STARTUP_GIT_TIMEOUT_MS = 30_000;

/**
 * Turn a `git rev-parse --git-common-dir` answer, asked in `dir`, into the
 * identity two directories are compared by: the real path of the common dir,
 * or `undefined` when it does not resolve.
 *
 * The common dir is the one directory every worktree of a repository shares,
 * so it identifies the repository rather than the checkout. Resolved with
 * `realpath`, not lexically: git answers `.git` for both a repository and a
 * symlink to it, and a lexical resolve would call those two repositories.
 */
export function identityFromCommonDir(dir: string, commonDir: string): string | undefined {
  try {
    return realpathSync(path.resolve(dir, commonDir.trim()));
  } catch {
    return undefined;
  }
}

/** The repository `dir` belongs to, as {@link identityFromCommonDir} names it, or `undefined`. */
export function repositoryIdentity(dir: string): string | undefined {
  try {
    const out = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: dir,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      timeout: STARTUP_GIT_TIMEOUT_MS,
    }).trim();
    return identityFromCommonDir(dir, out);
  } catch {
    return undefined;
  }
}

/** `true` when `ref` resolves to a commit in the repository at `repo`. */
export function resolvesToCommit(repo: string, ref: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      cwd: repo,
      stdio: ["ignore", "ignore", "ignore"],
      timeout: STARTUP_GIT_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}
