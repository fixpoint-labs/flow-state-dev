/**
 * What repository a directory belongs to, whether a ref names a commit in it,
 * and what a listed repository's upstream fetch may use — the synchronous git
 * questions a host asks at startup, before anything is claimed.
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

/**
 * What a listed repository's upstream fetch may use, read once when the host
 * starts, before any run of it could have rewritten the repository's config.
 */
export interface FetchPins {
  /** Each remote's fetch URL, by remote name, as `git remote -v` expands it. */
  remotes: ReadonlyMap<string, string>;
  /**
   * The credential helpers set outside the repository (system, global and
   * command-line config, in git's order), as `[key, value]` pairs: what a
   * fetch replays after clearing every helper, so a helper planted in the
   * repository's own config never runs and the person's own still do.
   */
  credentialHelpers: ReadonlyArray<readonly [string, string]>;
  /**
   * Each local branch's upstream, by its full ref name (`refs/heads/main`):
   * its tracking ref, remote and the branch on that remote. A run can rewrite
   * `branch.<name>.remote` and `.merge`, so a fetch follows these instead.
   */
  upstreams: ReadonlyMap<string, PinnedUpstream>;
}

/** One local branch's upstream, as {@link FetchPins} pins it. */
export interface PinnedUpstream {
  /** The tracking ref, e.g. `refs/remotes/origin/main`. */
  ref: string;
  /** The remote's name. */
  remoteName: string;
  /** The branch on the remote, e.g. `refs/heads/main`. */
  remoteRef: string;
}

/** Read {@link FetchPins} for `repo`. Anything unreadable pins nothing. */
export function readFetchPins(repo: string): FetchPins {
  const read = (args: string[]): string => {
    try {
      return execFileSync("git", args, {
        cwd: repo,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
        timeout: STARTUP_GIT_TIMEOUT_MS,
      });
    } catch {
      return "";
    }
  };
  const remotes = new Map<string, string>();
  for (const line of read(["remote", "-v"]).split("\n")) {
    const match = /^([^\t]+)\t(.*) \(fetch\)$/.exec(line);
    if (match !== null && !remotes.has(match[1]!)) remotes.set(match[1]!, match[2]!);
  }
  // `-z --show-scope`: `<scope>\0<key>\n<value>\0` per entry.
  const fields = read(["config", "-z", "--show-scope", "--includes", "--get-regexp", "^credential\\.(.*\\.)?helper$"]).split("\0");
  const credentialHelpers: Array<readonly [string, string]> = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const scope = fields[i]!;
    const entry = fields[i + 1]!;
    const newline = entry.indexOf("\n");
    if (scope === "local" || scope === "worktree" || newline < 0) continue;
    credentialHelpers.push([entry.slice(0, newline), entry.slice(newline + 1)]);
  }
  const upstreams = new Map<string, PinnedUpstream>();
  for (const line of read(["for-each-ref", "--format=%(refname)%09%(upstream)%09%(upstream:remotename)%09%(upstream:remoteref)", "refs/heads"]).split("\n")) {
    const [refname = "", ref = "", remoteName = "", remoteRef = ""] = line.split("\t");
    if (ref.startsWith("refs/remotes/") && remoteName !== "" && remoteName !== ".") {
      upstreams.set(refname, { ref, remoteName, remoteRef });
    }
  }
  return { remotes, credentialHelpers, upstreams };
}
