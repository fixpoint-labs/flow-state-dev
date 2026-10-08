/**
 * Cutting a run's branch into a git worktree, and handing it back on the next
 * attempt — the git half of a workspace host.
 *
 * Moved here from harness-manager's checkout module, so every worker reaches
 * git through the host instead of through a copy of its own. Its rules did not
 * change on the way:
 *
 * 1. **Idempotent per checkout, on its own branch.** Called twice it returns
 *    the same directory, and the second call leaves uncommitted work exactly
 *    where it was. Nothing here resets, forces, cleans, or fetches an existing
 *    branch.
 * 2. **One deadline for the whole operation.** Every git command draws from
 *    one budget, because a caller that holds a lock across provisioning sizes
 *    its stale window from that number; a per-command timeout of N would let a
 *    three-command provision hold the lock for 3N.
 * 3. **Contents this cannot explain are kept, and the refusal says so.** The
 *    only trees it ever clears are a provision it can positively identify as
 *    interrupted (a marker beside the tree, AND a tree that agrees), and the
 *    one it just made and is refusing.
 *
 * The repository worktrees are cut from is the caller's: a repository on this
 * machine the operator named, or the host's own clone of an allowed remote.
 * Nothing here knows which.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { CHECKOUT_CLEANUP_TIMEOUT_MS, run } from "./exec";
import { identityFromCommonDir } from "./repository";

/**
 * A directory inside the checkout that git must never commit — somewhere the
 * caller writes files of its own, such as a question a run asks.
 *
 * Provisioning refuses a checkout whose repository tracks a guarded file there
 * or does not ignore the directory, before any worker runs. Refused rather than
 * fixed: the rule belongs in the repository's own `.gitignore`, which is the
 * operator's file.
 */
export interface IgnoredDirectory {
  /** The directory, relative to the checkout, `/`-separated. */
  dir: string;
  /** The `.gitignore` line that satisfies the check, named in the refusal. */
  rule: string;
  /**
   * Which tracked paths under `dir` (as `git ls-files` prints them) are the
   * caller's files. A tracked sibling the caller never writes is harmless.
   * Omitted: every tracked path under `dir`.
   */
  guards?: (gitPath: string) => boolean;
  /** One sentence saying what the caller writes there, for the refusal. */
  why: string;
}

/** One worktree to provision. */
export interface WorktreeRequest {
  /** The repository worktrees are cut from, and where branches live. */
  repo: string;
  /** How a refusal names that repository to a person. */
  repoLabel: string;
  /** The checkout's directory. */
  checkout: string;
  /** Present while `git worktree add` runs; beside the checkout, never inside it. */
  marker: string;
  /** The directory every tree this clears must be strictly inside. */
  root: string;
  /** The run's own branch. */
  branch: string;
  /** Git's environment, laid over the process's own. */
  env?: Record<string, string>;
  /** When the whole provision must be finished by, on `now`'s clock. */
  deadline: number;
  now: () => number;
  /** Called once a checkout is to be made (not on a hand-back), before anything touches `repo`. */
  prepare?: (left: () => number) => Promise<void>;
  /** What a NEW branch is cut from. Called only when the branch does not exist yet. */
  base: (left: () => number) => Promise<{ ref: string; commitish: string; commit?: string }>;
  ignored?: IgnoredDirectory;
}

/** What `provisionWorktree` made or found. */
export interface Worktree {
  /** Whether this call cut the branch. */
  created: boolean;
  /** The ref a new branch was cut from. Only when `created`. */
  baseRef?: string;
  /** The commit it was cut at, when the caller's `base` knew it. */
  baseCommit?: string;
}

/**
 * The remaining time in one provision, as a per-call timeout.
 *
 * **Zero is not "no budget left" to `execFile` — it is "no timeout at all".**
 * So an exhausted deadline throws here rather than being passed down, or the
 * case the bound exists for would remove it instead of enforcing it.
 */
