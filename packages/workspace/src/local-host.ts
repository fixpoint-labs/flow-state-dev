/**
 * A workspace host on the machine the flow runs on.
 *
 * A **workspace host** turns a run source's answer into a directory a worker
 * can edit, saves the work back, and lets the directory go. This one keeps
 * everything under one host directory:
 *
 * ```
 * <root>/.clones/<clone-key>.git    one bare clone per remote, shared by every run
 * <root>/.clones/<clone-key>.lock   held while a provision works on that clone
 * <root>/<place…>/
 *     .lock        held while a provision works on this place
 *     .checkout.provisioning   present while `git worktree add` runs
 *     checkout/    a git worktree on the run's own branch (a repository run)
 *     project/     the kept files, beside the checkout and never inside it
 *     workspace/   the kept files as the working directory (a run with no repository)
 * ```
 *
 * Three rules shape it, and each is enforced here rather than trusted to the
 * caller:
 *
 * - **A remote is judged before git sees it** (`./remotes`). A refused remote
 *   starts no process at all, and every process that does start can reach
 *   only the transports the allowlist names.
 * - **Existing work is never discarded.** A checkout already on disk is handed
 *   back as it is — no fetch, no reset, no rebase — and one this host cannot
 *   explain is refused, not cleared. Only a NEW branch is cut from a freshly
 *   fetched remote.
 * - **The kept files are the record, the directory is not.** `project/` and
 *   `workspace/` are hydrated from one key prefix of a collection and flushed
 *   back to it. A directory this process did not hydrate is rebuilt from the
 *   collection; one it did is handed back live, with its unsaved edits.
 *
 * Provisioning one place, or touching one clone, is held by a lock on disk
 * (`./lock`), so two hosts or two processes sharing a root wait for each
 * other rather than racing. The lock and marker names start with `.`, and a
 * place segment may not, so no place is ever named over them.
 *
 * Checkpoint and restore are declared and do nothing yet: holding a
 * repository's uncommitted work across a lost machine is a later slice, and
 * the seam is here so that slice adds behaviour rather than a method.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { GIT_TIMEOUT_MS, run } from "./exec";
import { createHostPlace } from "./host-place";
import { acquireLock, releaseLock } from "./lock";
import { assertScope, createProjection, type Projection } from "./projection";
import { allowedProtocols, checkRemote, redactRemote, type AllowedRemote } from "./remotes";
import type { RunFiles, RunSource, RunSourceAnswer } from "./run-source";
import type { FlushReport } from "./types";

/** The directory names inside a place. People and agents read them. */
const CHECKOUT_DIR = "checkout";
const PROJECT_DIR = "project";
const WORKSPACE_DIR = "workspace";
/**
 * Where the shared clones live. Dot-prefixed, and a place segment may not
 * start with a dot, so no place can ever be named over it.
 */
const CLONES_DIR = ".clones";
/** The lock file in a place's directory, and beside each clone. */
const LOCK_SUFFIX = ".lock";
/**
 * Present in a place's directory from just before `git worktree add` until it
 * returns, so a checkout a killed `add` left half-built is identified rather
 * than handed to a run.
 */
const PROVISIONING_MARKER = ".checkout.provisioning";

/**
 * The host would not provision this run, and says why — before anything was
 * created and before any agent was paid for.
 *
 * `reason` is stable: `"invalid-remote"`, `"remote-not-allowed"`,
 * `"remote-unreadable"`, or whatever reason a run source refused with. A
 * caller should fail the run with it rather than retry: none of these clears
 * on its own.
 */
export class WorkspaceRefusedError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceRefusedError";
  }
}

export interface LocalWorkspaceHostOptions {
  /** The host directory every clone and place lives under. */
  root: string;
  /**
   * The remotes this host may reach. `allow` lists hosts, reached over
   * `https` or `ssh`, and may include `"file"` to permit `file://` remotes.
   */
  remotes: { allow: readonly string[] };
  /** Where each run's files come from. Kept on the host for its callers to ask. */
  source: RunSource;
}

/** Which place a run gets, named by its caller. */
export interface PlaceRequest {
  /**
   * The place's directory under the root, one segment per level — typically
   * whatever identifies the run, outermost first. Each segment is a plain
   * name: no separators, nothing starting with `.`.
   */
  place: readonly string[];
  /** The run's own branch. Required for a repository run. */
  branch?: string;
}

