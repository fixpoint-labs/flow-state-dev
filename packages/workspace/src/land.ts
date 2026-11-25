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
 * - **Only the remote calls hold the host's credentials.** The push,
 *   `ls-remote`, fetch and `gh` start with `HOST_REMOTE_PASS` (gh's tokens,
 *   the ssh agent); every local git call starts with `HOST_GIT_PASS`, which
 *   carries none (`./child-env`).
 * - **A merge never resolves a conflict.** It runs in the person's checkout
 *   of the base branch, refuses one with uncommitted changes, and on a
 *   conflict aborts, so the checkout is as it was, and says which files.
 * - **The run's branch is never touched.** Whatever fails, its commits stay
 *   where they are, so the person can try again.
 *
 * - **A pull request goes into a branch the remote has.** When the run's base
 *   is gone from the remote (its pull request merged and the branch was
 *   deleted), it asks to merge into the remote's default branch instead.
 *
 * Every failure is a `WorkspaceRefusedError` whose message says what
 * happened and, where there is one, what clears it.
 */
import { pullRequestRefFromUrl } from "@flow-state-dev/core/harness";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { childEnv, HOST_GIT_PASS, HOST_REMOTE_PASS } from "./child-env";
import { run } from "./exec";
import { scratchDir } from "./held-work";
import { WorkspaceRefusedError } from "./refused";
import { checkRemoteShape, redactRemote, withoutCredential, type AllowedRemote } from "./remotes";
import type { KeptFetchPins } from "./repository";
import { firstLine, NO_HOOKS, remoteCallConfig } from "./worktree";

/** How long one landing may take, by default: every command in it shares this one deadline. */
const LAND_TIMEOUT_MS = 2 * 60_000;

/**
 * How long each command that puts a checkout back after a failed merge may
 * take: its own bound, not what is left of the landing's, so a merge that ran
 * out the landing's time is still undone.
 */
const RESTORE_TIMEOUT_MS = 30_000;

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
  /**
   * The commit the run's branch was cut at. When the run's branch is gone
   * (the run renamed it, or moved its work to a branch of its own), the
   * branch the checkout has checked out is landed instead, but only when it
   * holds commits over this one. Absent: a gone branch is refused.
   */
  readonly baseCommit?: string | null;
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
      /** The whole landing's wall clock. Default two minutes. */
      readonly timeoutMs?: number;
      /**
       * Land only on a pull request already open from the branch into its
       * base: when none is (it was closed or merged since it was found), or
       * GitHub can't say, nothing is pushed and none is opened, and the
       * landing is refused `pull-request-gone` or `pull-request-failed`.
       */
      readonly onlyExisting?: boolean;
    }
  | {
      readonly kind: "merge";
      /** The whole landing's wall clock. Default two minutes. */
      readonly timeoutMs?: number;
    };

/** Where a run's work landed. */
export type Landed =
  | {
      readonly kind: "pull-request";
      /** The pull request's web link. */
      readonly url: string;
      readonly number: number;
      /**
       * The branch pushed: the run's own, or the one its checkout is on when
       * the run moved its work off it (see `LandTarget.baseCommit`).
       */
      readonly branch: string;
      /** The branch the pull request asks to merge into, on the remote. */
      readonly base: string;
      /**
       * The base the run's work was cut from, when the remote no longer has
       * that branch (its pull request merged and the branch was deleted), so
       * the pull request asks to merge into the remote's default branch,
       * `base`, instead. Absent when it went into the run's own base.
       */
      readonly baseGone?: string;
      /** The remote pushed to, with any credential removed. */
      readonly remote: string;
      /**
       * `true` when the pull request was already open from the branch: the
       * branch was pushed to it and no pull request was opened. Absent on a
       * landing that opened one.
       */
      readonly existing?: boolean;
    }
  | {
      readonly kind: "merge";
      /** The branch merged into: the base, in the person's checkout. */
      readonly branch: string;
      /** The commit that branch is at after the merge. */
      readonly commit: string;
      /** The checkout the base branch is checked out in, where the merge ran. */
      readonly checkout: string;
      /** The run's branch, merged: its own, or the one its checkout is on (see `LandTarget.baseCommit`). */
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
  /**
   * The names a remote call (push, `ls-remote`, fetch, `gh`) may see from the
   * host's environment: `HOST_REMOTE_PASS` and the host's `remotes.pass`.
   * Default `HOST_REMOTE_PASS`.
   */
  readonly remotePass?: readonly string[];
  /**
   * The GitHub repository (`host/owner/name`, gh's `--repo`) a pinned remote's
   * URL names, or `undefined` when it names none. Default {@link repoOf}.
   */
  readonly pullRequestRepo?: (url: string) => string | undefined;
}

/**
 * The ways a run's branch can land on this host, asked before the review is:
 * `merge` for a run in a listed repository; `pull-request` too when its base
 * has a pinned remote that names a GitHub repository, the same checks
 * {@link landRun} makes before it pushes. Never throws: what can't be read
 * offers nothing.
 */