export function remainingBudget(deadline: number, now: () => number): number {
  const left = deadline - now();
  if (left <= 0) {
    throw new Error(
      "provisioning exceeded its budget (provisionTimeoutMs) before it finished. A caller " +
        "that holds a lock across provisioning sizes its stale window from that budget, so " +
        "a longer provision would risk being declared stale while it is still working.",
    );
  }
  return left;
}

/**
 * Did git answer **no**, or did the probe itself fail?
 *
 * A ref probe (`show-ref --verify --quiet`) and an ignore probe (`check-ignore
 * -q`) both exit 1, unkilled, for "no". Every other failure looks different: a
 * timeout comes back `killed: true`, a repository git cannot read exits 128,
 * and a git that cannot be spawned carries a string `code`. Read as "no", a
 * failed probe reports a branch deleted that was not, or cuts a branch that
 * exists.
 */
export function gitAnsweredNo(err: unknown): boolean {
  const { code, killed } = (err ?? {}) as { code?: unknown; killed?: unknown };
  return killed !== true && code === 1;
}

/**
 * Is every change in this tree a deletion? Porcelain status codes are two
 * columns; a tree whose every entry draws from `{" ", "D"}` has had files
 * removed and nothing added, edited, renamed or staged.
 */
export function everyChangeIsADeletion(porcelain: string): boolean {
  for (const line of porcelain.split("\n")) {
    if (line.length === 0) continue;
    if (line[0] !== " " && line[0] !== "D") return false;
    if (line[1] !== " " && line[1] !== "D") return false;
  }
  return true;
}

/**
 * Is `candidate` a **strict descendant** of `root`? Compared by path segments,
 * so a Windows separator and a root of `/` both work, and the root itself is
 * not inside itself — a clear aimed at the root would take every checkout.
 */
