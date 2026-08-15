/**
 * `defineConductor` — what a project actually writes.
 *
 * Level 1 is the whole target: `export default defineConductor();`. Everything
 * a level-1 project would otherwise be asked for is a fact of the machine
 * conductor runs on — the repo, the token, the default branch, the installed
 * coding harness — and is discovered rather than declared (see `./discover`).
 *
 * **Declaring and resolving are two steps on purpose.** `defineConductor` is a
 * typed identity function returning plain data, so `conductor.config.ts` stays
 * synchronous and importable anywhere — a test, an editor, a machine with no
 * git and no token. {@link resolveConductor} is the async half that touches the
 * environment, and it runs inside conductor's own process where a failure has
 * somewhere to be reported. A config file that shelled out to git at import
 * time would fail in every context that merely wants to read it.
 *
 * The fields that exist are the ones inference genuinely cannot cover: a fork
 * whose PRs target upstream, several remotes, one conductor driving a repo it
 * is not inside, and the project's own guidance documents. Anything level 2
 * adds — concurrency, budgets, per-phase dispatch, connectors — is deliberately
 * absent until something adopts it.
 */

import path from "node:path";

import type { Dispatcher } from "../dispatch/types";
import { DEFAULT_POLICY, type ConductorPolicy } from "../model/world";
import {
  ConductorConfigError,
  defaultGitRunner,
  discoverDefaultBranch,
  discoverDispatcher,
  discoverGitHubToken,
  discoverRemoteUrl,
  discoverRepoRoot,
  parseRepoRef,
  type HarnessProbe,
  type RepoRef,
} from "./discover";
import { DEFAULT_REMOTE, type GitRunner } from "../dispatch/branch";

/**
 * What a project declares. Every field is optional, and a level-1 project sets
 * none of them.
 *
 * Each one exists because discovery cannot be right in some real case, not
 * because it is a knob worth having. If a field here could be read from the
 * environment, it does not belong.
 */
export interface ConductorConfig {
  /**
   * The repository under management. Discovered from the `origin` remote.
   * Set it for a fork whose pull requests belong upstream.
   */
  readonly repo?: RepoRef;
  /**
   * The git remote to read the repository and default branch from. Defaults to
   * `origin`; set it when a checkout carries several.
   */
  readonly remote?: string;
  /**
   * The checkout conductor manages. Discovered from the working directory.
   * Set it when conductor drives a repo it is not running inside.
   */
  readonly repoRoot?: string;
  /**
   * The branch new work is cut from. Discovered from the remote's HEAD. Set it
   * when work belongs on a release branch rather than the default one.
   */
  readonly baseBranch?: string;
  /**
   * The coding harness phases are dispatched to. Discovered from what is
   * installed. Set it to pin a vendor, or to supply one conductor does not ship.
   */
  readonly dispatcher?: Dispatcher;
  /**
   * Repo-relative documents conductor reads as decision context and carries
   * into every phase brief — your philosophy, your objectives, your best
   * practices. Conductor owns none of them, and there is nothing to discover:
   * which documents govern this project is a project's own statement.
   */
  readonly guidance?: readonly string[];
}

/** Whether a resolved field came from the environment or from the config file. */
export type FieldOrigin = "discovered" | "configured";

/**
 * Where `baseBranch` came from — {@link FieldOrigin} plus the one discovery
 * that can answer from something other than the source of truth.
 *
 * `"discovered"` means the remote itself was asked. `"discovered-cached"` means
 * it could not be reached and the clone-time `refs/remotes/<remote>/HEAD` was
 * read instead — a value git never refreshes, so it is the branch this clone
 * was made against rather than the branch the repository has now. Reporting the
 * two as one would make `origins` say the field was looked up while hiding that
 * the lookup missed, which is the half of the answer an operator needs.
 */
export type BaseBranchOrigin = FieldOrigin | "discovered-cached";

/**
 * Where each resolved field came from.
 *
 * Kept as data rather than logged, because it is the answer to the question a
 * level-1 project will ask first — *what did it decide, and did I decide any of
 * it?* A board, a CLI, and this package's own example all render it.
 *
 * `guidance` and `remote` are absent deliberately: neither has a discovery
 * behind it, so neither has an origin to report. Empty `guidance` means the
 * project named no documents, not that conductor went looking and found none;
 * `remote` is either configured or the `origin` default, and reporting that
 * default as `"discovered"` would claim conductor probed the checkout when it
 * probed nothing. Every field listed here does have a real lookup behind it.
 */
export interface ConductorOrigins {
  readonly repoRoot: FieldOrigin;
  readonly repo: FieldOrigin;
  readonly baseBranch: BaseBranchOrigin;
  readonly dispatcher: FieldOrigin;
}