/** A provisioned place. Hand it back to `save`, `checkpoint`, `restore` and `release`. */
export interface WorkspacePlace {
  /** Which kind of source made it. */
  kind: "repo" | "files";
  /** The place's directory. */
  dir: string;
  /** Where the worker runs: `checkout/` for a repository, `workspace/` otherwise. */
  cwd: string;
  /** The directory synced with the kept files, when the run has any. */
  filesDir?: string;
  /** What the checkout is, for a repository run. Record `remote` and `baseRef` on the run. */
  repo?: {
    /** The remote as the source gave it. */
    remote: string;
    /** The shared clone this checkout is a worktree of. Log it so an operator can find it. */
    clone: string;
    branch: string;
    /** Whether this call cut the branch. `false` for a checkout handed back. */
    created: boolean;
    /** The remote branch the run's branch was cut from. Only when `created`. */
    baseRef?: string;
    /** The commit it was cut at. Only when `created`. */
    baseCommit?: string;
  };
}

/** Provision, save and release the places runs work in. */
export interface WorkspaceHost {
  /** The host directory. */
  readonly root: string;
  /** The run source the host was built with. Ask it, then hand its answer to `provision`. */
  readonly source: RunSource;
  /**
   * Make (or hand back) the place for one run.
   *
   * Rejects with a `WorkspaceRefusedError` for a refused source or remote,
   * before any git process or directory exists.
   */
  provision(answer: RunSourceAnswer, request: PlaceRequest): Promise<WorkspacePlace>;
  /**
   * Flush the place's kept files back to their collection. A conflict is an
   * outcome in the report, never an overwrite. A place with no kept files
   * reports nothing.
   */
  save(place: WorkspacePlace): Promise<FlushReport>;
  /** Hold uncommitted repository work durably. Declared for a later slice; does nothing yet. */
  checkpoint(place: WorkspacePlace): Promise<void>;
  /** Bring held work back to a lost place. Declared for a later slice; does nothing yet. */
  restore(place: WorkspacePlace): Promise<void>;
  /**
   * Let the place go. The directory is kept; the live link to its kept files
   * is dropped, so a later provision rebuilds them from the collection.
   */
  release(place: WorkspacePlace): Promise<void>;
}

const EMPTY_REPORT: FlushReport = { outcomes: [], conflicts: [], contested: [] };