export function isStrictlyInside(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Give a run its checkout on its own branch, or hand back the one the last
 * attempt left.
 *
 * A checkout whose branch was deleted, that is on another branch, or that is a
 * worktree of another repository is refused, never reset: it may hold work.
 */
export async function provisionWorktree(request: WorktreeRequest): Promise<Worktree> {
  const { repo, repoLabel, checkout, marker, branch, now } = request;
  const left = () => remainingBudget(request.deadline, now);
  const git = async (cwd: string, args: string[], timeoutMs: number): Promise<string> => {
    const { stdout } = await run("git", args, {
      cwd,
      timeoutMs,
      ...(request.env !== undefined ? { env: request.env } : {}),
    });
    return stdout.trim();
  };

  // **A marked tree is reused, cleared, or refused, and the marker alone does
  // not decide which.** `.git` is not the witness that a provision finished: a
  // `worktree add` killed part-way leaves `.git`, the branch and a registered
  // worktree with tracked files missing, and a run handed that tree commits
  // every missing file as a deletion. The marker is not a witness either: it
  // sits where anything with a shell, the coding agent included, can create
  // it. So it is acted on only when the tree independently agrees.
  const marked = existsSync(marker);
  const interrupted = marked && (await looksHalfBuilt(checkout, left, git));

  if (marked && !interrupted && existsSync(join(checkout, ".git"))) {
    throw new Error(
      `${marker} says a provision was interrupted, but the checkout at ${checkout} is not a ` +
        `half-built one: it holds more than missing tracked files. One of the two is wrong, ` +
        `and this will not guess. The marker can be created by anything with write access ` +
        `beside the checkout, and the tree may hold real work. Inspect it, then delete the ` +
        `marker to reuse the checkout or delete the checkout to have it rebuilt.`,
    );
  }

  if (!interrupted && existsSync(join(checkout, ".git"))) {
    return await handBack();
  }

  // **A directory with no `.git` is a creation that never finished — but only
  // the marker says so.** A run can remove `.git` from its own tree too, and
  // then the tree holds real uncommitted work. Unmarked, this is something
  // nobody here made, and it is kept.
  if (existsSync(checkout)) {
    if (!interrupted) {
      throw new Error(
        `the checkout at ${checkout} has no \`.git\` and no record of an interrupted ` +
          `provision, so it is not a half-created checkout and this will not clear it — it ` +
          `may hold work. Inspect it and remove it by hand if it is junk.`,
      );
    }
    if (!isStrictlyInside(checkout, request.root)) {
      throw new Error(
        `refusing to clear ${checkout}: it is not inside ${request.root}. A half-created ` +
          `checkout is only ever removed from the directory the host owns.`,
      );
    }
    rmSync(checkout, { recursive: true, force: true });
  }

  await request.prepare?.(left);
  // A worktree whose directory was removed leaves an administrative entry
  // behind, and `worktree add` then refuses the path by name. Pruning touches
  // bookkeeping, never a tree.
  await git(repo, ["worktree", "prune"], left());

  const branchPreexisted = await branchExists();
  let base: { ref: string; commitish: string; commit?: string } | undefined;
  if (!branchPreexisted) base = await request.base(left);
  const args = base === undefined ? ["worktree", "add", "--quiet", checkout, branch] : ["worktree", "add", "--quiet", "-b", branch, checkout, base.commitish];

  // Up before the call that creates the tree and down only once it returns,
  // so it covers exactly the window in which a kill leaves a partial tree. A
  // failed `add` leaves it: the next provision is the one entitled to clear.
  mkdirSync(dirname(checkout), { recursive: true });
  writeFileSync(marker, "");
  await git(repo, args, left());
  rmSync(marker, { force: true });

  // **A refusal here undoes what this call just made**, the one place clearing
  // a tree with `.git` is legitimate: no worker has run in it yet. Left
  // behind, the next provision reuses a branch cut before the operator's fix
  // and refuses identically forever.
  if (request.ignored !== undefined) {
    try {
      await assertIgnored(
        request.ignored,
        branchPreexisted ? { checkoutStillAttached: false } : undefined,
      );
    } catch (refusal) {
      const removed = await discardFresh(branchPreexisted);
      if (removed) throw refusal;
      throw new Error(
        `${(refusal as Error).message}\n\nAnd the checkout this call created could not be ` +
          `removed, so ${checkout}${branchPreexisted ? "" : ` and branch "${branch}"`} are ` +
          `still there. Fixing the repository will not be enough on its own — delete them by ` +
          `hand, or the next attempt reuses a tree cut before the fix and fails the same way.`,
      );
    }
  }

  return base === undefined
    ? { created: true }
    : { created: true, baseRef: base.ref, ...(base.commit !== undefined ? { baseCommit: base.commit } : {}) };

  /** The checkout the last attempt left, checked and returned as it is. */
  async function handBack(): Promise<Worktree> {
    // **The checkout has to belong to the repository this request names.** A
    // place outlives a change to its repository, and a branch name says nothing
    // about which repository it lives in. Asked first only when both answers
    // exist and disagree; when the repository cannot be read at all, the branch
    // probe below says so with the real cause.
    const [mine, theirs] = await Promise.all([gitIdentity(checkout, left()), gitIdentity(repo, left())]);
    const notOurs = (): Error =>
      new Error(
        `the checkout at ${checkout} does not belong to ${repoLabel}: it is not a worktree ` +
          `of ${repoLabel}. Refusing to reuse it: the branch name matches, but a run given ` +
          `this tree would commit to another repository. It may hold uncommitted work, so ` +
          `nothing here removes it — move or delete it by hand.`,
      );
    if (!existsSync(repo) || (mine !== undefined && theirs !== undefined && mine !== theirs)) throw notOurs();

    if (!(await branchExists())) {
      throw new Error(
        `the checkout at ${checkout} is on branch "${branch}", which no longer exists in ` +
          `${repoLabel}. Refusing to recreate it: the tree may hold uncommitted work, and a ` +
          `fresh branch off the base would diverge from whatever the deleted one pointed at.`,
      );
    }

    // The branch existing is not the branch being checked out. A tree switched
    // by hand or by a run would commit somewhere the record does not say.
    const head = await git(checkout, ["rev-parse", "--abbrev-ref", "HEAD"], left());
    const on = head === "HEAD" ? null : head;
    if (on !== branch) {
      throw new Error(
        `the checkout at ${checkout} is on branch "${on}", not the expected "${branch}". ` +
          `Refusing to use it: a run told it is on "${branch}" would commit to "${on}". ` +
          `Restore the branch or remove the checkout by hand — nothing here resets a tree.`,
      );
    }
    if (mine === undefined || theirs === undefined) throw notOurs();

    // Re-checked on reuse: a run that deleted the rule leaves a checkout that
    // provisioned legally and is no longer safe to write into.
    if (request.ignored !== undefined) await assertIgnored(request.ignored, { checkoutStillAttached: true });
    return { created: false };
  }

  /** `true` when the repository holds the branch; a probe that failed is raised, never read as no. */
  async function branchExists(): Promise<boolean> {
    try {
      await git(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], left());
      return true;
    } catch (err) {
      if (gitAnsweredNo(err)) return false;
      if ((err as Error).message?.startsWith("provisioning exceeded its budget")) throw err;
      const detail = firstLine(err);
      throw new Error(
        `could not determine whether branch "${branch}" exists in ${repoLabel}: the probe ` +
          `failed for a reason other than the ref being absent${detail ? ` (${detail})` : ""}. ` +
          `Not reporting that as a deleted branch.`,
        { cause: err },
      );
    }
  }

  /**
   * Refuse a checkout whose repository would commit the caller's files.
   *
   * Tracked first, and it is a different failure: an ignore rule does not
   * un-track a file. Then the DIRECTORY, not a file in it, because git does
   * not descend into an excluded directory, so no rule naming single files can
   * satisfy it partway. `--no-index`, so a tracked path does not read as
   * "not ignored" for a rule that is there.
   */
  async function assertIgnored(
    ignored: IgnoredDirectory,
    preserved: { checkoutStillAttached: boolean } | undefined,
  ): Promise<void> {
    const problem = await ignoredProblem(checkout, ignored, (args) => git(checkout, args, left()));
    if (problem !== undefined) throw new Error(problem + staleBranchRemedy(preserved));
  }

  /**
   * The rest of an ignore refusal's remedy, when the tree is on a branch that
   * outlives the refusal. That branch was cut before the operator's fix, so
   * fixing the repository alone leaves it refusing the same way. Git refuses
   * `branch -D` while a worktree has the branch checked out, so a reused tree
   * has to go first.
   */
  function staleBranchRemedy(preserved: { checkoutStillAttached: boolean } | undefined): string {
    if (preserved === undefined) return "";
    const deletion = preserved.checkoutStillAttached
      ? `remove the checkout at ${checkout} first and then delete "${branch}" (git refuses to ` +
        `delete a branch a worktree still has checked out), so the next attempt cuts a new one`
      : `delete "${branch}" so the next attempt cuts a new one`;
    return (
      ` This checkout is on branch "${branch}", which nothing here removes — it may carry ` +
      `work. That branch was cut before the fix, so fixing the repository alone leaves it ` +
      `unchanged and the next attempt reattaches it and refuses the same way: bring ` +
      `"${branch}" up to date, or ${deletion}.`
    );
  }

  /**
   * Undo the checkout this call just made, so its refusal is recoverable. The
   * branch goes only when this call created it; one `worktree add` attached
   * belongs to whoever made it.
   *
   * **Its own budget**, because the refusal it follows may be the provision's
   * budget running out. The marker goes back on before the delete (which node
   * cannot bound) and comes off after, so a delete cut short leaves a tree the
   * next provision identifies and clears. Reports whether it finished.
   */
  async function discardFresh(preexisted: boolean): Promise<boolean> {
    const deadline = now() + CHECKOUT_CLEANUP_TIMEOUT_MS;
    const cleanupLeft = () => remainingBudget(deadline, now);
    try {
      if (!isStrictlyInside(checkout, request.root)) return false;
      writeFileSync(marker, "");
      rmSync(checkout, { recursive: true, force: true });
      rmSync(marker, { force: true });
      await git(repo, ["worktree", "prune"], cleanupLeft());
      if (!preexisted) await git(repo, ["branch", "-D", branch], cleanupLeft());
      return true;
    } catch {
      return false;
    }
  }

  /** The repository a directory belongs to, through the budgeted git; `undefined` when not in one. */
  async function gitIdentity(dir: string, timeoutMs: number): Promise<string | undefined> {
    if (!existsSync(dir)) return undefined;
    try {
      return identityFromCommonDir(dir, await git(dir, ["rev-parse", "--git-common-dir"], timeoutMs));
    } catch {
      return undefined;
    }
  }
}