/** Everything conductor needs to run, with nothing left to look up. */
export interface ResolvedConductor {
  /** Absolute path to the checkout under management. */
  readonly repoRoot: string;
  readonly repo: RepoRef;
  /**
   * The git remote every read and every checkout goes through — `origin` unless
   * the config named another.
   *
   * Carried rather than re-defaulted downstream: discovery already used this
   * remote to find `repo` and `baseBranch`, and `provisionWorkspace` falls back
   * to `origin` when its `remote` is omitted. Without this field a fork working
   * off `upstream` would be *discovered* from upstream and then *provisioned*
   * from origin, which may be the fork or may not exist at all.
   */
  readonly remote: string;
  /** The URL `repo` was read from, or `null` when the repo was configured outright. */
  readonly remoteUrl: string | null;
  readonly baseBranch: string;
  /** The GitHub token. Never logged, never carried into a brief. */
  readonly token: string;
  readonly dispatcher: Dispatcher;
  readonly guidance: readonly string[];
  readonly policy: ConductorPolicy;
  readonly origins: ConductorOrigins;
}

/** Seams `resolveConductor` reaches the environment through. All injectable. */
export interface ResolveOptions {
  /** Where to start looking for the checkout. Defaults to the process cwd. */
  readonly cwd?: string;
  /** Environment to read the GitHub token from. Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** How to run git. Defaults to spawning the `git` binary. */
  readonly git?: GitRunner;
  /**
   * How to check a harness can be dispatched to. Defaults to asking each known
   * harness to resolve what it actually loads.
   */
  readonly probe?: HarnessProbe;
}

/**
 * Declare a project's conductor configuration.
 *
 * A typed identity function — it validates the shape at compile time and
 * returns it unchanged. All the work happens in {@link resolveConductor}.
 *
 * @param config What this project overrides. Omit it entirely for level 1.
 */
export function defineConductor(config: ConductorConfig = {}): ConductorConfig {
  return config;
}

/**
 * Fill in everything the config left out, from the environment.
 *
 * @param config The declaration from `conductor.config.ts`.
 * @param options Injected seams — cwd, env, git, and the PATH probe.
 * @returns A config with no field left to look up.
 * @throws {ConductorConfigError} when a discovery cannot answer and the config
 *   did not supply the value. Never falls back to a default.
 */
export async function resolveConductor(
  config: ConductorConfig = {},
  options: ResolveOptions = {},
): Promise<ResolvedConductor> {
  const { cwd = process.cwd(), env = process.env, git = defaultGitRunner, probe } = options;
  // The same constant provisioning defaults to, so the remote discovery reads
  // from and the remote a checkout is cut off can never drift apart.
  const remote = config.remote ?? DEFAULT_REMOTE;

  // Resolved once, here, and fed to everything downstream — the field is typed
  // absolute and every reader is entitled to believe it. A configured relative
  // path returned as written is resolved against the *process's* cwd by the git
  // commands and the worktree provisioning that follow, not against the one this
  // resolver was handed, so conductor would inspect and commit to a different
  // checkout than the caller named. Both branches go through the one resolve so
  // the configured path and the discovered one cannot come out under different
  // rules.
  const repoRoot = path.resolve(cwd, config.repoRoot ?? (await discoverRepoRoot(git, cwd)));

  let repo = config.repo;
  let remoteUrl: string | null = null;
  if (!repo) {
    remoteUrl = await discoverRemoteUrl(git, repoRoot, remote);
    const parsed = parseRepoRef(remoteUrl);
    if (!parsed) {
      throw new ConductorConfigError(
        `The \`${remote}\` remote (${remoteUrl}) is not a GitHub repository URL, so ` +
          `conductor cannot tell which owner and repo it manages. Set it in ` +
          `conductor.config.ts.`,
        "repo",
      );
    }
    repo = parsed;
  }

  const discoveredBranch = config.baseBranch
    ? null
    : await discoverDefaultBranch(git, repoRoot, remote);
  const baseBranch = config.baseBranch ?? discoveredBranch!.branch;
  const dispatcher = config.dispatcher ?? (await discoverDispatcher(probe));

  return {
    repoRoot,
    repo,
    remote,
    remoteUrl,
    baseBranch,
    token: discoverGitHubToken(env),
    dispatcher,
    guidance: config.guidance ?? [],
    policy: DEFAULT_POLICY,
    origins: {
      repoRoot: config.repoRoot ? "configured" : "discovered",
      repo: config.repo ? "configured" : "discovered",
      baseBranch: discoveredBranch
        ? discoveredBranch.from === "remote"
          ? "discovered"
          : "discovered-cached"
        : "configured",
      dispatcher: config.dispatcher ? "configured" : "discovered",
    },
  };
}