export async function landWays(host: LandHost, target: LandTarget): Promise<Array<LandRequest["kind"]>> {
  const git = async (cwd: string, args: string[]) =>
    (await run("git", [...NO_HOOKS, "-c", "core.fsmonitor=false", ...args], { cwd, timeoutMs: RESTORE_TIMEOUT_MS, env: host.env, pass: HOST_GIT_PASS })).stdout.trim();
  try {
    const { repo } = await pullRequestPlace(git, host, target.baseRef);
    return repo === undefined ? ["merge"] : ["pull-request", "merge"];
  } catch {
    return [];
  }
}

/**
 * The GitHub repository (`host/owner/name`) a run's base lands in: the one
 * its pinned remote's URL names, read the way {@link landRun} reads it, so
 * `gh` can be told the repository instead of reading it from a checkout the
 * run can configure. `undefined` when there is none or it can't be read.
 * Never throws.
 */
export async function pullRequestRepository(host: LandHost, target: Pick<LandTarget, "baseRef">): Promise<string | undefined> {
  const git = async (cwd: string, args: string[]) =>
    (await run("git", [...NO_HOOKS, "-c", "core.fsmonitor=false", ...args], { cwd, timeoutMs: RESTORE_TIMEOUT_MS, env: host.env, pass: HOST_GIT_PASS })).stdout.trim();
  try {
    return (await pullRequestPlace(git, host, target.baseRef)).repo;
  } catch {
    return undefined;
  }
}

/** The pull request already open from a run's branch, as {@link existingPullRequest} finds it. */
export interface ExistingPullRequest {
  /** The pull request's web link. */
  readonly url: string;
  readonly number: number;
  /** The branch it is open from: the run's own, or the one its checkout is on (see `LandTarget.baseCommit`). */
  readonly branch: string;
}

// FIX-2781.
/**
 * The pull request already open from the branch {@link landRun} would land,
 * into the base it would land on, asked before the review is, so a run whose
 * work goes onto an open pull request is never offered a second one. The
 * same checks `landRun` makes before it pushes (the branch, the pinned
 * remote, the GitHub repository it names), then `gh pr list --head <branch>
 * --state open`. `null` when there is none, or no pull request can be opened
 * here.
 *
 * @throws when it can't be told: the branch, the base or GitHub can't be read.
 */
