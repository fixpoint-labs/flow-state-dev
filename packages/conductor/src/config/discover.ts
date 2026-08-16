/**
 * Discovery — reading what the environment already knows.
 *
 * The rule the config surface is held to: **a field earns its place only if it
 * encodes an intent the environment cannot reveal.** Which repo, which token,
 * which default branch, and which coding harness are all facts of the machine
 * conductor is running on, so asking for them would be a knob that shouldn't
 * exist — and worse than a no-op, because it is a second place for one fact to
 * live. This module is the other half of that claim: everything level 1 does
 * not ask for has to actually be discoverable, and here is where.
 *
 * Two rules hold throughout:
 *
 * - **A failed discovery is an error, never a default.** Falling back to
 *   `main`, to `github.com/owner/repo`, or to "whichever harness we shipped
 *   first" would turn a misconfigured machine into a run that does the wrong
 *   thing quietly. Every failure here names what was looked for and which
 *   config field overrides it.
 * - **Everything is injected.** `git`, the environment, and the harness probe
 *   all arrive as parameters, so discovery is testable without a checkout, a
 *   token, or an installed harness.
 */

import { spawn } from "node:child_process";
import { defaultResolveClaudeAgentQuery } from "@flow-state-dev/claude-code/sdk";
import type { GitResult, GitRunner } from "../dispatch/branch";
import { claudeCodeDispatcher } from "../dispatch";
import type { Dispatcher } from "../dispatch/types";

/** A discovery could not answer, and no config field supplied the answer. */
export class ConductorConfigError extends Error {
  constructor(
    message: string,
    /** The `conductor.config.ts` field that overrides this discovery. */
    readonly field: string,
  ) {
    super(message);
    this.name = "ConductorConfigError";
  }
}

/**
 * Run one git command and resolve with its result. Resolves on a non-zero exit
 * rather than rejecting, matching {@link GitRunner}, so a failed probe is a code
 * to branch on rather than an exception to catch.
 */
