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
import { pullRequestRefFromUrl } from "@flow-state-dev/core/harness";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { run } from "./exec";
import { scratchDir } from "./held-work";
import { WorkspaceRefusedError } from "./refused";
import { checkRemoteShape, redactRemote, withoutCredential } from "./remotes";
import type { KeptFetchPins } from "./repository";
import { firstLine, NO_HOOKS } from "./worktree";

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
    (await run("git", [...NO_HOOKS, "-c", "core.fsmonitor=false", ...args], { cwd, timeoutMs: RESTORE_TIMEOUT_MS, env: host.env })).stdout.trim();
  try {
    const base = await resolveBase(git, host.repo, host.pins, target.baseRef);
    const remote = pushRemote(host.pins, base);
    const repo = remote === undefined ? undefined : (host.pullRequestRepo ?? repoOf)(remote.url);
    return repo === undefined ? ["merge"] : ["pull-request", "merge"];
  } catch {
    return [];
  }
}

/**
 * Land a run's branch, by `request.kind`.
 *
 * @throws WorkspaceRefusedError `base-unknown`, `no-push-remote`, `no-pull-request-repo`,
 *   `remote-repointed`, `push-failed`, `pull-request-failed`,
 *   `base-not-checked-out`, `checkout-dirty`, `checkout-busy`, `merge-conflict` or
 *   `merge-failed`, each saying what happened.
 */
export async function landRun(host: LandHost, target: LandTarget, request: LandRequest): Promise<Landed> {
  const deadline = Date.now() + (request.timeoutMs ?? LAND_TIMEOUT_MS);
  const left = () => Math.max(1, deadline - Date.now());
  const git = async (cwd: string, args: string[], env: Record<string, string> = {}) =>
    (await run("git", [...NO_HOOKS, ...args], { cwd, timeoutMs: left(), env: { ...host.env, ...env } })).stdout.trim();
  const restoreGit = async (cwd: string, args: string[], env: Record<string, string> = {}) =>
    (await run("git", [...NO_HOOKS, ...args], { cwd, timeoutMs: RESTORE_TIMEOUT_MS, env: { ...host.env, ...env } })).stdout.trim();
  const base = await resolveBase(git, host.repo, host.pins, target.baseRef);
  return request.kind === "merge"
    ? await merge(git, restoreGit, host.repo, base, target.branch, { ...process.env, ...host.env })
    : await openPullRequest(git, host, target, base, request, left);
}

type Git = (cwd: string, args: string[], env?: Record<string, string>) => Promise<string>;

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
function pushRemote(pins: KeptFetchPins | undefined, resolved: Base): { remoteName: string; url: string; base: string } | undefined {
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
  base: Base,
  request: Extract<LandRequest, { kind: "pull-request" }>,
  left: () => number,
): Promise<Landed> {
  const remote = pushRemote(host.pins, base);
  if (remote === undefined) {
    throw new WorkspaceRefusedError(
      "no-push-remote",
      `${host.repo} had no single remote to push to when the host started (an "origin", or "${base.named}"'s upstream), ` +
        `so the run's branch "${target.branch}" was not pushed. Its commits are still there.`,
    );
  }
  // gh is always told the repository, from the pinned URL: it never falls back to the live remotes.
  const repo = (host.pullRequestRepo ?? repoOf)(remote.url);
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
  // gh runs in an empty directory of its own, never in a checkout whose config the run can write
  // (`url.*.insteadOf`, `pushurl`, a credential helper), and git above it is never looked for.
  // It is always told the head branch, so it never pushes: the push above is the only one.
  const ghDir = scratchDir();
  const ghEnv = { GH_PROMPT_DISABLED: "1", GIT_CEILING_DIRECTORIES: dirname(ghDir) };
  const where = ["--repo", repo];
  // `owner:branch` on GitHub's side.
  const head = `${repo.split("/")[1]}:${target.branch}`;
  const failed = (step: string, error: unknown) =>
    new WorkspaceRefusedError(
      "pull-request-failed",
      `"${target.branch}" was pushed to ${redactRemote(remote.url)}, but ${step} failed: ${firstLine(error) ?? "gh gave no reason"}.`,
    );
  try {
    // A try after one that pushed and opened it, but failed to record it: the open one, not a second.
    let open: Array<{ url?: unknown; number?: unknown }> = [];
    try {
      const { stdout } = await run(
        gh,
        ["pr", "list", ...where, "--head", target.branch, "--state", "open", "--json", "number,url", "--limit", "1"],
        { cwd: ghDir, timeoutMs: left(), env: ghEnv },
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
          ["pr", "create", ...where, "--head", head, "--base", remote.base, "--title", request.title, "--body", request.body],
          { cwd: ghDir, timeoutMs: left(), env: ghEnv },
        );
        url = stdout.trim().split("\n").reverse().find((line) => pullRequestRefFromUrl(line.trim()) !== null)?.trim();
      } catch (error) {
        throw failed("opening its pull request", error);
      }
    }
    const ref = url === undefined ? null : pullRequestRefFromUrl(url);
    if (url === undefined || ref === null) throw failed("opening its pull request", new Error("gh printed no pull request link"));
    return { kind: "pull-request", url, number: ref.number, branch: target.branch, base: remote.base, remote: redactRemote(remote.url) };
  } finally {
    try {
      rmSync(ghDir, { recursive: true, force: true });
    } catch {}
  }
}
