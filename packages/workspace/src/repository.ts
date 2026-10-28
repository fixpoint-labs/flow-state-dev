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
import { chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { withLockSync, type LockBounds } from "./lock";
import { withoutCredential } from "./remotes";

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

/**
 * How a host start waits for another start's pin write. A hold is one small
 * read and write, so a holder still there after this long is gone.
 */
const PIN_LOCK_BOUNDS: LockBounds = { waitMs: 10_000, pollMs: 10, staleAfterMs: 10_000 };

/** {@link FetchPins} as {@link pinFetchSettings} keeps them, and the file that holds them. */
export interface KeptFetchPins extends FetchPins {
  /** The pin file in the host's root. Deleting it, then restarting the host, pins the config afresh. */
  file: string;
}

/**
 * Pin `repo`'s remotes and upstreams in the host's `root`, where a run can't
 * write, across restarts. First value wins; helpers stay live; an unreadable
 * file pins nothing and is left alone. A URL is pinned without any credential
 * in it, and the file is the operator's alone (`0600`, in a `0700` directory).
 * Two hosts starting on one root merge under a lock, so neither drops the
 * other's pins.
 */
export function pinFetchSettings(root: string, repo: string): KeptFetchPins {
  const live = readFetchPins(repo);
  const dir = path.join(root, FETCH_PINS_DIR);
  const file = path.join(dir, `${createHash("sha256").update(repo).digest("hex").slice(0, 16)}.json`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const unreadable = (why: string): KeptFetchPins => {
    console.warn(
      `[workspace] ${repo}: the fetch settings pinned in ${file} could not be read (${why}), ` +
        `so nothing is fetched for it. To pin its current config, delete ${file} and restart the host.`,
    );
    return { remotes: new Map(), upstreams: new Map(), credentialHelpers: live.credentialHelpers, file };
  };
  return withLockSync(
    `${file}.lock`,
    PIN_LOCK_BOUNDS,
    () => {
      let text: string | undefined;
      try {
        text = readFileSync(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return unreadable((error as Error).message);
      }
      let kept: Pins;
      try {
        kept = text === undefined ? { remotes: new Map(), upstreams: new Map() } : parsePins(text, repo);
      } catch (error) {
        return unreadable((error as Error).message);
      }
      let added = text === undefined;
      for (const [name, url] of live.remotes) {
        if (kept.remotes.has(name)) continue;
        kept.remotes.set(name, withoutCredential(url));
        added = true;
      }
      for (const [ref, upstream] of live.upstreams) {
        if (kept.upstreams.has(ref)) continue;
        kept.upstreams.set(ref, upstream);
        added = true;
      }
      if (added) {
        // Written whole and renamed into place, so a host never reads half a file.
        const temporary = `${file}.${randomUUID()}`;
        const json = { repo, remotes: Object.fromEntries(kept.remotes), upstreams: Object.fromEntries(kept.upstreams) };
        writeFileSync(temporary, `${JSON.stringify(json, null, 2)}\n`, { mode: 0o600 });
        renameSync(temporary, file);
      }
      return { ...kept, credentialHelpers: live.credentialHelpers, file };
    },
    `the fetch pins in ${file}`,
  );
}

/** A pin file's contents. Maps, so a remote named `__proto__` is a key like any other. */
interface Pins {
  remotes: Map<string, string>;
  upstreams: Map<string, PinnedUpstream>;
}

/** The pins in a file written for `repo`, or a throw naming what is wrong with it. */
function parsePins(text: string, repo: string): Pins {
  const parsed = JSON.parse(text) as unknown;
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const isUpstream = (value: unknown): value is PinnedUpstream =>
    isRecord(value) && typeof value.ref === "string" && typeof value.remoteName === "string" && typeof value.remoteRef === "string";
  if (!isRecord(parsed) || !isRecord(parsed.remotes) || !isRecord(parsed.upstreams)) throw new Error("not a pin file");
  if (parsed.repo !== repo) throw new Error(`it pins ${JSON.stringify(parsed.repo)}, not this repository`);
  const remotes = Object.entries(parsed.remotes);
  const upstreams = Object.entries(parsed.upstreams);
  if (!remotes.every(([, url]) => typeof url === "string")) throw new Error("a remote's URL is not a string");
  if (!upstreams.every(([, upstream]) => isUpstream(upstream))) throw new Error("an upstream is malformed");
  return {
    remotes: new Map(remotes as Array<[string, string]>),
    upstreams: new Map(upstreams as Array<[string, PinnedUpstream]>),
  };
}