export const defaultGitRunner: GitRunner = (argv, cwd) =>
  new Promise<GitResult>((resolve, reject) => {
    const child = spawn("git", [...argv], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

/** Where a repository lives, as GitHub addresses it. */
export interface RepoRef {
  /** `github.com`, or an Enterprise host. */
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
}

/**
 * Parse a git remote URL into owner and repo.
 *
 * Handles the three forms a checkout actually carries — `git@host:owner/repo.git`,
 * `https://host/owner/repo.git`, and `ssh://git@host/owner/repo` — and returns
 * `null` for anything that does not yield a host plus two path segments (a local
 * path remote, for instance, which has no owner).
 */
export function parseRepoRef(remoteUrl: string): RepoRef | null {
  const trimmed = remoteUrl.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  if (trimmed === "") return null;

  let host: string;
  let path: string;

  if (trimmed.includes("://")) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    host = url.host;
    path = url.pathname;
  } else {
    // scp-like: [user@]host:path
    const match = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(trimmed);
    if (!match) return null;
    host = match[1]!;
    path = match[2]!;
  }

  const segments = path.split("/").filter((segment) => segment !== "");
  if (host === "" || segments.length < 2) return null;
  return { host, owner: segments.at(-2)!, repo: segments.at(-1)! };
}

/** The repository root of the checkout conductor is running inside. */
export async function discoverRepoRoot(git: GitRunner, cwd: string): Promise<string> {
  const result = await git(["rev-parse", "--show-toplevel"], cwd);
  const root = result.stdout.trim();
  if (result.code !== 0 || root === "") {
    throw new ConductorConfigError(
      `Not inside a git checkout (\`git rev-parse --show-toplevel\` failed in ${cwd}). ` +
        `Conductor discovers the repo from the checkout it runs in.`,
      "repoRoot",
    );
  }
  return root;
}

/** The URL a remote points at. */
export async function discoverRemoteUrl(
  git: GitRunner,
  repoRoot: string,
  remote: string,
): Promise<string> {
  const result = await git(["remote", "get-url", remote], repoRoot);
  const url = result.stdout.trim();
  if (result.code !== 0 || url === "") {
    throw new ConductorConfigError(
      `The checkout at ${repoRoot} has no \`${remote}\` remote. Conductor reads the ` +
        `repository under management from it.`,
      "repo",
    );
  }
  return url;
}

/** The default branch, and which of the two reads answered for it. */
export interface DiscoveredDefaultBranch {
  readonly branch: string;
  /**
   * `"remote"` — the remote itself answered, so the value is current.
   * `"cached"` — only the local ref answered, so the value may be stale.
   */
  readonly from: "remote" | "cached";
}

/**
 * The remote's default branch — the branch every new issue branch is cut from.
 *
 * **Asked of the remote, not of the local ref.** `refs/remotes/<remote>/HEAD`
 * is written at clone time and then left alone: neither `git fetch` nor `git
 * remote update` refreshes it, so a repository that renames its default branch
 * while the old one still exists leaves every existing clone pointing at the
 * old name indefinitely. Reading it would provision every new workspace from an
 * obsolete base — silently, since the old branch still resolves.
 *
 * The local ref is therefore the **fallback**, taken only when `ls-remote`
 * cannot answer at all: no network, no credentials for a private remote, a
 * remote that has gone away. That case is reported rather than smoothed over —
 * see {@link DiscoveredDefaultBranch.from}, which `resolveConductor` carries
 * into `origins.baseBranch` as `"discovered-cached"`. A stale base branch is
 * worth knowing about at the moment it is chosen; discovering it from a pile of
 * pull requests cut from the wrong branch is not.
 *
 * **What this costs.** One network round-trip per config resolution, on a path
 * that was previously all-local. Resolution happens once per process, so the
 * cost is per process rather than per tick — but a project that resolves in a
 * hot loop, or one that runs offline by design, sets `baseBranch` in
 * `conductor.config.ts` and skips this function entirely.
 *
 * A hardcoded `main` fallback is deliberately absent: basing work on the wrong
 * branch is silent and expensive to unwind.
 */
export async function discoverDefaultBranch(
  git: GitRunner,
  repoRoot: string,
  remote: string,
): Promise<DiscoveredDefaultBranch> {
  const remoteHead = await git(["ls-remote", "--symref", remote, "HEAD"], repoRoot);
  const match = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m.exec(remoteHead.stdout);
  if (remoteHead.code === 0 && match) return { branch: match[1]!, from: "remote" };

  const local = await git(["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`], repoRoot);
  const localRef = local.stdout.trim();
  if (local.code === 0 && localRef !== "") {
    const branch = localRef.replace(`refs/remotes/${remote}/`, "");
    if (branch !== "" && branch !== localRef) return { branch, from: "cached" };
  }

  throw new ConductorConfigError(
    `Could not read the default branch of \`${remote}\` — neither ` +
      `\`git ls-remote --symref\` nor refs/remotes/${remote}/HEAD answered. ` +
      `Set it in conductor.config.ts.`,
    "baseBranch",
  );
}

/**
 * The GitHub token, from the variables `gh` already uses.
 *
 * **`GH_TOKEN` wins over `GITHUB_TOKEN`, which is the order `gh` documents**
 * (`gh help environment`: "GH_TOKEN, GITHUB_TOKEN (in order of precedence)").
 * Borrowing `gh`'s variables and not its precedence is worse than having our
 * own: the case it decides is a workflow where Actions injects a
 * repository-scoped `GITHUB_TOKEN` on its own while the operator supplies a
 * broader `GH_TOKEN` deliberately, and picking the narrower one surfaces much
 * later as a permissions error on an upstream read or write.
 *
 * **`null` rather than a raise, and this is the one discovery that reports an
 * absence instead of refusing it.** Every other field here has a
 * `conductor.config.ts` override, so "the lookup missed and nobody said
 * otherwise" is a genuine dead end. The token has none — and it is also the one
 * field a whole *supported* configuration never uses: an entity read from a
 * local checkout touches no GitHub API, and demanding a credential for it closes
 * the source that exists precisely for machines that have none. So the absence
 * travels, and {@link requireGitHubToken} refuses it at the point where GitHub
 * is actually the source being read.
 */
export function discoverGitHubToken(env: NodeJS.ProcessEnv): string | null {
  // Blank is unset. A workflow that writes `GH_TOKEN: ${{ secrets.PAT }}` with
  // no such secret exports an empty string, and `??` alone would take it and
  // report "no token" with a perfectly good `GITHUB_TOKEN` sitting there.
  const token = [env.GH_TOKEN, env.GITHUB_TOKEN].find((value) => (value ?? "").trim() !== "");
  return token ? token.trim() : null;
}

/**
 * The token, or the error that names what to set — raised where GitHub is the
 * source being read, and nowhere else.
 *
 * **Still eager.** The property the config layer holds is that a lookup which
 * cannot answer fails *at startup*, wearing its own name, rather than twenty
 * minutes later wearing something else's. This keeps it: the default observer is
 * built while `openConductor` is assembling, one call after resolution, so a
 * credential-less run against GitHub still stops before a work item is managed.
 * What moves is only *which* configurations the requirement applies to.
 *
 * Blank counts as absent, for {@link discoverGitHubToken}'s reason — a value the
 * environment set to the empty string is a secret that did not arrive.
 */
export function requireGitHubToken(token: string | null): string {
  if (token !== null && token.trim() !== "") return token.trim();
  throw new ConductorConfigError(
    "No GitHub token found, and the world is being read from GitHub. Conductor " +
      "reads GH_TOKEN or GITHUB_TOKEN, in that order — the same variables the " +
      "`gh` CLI uses, in the same precedence. Set one, or pass an `observer` that " +
      "reads somewhere else: a local checkout needs no credential.",
    "github.token",
  );
}

/** One coding harness conductor knows how to dispatch to. */
export interface KnownHarness {
  readonly vendor: string;
  /**
   * What has to be present for this vendor's dispatcher to run, named the way a
   * person would install it. Message text only — {@link available} is what
   * actually decides.
   */
  readonly requires: string;
  /** True when {@link requires} is satisfied on this machine. */
  readonly available: () => Promise<boolean>;
  readonly create: () => Dispatcher;
}

/**
 * Coding harnesses conductor knows how to dispatch to, in preference order.
 *
 * A vendor earns an entry here by having a {@link Dispatcher} implementation —
 * not by being installed. Discovery picks the first entry that reports itself
 * available, so adding a vendor is one row and no branching.
 *
 * **An entry probes what its dispatcher actually loads, not a binary that
 * resembles it.** `claudeCodeDispatcher` runs through
 * `@flow-state-dev/claude-code/sdk`, which loads the Agent SDK in-process and
 * brings its own executable — so a `claude` binary on `PATH` is neither
 * necessary nor sufficient, and probing for one reports "no harness available"
 * on a machine where dispatch works perfectly. The probe resolves the SDK
 * through the same seam the dispatcher does, so the two can only ever agree.
 * The SDK itself is never imported here: `@flow-state-dev/claude-code` is the
 * one package in the repo that imports it, and conductor routes through that
 * package rather than acquiring the dependency.
 */
export const KNOWN_HARNESSES: readonly KnownHarness[] = [
  {
    vendor: "claude-code",
    requires: "`@anthropic-ai/claude-agent-sdk` (claude-code)",
    available: async () => {
      try {
        await defaultResolveClaudeAgentQuery();
        return true;
      } catch {
        return false;
      }
    },
    create: () => claudeCodeDispatcher(),
  },
];

/**
 * True when a harness can actually be dispatched to. Injected so dispatcher
 * resolution is testable on a machine with no coding harness installed, and so
 * a test never loads a vendor SDK to find out.
 */
export type HarnessProbe = (harness: KnownHarness) => boolean | Promise<boolean>;

/** Ask each harness whether it is available. */
export const defaultHarnessProbe: HarnessProbe = (harness) => harness.available();

/**
 * The coding harness available on this machine.
 *
 * @throws {ConductorConfigError} when no entry in {@link KNOWN_HARNESSES}
 *   reports itself available. Deliberately loud: a silent default would
 *   dispatch every phase to a harness that cannot load and report each one as a
 *   failed dispatch instead of as a machine that is not set up.
 */
export async function discoverDispatcher(
  probe: HarnessProbe = defaultHarnessProbe,
): Promise<Dispatcher> {
  for (const harness of KNOWN_HARNESSES) {
    if (await probe(harness)) return harness.create();
  }
  const looked = KNOWN_HARNESSES.map((h) => `${h.requires}`).join(", ");
  throw new ConductorConfigError(
    `No coding harness is available. Conductor looked for ${looked}. Install one, ` +
      `or name a dispatcher in conductor.config.ts.`,
    "dispatcher",
  );
}