export async function existingPullRequest(
  host: LandHost,
  target: LandTarget,
  options: { readonly gh?: string; readonly timeoutMs?: number } = {},
): Promise<ExistingPullRequest | null> {
  const deadline = Date.now() + (options.timeoutMs ?? LAND_TIMEOUT_MS);
  const left = () => Math.max(1, deadline - Date.now());
  const git = async (cwd: string, args: string[]) =>
    (await run("git", [...NO_HOOKS, "-c", "core.fsmonitor=false", ...args], { cwd, timeoutMs: left(), env: host.env, pass: HOST_GIT_PASS })).stdout.trim();
  const branch = await branchToLand(git, target);
  const { remote, repo } = await pullRequestPlace(git, host, target.baseRef);
  if (remote === undefined || repo === undefined) return null;
  const ghDir = scratchDir();
  try {
    const gh = { gh: options.gh ?? "gh", ghDir, ghEnv: { GH_PROMPT_DISABLED: "1", GIT_CEILING_DIRECTORIES: dirname(ghDir) }, where: ["--repo", repo], pass: host.remotePass ?? HOST_REMOTE_PASS };
    // Into the base a landing would ask for: the remote's default branch when the run's is gone.
    const judged = checkRemoteShape(remote.url);
    // A base gone with no default to fall back on throws `base-gone`: it can't be told where a pull request would be.
    const base = "reason" in judged ? remote.base : (await baseOnRemote(host, remote, judged, left)).base;
    const url = await openPullRequestOf(gh, branch, base, left());
    const ref = url === undefined ? null : pullRequestRefFromUrl(url);
    return url === undefined || ref === null ? null : { url, number: ref.number, branch };
  } finally {
    try {
      rmSync(ghDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Land a run's branch, by `request.kind`.
 *
 * A pull request already open from the branch into its base is the
 * landing: the branch is pushed to it, and no second one is opened.
 *
 * @throws WorkspaceRefusedError `branch-gone`, `base-unknown`, `no-push-remote`, `no-pull-request-repo`,
 *   `remote-repointed`, `base-gone`, `push-failed`, `pull-request-failed`, `pull-request-gone`,
 *   `base-not-checked-out`, `checkout-dirty`, `checkout-busy`, `merge-conflict` or
 *   `merge-failed`, each saying what happened.
 */
export async function landRun(host: LandHost, target: LandTarget, request: LandRequest): Promise<Landed> {
  const deadline = Date.now() + (request.timeoutMs ?? LAND_TIMEOUT_MS);
  const left = () => Math.max(1, deadline - Date.now());
  const git = async (cwd: string, args: string[], env: Record<string, string> = {}) =>
    (await run("git", [...NO_HOOKS, ...args], { cwd, timeoutMs: left(), env: { ...host.env, ...env }, pass: HOST_GIT_PASS })).stdout.trim();
  const restoreGit = async (cwd: string, args: string[], env: Record<string, string> = {}) =>
    (await run("git", [...NO_HOOKS, ...args], { cwd, timeoutMs: RESTORE_TIMEOUT_MS, env: { ...host.env, ...env }, pass: HOST_GIT_PASS })).stdout.trim();
  const landing = { ...target, branch: await branchToLand(git, target) };
  const place = await pullRequestPlace(git, host, target.baseRef);
  return request.kind === "merge"
    ? await merge(git, restoreGit, host.repo, place.base, landing.branch, childEnv({ pass: HOST_GIT_PASS, env: host.env }))
    : await openPullRequest(git, host, landing, place, request, left);
}

/**
 * The branch that holds the run's work: its own when it still exists, else
 * the one its checkout has checked out, when that holds commits over the
 * run's base commit. A run that renamed its branch, or moved its work to one
 * it named, lands from there.
 */
async function branchToLand(git: Git, target: LandTarget): Promise<string> {
  const has = (ref: string) => git(target.cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).then(() => true, () => false);
  if (await has(`refs/heads/${target.branch}`)) return target.branch;
  const head = await git(target.cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => undefined);
  const base = target.baseCommit ?? undefined;
  if (head !== undefined && base !== undefined && (await has(base))) {
    const holds =
      (await git(target.cwd, ["merge-base", "--is-ancestor", base, `refs/heads/${head}`]).then(() => true, () => false)) &&
      Number(await git(target.cwd, ["rev-list", "--count", `${base}..refs/heads/${head}`]).catch(() => "0")) > 0;
    if (holds) return head;
  }
  throw new WorkspaceRefusedError(
    "branch-gone",
    `The run's branch "${target.branch}" no longer exists, and the checkout in ${target.cwd} is ` +
      (head === undefined ? "on no branch" : `on "${head}", which holds no commits over the run's base`) +
      `, so there is nothing to land.`,
  );
}

type Git = (cwd: string, args: string[], env?: Record<string, string>) => Promise<string>;

/** The remote a push goes to, as {@link pushRemote} reads it. */
type PushRemote = { remoteName: string; url: string; base: string };

/**
 * Where a run's branch would land, read the same way by {@link landWays},
 * {@link existingPullRequest} and {@link landRun}: the run's base, the pinned
 * remote a push goes to, and the GitHub repository that remote names
 * (`undefined` where there is none).
 */
async function pullRequestPlace(
  git: Git,
  host: LandHost,
  baseRef: string | null | undefined,
): Promise<{ base: Base; remote: PushRemote | undefined; repo: string | undefined }> {
  const base = await resolveBase(git, host.repo, host.pins, baseRef);
  const remote = pushRemote(host.pins, base);
  return { base, remote, repo: remote === undefined ? undefined : (host.pullRequestRepo ?? repoOf)(remote.url) };
}

/**
 * The base the run was cut from. `local` is the branch a merge lands on;
 * `remote` is set when the base is a remote-tracking ref (`origin/main`,
 * `refs/remotes/origin/main`): the pinned remote and its branch there, which a
 * pull request targets.
 */
interface Base {
  /** The local branch: `baseRef`'s own, or the one that tracks a remote base, as pinned. `undefined` when none does. */
  readonly local: string | undefined;
  /** For a remote-tracking base: the remote it is on and the branch's name there. */
  readonly remote?: { readonly remoteName: string; readonly branch: string };
  /** How the run named its base, for messages. */
  readonly named: string;
}

/**
 * Read `baseRef` as a {@link Base}: none or `HEAD` is the repository's
 * checked-out branch; a local branch of that name wins over a remote-tracking
 * ref spelled the same (a local `origin/main` is a branch); a remote-tracking
 * ref is split by the remotes the host pinned, never by the live config.
 */
async function resolveBase(git: Git, repo: string, pins: KeptFetchPins | undefined, baseRef: string | null | undefined): Promise<Base> {
  if (baseRef == null || baseRef === "HEAD") {
    try {
      const local = await git(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
      return { local, named: local };
    } catch {
      throw new WorkspaceRefusedError(
        "base-unknown",
        `${repo} has no branch checked out, so there is no base branch to land on. Check one out there, then try again.`,
      );
    }
  }
  if (baseRef.startsWith("refs/heads/")) return { local: baseRef.slice("refs/heads/".length), named: baseRef };
  const exists = (ref: string) => git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).then(() => true, () => false);
  let tracking: string;
  if (baseRef.startsWith("refs/remotes/")) tracking = baseRef;
  else if (await exists(`refs/heads/${baseRef}`)) return { local: baseRef, named: baseRef };
  else if (await exists(`refs/remotes/${baseRef}`)) tracking = `refs/remotes/${baseRef}`;
  else return { local: baseRef, named: baseRef };
  const name = tracking.slice("refs/remotes/".length);
  // The longest pinned remote name it starts with: a remote may itself have a slash.
  const remoteName = [...(pins?.remotes.keys() ?? [])]
    .filter((remote) => name.startsWith(`${remote}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (remoteName === undefined) {
    throw new WorkspaceRefusedError(
      "base-unknown",
      `The run's base "${baseRef}" is on a remote ${repo} didn't have when the host started, so there is no base to land on.`,
    );
  }
  const local = [...(pins?.upstreams ?? [])].find(([, upstream]) => upstream.ref === tracking)?.[0].slice("refs/heads/".length);
  return { local, remote: { remoteName, branch: name.slice(remoteName.length + 1) }, named: baseRef };
}

/**
 * Merge `from` into the base where it is checked out, as a real merge commit
 * whatever the repository's merge config says (`--commit --no-squash`), never
 * overwriting an ignored file. A conflict aborts and says which files.
 */
async function merge(
  git: Git,
  hostRestoreGit: Git,
  repo: string,
  resolved: Base,
  from: string,
  inherited: Record<string, string | undefined>,
): Promise<Landed> {
  const base = resolved.local;
  if (base === undefined) {
    throw new WorkspaceRefusedError(
      "base-not-checked-out",
      `No local branch in ${repo} tracks the run's base "${resolved.named}", so there is no checkout to merge into. ` +
        `Check out a branch that tracks it, then try again. The run's commits are still on "${from}".`,
    );
  }
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
  // From here every command runs in the person's checkout, whose config the run shares and can write:
  // nothing in it that names a program is obeyed (`programsOff`). The overrides go through
  // `GIT_CONFIG_COUNT`/`KEY`/`VALUE`, which keep a key and its value apart (a `-c key=value` splits a
  // subsection holding `=`), and git reads those from 2.31 on: older, the merge is refused.
  await requireGit(git, checkout, from);
  const off = await programsOff(git, checkout, inherited);
  const checkoutGit: Git = (cwd, args) => git(cwd, args, off);
  const restoreGit: Git = (cwd, args) => hostRestoreGit(cwd, args, off);
  if ((await checkoutGit(checkout, ["status", "--porcelain", "--untracked-files=no"])) !== "") {
    throw new WorkspaceRefusedError(
      "checkout-dirty",
      `${checkout} has uncommitted changes on "${base}", so nothing was merged. ` +
        `Commit or stash them, then try again. The run's commits are still on "${from}".`,
    );
  }
  // The person's own unfinished merge, rebase, cherry-pick or revert is theirs: refuse before
  // starting, so every merge state this function aborts or resets below is one it began.
  const busy: string[] = [];
  for (const name of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD", "rebase-merge", "rebase-apply"]) {
    if (existsSync(await checkoutGit(checkout, ["rev-parse", "--path-format=absolute", "--git-path", name]))) busy.push(name);
  }
  if (busy.length > 0) {
    throw new WorkspaceRefusedError(
      "checkout-busy",
      `${checkout} is in the middle of a merge, rebase, cherry-pick or revert (${busy.join(", ")}), so nothing was merged and it was left as it was. ` +
        `Finish or abort it, then try again. The run's commits are still on "${from}".`,
    );
  }
  const fromCommit = await checkoutGit(checkout, ["rev-parse", "--verify", `refs/heads/${from}^{commit}`]);
  const before = await checkoutGit(checkout, ["rev-parse", "--verify", "HEAD"]);
  try {
    // Explicit, so `merge.ff`/`branch.<base>.mergeOptions` can't make it a squash or leave it uncommitted,
    // and an ignored file in the checkout is refused, not overwritten.
    await checkoutGit(checkout, ["merge", "--no-edit", "--quiet", "--commit", "--no-squash", "--no-overwrite-ignore", from]);
  } catch (error) {
    // The index's unmerged entries, not git's wording: `<mode> <object> <stage>\t<path>` per stage.
    // Read and undone on their own time: the merge may have failed by running out the landing's.
    const unmerged = await restoreGit(checkout, ["ls-files", "--unmerged"]).catch(() => "");
    if (!(await restore(restoreGit, checkout, before))) throw notRestored(checkout, base, from, before, error);
    if (unmerged !== "") {
      const files = [...new Set(unmerged.split("\n").map((line) => line.slice(line.indexOf("\t") + 1)))];
      throw new WorkspaceRefusedError(
        "merge-conflict",
        `Merging "${from}" into "${base}" conflicts in ${files.join(", ")}, so it was stopped and nothing changed in ${checkout}. ` +
          `Nothing was resolved for you: merge it by hand, or open a pull request instead.`,
      );
    }
    throw new WorkspaceRefusedError(
      "merge-failed",
      `Merging "${from}" into "${base}" in ${checkout} failed: ` +
        ((error as { killed?: unknown }).killed === true ? "it ran out of the landing's time" : (firstLine(error) ?? "git gave no reason")) +
        `. Nothing changed in that checkout. The run's commits are still on "${from}".`,
    );
  }
  const commit = await checkoutGit(checkout, ["rev-parse", "HEAD"]);
  // Success means the run's commit is on the base now, whatever git printed.
  if (!(await checkoutGit(checkout, ["merge-base", "--is-ancestor", fromCommit, commit]).then(() => true, () => false))) {
    if (!(await restore(restoreGit, checkout, before))) throw notRestored(checkout, base, from, before, null);
    throw new WorkspaceRefusedError(
      "merge-failed",
      `Merging "${from}" into "${base}" in ${checkout} didn't commit it, so it didn't land. ` +
        `Nothing changed in that checkout. The run's commits are still on "${from}".`,
    );
  }
  return { kind: "merge", branch: base, commit, checkout, from };
}

/**
 * Config keys that name a program git would run while it checks, merges or
 * resets a checkout: the fsmonitor hook, content filters, merge drivers and
 * signing programs. Lowercase, as `git config --get-regexp` prints keys.
 */
const PROGRAM_KEYS = /^(core\.fsmonitor|core\.sshcommand|core\.askpass|gpg\.(.+\.)?program|gpg\.ssh\.defaultkeycommand|filter\..+\.(clean|smudge|process)|merge\..+\.driver)$/;

/** The oldest git that reads `GIT_CONFIG_COUNT`, which {@link programsOff} hands its overrides through. */
const GIT_CONFIG_ENV_SINCE = [2, 31] as const;

/** Refuse a local merge on a git too old to take {@link programsOff}'s overrides. */
async function requireGit(git: Git, cwd: string, from: string): Promise<void> {
  const version = await git(cwd, ["version"]).catch(() => "");
  const [major, minor] = (/(\d+)\.(\d+)/.exec(version) ?? []).slice(1).map(Number);
  const [needMajor, needMinor] = GIT_CONFIG_ENV_SINCE;
  if (major === undefined || minor === undefined || major < needMajor || (major === needMajor && minor < needMinor)) {
    throw new WorkspaceRefusedError(
      "git-too-old",
      `Merging locally needs git ${needMajor}.${needMinor} or later, to keep the checkout's own config from running a program, ` +
        `and this host has ${version || "a git that didn't say its version"}. Nothing was merged; open a pull request instead, ` +
        `or update git. The run's commits are still on "${from}".`,
    );
  }
}

/**
 * Overrides, as `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`, that
 * keep a checkout's own config from running a program. That config (`local`,
 * `worktree`) is shared with every run's worktree, so a run can write it; the
 * person's `global` and `system` config, and the host's own (`command`), can't
 * be. Each key that names a program and is set in the checkout's own config is
 * put back to its last trusted value, or else switched off: an empty filter
 * leaves content as it is, an empty merge driver can't run and so stops on the
 * conflict, an empty signing program fails the merge. The fsmonitor is off
 * always, as it is for every read the host makes. Appended after any
 * `GIT_CONFIG_COUNT` entries `inherited` already holds, so the host's own stay.
 */
async function programsOff(git: Git, cwd: string, inherited: Record<string, string | undefined>): Promise<Record<string, string>> {
  // `-z --show-scope`: `<scope>\0<key>\n<value>\0` per entry.
  const fields = (await git(cwd, ["config", "-z", "--show-scope", "--includes", "--get-regexp", PROGRAM_KEYS.source]).catch(() => "")).split("\0");
  const trusted = new Map<string, string>();
  const untrusted = new Set<string>();
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const scope = fields[i]!;
    const entry = fields[i + 1]!;
    const newline = entry.indexOf("\n");
    const key = newline < 0 ? entry : entry.slice(0, newline);
    const value = newline < 0 ? "true" : entry.slice(newline + 1);
    if (scope === "global" || scope === "system" || scope === "command") trusted.set(key, value);
    else untrusted.add(key);
  }
  const overrides: Array<[string, string]> = [["core.fsmonitor", "false"]];
  for (const key of untrusted) {
    if (key === "core.fsmonitor") continue;
    overrides.push([key, trusted.get(key) ?? (key === "core.sshcommand" ? "ssh" : "")]);
  }
  const already = Number.parseInt(inherited.GIT_CONFIG_COUNT ?? "0", 10);
  const start = Number.isInteger(already) && already > 0 ? already : 0;
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(start + overrides.length) };
  overrides.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${start + i}`] = key;
    env[`GIT_CONFIG_VALUE_${start + i}`] = value;
  });
  return env;
}

/**
 * Put `checkout` back at `before` after a merge this landing started: abort
 * the merge it left, reset what it staged or committed, then check. `true`
 * only when there is no merge in progress, HEAD is `before` and nothing is
 * staged. `reset --merge` refuses rather than lose a change the merge didn't
 * make; the checkout was clean before it.
 */
async function restore(git: Git, checkout: string, before: string): Promise<boolean> {
  const mergeHead = async () => existsSync(await git(checkout, ["rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"]));
  try {
    if (await mergeHead()) await git(checkout, ["merge", "--abort"]).catch(() => undefined);
    if ((await git(checkout, ["rev-parse", "HEAD"])) !== before || (await git(checkout, ["status", "--porcelain", "--untracked-files=no"])) !== "") {
      await git(checkout, ["reset", "--quiet", "--merge", before]);
    }
    return (
      !(await mergeHead()) &&
      (await git(checkout, ["rev-parse", "HEAD"])) === before &&
      (await git(checkout, ["status", "--porcelain", "--untracked-files=no"])) === ""
    );
  } catch {
    return false;
  }
}

/** A merge that failed and whose checkout couldn't be put back: says so, and where it was. */
function notRestored(checkout: string, base: string, from: string, before: string, error: unknown): WorkspaceRefusedError {
  return new WorkspaceRefusedError(
    "merge-failed",
    `Merging "${from}" into "${base}" in ${checkout} ` +
      (error === null ? "didn't commit it" : `failed: ${firstLine(error) ?? "git gave no reason"}`) +
      `, and putting that checkout back at ${before.slice(0, 12)} failed too. ` +
      `Check it for a merge in progress or staged changes (git merge --abort, or git reset --merge ${before.slice(0, 12)}) before trying again. ` +
      `The run's commits are still on "${from}".`,
  );
}

/**
 * The remote a push goes to, and the branch a pull request asks to merge
 * into there: the base branch's pinned upstream, else the pinned `origin`
 * (or the one pinned remote) and the base's own name.
 */
function pushRemote(pins: KeptFetchPins | undefined, resolved: Base): PushRemote | undefined {
  if (resolved.remote !== undefined) {
    const url = pins?.remotes.get(resolved.remote.remoteName);
    return url === undefined ? undefined : { remoteName: resolved.remote.remoteName, url, base: resolved.remote.branch };
  }
  const base = resolved.local!;
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
  place: { base: Base; remote: PushRemote | undefined; repo: string | undefined },
  request: Extract<LandRequest, { kind: "pull-request" }>,
  left: () => number,
): Promise<Landed> {
  const { base, remote, repo } = place;
  if (remote === undefined) {
    throw new WorkspaceRefusedError(
      "no-push-remote",
      `${host.repo} had no single remote to push to when the host started (an "origin", or "${base.named}"'s upstream), ` +
        `so the run's branch "${target.branch}" was not pushed. Its commits are still there.`,
    );
  }
  // gh is always told the repository, from the pinned URL: it never falls back to the live remotes.
  if (repo === undefined) {
    throw new WorkspaceRefusedError(
      "no-pull-request-repo",
      `${redactRemote(remote.url)} names no GitHub repository, so no pull request can be opened there, ` +
        `and the run's branch "${target.branch}" was not pushed. Its commits are still there.`,
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

  // Before anything is pushed, so a base gone with no default to fall back on pushes nothing.
  const objects = join(await git(host.repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "objects");
  const cutAt = target.baseCommit == null ? undefined : { commit: target.baseCommit, objects };
  const into = await baseOnRemote(host, remote, judged, left, cutAt);

  const gh = request.gh ?? "gh";
  // gh runs in an empty directory of its own, never in a checkout whose config the run can write
  // (`url.*.insteadOf`, `pushurl`, a credential helper), and git above it is never looked for.
  // It is always told the head branch, so it never pushes: the push below is the only one.
  const ghDir = scratchDir();
  const ghEnv = { GH_PROMPT_DISABLED: "1", GIT_CEILING_DIRECTORIES: dirname(ghDir) };
  const where = ["--repo", repo];
  try {
    return await pushAndOpen(git, host, target, { ...remote, base: into.base }, into.gone, judged, request, left, { gh, ghDir, ghEnv, where, pass: host.remotePass ?? HOST_REMOTE_PASS, repo });
  } finally {
    try {
      rmSync(ghDir, { recursive: true, force: true });
    } catch {}
  }
}

/** How many open pull requests from one branch name are read: forks and other bases are passed over. */
const OPEN_PULL_REQUESTS_READ = 20;

/**
 * The open pull request from `branch` in the repository itself into `base`,
 * or `undefined`; throws when GitHub can't be asked. `--head` matches the
 * branch's name in any fork, and a branch can be open into several bases, so
 * a pull request from a fork (`isCrossRepository`) or into another base is
 * not this run's. A field gh doesn't give is not held against it.
 */
async function openPullRequestOf(
  gh: { gh: string; ghDir: string; ghEnv: Record<string, string>; where: string[]; pass: readonly string[] },
  branch: string,
  base: string,
  timeoutMs: number,
): Promise<string | undefined> {
  const { stdout } = await run(
    gh.gh,
    [
      "pr", "list", ...gh.where, "--head", branch, "--state", "open",
      "--json", "number,url,baseRefName,isCrossRepository", "--limit", String(OPEN_PULL_REQUESTS_READ),
    ],
    { cwd: gh.ghDir, timeoutMs, env: gh.ghEnv, pass: gh.pass, gitCredentials: true },
  );
  const parsed = JSON.parse(stdout || "[]") as unknown;
  const listed = (Array.isArray(parsed) ? parsed : []) as Array<{ url?: unknown; baseRefName?: unknown; isCrossRepository?: unknown }>;
  const ours = listed.find(
    (pr) => typeof pr?.url === "string" && pr.isCrossRepository !== true && (typeof pr.baseRefName !== "string" || pr.baseRefName === base),
  );
  return ours?.url as string | undefined;
}

async function pushAndOpen(
  git: Git,
  host: LandHost,
  target: LandTarget,
  remote: { remoteName: string; url: string; base: string },
  baseGone: string | undefined,
  judged: AllowedRemote,
  request: Extract<LandRequest, { kind: "pull-request" }>,
  left: () => number,
  gh: { gh: string; ghDir: string; ghEnv: Record<string, string>; where: string[]; pass: readonly string[]; repo: string },
): Promise<Landed> {
  const landedAt = (url: string, existing = false): Landed => {
    const ref = pullRequestRefFromUrl(url)!;
    return {
      kind: "pull-request",
      url,
      number: ref.number,
      branch: target.branch,
      base: remote.base,
      remote: redactRemote(remote.url),
      ...(baseGone !== undefined ? { baseGone } : {}),
      ...(existing ? { existing: true } : {}),
    };
  };
  const failed = (step: string, error: unknown) =>
    new WorkspaceRefusedError(
      "pull-request-failed",
      `"${target.branch}" was pushed to ${redactRemote(remote.url)}, but ${step} failed: ${firstLine(error) ?? "gh gave no reason"}.`,
    );
  // **The work may already be in a pull request**: an earlier try that opened
  // it, or the run itself pushing its branch and opening one. That one is the
  // landing, and no second one is opened. The branch is still pushed, so a
  // commit made since reaches it. A refused push is let go only when the
  // remote's branch already holds the checkout's tip; otherwise the pull
  // request lacks the work, and the refusal stands. A failed ask is no
  // answer: the push and the list after it go on as before.
  // A landing that may only go onto that pull request (`onlyExisting`) stops
  // here when it is gone, or can't be found: it pushes nothing and opens none.
  let already: string | undefined;
  try {
    already = await openPullRequestOf(gh, target.branch, remote.base, left());
  } catch (error) {
    if (request.onlyExisting === true) {
      throw new WorkspaceRefusedError(
        "pull-request-failed",
        `GitHub couldn't be asked for the pull request open from "${target.branch}", so nothing was pushed: ${firstLine(error) ?? "gh gave no reason"}.`,
      );
    }
  }
  if (already !== undefined && pullRequestRefFromUrl(already) !== null) {
    try {
      await push(git, host, target, remote, judged, left);
    } catch (error) {
      if (!(await remoteHolds(git, host, target, judged, left))) throw error;
    }
    return landedAt(already, true);
  }
  if (request.onlyExisting === true) {
    throw new WorkspaceRefusedError(
      "pull-request-gone",
      `No pull request is open from "${target.branch}" into ${remote.base} any more, so nothing was pushed and none was opened. Its commits are still there.`,
    );
  }
  await push(git, host, target, remote, judged, left);

  // `owner:branch` on GitHub's side.
  const head = `${gh.repo.split("/")[1]}:${target.branch}`;
  // A try after one that pushed and opened it, but failed to record it: the open one, not a second.
  let url: string | undefined;
  try {
    url = await openPullRequestOf(gh, target.branch, remote.base, left());
  } catch (error) {
    throw failed("asking GitHub for its open pull request", error);
  }
  if (url === undefined) {
    try {
      const { stdout } = await run(
        gh.gh,
        ["pr", "create", ...gh.where, "--head", head, "--base", remote.base, "--title", request.title, "--body", request.body],
        { cwd: gh.ghDir, timeoutMs: left(), env: gh.ghEnv, pass: gh.pass, gitCredentials: true },
      );
      url = stdout.trim().split("\n").reverse().find((line) => pullRequestRefFromUrl(line.trim()) !== null)?.trim();
    } catch (error) {
      throw failed("opening its pull request", error);
    }
  }
  if (url === undefined || pullRequestRefFromUrl(url) === null) throw failed("opening its pull request", new Error("gh printed no pull request link"));
  return landedAt(url);
}

/** Push the branch's tip to the pinned remote, never forced. */
/** The `-c` settings every remote call runs under: no hooks, no askpass, only the judged protocol, the host's pinned credentials. */
function remoteConfig(host: LandHost, judged: AllowedRemote): string[] {
  return remoteCallConfig(judged.scheme, host.pins?.credentialHelpers ?? []);
}

/**
 * Whether the remote's `target.branch` already holds the checkout's tip: its
 * tip is that commit, or one the checkout knows that descends from it. Any
 * failure to tell answers no.
 */
async function remoteHolds(git: Git, host: LandHost, target: LandTarget, judged: AllowedRemote, left: () => number): Promise<boolean> {
  try {
    const local = await git(target.cwd, ["rev-parse", "--verify", `refs/heads/${target.branch}^{commit}`]);
    const remoteTip = (await lsRemote(host, judged, [`refs/heads/${target.branch}`], left)).trim().split(/\s+/)[0];
    if (!remoteTip) return false;
    if (remoteTip === local) return true;
    await git(target.cwd, ["merge-base", "--is-ancestor", local, remoteTip]);
    return true;
  } catch {
    return false;
  }
}

/**
 * `git ls-remote --symref` of `refs` on the pinned remote, asked from an empty
 * repository of its own, as `push` is: the run's config is never read.
 */
async function lsRemote(host: LandHost, judged: AllowedRemote, refs: string[], left: () => number): Promise<string> {
  let scratch: string | undefined;
  try {
    scratch = scratchDir();
    await run("git", ["init", "--quiet", "--bare", scratch], { cwd: scratch, timeoutMs: left(), env: host.env, pass: HOST_GIT_PASS });
    const { stdout } = await run(
      "git",
      [...remoteConfig(host, judged), "ls-remote", "--symref", "--", judged.url, ...refs],
      { cwd: scratch, timeoutMs: left(), env: { ...host.env, GIT_DIR: scratch, GIT_ALLOW_PROTOCOL: judged.scheme, GIT_SSH_COMMAND: "ssh" }, pass: host.remotePass ?? HOST_REMOTE_PASS, gitCredentials: true },
    );
    return stdout;
  } finally {
    try {
      if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
    } catch {}
  }
}

// FIX-2858.
/**
 * The branch a pull request asks to merge into: the run's base while the
 * remote has it; else, when it is gone (its pull request merged and the
 * branch was deleted), the remote's default branch, with the gone one as
 * `gone`. When the remote can't be asked, the base as named: GitHub says if
 * it is gone.
 *
 * With `cutAt` (the commit the run was cut at, and the person's object
 * store), the default branch is taken only when it holds that commit. A base
 * merged by squash or rebase left its commits off the default branch, so the
 * run's branch would carry them all again into the pull request.
 *
 * @throws WorkspaceRefusedError `base-gone` when the base is gone and the remote names no default branch,
 *   or one that doesn't hold the commit the run was cut at.
 */
async function baseOnRemote(
  host: LandHost,
  remote: PushRemote,
  judged: AllowedRemote,
  left: () => number,
  cutAt?: { readonly commit: string; readonly objects: string },
): Promise<{ base: string; gone?: string }> {
  let listed: string;
  try {
    listed = await lsRemote(host, judged, ["HEAD", `refs/heads/${remote.base}`], left);
  } catch {
    return { base: remote.base };
  }
  const lines = listed.split("\n");
  if (lines.some((line) => line.endsWith(`\trefs/heads/${remote.base}`))) return { base: remote.base };
  const fallback = lines.map((line) => /^ref: refs\/heads\/(.+)\tHEAD$/.exec(line)?.[1]).find((name) => name !== undefined);
  if (fallback === undefined) {
    throw new WorkspaceRefusedError(
      "base-gone",
      `The branch this work was started from, "${remote.base}", is no longer on ${redactRemote(remote.url)} ` +
        `(its pull request was probably merged and the branch deleted), and the remote names no default branch to open the pull request into instead. ` +
        `Nothing was pushed, and the run's commits are still on its branch: merge locally instead.`,
    );
  }
  if (cutAt !== undefined && (await remoteBranchHolds(host, judged, fallback, cutAt, left)) === false) {
    throw new WorkspaceRefusedError(
      "base-gone",
      `The branch this work was started from, "${remote.base}", is no longer on ${redactRemote(remote.url)}, ` +
        `and its commits aren't on "${fallback}" as they were (it was probably squashed or rebased when it merged). ` +
        `A pull request into "${fallback}" would carry all of "${remote.base}"'s changes again, so none was opened and nothing was pushed. ` +
        `The run's commits are still on its branch: ask for changes to move them onto "${fallback}", or merge locally.`,
    );
  }
  return { base: fallback, gone: remote.base };
}

/**
 * Whether the remote's `branch` holds `cutAt.commit`: `undefined` when it
 * can't be told. Fetched into an empty repository of its own over the
 * person's objects, as `push` pushes from, with the commit as its one ref, so
 * only what the person lacks is sent. The objects it adds are a fetch's, and
 * no ref of the person's moves.
 */
async function remoteBranchHolds(
  host: LandHost,
  judged: AllowedRemote,
  branch: string,
  cutAt: { readonly commit: string; readonly objects: string },
  left: () => number,
): Promise<boolean | undefined> {
  let scratch: string | undefined;
  try {
    scratch = scratchDir();
    const env = { ...host.env, GIT_DIR: scratch, GIT_OBJECT_DIRECTORY: cutAt.objects, GIT_ALLOW_PROTOCOL: judged.scheme, GIT_SSH_COMMAND: "ssh" };
    await run("git", ["init", "--quiet", "--bare", scratch], { cwd: scratch, timeoutMs: left(), env: host.env, pass: HOST_GIT_PASS });
    await run("git", [...NO_HOOKS, "update-ref", "refs/cut", cutAt.commit], { cwd: scratch, timeoutMs: left(), env, pass: HOST_GIT_PASS });
    await run(
      "git",
      [...remoteConfig(host, judged), "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "--", judged.url, `+refs/heads/${branch}:refs/default`],
      { cwd: scratch, timeoutMs: left(), env, pass: host.remotePass ?? HOST_REMOTE_PASS, gitCredentials: true },
    );
    return await run("git", [...NO_HOOKS, "merge-base", "--is-ancestor", cutAt.commit, "refs/default"], { cwd: scratch, timeoutMs: left(), env, pass: HOST_GIT_PASS }).then(
      () => true,
      (error: { code?: unknown }) => (error.code === 1 ? false : undefined),
    );
  } catch {
    return undefined;
  } finally {
    try {
      if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
    } catch {}
  }
}

async function push(
  git: Git,
  host: LandHost,
  target: LandTarget,
  remote: { remoteName: string; url: string; base: string },
  judged: AllowedRemote,
  left: () => number,
): Promise<void> {
  const commit = await git(target.cwd, ["rev-parse", "--verify", `refs/heads/${target.branch}^{commit}`]);
  // Pushed from an empty repository of its own over the person's objects: the
  // repository's config, which the run can rewrite, is never read.
  let scratch: string | undefined;
  try {
    scratch = scratchDir();
    const objects = join(await git(host.repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "objects");
    const isolated = { ...host.env, GIT_DIR: scratch, GIT_OBJECT_DIRECTORY: objects };
    await run("git", ["init", "--quiet", "--bare", scratch], { cwd: scratch, timeoutMs: left(), env: host.env, pass: HOST_GIT_PASS });
    await run(
      "git",
      [
        ...remoteConfig(host, judged),
        "push",
        "--receive-pack=git-receive-pack",
        "--quiet",
        "--no-verify",
        "--",
        judged.url,
        `${commit}:refs/heads/${target.branch}`,
      ],
      { cwd: scratch, timeoutMs: left(), env: { ...isolated, GIT_ALLOW_PROTOCOL: judged.scheme, GIT_SSH_COMMAND: "ssh" }, pass: host.remotePass ?? HOST_REMOTE_PASS, gitCredentials: true },
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
}
