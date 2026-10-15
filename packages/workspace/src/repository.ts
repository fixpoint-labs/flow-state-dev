/**
 * What repository a directory belongs to, whether a ref names a commit in it,
 * and what a listed repository's upstream fetch may use — the synchronous git
 * questions a host asks at startup, before anything is claimed — and the pin
 * file in the host's root that keeps those fetch settings across restarts.
 *
 * One definition of "the same repository" for every caller. The provisioning
 * path (`./worktree`) asks git asynchronously, inside its budget, and turns the
 * answer into an identity through {@link identityFromCommonDir}; the startup
 * guards ask synchronously through {@link repositoryIdentity}. Two copies of
 * the rule would be two definitions, and the guards that depend on it would
 * stop agreeing.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";

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

/** Where a host keeps the fetch settings it pinned, in its root. Dot-prefixed, so no place is named over it. */
const FETCH_PINS_DIR = ".fetch-pins";

/** {@link FetchPins} as {@link pinFetchSettings} keeps them, and the file that holds them. */
export interface KeptFetchPins extends FetchPins {
  /** The pin file in the host's root. Deleting it, then restarting the host, pins the config afresh. */
  file: string;
}

/**
 * The fetch settings of `repo`, pinned across restarts in the host's `root`,
 * which a run can't write. Each remote's URL and each branch's upstream is
 * pinned the first time a host start sees it, and that value wins from then
 * on: a run that rewrites the repository's shared config changes nothing the
 * next host fetches with. Credential helpers live outside the repository and
 * are read fresh. A pin file that can't be read pins nothing, with a warning,
 * and is left as it is for the person to look at.
 */
export function pinFetchSettings(root: string, repo: string): KeptFetchPins {
  const live = readFetchPins(repo);
  const dir = path.join(root, FETCH_PINS_DIR);
  const file = path.join(dir, `${createHash("sha256").update(repo).digest("hex").slice(0, 16)}.json`);
  let kept: { remotes: Record<string, string>; upstreams: Record<string, PinnedUpstream> };
  try {
    kept = parsePins(readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(
        `[workspace] ${repo}: the fetch settings pinned in ${file} could not be read (${(error as Error).message}), ` +
          `so nothing is fetched for it. To pin its current config, delete ${file} and restart the host.`,
      );
      return { remotes: new Map(), upstreams: new Map(), credentialHelpers: live.credentialHelpers, file };
    }
    kept = { remotes: {}, upstreams: {} };
  }
  let added = false;
  for (const [name, url] of live.remotes) {
    if (Object.hasOwn(kept.remotes, name)) continue;
    kept.remotes[name] = url;
    added = true;
  }
  for (const [ref, upstream] of live.upstreams) {
    if (Object.hasOwn(kept.upstreams, ref)) continue;
    kept.upstreams[ref] = upstream;
    added = true;
  }
  if (added || !existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    // Written whole and renamed into place, so a host never reads half a file.
    const temporary = `${file}.${randomUUID()}`;
    writeFileSync(temporary, `${JSON.stringify({ repo, ...kept }, null, 2)}\n`);
    renameSync(temporary, file);
  }
  return {
    remotes: new Map(Object.entries(kept.remotes)),
    upstreams: new Map(Object.entries(kept.upstreams)),
    credentialHelpers: live.credentialHelpers,
    file,
  };
}

/** A pin file's remotes and upstreams, or a throw naming what is wrong with it. */
function parsePins(text: string): { remotes: Record<string, string>; upstreams: Record<string, PinnedUpstream> } {
  const parsed = JSON.parse(text) as { remotes?: unknown; upstreams?: unknown };
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const isUpstream = (value: unknown): value is PinnedUpstream =>
    isRecord(value) && typeof value.ref === "string" && typeof value.remoteName === "string" && typeof value.remoteRef === "string";
  if (!isRecord(parsed) || !isRecord(parsed.remotes) || !isRecord(parsed.upstreams)) throw new Error("not a pin file");
  if (!Object.values(parsed.remotes).every((url) => typeof url === "string")) throw new Error("a remote's URL is not a string");
  if (!Object.values(parsed.upstreams).every(isUpstream)) throw new Error("an upstream is malformed");
  return { remotes: parsed.remotes as Record<string, string>, upstreams: parsed.upstreams as Record<string, PinnedUpstream> };
}
