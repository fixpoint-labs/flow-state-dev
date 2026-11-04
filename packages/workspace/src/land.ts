/**
 * Landing a run's accepted work, from a repository the operator listed on
 * this machine (`LocalWorkspaceHostOptions.localRepositories`): push the
 * run's branch and open a pull request, or merge it into the base branch
 * where the person has it checked out. `localWorkspaceHost`'s `land` calls
 * {@link landRun}; nothing else does.
 *
 * - **A push goes to a pinned URL, never a remote's name.** The run shares
 *   the repository's config and can repoint `origin` or add a
 *   `url.insteadOf`, so the push runs in an empty repository of its own over
 *   the person's objects, to the URL the host pinned at start, with the
 *   person's own credential helpers and nothing in config that runs a
 *   program. A remote repointed since is refused, naming the pin file, the
 *   same as a fetch. Never a force push.
 * - **A merge never resolves a conflict.** It runs in the person's checkout
 *   of the base branch, refuses one with uncommitted changes, and on a
 *   conflict aborts, so the checkout is as it was, and says which files.
 * - **The run's branch is never touched.** Whatever fails, its commits stay
 *   where they are, so the person can try again.
 *
 * Every failure is a `WorkspaceRefusedError` whose message says what
 * happened and, where there is one, what clears it.
 */
import { pullRequestRefFromUrl } from "@flow-state-dev/core";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./exec";
import { scratchDir } from "./held-work";
import { WorkspaceRefusedError } from "./refused";
import { checkRemoteShape, redactRemote, withoutCredential } from "./remotes";
import type { KeptFetchPins } from "./repository";
import { firstLine, NO_HOOKS } from "./worktree";

/** How long one landing may take, by default: every command in it shares this one deadline. */
export const LAND_TIMEOUT_MS = 2 * 60_000;

/** The run whose work lands: its checkout and branch, and the ref it was cut from. */
export interface LandTarget {
  /** The run's checkout. */
  readonly cwd: string;
  /** The run's branch. */
  readonly branch: string;
  /**
   * The ref the run's branch was cut from, as its place recorded it. Absent
   * or `"HEAD"`: the branch the repository's own checkout is on now.
   */
  readonly baseRef?: string | null;
}

/** How a run's accepted work lands. */
export type LandRequest =
  | {
      readonly kind: "pull-request";
      /** The pull request's title. */
      readonly title: string;
      /** The pull request's description. */
      readonly body: string;
      /** The `gh` to run. Default `"gh"` on `PATH`. */
      readonly gh?: string;
      /** The whole landing's wall clock. Default {@link LAND_TIMEOUT_MS}. */
      readonly timeoutMs?: number;
    }
  | {
      readonly kind: "merge";
      /** The whole landing's wall clock. Default {@link LAND_TIMEOUT_MS}. */
      readonly timeoutMs?: number;
    };

/** Where a run's work landed. */
export type Landed =
  | {
      readonly kind: "pull-request";
      /** The pull request's web link. */
      readonly url: string;
      readonly number: number;
      /** The branch pushed: the run's own. */
      readonly branch: string;
      /** The branch the pull request asks to merge into, on the remote. */
      readonly base: string;
      /** The remote pushed to, with any credential removed. */
      readonly remote: string;
    }
  | {
      readonly kind: "merge";
      /** The branch merged into: the base, in the person's checkout. */
      readonly branch: string;
      /** The commit that branch is at after the merge. */
      readonly commit: string;
      /** The checkout the base branch is checked out in, where the merge ran. */
      readonly checkout: string;
      /** The run's branch, merged. */
      readonly from: string;
    };

/** What {@link landRun} needs from the host. */
export interface LandHost {
  /** The listed repository the run's checkout is a worktree of. */
  readonly repo: string;
  /** That repository's pins, as the host read them at start. */
  readonly pins: KeptFetchPins | undefined;
  /** The host's environment for git. */
  readonly env: Record<string, string>;
}

/**
 * Land a run's branch, by `request.kind`.
 *
 * @throws WorkspaceRefusedError `base-unknown`, `no-push-remote`,
 *   `remote-repointed`, `push-failed`, `pull-request-failed`,
 *   `base-not-checked-out`, `checkout-dirty`, `merge-conflict` or
 *   `merge-failed`, each saying what happened.
 */
export async function landRun(host: LandHost, target: LandTarget, request: LandRequest): Promise<Landed> {
  const deadline = Date.now() + (request.timeoutMs ?? LAND_TIMEOUT_MS);
  const left = () => Math.max(1, deadline - Date.now());
  const git = async (cwd: string, args: string[]) =>
    (await run("git", [...NO_HOOKS, ...args], { cwd, timeoutMs: left(), env: host.env })).stdout.trim();
  const base = await baseBranch(git, host.repo, target.baseRef);
  return request.kind === "merge"
    ? await merge(git, host.repo, base, target.branch)
    : await openPullRequest(git, host, target, base, request, left);
}