/** Build a workspace host over a directory on this machine. */
export function localWorkspaceHost(options: LocalWorkspaceHostOptions): WorkspaceHost {
  const root = resolve(options.root);
  const allow = options.remotes.allow;
  const env = {
    GIT_ALLOW_PROTOCOL: allowedProtocols(allow),
    // A remote that wants a password fails instead of waiting on a prompt
    // nobody will answer.
    GIT_TERMINAL_PROMPT: "0",
  };

  /** Live kept-files projections, by the directory they fill. */
  const live = new Map<string, Promise<Projection>>();
  /** The tail of each place's and each clone's queue, in this process. */
  const queues = new Map<string, Promise<unknown>>();

  async function git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await run("git", args, { cwd, timeoutMs: GIT_TIMEOUT_MS, env });
    return stdout.trim();
  }

  /**
   * Run `operation` after every earlier one under the same key has settled.
   * Queues this process's own callers, so they wait without polling the lock
   * on disk.
   */
  function serially<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    queues.set(key, next);
    void next
      .catch(() => undefined)
      .finally(() => {
        if (queues.get(key) === next) queues.delete(key);
      });
    return next;
  }

  /**
   * Run `operation` holding the lock at `lockPath`: queued behind this
   * process's earlier callers, then behind any other host's on disk.
   */
  function locked<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
    return serially(lockPath, async () => {
      const lease = await acquireLock(lockPath);
      try {
        return await operation();
      } finally {
        releaseLock(lease);
      }
    });
  }

  /** The place's directory, refusing any name that could leave the root or shadow the clones. */
  function placeDir(segments: readonly string[]): string {
    const bad = segments.find(
      (s) => s === "" || s.startsWith(".") || s.includes("/") || s.includes("\\") || s.includes("\0"),
    );
    if (segments.length === 0 || bad !== undefined) {
      throw new Error(
        `a place is named by plain directory segments — none empty, none containing a ` +
          `separator, none starting with "." — got ${JSON.stringify(segments)}.`,
      );
    }
    const dir = resolve(root, ...segments);
    const rel = relative(root, dir);
    if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
      throw new Error(`the place ${JSON.stringify(segments)} is not inside the host's root ${root}.`);
    }
    return dir;
  }

  /**
   * Fill `<dir>/<name>` from one key prefix of `files`, or hand back the live
   * one this process already filled.
   *
   * A directory with no live projection behind it is cleared and hydrated
   * again. Its contents were either saved — and so are in the collection — or
   * were never saved by this process, and a projection that adopted them would
   * read every file as new and could resurrect one another run deleted.
   */
  function provisionFiles(dir: string, name: string, projectId: string, files: RunFiles): Promise<Projection> {
    const filesDir = join(dir, name);
    const existing = live.get(filesDir);
    if (existing !== undefined && existsSync(filesDir)) return existing;

    const made = (async () => {
      rmSync(filesDir, { recursive: true, force: true });
      mkdirSync(filesDir, { recursive: true });
      const projection = createProjection({
        place: createHostPlace(dir),
        mounts: [
          {
            prefix: name,
            scope: projectId,
            collection: files.collection,
            collectionId: files.collectionId,
            writable: true,
          },
        ],
      });
      await projection.hydrate();
      return projection;
    })();
    live.set(filesDir, made);
    made.catch(() => {
      if (live.get(filesDir) === made) live.delete(filesDir);
    });
    return made;
  }

  /**
   * `true` when the clone holds `refs/heads/<branch>`. Local; never touches the
   * remote. Only git's "no such ref" answer is `false`; any other failure is
   * raised, so a clone git cannot read is not taken for one without the branch.
   */
  async function hasBranch(clone: string, branch: string): Promise<boolean> {
    try {
      await git(clone, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
      return true;
    } catch (error) {
      if (gitAnsweredNo(error)) return false;
      throw error;
    }
  }

  /**
   * Does this checkout look like a `git worktree add` that was killed
   * part-way, with nothing worked in it since? Ported from harness-manager's
   * `looksHalfBuilt`.
   *
   * A killed `add` can leave `.git`, the branch and the worktree registration
   * in place with tracked files missing. So: no `.git` at all, or tracked
   * files missing and NOTHING else changed — no edit, no addition, no staged
   * change. A missing file alone is not enough, because a run that deletes a
   * file reads the same; anything an agent could have written means work, and
   * work is never cleared. A tree git cannot answer about does not look
   * half-built: unknown never authorises a delete.
   */
  async function looksHalfBuilt(checkout: string): Promise<boolean> {
    if (!existsSync(join(checkout, ".git"))) return true;
    try {
      if ((await git(checkout, ["ls-files", "--deleted"])) === "") return false;
      return everyChangeIsADeletion(await git(checkout, ["status", "--porcelain", "--untracked-files=all"]));
    } catch {
      return false;
    }
  }

  /**
   * Fetch the remote into `clone` and record its default branch.
   *
   * The default branch is read from the remote every time rather than kept,
   * so a remote that renamed `main` to `trunk` is followed on the next new
   * branch instead of cut from a ref that no longer moves.
   */
  async function refresh(clone: string, remote: AllowedRemote): Promise<string> {
    try {
      const head = await git(clone, ["ls-remote", "--symref", "--", remote.url, "HEAD"]);
      const match = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(head);
      if (match === null) throw new Error("the remote reports no default branch");
      const defaultBranch = match[1]!;
      await git(clone, ["fetch", "--quiet", "--prune", "--", remote.url, "+refs/heads/*:refs/remotes/origin/*"]);
      await git(clone, ["symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${defaultBranch}`]);
      return defaultBranch;
    } catch (error) {
      throw unreadable(remote, error);
    }
  }

  /** The clone for `remote`, made whole and in place, and whether this call made it. */
  async function ensureClone(remote: AllowedRemote, clone: string): Promise<{ fresh: boolean; defaultBranch?: string }> {
    if (existsSync(clone)) return { fresh: false };
    mkdirSync(join(root, CLONES_DIR), { recursive: true });
    const making = `${clone}.making-${randomUUID()}`;
    try {
      await git(root, ["init", "--quiet", "--bare", making]);
      const defaultBranch = await refresh(making, remote);
      try {
        renameSync(making, clone);
      } catch (error) {
        // Another process finished its clone first. Theirs is whole, and
        // ours is redundant.
        if (!existsSync(clone)) throw error;
        rmSync(making, { recursive: true, force: true });
        return { fresh: false };
      }
      return { fresh: true, defaultBranch };
    } catch (error) {
      rmSync(making, { recursive: true, force: true });
      throw error;
    }
  }

  /** Called holding the place's lock. */
  async function provisionCheckout(
    remote: AllowedRemote,
    baseRef: string | undefined,
    dir: string,
    branch: string,
  ): Promise<NonNullable<WorkspacePlace["repo"]>> {
    const clone = join(root, CLONES_DIR, `${remote.cloneKey}.git`);
    const checkout = join(dir, CHECKOUT_DIR);
    const marker = join(dir, PROVISIONING_MARKER);
    const shown = redactRemote(remote.url);

    // A checkout already here is the last attempt's work. It is handed back
    // as it is, or refused — never fetched, reset or rebased.
    const handBack = async (): Promise<NonNullable<WorkspacePlace["repo"]>> => {
      if (!existsSync(join(checkout, ".git"))) {
        throw new Error(
          `the checkout at ${checkout} has no .git, so it is not one this host made. It may ` +
            `hold work, and nothing here clears it — inspect it and remove it by hand.`,
        );
      }
      const head = await git(checkout, ["rev-parse", "--abbrev-ref", "HEAD"]);
      if (head !== branch) {
        throw new Error(
          `the checkout at ${checkout} is on branch "${head}", not "${branch}". Refusing to ` +
            `use it, and nothing here resets a tree — restore the branch or remove the checkout.`,
        );
      }
      // Compared as real paths: git answers with one, and a root under a
      // symlinked directory would otherwise never match.
      const common = realpathSync(resolve(checkout, await git(checkout, ["rev-parse", "--git-common-dir"])));
      if (!existsSync(clone) || common !== realpathSync(clone)) {
        throw new Error(
          `the checkout at ${checkout} is not a worktree of the clone of "${shown}". Refusing ` +
            `to hand it to a run that expects that repository; it may hold work, so it is kept.`,
        );
      }
      return { remote: remote.url, clone, branch, created: false };
    };

    if (existsSync(checkout)) {
      // The marker alone does not clear a tree: it sits where a run could
      // write it. The tree has to agree that it is half-built, and when the
      // two disagree the tree is kept and refused, not reused or cleared.
      const marked = existsSync(marker);
      if (!marked || !(await looksHalfBuilt(checkout))) {
        if (marked && existsSync(join(checkout, ".git"))) {
          throw new Error(
            `${marker} records an interrupted provision, but the checkout at ${checkout} is ` +
              `not a half-built one — it holds more than missing files. One of the two is ` +
              `wrong and this will not guess: the tree may hold work. Inspect it, then delete ` +
              `the marker to reuse the checkout or delete the checkout to have it rebuilt.`,
          );
        }
        return await handBack();
      }
      // Never used: the provision that made it never returned it to a run.
      rmSync(checkout, { recursive: true, force: true });
    }

    /** `git worktree add`, with the marker up for exactly as long as it runs. */
    const addWorktree = async (clone: string, args: string[]): Promise<void> => {
      writeFileSync(marker, "");
      await git(clone, ["worktree", "add", "--quiet", ...args]);
      rmSync(marker, { force: true });
    };

    return await locked(join(root, CLONES_DIR, `${remote.cloneKey}${LOCK_SUFFIX}`), async () => {
      const made = await ensureClone(remote, clone);
      // Bookkeeping for a worktree whose directory was removed, which would
      // otherwise make `worktree add` refuse the path. Not a reset: it
      // touches no tree.
      await git(clone, ["worktree", "prune"]);

      // The run's branch already exists: its checkout was lost, the run was
      // not. Put the branch back where it was — without a fetch, so nothing
      // it started from moves.
      if (!made.fresh && (await hasBranch(clone, branch))) {
        await addWorktree(clone, [checkout, branch]);
        return { remote: remote.url, clone, branch, created: false };
      }

      const defaultBranch = made.fresh ? made.defaultBranch! : await refresh(clone, remote);
      const base = baseRef ?? defaultBranch;
      let baseCommit: string;
      try {
        baseCommit = await git(clone, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}^{commit}`]);
      } catch {
        throw new WorkspaceRefusedError(
          "remote-unreadable",
          `the remote "${shown}" has no branch "${base}" to cut the run's branch from.`,
        );
      }
      await addWorktree(clone, ["-b", branch, checkout, baseCommit]);
      return { remote: remote.url, clone, branch, created: true, baseRef: base, baseCommit };
    });
  }

  async function provision(answer: RunSourceAnswer, request: PlaceRequest): Promise<WorkspacePlace> {
    if (answer.kind === "refused") throw new WorkspaceRefusedError(answer.reason, answer.message);
    const dir = placeDir(request.place);

    if (answer.kind === "files") {
      assertScope(answer.projectId);
      const filesDir = join(dir, WORKSPACE_DIR);
      await locked(join(dir, LOCK_SUFFIX), () => provisionFiles(dir, WORKSPACE_DIR, answer.projectId, answer.files));
      return { kind: "files", dir, cwd: filesDir, filesDir };
    }

    // The key prefix is checked before anything is made, so a bad one never
    // leaves a checkout behind with no kept files beside it.
    if (answer.projectId !== undefined) assertScope(answer.projectId);
    if ((answer.projectId === undefined) !== (answer.files === undefined)) {
      throw new Error(
        "a repository source names its kept files with both projectId and files, or neither — " +
          "one without the other has no key prefix to keep them under.",
      );
    }
    const branch = request.branch;
    if (branch === undefined || !isPlainBranch(branch)) {
      throw new Error(`a repository run needs a plain branch name to cut; got ${JSON.stringify(branch)}.`);
    }
    // Judged before anything is created or spawned.
    const remote = checkRemote(answer.repo, allow);
    if ("reason" in remote) throw new WorkspaceRefusedError(remote.reason, remote.message);

    return await locked(join(dir, LOCK_SUFFIX), async () => {
      const repo = await provisionCheckout(remote, answer.baseRef, dir, branch);
      const place: WorkspacePlace = { kind: "repo", dir, cwd: join(dir, CHECKOUT_DIR), repo };
      if (answer.projectId !== undefined && answer.files !== undefined) {
        await provisionFiles(dir, PROJECT_DIR, answer.projectId, answer.files);
        place.filesDir = join(dir, PROJECT_DIR);
      }
      return place;
    });
  }

  async function save(place: WorkspacePlace): Promise<FlushReport> {
    if (place.filesDir === undefined) return EMPTY_REPORT;
    const projection = live.get(place.filesDir);
    if (projection === undefined) {
      throw new Error(
        `the place at ${place.dir} has no live kept files in this process — it was released, ` +
          `or provisioned elsewhere. Provision it again before saving.`,
      );
    }
    return await (await projection).flush();
  }

  return {
    root,
    source: options.source,
    provision,
    save,
    async checkpoint() {},
    async restore() {},
    async release(place) {
      if (place.filesDir !== undefined) live.delete(place.filesDir);
    },
  };
}

/** The remote could not be read; say which one, and never with a credential. */
function unreadable(remote: AllowedRemote, error: unknown): WorkspaceRefusedError {
  if (error instanceof WorkspaceRefusedError) return error;
  const shown = redactRemote(remote.url);
  const detail = String((error as { stderr?: unknown })?.stderr ?? (error as Error)?.message ?? error)
    .split("\n")
    .find((line) => line.trim() !== "")
    ?.trim();
  return new WorkspaceRefusedError(
    "remote-unreadable",
    `the remote "${shown}" could not be read${detail ? `: ${detail}` : ""}.`,
  );
}

/**
 * Did git answer **no**, or did the probe itself fail? Ported from
 * harness-manager: a ref probe exits 1, unkilled, when the ref is absent; a
 * timeout comes back `killed`, an unreadable repository exits 128, and a git
 * that cannot be spawned carries a string `code`.
 */
function gitAnsweredNo(error: unknown): boolean {
  const { code, killed } = (error ?? {}) as { code?: unknown; killed?: unknown };
  return killed !== true && code === 1;
}

/**
 * Whether every entry of `git status --porcelain` is a deletion — files
 * removed, nothing added, edited, renamed or staged. Ported from
 * harness-manager's `everyChangeIsADeletion`.
 */
function everyChangeIsADeletion(porcelain: string): boolean {
  for (const line of porcelain.split("\n")) {
    if (line.length === 0) continue;
    if (line[0] !== " " && line[0] !== "D") return false;
    if (line[1] !== " " && line[1] !== "D") return false;
  }
  return true;
}

/**
 * A branch name this host will hand to git: nothing git would read as an
 * option, and none of the spellings a ref refuses. Git checks the rest.
 */
function isPlainBranch(branch: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) &&
    !/\.\.|\/\/|\/\.|\.lock$|\.lock\/|\/$|\.$/.test(branch)
  );
}