/**
 * Why `checkout`'s repository would commit the caller's files under
 * `ignored.dir`, or `undefined` when it would not.
 *
 * Tracked first, and it is a different failure: an ignore rule does not
 * un-track a file. Then the DIRECTORY, not a file in it, because git does not
 * descend into an excluded directory, so no rule naming single files can
 * satisfy it partway. `--no-index`, so a tracked path does not read as "not
 * ignored" for a rule that is there.
 */
export async function ignoredProblem(
  checkout: string,
  ignored: IgnoredDirectory,
  git: (args: string[]) => Promise<string>,
): Promise<string | undefined> {
  const guards = ignored.guards ?? (() => true);
  const tracked = (await git(["ls-files", "--", ignored.dir]))
    .split("\n")
    .filter((line) => line !== "" && guards(line));
  if (tracked.length > 0) {
    return (
      `the repository behind ${checkout} already tracks files under ${ignored.dir}: ` +
      `${tracked.join(", ")}. ${ignored.why} An ignore rule does not un-track a file, so ` +
      `a commit of everything would still pick them up. Remove those files from that ` +
      `repository first.`
    );
  }
  try {
    await git(["check-ignore", "-q", "--no-index", ignored.dir]);
    return undefined;
  } catch (error) {
    if (!gitAnsweredNo(error)) throw error;
  }
  return (
    `the repository behind ${checkout} does not ignore the directory "${ignored.dir}". ` +
    `${ignored.why} Nothing here can stop a commit of everything from staging a file git ` +
    `does not ignore. The DIRECTORY is what is checked, because a rule naming one file ` +
    `leaves the next one unprotected. Add \`${ignored.rule}\` to that repository's ` +
    `.gitignore.`
  );
}

/**
 * Does this checkout look like a `git worktree add` killed part-way, with
 * nothing worked in it since? No `.git` at all, or tracked files missing and
 * NOTHING else changed. A missing file alone is not enough: a run that deletes
 * a file reads the same. A tree git cannot answer about does not look
 * half-built: unknown never authorises a delete. Each command draws its own
 * share of the one budget, and an exhausted budget is raised, not read as no.
 */
async function looksHalfBuilt(
  checkout: string,
  left: () => number,
  git: (cwd: string, args: string[], timeoutMs: number) => Promise<string>,
): Promise<boolean> {
  if (!existsSync(join(checkout, ".git"))) return true;
  const forListing = left();
  let missing: string;
  try {
    missing = await git(checkout, ["ls-files", "--deleted"], forListing);
  } catch {
    return false;
  }
  if (missing.length === 0) return false;
  const forStatus = left();
  try {
    return everyChangeIsADeletion(await git(checkout, ["status", "--porcelain", "--untracked-files=all"], forStatus));
  } catch {
    return false;
  }
}

function firstLine(error: unknown): string | undefined {
  return String((error as { stderr?: unknown })?.stderr || (error as Error)?.message || error)
    .split("\n")
    .find((line) => line.trim() !== "")
    ?.trim();
}
