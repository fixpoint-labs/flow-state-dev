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
 * <root>/.clones/<clone-key>.fetched.json  when that clone was last fetched, and its default branch
 * <root>/<place…>/
 *     .lock        held while a provision works on this place
 *     .checkout.provisioning   present while `git worktree add` runs
 *     .checkout.setup          present while the operator's setup command is owed
 *     checkout/    a git worktree on the run's own branch (a repository run)
 *     project/     the kept files, beside the checkout and never inside it
 *     workspace/   the kept files as the working directory (a run with no repository)
 *
 * <root>/<place…>/                  a repository the operator named in
 *                                   `localRepositories`, with no kept files: the
 * <root>/<place…>.provisioning      place IS the checkout, with its marker and lock
 * <root>/<place…>.place.lock        beside it (and `<place…>.setup`, its setup
 *                                   marker), and the branch kept in that
 *                                   repository, never cloned
 * <root>/.fetch-pins/<key>.json     each such repository's remote URLs and branch
 *                                   upstreams, as a host start first saw them
 * ```
 *
 * A repository the operator named, answered WITH kept files, is laid out like
 * a remote run's place: its worktree in `checkout/` and the files in
 * `project/` beside it, the branch still kept in that repository.
 *
 * Three rules shape it, and each is enforced here rather than trusted to the
 * caller:
 *
 * - **A remote is judged before git sees it** (`./remotes`). A refused remote
 *   starts no process at all, and every process that does start can reach
 *   only the transports the allowlist names. The one exception is a listed
 *   repository's own upstream, which listing it admits: judged for shape
 *   all the same, and fetched speaking only its own scheme.
 * - **Existing work is never discarded.** A checkout already on disk is handed
 *   back as it is — no fetch, no reset, no rebase — and one this host cannot
 *   explain is refused, not cleared. Only a NEW branch is cut from a freshly
 *   fetched remote, and in a repository the operator named, from the newer of
 *   its base and that base's freshly fetched upstream.
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
 * **Held work is off unless the operator gives the host a held-work store**
 * (`heldWork`). With one, and a source that names a `heldPrefix` for a run cut
 * from a remote, `checkpoint` holds the run's commits and files in the store
 * and `provision` rebuilds a lost checkout from them (`./held-work`). Without
 * either, neither does anything, and the host is what it was:
 *
 * ```
 * <root>/.host-id                   this host's identity; hosts sharing a root share it
 * <root>/<place…>/held/             a held snapshot laid out for a person, after a mismatch
 * <root>/<place…>/checkout.stale-…  a checkout another host's record replaced, kept
 * ```
 */
import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { GIT_TIMEOUT_MS, run } from "./exec";
import {
  asideName,
  assertHeldPrefix,
  type Git,
  HeldWorkMismatchError,
  type HeldWork,
  type HeldWorkMismatchField,
  type HeldWorkStore,
  packFromBase,
  placeKeyPrefix,
  type RecordedHold,
  scratchDir,
  sha256,
  snapshotWorkingTree,
} from "./held-work";
import { createHostPlace } from "./host-place";
import { acquireLock, HOST_LOCK_BOUNDS, releaseLock, tryAcquireLock } from "./lock";
import { assertScope, createProjection, type Projection } from "./projection";
import { allowedProtocols, checkRemote, checkRemoteShape, redactRemote, withoutCredential, type AllowedRemote } from "./remotes";
import type { RepoRunSource, RunFiles, RunSource, RunSourceAnswer } from "./run-source";
import {
  checkSourcePath,
  globPaths,
  looksBinary,
  matchCap,
  matchesCut,
  readBody,
  readKeptFiles,
  snippetOf,
  SOURCE_READ_FRESH_MS,
  type GrepDialect,
  type SourceReadAt,
  type SourceReadRequest,
  type SourceReadResult,
} from "./source-read";
import type { FlushReport, Place } from "./types";
import { pinFetchSettings } from "./repository";
import { WorkspaceRefusedError } from "./refused";
import { setUpCheckout, type PlaceSetup, type WorkspaceSetup } from "./setup";
import { firstLine, gitAnsweredNo, ignoredProblem, isAncestor, NO_HOOKS, provisionWorktree, remainingBudget, type IgnoredDirectory, type MovedBack, type OffBranch } from "./worktree";

/** The directory names inside a place. People and agents read them. */
const CHECKOUT_DIR = "checkout";
const PROJECT_DIR = "project";
const WORKSPACE_DIR = "workspace";
/**
 * Where the shared clones live. Dot-prefixed, and a place segment may not
 * start with a dot, so no place can ever be named over it.
 */
const CLONES_DIR = ".clones";
/** Beside each clone: when it was last fetched, for every host sharing the root. */
const FETCHED_SUFFIX = ".fetched.json";
/**
 * The most a read loads of one file. Past it, a read answers `too-large`
 * rather than buffering the file whole to return its first lines.
 */
const READ_LOAD_MAX_BYTES = 64 * 1024 * 1024;
/** The most output one read's git listing or search may produce. */
const READ_OUTPUT_MAX_BYTES = 256 * 1024 * 1024;
/** The lock file in a place's directory, and beside each clone. */
const LOCK_SUFFIX = ".lock";
/**
 * Present in a place's directory from just before `git worktree add` until it
 * returns, so a checkout a killed `add` left half-built is identified rather
 * than handed to a run.
 */
const PROVISIONING_MARKER = ".checkout.provisioning";
/**
 * A local repository's place is its checkout, so its marker and lock sit
 * beside the place rather than in it. Different from `.lock`, which a caller
 * may already hold beside its own checkout.
 */
const LOCAL_MARKER_SUFFIX = ".provisioning";
const LOCAL_LOCK_SUFFIX = ".place.lock";
/**
 * Present beside a checkout from just before the operator's setup command
 * starts until it succeeds (`./setup`), so a failed or killed setup runs again
 * on the next provision.
 */
const SETUP_MARKER = ".checkout.setup";
const LOCAL_SETUP_SUFFIX = ".setup";
/** This host's identity, in its root. Dot-prefixed, so no place is named over it. */
const HOST_ID_FILE = ".host-id";
/** Where a held snapshot is laid out for a person, beside the checkout. */
const HELD_DIR = "held";
/**
 * The share of a provision's remaining budget a local repository's upstream
 * fetch may take, so one that hangs still leaves time to cut the branch.
 */
const FETCH_BUDGET_SHARE = 0.5;

/** The host's typed refusal, defined in `./refused` and exported from here as it always was. */
export { WorkspaceRefusedError };

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
  /**
   * Repositories on this machine that runs are cut from directly, as their
   * absolute paths. A source answering one of these paths as its `repo` gets a
   * worktree of that repository itself: no clone, and the run's branch kept
   * in it. When the source names no kept files, the place's directory is the
   * checkout; when it names them, the worktree is the place's `checkout/` and
   * the files are in `project/` beside it.
   *
   * A NEW branch whose base tracks an upstream is cut from the newer of the
   * two, after fetching that one upstream branch into its tracking ref; a
   * base and upstream that have each moved are refused as `base-diverged`,
   * and a fetch that fails or is skipped starts the run from the local base,
   * with a warning. Listing a path admits fetching its own upstream:
   * `remotes.allow` isn't asked, though the URL is still judged for shape
   * before git sees it. Each listed path's remote URLs and branch upstreams
   * are pinned in `<root>/.fetch-pins/` the first time a host start sees
   * them, and kept across restarts; a remote whose URL has changed since (a
   * run shares the repository's config) is not fetched, with a warning that
   * names the pin file to delete to accept the change, and the fetch obeys
   * no program-running setting in the repository's own config.
   *
   * A run in a listed repository acts with the operator's own trust: it can
   * move the repository's branches and refs as they can. Keep a run that
   * must not do that in a separate clone, not in this list.
   *
   * Any other bare path is still refused. Listing a path is the operator's
   * allowance, judged before any git process, the same as `remotes.allow`.
   */
  localRepositories?: readonly string[];
  /**
   * How long one whole provision may take, every git command in it included,
   * in milliseconds. Defaults to ten minutes. A caller that holds a lock
   * across provisioning reads it as the longest provisioning can hold it.
   */
  provisionTimeoutMs?: number;
  /** The clock the provision budget is measured on. For tests. */
  now?: () => number;
  /**
   * A command run in each repository checkout this host makes, before it is
   * handed over: `{ command: ["pnpm", "install", "--frozen-lockfile",
   * "--prefer-offline"] }`, say. Absent by default, and then nothing runs.
   *
   * It runs once per fresh checkout, and again on the next provision until it
   * exits 0. It is the last step of the provision and draws from its one
   * budget, so raise `provisionTimeoutMs` to cover it. A failure doesn't fail
   * the provision: the checkout is handed over with `place.setup` saying what
   * went wrong. A place with no repository runs nothing. See `./setup`.
   */
  setup?: WorkspaceSetup;
  /**
   * Where a run's held work goes. Absent by default, and then holding is off:
   * `checkpoint` returns `null` and starts no process, and `provision` does
   * what it always did, except that it rejects a recorded hold it cannot use
   * (`HeldWorkMismatchError`, `field: "disabled"`).
   *
   * With a store, a repository run cut from a remote whose source names a
   * `heldPrefix` is held at each `checkpoint`, and rebuilt from it by
   * `provision` on any host sharing the store.
   */
  heldWork?: HeldWorkStore;
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
  /**
   * A directory inside the checkout that the repository must keep out of git.
   * A checkout whose repository tracks the caller's files there, or does not
   * ignore the directory, is refused before it is handed over, and one this
   * call made is removed again.
   *
   * For a run with no repository, the same directory inside `workspace/` is
   * left out of the kept files: `save` never writes it to the collection.
   */
  ignored?: IgnoredDirectory;
  /**
   * What the run's record says about the place, from an earlier provision.
   * Omitted on a first provision, and on a record written before held work
   * existed: the place is provisioned as it always was.
   */
  recorded?: RecordedPlace;
  /**
   * Told when the recorded place is not live here (`lost`), and when the
   * host starts rebuilding it from held work (`restoring`), so the caller
   * can record each before it happens. Awaited.
   */
  progress?: (state: "lost" | "restoring") => void | Promise<void>;
  /**
   * Told just before the host's setup command starts in this place's checkout
   * (`LocalWorkspaceHostOptions.setup`), so the caller can say the run is
   * waiting on it. Awaited. Never called when nothing runs.
   */
  onSetup?: () => void | Promise<void>;
}

/** What a run's record says about its place. Every field may be absent. */
export interface RecordedPlace {
  /** The host the place was last ready on. See `WorkspaceHost.hostId`. */
  host?: string | null;
  /** The run's last hold, as `checkpoint` returned it. */
  held?: RecordedHold | null;
  /** The remote the run was cut from. A rebuild refuses another (`field: "remote"`). */
  remote?: string | null;
  /** The run's branch. A rebuild refuses another (`field: "branch"`). */
  branch?: string | null;
  /** The branch the run was cut from, for a hold on a place provisioned before holding was on. */
  baseRef?: string | null;
}

/**
 * Where a repository place came from. `new`: cut for the first time. `live`:
 * on this host already, handed back as it was. `held`: rebuilt from held
 * work. `base`: recorded elsewhere with nothing held, so cut again from the
 * base.
 */
export type PlaceOrigin = "new" | "live" | "held" | "base";

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
  /**
   * Which provision of the place this is, when it has kept files. A place
   * provisioned again hands its kept files to the newer provision, so `save`
   * refuses an older one and `release` leaves the newer one's link alone.
   */
  holder?: string;
  /** What the checkout is, for a repository run. Record `remote` and `baseRef` on the run. */
  repo?: {
    /** The remote as the source gave it. */
    remote: string;
    /**
     * The repository this checkout is a worktree of: the shared clone, or the
     * local repository itself. Log it so an operator can find it.
     */
    clone: string;
    branch: string;
    /**
     * Whether this call made the checkout: it cut the branch, or checked out a
     * branch that already existed into a new tree (a rebuild from held work
     * included). `false` for a checkout handed back.
     */
    created: boolean;
    /**
     * The ref the run's branch was cut from, as asked (`"HEAD"` when none was
     * named). Only when `created`.
     */
    baseRef?: string;
    /** The commit it was cut at. Only when `created`. */
    baseCommit?: string;
    /**
     * Present when the checkout was handed back off the run's branch and moved
     * back onto it (see `MovedBack`). Tell the run, which may still think it is
     * on the branch it switched to.
     */
    movedBack?: MovedBack;
    /**
     * Present when the checkout was handed back off the run's branch and left
     * there, because moving it would move uncommitted changes (see
     * `OffBranch`). Tell the run; a caller that must only run on the run's
     * branch refuses with its `message`.
     */
    offBranch?: OffBranch;
  };
  /** Where a repository place came from. */
  origin?: PlaceOrigin;
  /**
   * What the host's setup command came to, when this provision ran it
   * (`LocalWorkspaceHostOptions.setup`). Absent when nothing ran: no setup
   * configured, or a checkout already set up.
   */
  setup?: PlaceSetup;
  /**
   * Present only when holding applies to this place: the host has a held-work
   * store, the source named a `heldPrefix`, and the branch came from a remote.
   */
  holding?: {
    /** Every key this place's holds use starts with it. */
    keyPrefix: string;
    /** The commit holds pack from. */
    base: string;
    /** The host that provisioned it. */
    host: string;
  };
  /**
   * Where a held snapshot was laid out beside the checkout, after its owner
   * answered a mismatch. Absent when it could not be read.
   */
  heldDir?: string;
}

/** Provision, save and release the places runs work in. */
export interface WorkspaceHost {
  /** The host directory. */
  readonly root: string;
  /** The run source the host was built with. Ask it, then hand its answer to `provision`. */
  readonly source: RunSource;
  /** The budget one provision is held to. See `LocalWorkspaceHostOptions.provisionTimeoutMs`. */
  readonly provisionTimeoutMs: number;
  /**
   * Where `provision` would put a place for this answer, without making
   * anything: its directory, and where the worker runs. For a caller that
   * has to name the working directory (in a prompt, say) before provisioning.
   */
  locate(answer: RunSourceAnswer, request: Pick<PlaceRequest, "place">): { dir: string; cwd: string };
  /**
   * Make (or hand back) the place for one run.
   *
   * Rejects with a `WorkspaceRefusedError` for a refused source or remote,
   * before any git process or directory exists. Rejects with a
   * `HeldWorkMismatchError` when the recorded held work disagrees with the
   * record or this host cannot use it, with nothing held changed.
   */
  provision(answer: RunSourceAnswer, request: PlaceRequest): Promise<WorkspacePlace>;
  /**
   * Flush the place's kept files back to their collection. A conflict is an
   * outcome in the report, never an overwrite. A place with no kept files
   * reports nothing. Refuses a place provisioned again since: its kept files
   * are the newer provision's to save.
   */
  save(place: WorkspacePlace): Promise<FlushReport>;
  /**
   * This host's identity: kept in `<root>/.host-id`, so hosts sharing a root
   * share it. Record it as the place's host.
   */
  hostId(): string;
  /** Whether holding applies to a run with this answer. `false` on a host with no held-work store. */
  holds(answer: RunSourceAnswer): boolean;
  /**
   * Hold the place's work: snapshot its working tree on top of its head, pack
   * every object from its base to that snapshot, and `put` the pack under a
   * new key. Writes no ref, never touches the checkout's own index, and never
   * contacts the remote.
   *
   * `null` unless holding applies to the place. When the snapshot equals
   * `recorded`'s, nothing is written and the result says `unchanged`.
   * Record the result after this resolves, then `dropHeld` the key it replaced.
   */
  checkpoint(
    place: WorkspacePlace,
    recorded?: Pick<HeldWork, "snapshot" | "sha256" | "bytes"> | null,
  ): Promise<HeldWork | null>;
  /**
   * Delete one held pack of this place. Refuses a key outside the place's
   * prefix; resolves when the key is already gone.
   */
  dropHeld(place: WorkspacePlace, key: string): Promise<void>;
  /** Does nothing: `provision` rebuilds a lost place from held work. */
  restore(place: WorkspacePlace): Promise<void>;
  /**
   * Let the place go. The directory is kept; the live link to its kept files
   * is dropped, so a later provision rebuilds them from the collection. Does
   * nothing for a place provisioned again since.
   */
  release(place: WorkspacePlace): Promise<void>;
  /**
   * Read the files `answer` names, without a run: list paths by a glob, read
   * one file's lines, or search the files. Optional: a host without it offers
   * no reads, and a caller that needs them refuses it when it is built.
   *
   * Nothing is made but the shared clone, and nothing is written. A
   * repository is read at one commit of the remote's default branch, never
   * a run's own branch; a checkout listed in `localRepositories` at the base
   * a new run there would be cut from; kept files from their collection.
   * Every result is held to `SOURCE_READ_LIMITS` and says when it was cut.
   *
   * Rejects with a `WorkspaceRefusedError` for a refused answer, a remote the
   * host may not reach, or a path that is not a repository path.
   */
  readSource?(answer: RunSourceAnswer, request: SourceReadRequest): Promise<SourceReadResult>;
}

const EMPTY_REPORT: FlushReport = { outcomes: [], conflicts: [], contested: [] };

/** Build a workspace host over a directory on this machine. */
export function localWorkspaceHost(options: LocalWorkspaceHostOptions): WorkspaceHost {
  const root = resolve(options.root);
  const allow = options.remotes.allow;
  const localRepositories = new Set((options.localRepositories ?? []).map((path) => resolve(path)));
  const fetchPins = new Map([...localRepositories].map((path) => [path, pinFetchSettings(root, path)] as const));
  const provisionTimeoutMs = options.provisionTimeoutMs ?? GIT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const env = {
    GIT_ALLOW_PROTOCOL: allowedProtocols(allow),
    // A remote that wants a password fails instead of waiting on a prompt
    // nobody will answer.
    GIT_TERMINAL_PROMPT: "0",
  };

  /** Live kept-files projections, by the directory they fill. */
  const live = new Map<string, Promise<Projection>>();
  /** The latest provision of each live directory: the one `save` and `release` answer to. */
  const holders = new Map<string, string>();
  /** The tail of each place's and each clone's queue, in this process. */
  const queues = new Map<string, Promise<unknown>>();
  const heldWork = options.heldWork;
  let id: string | undefined;

  /** Git as the host runs it: none of the repository's hooks (`NO_HOOKS`), and this host's environment. */
  async function git(cwd: string, args: string[], timeoutMs: number): Promise<string> {
    const { stdout } = await run("git", [...NO_HOOKS, ...args], { cwd, timeoutMs, env });
    return stdout.trim();
  }

  /** Git for held work: one budget, extra environment and input per call, and no hooks, as `git`. */
  function heldGit(left: () => number): Git {
    return async (cwd, args, extra) => {
      const { stdout } = await run("git", [...NO_HOOKS, ...args], {
        cwd,
        timeoutMs: left(),
        env: { ...env, ...extra?.env },
        ...(extra?.input !== undefined ? { input: extra.input } : {}),
      });
      return extra?.raw === true ? stdout : stdout.trim();
    };
  }

  /**
   * This host's identity, made once and kept in the root. Written to a
   * temporary file and linked into place, so a host reading it never sees a
   * partial id, and two hosts racing to make it agree on the first.
   */
  function hostId(): string {
    if (id !== undefined) return id;
    mkdirSync(root, { recursive: true });
    const path = join(root, HOST_ID_FILE);
    if (!existsSync(path)) {
      const temporary = `${path}.${randomUUID()}`;
      writeFileSync(temporary, randomUUID());
      try {
        linkSync(temporary, path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    id = readFileSync(path, "utf8").trim();
    return id;
  }

  /**
   * A checkout is live here when it has a `.git` and no provisioning marker
   * beside it: a `worktree add` killed part-way leaves both, and that tree is
   * not the run's place.
   */
  function isLive(dir: string): boolean {
    return existsSync(join(dir, CHECKOUT_DIR, ".git")) && !existsSync(join(dir, PROVISIONING_MARKER));
  }

  /** Holding applies: a store, a prefix, and a branch cut from a remote. */
  function holds(answer: RunSourceAnswer): boolean {
    return (
      heldWork !== undefined &&
      answer.kind === "repo" &&
      answer.heldPrefix !== undefined &&
      localRepository(answer.repo) === undefined
    );
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
   *
   * **The wait draws from the provision's one deadline.** A caller holding a
   * lease across provisioning sizes it from `provisionTimeoutMs`, so time
   * spent queued for a place or a clone counts against that budget rather
   * than starting a fresh one once the lock is taken. A wait that outlasts
   * the deadline fails, and an operation whose turn comes after it never
   * starts.
   */
  function locked<T>(lockPath: string, deadline: number, operation: () => Promise<T>): Promise<T> {
    let started = false;
    const turn = serially(lockPath, async () => {
      started = true;
      const waitMs = Math.min(HOST_LOCK_BOUNDS.waitMs, remainingBudget(deadline, now));
      const lease = await acquireLock(lockPath, { ...HOST_LOCK_BOUNDS, waitMs }, { now });
      try {
        return await operation();
      } finally {
        releaseLock(lease);
      }
    });
    // The in-process queue has no clock of its own, so a turn still queued
    // at the deadline is abandoned here; when it does come, `remainingBudget`
    // stops it before it takes the lock. The wait on disk is bounded by
    // `waitMs` above.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          if (started) return;
          try {
            remainingBudget(deadline, now);
          } catch (error) {
            reject(error);
          }
        },
        Math.max(0, deadline - now()),
      );
      timer.unref?.();
    });
    return Promise.race([turn, expired]).finally(() => clearTimeout(timer));
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
  function provisionFiles(
    dir: string,
    name: string,
    projectId: string,
    files: RunFiles,
    ignored?: IgnoredDirectory,
  ): Promise<Projection> {
    const filesDir = join(dir, name);
    const existing = live.get(filesDir);
    if (existing !== undefined && existsSync(filesDir)) return existing;

    const made = (async () => {
      rmSync(filesDir, { recursive: true, force: true });
      mkdirSync(filesDir, { recursive: true });
      const projection = createProjection({
        place: leavingOut(createHostPlace(dir), ignored && `${name}/${ignored.dir.split(sep).join("/")}/`),
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
   * Fetch the remote into `clone` and record its default branch, stamping
   * the fetch beside the clone with that branch and its commit.
   *
   * The default branch is read from the remote every time rather than kept,
   * so a remote that renamed `main` to `trunk` is followed on the next new
   * branch instead of cut from a ref that no longer moves.
   */
  async function refresh(clone: string, remote: AllowedRemote, left: () => number, stamp = true): Promise<string> {
    let defaultBranch: string;
    try {
      const head = await git(clone, ["ls-remote", "--symref", "--", remote.url, "HEAD"], left());
      const match = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(head);
      if (match === null) throw new Error("the remote reports no default branch");
      defaultBranch = match[1]!;
      await git(clone, ["fetch", "--quiet", "--prune", "--", remote.url, "+refs/heads/*:refs/remotes/origin/*"], left());
      await git(clone, ["symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${defaultBranch}`], left());
    } catch (error) {
      throw unreadable(remote, error);
    }
    if (stamp) stampFetched(clone, defaultBranch, await fetchedTip(clone, remote, defaultBranch, left));
    return defaultBranch;
  }

  /** The commit `clone`'s fetch of `branch` landed on. */
  async function fetchedTip(clone: string, remote: AllowedRemote, branch: string, left: () => number): Promise<string> {
    try {
      return await git(clone, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}^{commit}`], left());
    } catch (error) {
      throw unreadable(remote, error);
    }
  }

  /**
   * Record that `clone` was just fetched, and the default branch and commit
   * it fetched, beside it, where every host sharing the root reads it.
   * Written whole and renamed into place, so a reader never sees half of it,
   * and reads serve that commit rather than resolving refs a later fetch may
   * be pruning. Best effort: a stamp that fails to land only makes the next
   * read fetch again.
   */
  function stampFetched(clone: string, branch: string, commit: string): void {
    const file = fetchedFile(clone);
    const temporary = `${file}.${randomUUID()}`;
    try {
      writeFileSync(temporary, JSON.stringify({ at: now(), branch, commit }));
      renameSync(temporary, file);
    } catch {
      rmSync(temporary, { force: true });
    }
  }

  /**
   * When `clone` was last fetched, and the branch and commit that fetch
   * landed on; `undefined` when no stamp says. A stamp written before it
   * carried the commit has only `at`.
   */
  function fetchedStamp(clone: string): { at: number; tip?: { branch: string; commit: string } } | undefined {
    try {
      const { at, branch, commit } = JSON.parse(readFileSync(fetchedFile(clone), "utf8")) as Record<string, unknown>;
      if (typeof at !== "number") return undefined;
      if (typeof branch !== "string" || typeof commit !== "string" || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commit)) return { at };
      return { at, tip: { branch, commit } };
    } catch {
      return undefined;
    }
  }

  /** The clone for `remote`, made whole and in place, and whether this call made it. */
  async function ensureClone(
    remote: AllowedRemote,
    clone: string,
    left: () => number,
  ): Promise<{ fresh: boolean; defaultBranch?: string }> {
    if (existsSync(clone)) return { fresh: false };
    mkdirSync(join(root, CLONES_DIR), { recursive: true });
    const making = `${clone}.making-${randomUUID()}`;
    try {
      await git(root, ["init", "--quiet", "--bare", making], left());
      const defaultBranch = await refresh(making, remote, left, false);
      try {
        renameSync(making, clone);
      } catch (error) {
        // Another process finished its clone first. Theirs is whole, and
        // ours is redundant.
        if (!existsSync(clone)) throw error;
        rmSync(making, { recursive: true, force: true });
        return { fresh: false };
      }
      stampFetched(clone, defaultBranch, await fetchedTip(clone, remote, defaultBranch, left));
      return { fresh: true, defaultBranch };
    } catch (error) {
      rmSync(making, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * A worktree of the host's clone of `remote`, in `<dir>/checkout`. Called
   * holding the place's lock; takes the clone's lock for everything that
   * touches the clone.
   */
  async function provisionClonedCheckout(
    remote: AllowedRemote,
    baseRef: string | undefined,
    dir: string,
    branch: string,
    ignored: IgnoredDirectory | undefined,
    deadline: number,
  ): Promise<NonNullable<WorkspacePlace["repo"]>> {
    const clone = join(root, CLONES_DIR, `${remote.cloneKey}.git`);
    const shown = redactRemote(remote.url);
    let made: { fresh: boolean; defaultBranch?: string } = { fresh: false };

    return await locked(join(root, CLONES_DIR, `${remote.cloneKey}${LOCK_SUFFIX}`), deadline, async () => {
      const worktree = await provisionWorktree({
        repo: clone,
        repoLabel: `the clone of "${shown}"`,
        checkout: join(dir, CHECKOUT_DIR),
        marker: join(dir, PROVISIONING_MARKER),
        root,
        branch,
        env,
        deadline,
        now,
        ...(ignored !== undefined ? { ignored } : {}),
        prepare: async (left) => {
          made = await ensureClone(remote, clone, left);
        },
        // Only a NEW branch is cut from a freshly fetched remote. A branch
        // that exists is the run's own, put back where it was without a fetch.
        base: async (left) => {
          const defaultBranch = made.fresh ? made.defaultBranch! : await refresh(clone, remote, left);
          const base = baseRef ?? defaultBranch;
          let commit: string;
          try {
            commit = await git(clone, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}^{commit}`], left());
          } catch (error) {
            if (!gitAnsweredNo(error)) throw error;
            throw new WorkspaceRefusedError(
              "remote-unreadable",
              `the remote "${shown}" has no branch "${base}" to cut the run's branch from.`,
            );
          }
          return { ref: base, commitish: commit, commit };
        },
      });
      return {
        remote: remote.url,
        clone,
        branch,
        created: worktree.created,
        ...(worktree.baseRef !== undefined ? { baseRef: worktree.baseRef } : {}),
        ...(worktree.baseCommit !== undefined ? { baseCommit: worktree.baseCommit } : {}),
        ...(worktree.movedBack !== undefined ? { movedBack: worktree.movedBack } : {}),
        ...(worktree.offBranch !== undefined ? { offBranch: worktree.offBranch } : {}),
      };
    });
  }

  /**
   * A worktree of a repository the operator named, at `checkout`: the place
   * itself when the run keeps no files, `<place>/checkout` when it does. No
   * clone: the run's branch stays in the repository. A new branch is cut
   * from the base, or from its upstream when that is ahead (`fetchUpstream`);
   * the repository's own branches, index and files never move. No lock over
   * the repository: each run has its own place and branch, git keeps
   * concurrent worktrees apart, and a fetch that loses a ref lock to another
   * falls back like any failed fetch. Called holding the place's lock.
   */
  async function provisionLocalCheckout(
    repo: string,
    baseRef: string | undefined,
    checkout: string,
    marker: string,
    branch: string,
    ignored: IgnoredDirectory | undefined,
    deadline: number,
  ): Promise<NonNullable<WorkspacePlace["repo"]>> {
    const worktree = await provisionWorktree({
      repo,
      repoLabel: repo,
      checkout,
      marker,
      root,
      branch,
      deadline,
      now,
      ...(ignored !== undefined ? { ignored } : {}),
      // Read before anything is made, so a ref the repository doesn't have,
      // or a base that has split from its upstream, fails naming it and
      // leaves no marker, tree or branch behind. Only a NEW branch gets here.
      base: (left) => localBase(repo, baseRef, left),
    });
    return {
      remote: repo,
      clone: repo,
      branch,
      created: worktree.created,
      ...(worktree.baseRef !== undefined ? { baseRef: worktree.baseRef } : {}),
      ...(worktree.baseCommit !== undefined ? { baseCommit: worktree.baseCommit } : {}),
      ...(worktree.movedBack !== undefined ? { movedBack: worktree.movedBack } : {}),
      ...(worktree.offBranch !== undefined ? { offBranch: worktree.offBranch } : {}),
    };
  }

  /**
   * The base a NEW branch in a repository the operator listed is cut from:
   * `baseRef` (or `HEAD`), or its upstream when that is ahead, fetched first
   * (`fetchUpstream`). Refuses a ref the repository doesn't have, and a base
   * that has split from its upstream (`base-diverged`). A read of a mapped
   * checkout resolves its commit here too, so it sees what a new run would.
   */
  async function localBase(
    repo: string,
    baseRef: string | undefined,
    left: () => number,
  ): Promise<{ ref: string; commitish: string; commit: string }> {
    const base = baseRef ?? "HEAD";
    try {
      await git(repo, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`], left());
    } catch (error) {
      if (!gitAnsweredNo(error)) throw error;
      throw new WorkspaceRefusedError("remote-unreadable", `${repo} has no "${base}" to cut the run's branch from.`);
    }
    // Named once, and everything after read off that one name: `HEAD` can
    // move to another branch while this runs, and the ref recorded, the
    // commit compared and the upstream fetched must all be one branch's.
    const full = await git(repo, ["rev-parse", "--symbolic-full-name", base], left());
    const branchRef = full.startsWith("refs/heads/") ? full : undefined;
    const local = await git(repo, ["rev-parse", "--verify", "--quiet", `${branchRef ?? base}^{commit}`], left());
    // Recorded as asked (`HEAD` when no base is named); the commit cut at
    // is recorded beside it.
    const ref = base;
    // Always fetched, on purpose: the cached tracking ref can say "ahead" while upstream has moved.
    const upstream = branchRef === undefined ? undefined : await fetchUpstream(repo, base, branchRef, left);
    // Equal, or local ahead: the person's branch, as it always was.
    if (upstream === undefined || (await isAncestor(git, repo, upstream.commit, local, left()))) {
      // The commit compared, not the name: the name can move while the fetch runs.
      return { ref, commitish: local, commit: local };
    }
    // Behind: cut at the commit, never the ref's name, so the run's branch
    // doesn't come out tracking the person's upstream.
    if (await isAncestor(git, repo, local, upstream.commit, left())) {
      return { ref, commitish: upstream.commit, commit: upstream.commit };
    }
    throw new WorkspaceRefusedError(
      "base-diverged",
      `${repo}: "${base}" (${local}) and its upstream ${upstream.ref} (${upstream.commit}) each have ` +
        `commits the other lacks, so neither is the base to cut a run's branch from. To start a run ` +
        `from it, pull or rebase, or push, in ${repo}.`,
    );
  }

  /**
   * Bring the upstream of `full`, the branch `base` named, up to date in a
   * repository the operator listed, and say where it is: its tracking ref and
   * commit, or `undefined` when the branch has none (it tracks nothing or
   * another local branch) or this fetch didn't bring it.
   *
   * Only that one upstream branch is fetched, into its own tracking ref: no
   * tags, no `FETCH_HEAD`, no maintenance, no other ref. Listing the
   * repository admits its upstream, so `remotes.allow` isn't asked, but the
   * URL is judged for shape before git sees it and git may speak only its
   * scheme. The URL fetched is the one pinned in the host's root
   * (`pinFetchSettings`): a remote repointed since, or not pinned, is skipped.
   * The fetch runs in an empty
   * repository of its own, so nothing in the repository's config, a
   * `url.insteadOf` included, is read by it; nothing outside it that runs a
   * program (ssh command, upload-pack, credential helper, hooks, askpass,
   * fsmonitor) is obeyed either; credential helpers from outside the
   * repository, read when the host was built, are. **A fetch that fails, a URL
   * that fails the judge, or one skipped, is a warning,
   * never a refusal**, and the run starts from the local base: the tracking
   * ref is shared with every run, so only a commit this fetch brought is
   * compared. A probe that fails is raised: read as "no upstream", it would
   * cut from a stale base without a word.
   */
  async function fetchUpstream(
    repo: string,
    base: string,
    full: string,
    left: () => number,
  ): Promise<{ ref: string; commit: string } | undefined> {
    const [liveRef = "", liveRemote = "", liveRemoteRef = ""] = (
      await git(repo, ["for-each-ref", "--format=%(upstream)%0a%(upstream:remotename)%0a%(upstream:remoteref)", full], left())
    ).split("\n");
    const pins = fetchPins.get(repo);
    const acceptChange = pins === undefined ? "" : ` To pin the repository's current config, delete ${pins.file} and restart the host.`;
    // Pinned upstream, not the live config. None pinned means no upstream here.
    const pinnedUpstream = pins?.upstreams.get(full);
    if (pinnedUpstream === undefined) {
      if (liveRef.startsWith("refs/remotes/") && liveRemote !== "" && liveRemote !== ".") {
        console.warn(
          `[workspace] ${repo}: "${base}" now tracks ${liveRef}, which it didn't when the host pinned its ` +
            `fetch settings, so its upstream is neither fetched nor compared.${acceptChange}`,
        );
      }
      return undefined;
    }
    const { ref, remoteName, remoteRef } = pinnedUpstream;
    if (liveRef !== ref || liveRemote !== remoteName || liveRemoteRef !== remoteRef) {
      console.warn(
        `[workspace] ${repo}: "${base}" now tracks ${liveRef || "nothing"}, not ${ref} as pinned; ` +
          `${ref} is used.${acceptChange}`,
      );
    }

    const skip = (why: string, after = "") =>
      console.warn(`[workspace] ${repo}: ${why}, so the run starts from the local "${base}", not ${ref}.${after}`);
    const pinned = pins?.remotes.get(remoteName);
    let url: string | undefined;
    try {
      url = await git(repo, ["remote", "get-url", remoteName], left());
    } catch (error) {
      skip(`could not read the URL of remote "${remoteName}" (${firstLine(error)})`);
    }
    if (url !== undefined && pinned === undefined) {
      skip(
        `its upstream was not fetched: remote "${remoteName}" (${redactRemote(url)}) was not there when the ` +
          `host pinned its fetch settings`,
        acceptChange,
      );
    } else if (url !== undefined && withoutCredential(url) !== pinned) {
      skip(
        `its upstream was not fetched with your credentials: remote "${remoteName}" now points at ` +
          `"${redactRemote(url)}", not "${redactRemote(pinned!)}" as pinned`,
        acceptChange,
      );
    } else if (pinned !== undefined && url !== undefined) {
      // `url` is the pinned URL unless it carries a credential, which the pin
      // drops and the judge refuses: the pinned URL, never the remote's name,
      // is what git is handed.
      const judged = checkRemoteShape(url);
      if ("reason" in judged) skip(`its upstream was not fetched: ${judged.message}`);
      else if (!/^refs\/heads\/[^\s:]+$/.test(remoteRef)) skip(`its upstream was not fetched: "${remoteRef}" is not a branch`);
      // A `url.<base>.insteadOf` added since would still rewrite the URL git is handed.
      else {
        // Fetched in an empty repository of its own, into the person's object
        // store: the person's config, which every run's worktree shares and can
        // rewrite at any moment, is never read, so no `url.insteadOf` added in
        // it can aim the fetch elsewhere. The tracking ref moves only after.
        let scratch: string | undefined;
        try {
          scratch = scratchDir();
          const objects = join(await git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"], left()), "objects");
          const isolated = { ...env, GIT_DIR: scratch, GIT_OBJECT_DIRECTORY: objects };
          await run("git", ["init", "--quiet", "--bare", scratch], { cwd: scratch, timeoutMs: left(), env });
          // The copy last fetched, so only what is new crosses the wire.
          const previous = await git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], left()).catch(() => "");
          if (previous !== "") await run("git", ["update-ref", ref, previous], { cwd: scratch, timeoutMs: left(), env: isolated });
          await run(
            "git",
            [
              // Nothing in config that runs a program is obeyed here.
              "-c", "core.sshCommand=ssh",
              "-c", "core.askPass=",
              ...NO_HOOKS,
              "-c", "core.fsmonitor=false",
              "-c", "protocol.allow=never",
              "-c", `protocol.${judged.scheme}.allow=always`,
              // An empty helper clears every one before it; the person's own,
              // read at start, are put back.
              "-c", "credential.helper=",
              ...(pins?.credentialHelpers ?? []).flatMap(([key, value]) => ["-c", `${key}=${value}`]),
              "fetch",
              "--upload-pack=git-upload-pack",
              "--quiet",
              "--no-tags",
              "--no-prune",
              "--no-write-fetch-head",
              "--no-auto-maintenance",
              "--no-recurse-submodules",
              "--",
              judged.url,
              `+${remoteRef}:${ref}`,
            ],
            // A slice of what is left, so a fetch that hangs leaves time to cut.
            {
              cwd: scratch,
              timeoutMs: Math.max(1, Math.floor(left() * FETCH_BUDGET_SHARE)),
              env: { ...isolated, GIT_ALLOW_PROTOCOL: judged.scheme, GIT_SSH_COMMAND: "ssh" },
            },
          );
          const fetched = (await run("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: scratch, timeoutMs: left(), env: isolated })).stdout.trim();
          // Only over the copy this fetch started from: a provision running
          // beside this one may have fetched something newer since. A ref
          // that failed to move for any other reason (a lock) is a failed
          // fetch, and falls back like one.
          try {
            // `--no-deref`: a tracking ref a run replaced with a symbolic ref
            // moves itself, never the branch it points at.
            await git(repo, ["update-ref", "--no-deref", ref, fetched, previous], left());
          } catch (error) {
            const now = await git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], left()).catch(() => "");
            if (now === previous) throw error;
          }
          // What was fetched, not what the shared ref says now.
          return { ref, commit: fetched };
        } catch (error) {
          skip(`could not fetch "${redactRemote(judged.url)}" (${firstLine(error)})`);
        } finally {
          // Best effort: a leftover temp dir never decides the provision.
          try {
            if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
          } catch {}
        }
      }
    }
    return undefined;
  }


  /** The repository a source's `repo` names, when the operator listed it as local. */
  function localRepository(repo: string): string | undefined {
    if (!isAbsolute(repo)) return undefined;
    const path = resolve(repo);
    return localRepositories.has(path) ? path : undefined;
  }

  function locate(answer: RunSourceAnswer, request: Pick<PlaceRequest, "place">): { dir: string; cwd: string } {
    const dir = placeDir(request.place);
    if (answer.kind === "files") return { dir, cwd: join(dir, WORKSPACE_DIR) };
    // A local repository is its own place only when no kept files sit beside it.
    if (answer.kind === "repo" && localRepository(answer.repo) !== undefined && answer.files === undefined) {
      return { dir, cwd: dir };
    }
    return { dir, cwd: join(dir, CHECKOUT_DIR) };
  }

  async function provision(answer: RunSourceAnswer, request: PlaceRequest): Promise<WorkspacePlace> {
    if (answer.kind === "refused") throw new WorkspaceRefusedError(answer.reason, answer.message);
    const dir = placeDir(request.place);
    // One budget for the whole provision, lock waits included.
    const deadline = now() + provisionTimeoutMs;

    if (answer.kind === "files") {
      assertScope(answer.projectId);
      const filesDir = join(dir, WORKSPACE_DIR);
      await locked(join(dir, LOCK_SUFFIX), deadline, () =>
        provisionFiles(dir, WORKSPACE_DIR, answer.projectId, answer.files, request.ignored),
      );
      return { kind: "files", dir, cwd: filesDir, filesDir, holder: hold(filesDir) };
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

    // A repository the operator named on this machine, used as it stands.
    const local = localRepository(answer.repo);
    if (local !== undefined) {
      if (answer.projectId === undefined || answer.files === undefined) {
        // No kept files: the place is the checkout, with its marker and lock
        // beside it, exactly as places already on disk were made.
        mkdirSync(root, { recursive: true });
        return await locked(`${dir}${LOCAL_LOCK_SUFFIX}`, deadline, async () => {
          const repo = await provisionLocalCheckout(local, answer.baseRef, dir, `${dir}${LOCAL_MARKER_SUFFIX}`, branch, request.ignored, deadline);
          const place: WorkspacePlace = { kind: "repo", dir, cwd: dir, repo, origin: repo.created ? "new" : "live" };
          return await withSetup(place, `${dir}${LOCAL_SETUP_SUFFIX}`, request, deadline);
        });
      }
      // Kept files: laid out like a remote run's place, the worktree in
      // checkout/ and the files in project/ beside it, never inside it.
      const { projectId, files } = answer;
      return await locked(join(dir, LOCK_SUFFIX), deadline, async () => {
        const repo = await provisionLocalCheckout(
          local,
          answer.baseRef,
          join(dir, CHECKOUT_DIR),
          join(dir, PROVISIONING_MARKER),
          branch,
          request.ignored,
          deadline,
        );
        const filesDir = join(dir, PROJECT_DIR);
        await provisionFiles(dir, PROJECT_DIR, projectId, files);
        const place: WorkspacePlace = {
          kind: "repo",
          dir,
          cwd: join(dir, CHECKOUT_DIR),
          filesDir,
          holder: hold(filesDir),
          repo,
          origin: repo.created ? "new" : "live",
        };
        return await withSetup(place, join(dir, SETUP_MARKER), request, deadline);
      });
    }

    // Judged before anything is created or spawned.
    const remote = checkRemote(answer.repo, allow);
    if ("reason" in remote) throw new WorkspaceRefusedError(remote.reason, remote.message);

    const holding = holds(answer);
    if (holding) assertHeldPrefix(answer.heldPrefix!);
    // **A hold this host cannot use waits for a person**, rather than the run
    // starting over from its base and losing the turns that were held. Only
    // where the run has no live checkout here, so the attempt the owner's
    // answer starts is not stopped again; and not once the owner has answered.
    const held = request.recorded?.held;
    if (heldWork === undefined && held != null && held.parked !== true && !isLive(dir)) {
      throw new HeldWorkMismatchError(
        "disabled",
        `the run's work is held (${held.key}), but this host has no held-work store to rebuild it ` +
          `from. Not starting it over from its base: that would drop the held work.`,
      );
    }

    return await locked(join(dir, LOCK_SUFFIX), deadline, async () => {
      let repo: NonNullable<WorkspacePlace["repo"]>;
      let origin: PlaceOrigin;
      let extra: Pick<WorkspacePlace, "holding" | "heldDir"> = {};
      if (holding) {
        const made = await provisionHolding(answer as RepoRunSource & { heldPrefix: string }, remote, request, dir, branch, deadline);
        ({ repo, origin } = made);
        extra = {
          holding: { keyPrefix: placeKeyPrefix(answer.heldPrefix!, request.place), base: made.base, host: hostId() },
          ...(made.heldDir !== undefined ? { heldDir: made.heldDir } : {}),
        };
      } else {
        repo = await provisionClonedCheckout(remote, answer.baseRef, dir, branch, request.ignored, deadline);
        origin = repo.created ? "new" : "live";
      }
      const place: WorkspacePlace = { kind: "repo", dir, cwd: join(dir, CHECKOUT_DIR), repo, origin, ...extra };
      if (answer.projectId !== undefined && answer.files !== undefined) {
        await provisionFiles(dir, PROJECT_DIR, answer.projectId, answer.files);
        place.filesDir = join(dir, PROJECT_DIR);
        place.holder = hold(place.filesDir);
      }
      return await withSetup(place, join(dir, SETUP_MARKER), request, deadline);
    });
  }

  /**
   * `place`, with the operator's setup command run in its checkout when it is
   * owed: this provision made the tree (`repo.created`, which every `worktree
   * add` sets, a rebuild from held work included, and a hand-back never does),
   * or the last setup there never finished. The last step of a provision,
   * holding the place's lock, on what is left of its budget.
   */
  async function withSetup(place: WorkspacePlace, marker: string, request: PlaceRequest, deadline: number): Promise<WorkspacePlace> {
    const fresh = place.repo?.created === true;
    const outcome = await setUpCheckout(options.setup, place.cwd, marker, fresh, () => remainingBudget(deadline, now), request.onSetup);
    return outcome === undefined ? place : { ...place, setup: outcome };
  }

  /**
   * Provision a place holding applies to: hand back the live one, cut a new
   * one, or rebuild a lost one from what the record says was held. Called
   * holding the place's lock.
   */
  async function provisionHolding(
    answer: RepoRunSource & { heldPrefix: string },
    remote: AllowedRemote,
    request: PlaceRequest,
    dir: string,
    branch: string,
    deadline: number,
  ): Promise<{ repo: NonNullable<WorkspacePlace["repo"]>; origin: PlaceOrigin; base: string; heldDir?: string }> {
    const recorded = request.recorded;
    const held = recorded?.held ?? null;
    const checkout = join(dir, CHECKOUT_DIR);
    const keyPrefix = placeKeyPrefix(answer.heldPrefix, request.place);
    const left = () => remainingBudget(deadline, now);

    // Checked before anything moves: a mismatch changes nothing.
    if (recorded?.remote != null && recorded.remote !== answer.repo) {
      throw mismatch("remote", `the run's record names another remote than "${redactRemote(answer.repo)}".`);
    }
    if (recorded?.branch != null && recorded.branch !== branch) {
      throw mismatch("branch", `the run's record names branch "${recorded.branch}", not "${branch}".`);
    }
    if (held !== null && !(held.key.startsWith(keyPrefix) && !held.key.slice(keyPrefix.length).includes("/"))) {
      throw mismatch("scope", `the recorded held work (${held.key}) is not under this run's prefix (${keyPrefix}).`);
    }

    // **Live here: used as it is**, exactly as without holding. So is a place
    // the record has never named: a first provision, or a record from before
    // holding was on.
    const live = isLive(dir);
    if (recorded?.host == null || (recorded.host === hostId() && live)) {
      const repo = await provisionClonedCheckout(remote, answer.baseRef, dir, branch, request.ignored, deadline);
      const base =
        repo.baseCommit ?? held?.base ?? (await mergeBase(checkout, recorded?.baseRef ?? answer.baseRef, left));
      return { repo, origin: repo.created ? "new" : "live", base };
    }

    // **Lost**: recorded on another host, or gone from this one. A checkout
    // here is moved aside and kept, never deleted.
    await request.progress?.("lost");
    if (existsSync(checkout)) renameSync(checkout, asideName(checkout, now()));
    const clone = join(root, CLONES_DIR, `${remote.cloneKey}.git`);
    const cloneLock = join(root, CLONES_DIR, `${remote.cloneKey}${LOCK_SUFFIX}`);

    if (held === null || held.parked === true) {
      // Nothing held, or held work its owner has answered for: start again
      // from the base, and lay the snapshot out beside the checkout.
      if (existsSync(clone)) await locked(cloneLock, deadline, () => branchAside(clone, branch, [], left));
      const repo = await provisionClonedCheckout(remote, answer.baseRef, dir, branch, request.ignored, deadline);
      let heldDir: string | undefined;
      if (held !== null) {
        // A pack that cannot be read, or is not the one recorded, leaves no
        // `held/` (BR-20). Anything else, the store itself failing above all,
        // fails the provision, so a retry can still lay the work out.
        heldDir = await locked(cloneLock, deadline, () => layOutHeld(clone, held, dir, left)).catch((error: unknown) => {
          if (error instanceof HeldWorkMismatchError) return undefined;
          throw error;
        });
      }
      return { repo, origin: "base", base: repo.baseCommit!, ...(heldDir !== undefined ? { heldDir } : {}) };
    }

    await request.progress?.("restoring");
    await locked(cloneLock, deadline, async () => {
      const made = await ensureClone(remote, clone, left);
      if (!made.fresh) await refresh(clone, remote, left);
      await unpackHeld(clone, held, left);
      await rebuild(clone, checkout, branch, held, request.ignored, left);
    });
    return {
      repo: {
        remote: remote.url,
        clone,
        branch,
        created: true,
        ...(answer.baseRef !== undefined ? { baseRef: answer.baseRef } : {}),
        baseCommit: held.base,
      },
      origin: "held",
      base: held.base,
    };
  }

  /**
   * Add the recorded pack's objects to the clone, checking it is the pack the
   * record names and that it holds the commits the record names.
   */
  async function unpackHeld(clone: string, held: RecordedHold, left: () => number): Promise<void> {
    const g = heldGit(left);
    // On the remote as just fetched: reachable from one of its branches, not
    // merely an object this clone kept from before a force-push.
    if (!(await hasCommit(g, clone, held.base)) || (await g(clone, ["for-each-ref", "--contains", held.base, "--format=%(refname)", "refs/remotes/origin/"])) === "") {
      throw mismatch("base", `the run's base commit ${held.base} is not on the remote.`);
    }
    const bytes = await heldWork!.get(held.key);
    if (bytes === undefined) throw mismatch("pack", `the held pack ${held.key} is missing from the held-work store.`);
    if (sha256(bytes) !== held.sha256) {
      throw mismatch("pack", `the held pack ${held.key} is not the one recorded: its hash differs.`);
    }
    try {
      await g(clone, ["index-pack", "--stdin"], { input: bytes });
    } catch {
      throw mismatch("pack", `the held pack ${held.key} could not be read as a git pack.`);
    }
    if (!(await hasCommit(g, clone, held.head))) {
      throw mismatch("head", `the run's head commit ${held.head} is in neither the held pack nor the remote.`);
    }
    if (!(await hasCommit(g, clone, held.snapshot)) || (await g(clone, ["rev-parse", `${held.snapshot}^`])) !== held.head) {
      throw mismatch("snapshot", `the held snapshot ${held.snapshot} is not in the held pack on top of the run's head.`);
    }
  }

  /**
   * Cut the branch at the base, check the snapshot's tree out over it, and
   * move the branch to the head with the changes left unstaged. Undone when
   * the rebuilt tree is not the snapshot's.
   */
  async function rebuild(
    clone: string,
    checkout: string,
    branch: string,
    held: RecordedHold,
    ignored: IgnoredDirectory | undefined,
    left: () => number,
  ): Promise<void> {
    const g = heldGit(left);
    await branchAside(clone, branch, [held.base, held.head], left);
    mkdirSync(dirname(checkout), { recursive: true });
    await g(clone, ["worktree", "add", "--quiet", "-B", branch, checkout, held.base]);
    const scratch = scratchDir();
    try {
      await g(checkout, ["read-tree", "-u", "--reset", held.snapshot]);
      // `read-tree` moved the files, not the branch. This moves the branch
      // from the base to the head, and the index with it, and leaves the
      // files alone: the run's changes read as unstaged, new files as
      // untracked.
      await g(checkout, ["reset", "--quiet", "--mixed", held.head]);
      const rebuilt = await snapshotWorkingTree(g, checkout, scratch);
      const expected = await g(clone, ["rev-parse", `${held.snapshot}^{tree}`]);
      if (rebuilt.tree !== expected || rebuilt.head !== held.head) {
        throw mismatch("tree", `the rebuilt checkout does not match the held snapshot ${held.snapshot}.`);
      }
      // The same check a new or handed-back checkout gets: a run that dropped
      // the ignore rule, or began tracking the caller's files, is refused
      // here rather than handed to the harness.
      if (ignored !== undefined) {
        const problem = await ignoredProblem(checkout, ignored, (args) => g(checkout, args));
        if (problem !== undefined) throw new Error(problem);
      }
    } catch (error) {
      rmSync(checkout, { recursive: true, force: true });
      await g(clone, ["worktree", "prune"]).catch(() => undefined);
      await g(clone, ["branch", "-D", branch]).catch(() => undefined);
      throw error;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  /**
   * Lay the held snapshot out in `<dir>/held/` for a person to pick from.
   * Rejects when the pack cannot be read.
   */
  async function layOutHeld(clone: string, held: RecordedHold, dir: string, left: () => number): Promise<string> {
    await unpackHeld(clone, held, left);
    const g = heldGit(left);
    const heldDir = join(dir, HELD_DIR);
    if (existsSync(heldDir)) renameSync(heldDir, asideName(heldDir, now()));
    mkdirSync(heldDir, { recursive: true });
    const scratch = scratchDir();
    try {
      const index = { GIT_INDEX_FILE: join(scratch, "index") };
      await g(clone, ["read-tree", held.snapshot], { env: index });
      await g(clone, [`--work-tree=${heldDir}`, "checkout-index", "--all", "--force"], { env: index });
    } catch (error) {
      rmSync(heldDir, { recursive: true, force: true });
      throw error;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    return heldDir;
  }

  /**
   * Rename the clone's `branch` aside, unless it is absent or points at one
   * of `keep`. What this host held on it from an earlier stay is kept, never
   * deleted.
   */
  async function branchAside(clone: string, branch: string, keep: string[], left: () => number): Promise<void> {
    const g = heldGit(left);
    await g(clone, ["worktree", "prune"]);
    let tip: string;
    try {
      tip = await g(clone, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    } catch (error) {
      if (gitAnsweredNo(error)) return;
      throw error;
    }
    if (keep.includes(tip)) return;
    await g(clone, ["branch", "-m", branch, asideName(branch, now())]);
  }

  /** The base of a place provisioned before holding was on: where its branch left the remote's. */
  async function mergeBase(checkout: string, baseRef: string | null | undefined, left: () => number): Promise<string> {
    return await heldGit(left)(checkout, ["merge-base", "HEAD", `refs/remotes/origin/${baseRef ?? "HEAD"}`]);
  }

  /** Make this provision the one a directory's kept files answer to. */
  function hold(filesDir: string): string {
    const holder = randomUUID();
    holders.set(filesDir, holder);
    return holder;
  }

  /** Git for a read: raw output, a large buffer, and every path handed to it read literally. */
  async function readGit(cwd: string, args: string[], left: () => number): Promise<string> {
    const { stdout } = await run("git", [...NO_HOOKS, ...args], {
      cwd,
      timeoutMs: left(),
      env: { ...env, GIT_LITERAL_PATHSPECS: "1" },
      maxBuffer: READ_OUTPUT_MAX_BYTES,
    });
    return stdout;
  }

  /**
   * The commit a read of `remote` sees, in the host's shared clone of it.
   *
   * **A read never waits on the clone's lock**, which a provision can hold
   * for minutes. With no clone yet, the read makes one without the lock, the
   * way a provision does: in a `.making-` directory renamed into place, so a
   * racing provision's clone wins and this one is dropped. With a clone last
   * fetched over a minute ago, the read tries the lock once: taken, it
   * fetches, within half the read's budget so a remote that hangs leaves
   * time to read; held, it serves the last fetched commit and says how old
   * it is. A fetch that fails is served the same way. The commit served is
   * the one the last fetch stamped beside the clone, the tip of the remote's
   * default branch as fetched, `refs/remotes/origin/<default>`, which a
   * run's own branch (in `refs/heads/`) can never be. Reading it from the
   * stamp, not the refs, means a fetch pruning those refs right now can't
   * leave the read without one; its objects stay in the clone.
   */
  async function cloneReadAt(remote: AllowedRemote, left: () => number): Promise<{ repo: string; at: SourceReadAt }> {
    const clone = join(root, CLONES_DIR, `${remote.cloneKey}.git`);
    const shown = redactRemote(remote.url);
    if (!existsSync(clone)) {
      await ensureClone(remote, clone, left);
    } else {
      const last = fetchedStamp(clone)?.at;
      if (last === undefined || now() - last > SOURCE_READ_FRESH_MS) {
        const lease = tryAcquireLock(join(root, CLONES_DIR, `${remote.cloneKey}${LOCK_SUFFIX}`), HOST_LOCK_BOUNDS, { now });
        if (lease !== undefined) {
          const fetchDeadline = now() + Math.floor(left() / 2);
          try {
            await refresh(clone, remote, () => remainingBudget(fetchDeadline, now));
          } catch (error) {
            console.warn(`[workspace] a read of "${shown}" serves its last fetched commit: ${firstLine(error)}`);
          } finally {
            releaseLock(lease);
          }
        }
      }
    }
    const stamp = fetchedStamp(clone);
    let tip = stamp?.tip;
    if (tip === undefined) {
      // No stamp, or one from before stamps named the commit: resolve the refs.
      try {
        const branch = (await git(clone, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], left())).replace(/^origin\//, "");
        tip = { branch, commit: await git(clone, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}^{commit}`], left()) };
      } catch {
        throw new WorkspaceRefusedError("remote-unreadable", `the clone of "${shown}" holds no default branch to read.`);
      }
    }
    const { branch, commit } = tip;
    const at = stamp?.at;
    return {
      repo: clone,
      at: {
        kind: "repo",
        commit,
        branch,
        fetchedAt: at === undefined ? null : new Date(at).toISOString(),
        ageMs: at === undefined ? null : Math.max(0, now() - at),
      },
    };
  }

  /** The last base each listed repository's reads resolved, so a burst of reads resolves it once a minute. */
  const localReads = new Map<string, { at: number; commit: string; ref: string }>();

  /**
   * The commit a read of a repository the operator listed sees: the base a
   * new run there would be cut from (`localBase`), never its working tree.
   */
  async function localReadAt(repo: string, baseRef: string | undefined, left: () => number): Promise<{ repo: string; at: SourceReadAt }> {
    const key = `${repo}\0${baseRef ?? ""}`;
    let kept = localReads.get(key);
    if (kept === undefined || now() - kept.at > SOURCE_READ_FRESH_MS) {
      const resolved = await localBase(repo, baseRef, left);
      kept = { at: now(), commit: resolved.commit, ref: resolved.ref };
      localReads.set(key, kept);
    }
    return { repo, at: { kind: "repo", commit: kept.commit, branch: kept.ref, fetchedAt: null, ageMs: null } };
  }

  /** One read of the repository at `repo`, at the one commit `at` names, and no other. */
  async function readAtCommit(repo: string, at: SourceReadAt & { kind: "repo" }, request: SourceReadRequest, left: () => number): Promise<SourceReadResult> {
    const { commit } = at;
    if (request.kind === "glob") {
      const listed = (await readGit(repo, ["ls-tree", "-r", "-z", "--name-only", commit], left)).split("\0").filter((path) => path !== "");
      return { kind: "glob", at, ...globPaths(listed, request.pattern, request.limit) };
    }
    if (request.kind === "read") {
      const path = request.path;
      // `<mode> <type> <object> <size>\t<path>`, for the entry at exactly this path.
      const entry = (await readGit(repo, ["ls-tree", "-z", "-l", commit, "--", path], left))
        .split("\0")
        .map((line) => /^\S+ (\S+) (\S+) +(\S+)\t(.*)$/s.exec(line))
        .find((match) => match !== null && match[4] === path);
      if (entry == null) return { kind: "read", at, path, status: "missing" };
      const [, type, object, size] = entry;
      if (type === "tree") return { kind: "read", at, path, status: "directory" };
      if (type !== "blob") return { kind: "read", at, path, status: "missing" };
      const bytes = Number(size);
      if (bytes > READ_LOAD_MAX_BYTES) return { kind: "read", at, path, status: "too-large", bytes };
      const text = await readGit(repo, ["cat-file", "blob", object!], left);
      if (looksBinary(text)) return { kind: "read", at, path, status: "binary", bytes };
      return readBody(path, text, request, at);
    }
    const prefix = request.prefix == null || request.prefix === "" ? [] : ["--", request.prefix];
    const keep = matchCap(request.maxResults);
    const matches: { path: string; line: number; snippet: string }[] = [];
    let total = 0;
    // Read as git writes it, keeping the matches the cap allows and counting
    // the rest, so the cut is exact and the output is never held whole.
    const search = async (dialect: GrepDialect): Promise<void> => {
      try {
        await run("git", [...NO_HOOKS, "grep", "-I", "-n", "-z", "--no-color", "--no-column", dialect === "literal" ? "-F" : "-E", "-e", request.pattern, commit, ...prefix], {
          cwd: repo,
          timeoutMs: left(),
          env: { ...env, GIT_LITERAL_PATHSPECS: "1" },
          onLine: (record) => {
            // `<commit>:<path>\0<line>\0<text>`
            if (!record.startsWith(`${commit}:`)) return;
            total += 1;
            if (matches.length >= keep) return;
            const [name = "", line = "", ...text] = record.split("\0");
            matches.push({ path: name.slice(commit.length + 1), line: Number(line), snippet: snippetOf(text.join("\0")) });
          },
        });
      } catch (error) {
        // Exit 1 is git's "no match".
        if ((error as { code?: unknown }).code !== 1) throw error;
      }
    };
    let dialect: GrepDialect = "extended-regex";
    try {
      await search(dialect);
    } catch (error) {
      // A pattern git can't compile is searched for as written. Any other
      // failure is the read's, never a reason to search differently.
      if (!notCompiled(error, request.pattern)) throw error;
      dialect = "literal";
      await search(dialect);
    }
    return { kind: "grep", at, dialect, binary: "skipped", matches, cut: matchesCut(total, request.maxResults) };
  }

  async function readSource(answer: RunSourceAnswer, request: SourceReadRequest): Promise<SourceReadResult> {
    if (answer.kind === "refused") throw new WorkspaceRefusedError(answer.reason, answer.message);
    // Checked before anything is made or spawned.
    if (request.kind === "read") checkSourcePath(request.path);
    if (request.kind === "grep" && request.prefix != null && request.prefix !== "") checkSourcePath(request.prefix, "prefix");
    if (answer.kind === "files") {
      assertScope(answer.projectId);
      return await readKeptFiles(answer.projectId, answer.files, request);
    }
    const deadline = now() + provisionTimeoutMs;
    const left = () => remainingBudget(deadline, now);
    // A repository's kept files are not read here: a path names one tree, the repository's.
    const local = localRepository(answer.repo);
    if (local !== undefined) {
      const { repo, at } = await localReadAt(local, answer.baseRef, left);
      return await readAtCommit(repo, at as SourceReadAt & { kind: "repo" }, request, left);
    }
    const remote = checkRemote(answer.repo, allow);
    if ("reason" in remote) throw new WorkspaceRefusedError(remote.reason, remote.message);
    const { repo, at } = await cloneReadAt(remote, left);
    return await readAtCommit(repo, at as SourceReadAt & { kind: "repo" }, request, left);
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
    if (holders.get(place.filesDir) !== place.holder) {
      throw new Error(
        `the place at ${place.dir} was provisioned again since this handle was made, so its ` +
          `kept files are the newer provision's to save. Not saving them from here.`,
      );
    }
    return await (await projection).flush();
  }

  return {
    root,
    source: options.source,
    provisionTimeoutMs,
    locate,
    provision,
    save,
    hostId,
    holds,
    async checkpoint(place, recorded) {
      const holding = place.holding;
      if (heldWork === undefined || holding === undefined || place.kind !== "repo") return null;
      const deadline = now() + provisionTimeoutMs;
      return await locked(join(place.dir, LOCK_SUFFIX), deadline, async () => {
        const g = heldGit(() => remainingBudget(deadline, now));
        const scratch = scratchDir();
        try {
          const snap = await snapshotWorkingTree(g, place.cwd, scratch);
          const common = {
            base: holding.base,
            head: snap.head,
            snapshot: snap.snapshot,
            key: `${holding.keyPrefix}${snap.snapshot}.pack`,
            skipped: snap.skipped,
          };
          // The same snapshot is the same key: putting it again would rewrite
          // the live pack, and the caller's drop of "the previous key" would
          // then delete it.
          if (recorded != null && recorded.snapshot === snap.snapshot) {
            return { ...common, sha256: recorded.sha256, bytes: recorded.bytes, unchanged: true };
          }
          const pack = await packFromBase(g, place.cwd, holding.base, snap.snapshot, scratch);
          await heldWork.put(common.key, pack);
          return { ...common, sha256: sha256(pack), bytes: pack.byteLength, unchanged: false };
        } finally {
          rmSync(scratch, { recursive: true, force: true });
        }
      });
    },
    async dropHeld(place, key) {
      const holding = place.holding;
      if (heldWork === undefined || holding === undefined) {
        throw new Error(`holding does not apply to the place at ${place.dir}, so it has no held work to drop.`);
      }
      const rest = key.slice(holding.keyPrefix.length);
      if (!key.startsWith(holding.keyPrefix) || rest === "" || rest.includes("/")) {
        throw new Error(`refusing to drop ${key}: it is not a held pack of the place at ${place.dir}.`);
      }
      await heldWork.delete(key);
    },
    readSource,
    async restore() {},
    async release(place) {
      if (place.filesDir === undefined || holders.get(place.filesDir) !== place.holder) return;
      live.delete(place.filesDir);
      holders.delete(place.filesDir);
    },
  };
}

/**
 * Whether `git grep` refused `pattern` because it doesn't compile: git exits
 * 128 naming the pattern (`fatal: -e option, '<pattern>': <why>`) before it
 * reads a file, so nothing was searched.
 */
function notCompiled(error: unknown, pattern: string): boolean {
  const { code, stderr } = (error ?? {}) as { code?: unknown; stderr?: unknown };
  return code === 128 && typeof stderr === "string" && stderr.includes(`-e option, '${pattern}': `);
}

/** The file beside a clone that says when it was last fetched. */
function fetchedFile(clone: string): string {
  return `${clone.replace(/\.git$/, "")}${FETCHED_SUFFIX}`;
}

function mismatch(field: HeldWorkMismatchField, message: string): HeldWorkMismatchError {
  return new HeldWorkMismatchError(field, message);
}

/** Whether `commit` is a commit in the repository at `cwd`. A probe that failed is raised, never read as no. */
async function hasCommit(g: Git, cwd: string, commit: string): Promise<boolean> {
  try {
    await g(cwd, ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`]);
    return true;
  } catch (error) {
    if (gitAnsweredNo(error)) return false;
    throw error;
  }
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
 * A branch name this host will hand to git: nothing git would read as an
 * option, and none of the spellings a ref refuses. Git checks the rest.
 */
function isPlainBranch(branch: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) &&
    !/\.\.|\/\/|\/\.|\.lock$|\.lock\/|\/$|\.$/.test(branch)
  );
}

/**
 * `place`, with every path under `hidden` left out of its listing, so a flush
 * never sees those files and never saves them. Reads and writes pass through.
 */
function leavingOut(place: Place, hidden: string | undefined): Place {
  if (hidden === undefined) return place;
  return {
    read: (path) => place.read(path),
    write: (path, content) => place.write(path, content),
    list: async (prefixes) => (await place.list(prefixes)).filter((path) => !path.startsWith(hidden)),
  };
}