type Git = (cwd: string, args: string[]) => Promise<string>;

/** The local branch the run was cut from: `baseRef`'s, or the repository's checked-out one for none or `HEAD`. */
async function baseBranch(git: Git, repo: string, baseRef: string | null | undefined): Promise<string> {
  if (baseRef != null && baseRef !== "HEAD") return baseRef.replace(/^refs\/heads\//, "");
  try {
    return await git(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  } catch {
    throw new WorkspaceRefusedError(
      "base-unknown",
      `${repo} has no branch checked out, so there is no base branch to land on. Check one out there, then try again.`,
    );
  }
}

/** Merge `from` into `base` where `base` is checked out; a conflict aborts and says which files. */
async function merge(git: Git, repo: string, base: string, from: string): Promise<Landed> {
  const listed = await git(repo, ["worktree", "list", "--porcelain"]);
  let checkout: string | undefined;
  let current: string | undefined;
  for (const line of listed.split("\n")) {
    if (line.startsWith("worktree ")) current = line.slice("worktree ".length);
    else if (line === `branch refs/heads/${base}`) checkout = current;
  }
  if (checkout === undefined) {
    throw new WorkspaceRefusedError(
      "base-not-checked-out",
      `"${base}" isn't checked out anywhere in ${repo}, so there is no checkout to merge into. ` +
        `Check it out there, then try again. The run's commits are still on "${from}".`,
    );
  }
  if ((await git(checkout, ["status", "--porcelain", "--untracked-files=no"])) !== "") {
    throw new WorkspaceRefusedError(
      "checkout-dirty",
      `${checkout} has uncommitted changes on "${base}", so nothing was merged. ` +
        `Commit or stash them, then try again. The run's commits are still on "${from}".`,
    );
  }
  try {
    await git(checkout, ["merge", "--no-edit", "--quiet", from]);
  } catch (error) {
    const conflicted = await git(checkout, ["diff", "--name-only", "--diff-filter=U"]).catch(() => "");
    // Abort whatever the merge left, so the checkout is as it was.
    await git(checkout, ["merge", "--abort"]).catch(() => undefined);
    if (conflicted !== "") {
      const files = conflicted.split("\n");
      throw new WorkspaceRefusedError(
        "merge-conflict",
        `Merging "${from}" into "${base}" conflicts in ${files.join(", ")}, so it was stopped and nothing changed in ${checkout}. ` +
          `Nothing was resolved for you: merge it by hand, or open a pull request instead.`,
      );
    }
    throw new WorkspaceRefusedError(
      "merge-failed",
      `Merging "${from}" into "${base}" in ${checkout} failed: ${firstLine(error) ?? "git gave no reason"}. ` +
        `The run's commits are still on "${from}".`,
    );
  }
  return { kind: "merge", branch: base, commit: await git(checkout, ["rev-parse", "HEAD"]), checkout, from };
}

/**
 * The remote a push goes to, and the branch a pull request asks to merge
 * into there: the base branch's pinned upstream, else the pinned `origin`
 * (or the one pinned remote) and the base's own name.
 */
function pushRemote(pins: KeptFetchPins | undefined, base: string): { remoteName: string; url: string; base: string } | undefined {
  const upstream = pins?.upstreams.get(`refs/heads/${base}`);
  if (upstream !== undefined) {
    const url = pins!.remotes.get(upstream.remoteName);
    if (url !== undefined) return { remoteName: upstream.remoteName, url, base: upstream.remoteRef.replace(/^refs\/heads\//, "") };
  }
  const names = [...(pins?.remotes.keys() ?? [])];
  const remoteName = names.includes("origin") ? "origin" : names.length === 1 ? names[0] : undefined;
  if (remoteName === undefined) return undefined;
  return { remoteName, url: pins!.remotes.get(remoteName)!, base };
}

/** `gh`'s `--repo` for a GitHub URL (`host/owner/name`), or `undefined` when it isn't one. */
function repoOf(url: string): string | undefined {
  const scp = /^(?:[^@/]+@)?([^:/]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  if (scp !== null && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return `${scp[1]}/${scp[2]}/${scp[3]}`;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return undefined;
    const [owner, name] = parsed.pathname.replace(/^\/+/, "").replace(/\.git\/?$/, "").split("/");
    return owner && name ? `${parsed.hostname}/${owner}/${name}` : undefined;
  } catch {
    return undefined;
  }
}

/** Push the run's branch to the pinned remote, then open its pull request, or find the one already open. */
async function openPullRequest(
  git: Git,
  host: LandHost,
  target: LandTarget,
  base: string,
  request: Extract<LandRequest, { kind: "pull-request" }>,
  left: () => number,
): Promise<Landed> {
  const remote = pushRemote(host.pins, base);
  if (remote === undefined) {
    throw new WorkspaceRefusedError(
      "no-push-remote",
      `${host.repo} had no single remote to push to when the host started (an "origin", or "${base}"'s upstream), ` +
        `so the run's branch "${target.branch}" was not pushed. Its commits are still there.`,
    );
  }
  const live = await git(host.repo, ["remote", "get-url", remote.remoteName]).catch(() => undefined);
  if (live !== undefined && withoutCredential(live) !== remote.url) {
    throw new WorkspaceRefusedError(
      "remote-repointed",
      `Remote "${remote.remoteName}" now points at "${redactRemote(live)}", not "${redactRemote(remote.url)}" as pinned, ` +
        `so the run's branch was not pushed with your credentials.` +
        (host.pins === undefined ? "" : ` To pin the repository's current config, delete ${host.pins.file} and restart the host.`),
    );
  }
  const judged = checkRemoteShape(remote.url);
  if ("reason" in judged) throw new WorkspaceRefusedError("push-failed", `The run's branch was not pushed: ${judged.message}`);

  const commit = await git(target.cwd, ["rev-parse", "--verify", `refs/heads/${target.branch}^{commit}`]);
  // Pushed from an empty repository of its own over the person's objects: the
  // repository's config, which the run can rewrite, is never read.
  let scratch: string | undefined;
  try {
    scratch = scratchDir();
    const objects = join(await git(host.repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "objects");
    const isolated = { ...host.env, GIT_DIR: scratch, GIT_OBJECT_DIRECTORY: objects };
    await run("git", ["init", "--quiet", "--bare", scratch], { cwd: scratch, timeoutMs: left(), env: host.env });
    await run(
      "git",
      [
        "-c", "core.sshCommand=ssh",
        "-c", "core.askPass=",
        ...NO_HOOKS,
        "-c", "core.fsmonitor=false",
        "-c", "protocol.allow=never",
        "-c", `protocol.${judged.scheme}.allow=always`,
        "-c", "credential.helper=",
        ...(host.pins?.credentialHelpers ?? []).flatMap(([key, value]) => ["-c", `${key}=${value}`]),
        "push",
        "--receive-pack=git-receive-pack",
        "--quiet",
        "--no-verify",
        "--",
        judged.url,
        `${commit}:refs/heads/${target.branch}`,
      ],
      { cwd: scratch, timeoutMs: left(), env: { ...isolated, GIT_ALLOW_PROTOCOL: judged.scheme, GIT_SSH_COMMAND: "ssh" } },
    );
  } catch (error) {
    throw new WorkspaceRefusedError(
      "push-failed",
      `Pushing "${target.branch}" to ${redactRemote(remote.url)} failed: ${firstLine(error) ?? "git gave no reason"}. ` +
        `Its commits are still on the branch in ${target.cwd}.`,
    );
  } finally {
    try {
      if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
    } catch {}
  }

  const gh = request.gh ?? "gh";
  const repo = repoOf(remote.url);
  const ghEnv = { GH_PROMPT_DISABLED: "1" };
  const where = repo === undefined ? [] : ["--repo", repo];
  const failed = (step: string, error: unknown) =>
    new WorkspaceRefusedError(
      "pull-request-failed",
      `"${target.branch}" was pushed to ${redactRemote(remote.url)}, but ${step} failed: ${firstLine(error) ?? "gh gave no reason"}.`,
    );
  // A try after one that pushed and opened it, but failed to record it: the open one, not a second.
  let open: Array<{ url?: unknown; number?: unknown }> = [];
  try {
    const { stdout } = await run(
      gh,
      ["pr", "list", ...where, "--head", target.branch, "--state", "open", "--json", "number,url", "--limit", "1"],
      { cwd: target.cwd, timeoutMs: left(), env: ghEnv },
    );
    const parsed = JSON.parse(stdout || "[]") as unknown;
    if (Array.isArray(parsed)) open = parsed;
  } catch (error) {
    throw failed("asking GitHub for its open pull request", error);
  }
  let url = typeof open[0]?.url === "string" ? open[0].url : undefined;
  if (url === undefined) {
    try {
      const { stdout } = await run(
        gh,
        ["pr", "create", ...where, "--head", target.branch, "--base", remote.base, "--title", request.title, "--body", request.body],
        { cwd: target.cwd, timeoutMs: left(), env: ghEnv },
      );
      url = stdout.trim().split("\n").reverse().find((line) => pullRequestRefFromUrl(line.trim()) !== null)?.trim();
    } catch (error) {
      throw failed("opening its pull request", error);
    }
  }
  const ref = url === undefined ? null : pullRequestRefFromUrl(url);
  if (url === undefined || ref === null) throw failed("opening its pull request", new Error("gh printed no pull request link"));
  return { kind: "pull-request", url, number: ref.number, branch: target.branch, base: remote.base, remote: redactRemote(remote.url) };
}
