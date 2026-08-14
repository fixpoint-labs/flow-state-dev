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
 * - **Everything is injected.** `git`, the environment, and the PATH probe all
 *   arrive as parameters, so discovery is testable without a checkout, a token,
 *   or an installed CLI.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
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

/**
 * True when a binary is runnable. Injected so dispatcher resolution is testable
 * on a machine with no coding harness installed — and so the check never spawns
 * a process just to find out whether it exists.
 */
export type BinaryProbe = (bin: string) => boolean;

/** Walk `PATH` for an executable entry named `bin`. */
export function onPath(bin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (bin.includes("/") || bin.includes("\\")) return existsSync(bin);
  const extensions =
    process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    for (const extension of extensions) {
      if (existsSync(join(dir, `${bin}${extension}`))) return true;
    }
  }
  return false;
}

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

/**
 * The remote's default branch — the branch every new issue branch is cut from.
 *
 * Read from the local `refs/remotes/<remote>/HEAD` first, and from the remote
 * itself when the local ref is unset (a shallow or single-branch clone). A
 * hardcoded `main` fallback is deliberately absent: basing work on the wrong
 * branch is silent and expensive to unwind.
 */
export async function discoverDefaultBranch(
  git: GitRunner,
  repoRoot: string,
  remote: string,
): Promise<string> {
  const local = await git(["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`], repoRoot);
  const localRef = local.stdout.trim();
  if (local.code === 0 && localRef !== "") {
    const branch = localRef.replace(`refs/remotes/${remote}/`, "");
    if (branch !== "" && branch !== localRef) return branch;
  }

  const remoteHead = await git(["ls-remote", "--symref", remote, "HEAD"], repoRoot);
  const match = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m.exec(remoteHead.stdout);
  if (remoteHead.code === 0 && match) return match[1]!;

  throw new ConductorConfigError(
    `Could not read the default branch of \`${remote}\` — neither ` +
      `refs/remotes/${remote}/HEAD nor \`git ls-remote --symref\` answered. ` +
      `Set it in conductor.config.ts.`,
    "baseBranch",
  );
}

/**
 * The GitHub token, from the variables `gh` already uses.
 *
 * GitHub is the one connector that is not optional — it hosts the artifacts and
 * the gates — so an absent token is an error rather than a degraded mode.
 */
export function discoverGitHubToken(env: NodeJS.ProcessEnv): string {
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN;
  if (!token || token.trim() === "") {
    throw new ConductorConfigError(
      "No GitHub token found. Conductor reads GITHUB_TOKEN or GH_TOKEN, the same " +
        "variables the `gh` CLI uses. GitHub hosts the artifacts and the gates, so " +
        "there is no mode that runs without it.",
      "github.token",
    );
  }
  return token.trim();
}

/**
 * Coding harnesses conductor knows how to dispatch to, in preference order.
 *
 * A vendor earns an entry here by having a {@link Dispatcher} implementation —
 * not by being installed. Discovery picks the first entry whose binary is on
 * PATH, so adding a vendor is one row and no branching.
 */
export const KNOWN_HARNESSES: readonly {
  readonly vendor: string;
  readonly bin: string;
  readonly create: () => Dispatcher;
}[] = [{ vendor: "claude-code", bin: "claude", create: () => claudeCodeDispatcher() }];

/**
 * The coding harness installed on this machine.
 *
 * @throws {ConductorConfigError} when none of {@link KNOWN_HARNESSES} is on PATH.
 *   Deliberately loud: a silent default would dispatch every phase to a binary
 *   that is not there and report each one as a failed dispatch instead of as a
 *   machine that is not set up.
 */
export function discoverDispatcher(probe: BinaryProbe): Dispatcher {
  for (const harness of KNOWN_HARNESSES) {
    if (probe(harness.bin)) return harness.create();
  }
  const looked = KNOWN_HARNESSES.map((h) => `\`${h.bin}\` (${h.vendor})`).join(", ");
  throw new ConductorConfigError(
    `No coding harness found on PATH. Conductor looked for ${looked}. Install one, ` +
      `or name a dispatcher in conductor.config.ts.`,
    "dispatcher",
  );
}
