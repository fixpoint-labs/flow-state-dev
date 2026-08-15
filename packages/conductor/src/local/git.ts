/**
 * The git reads the local source answers its questions with.
 *
 * Every function here maps one world fact onto one real git command. That is
 * the whole design intent: a local observation is not a simulation of GitHub, it
 * is a set of questions git can already answer about a checkout that actually
 * exists. A branch's head is `rev-parse`. Whether it merged is ancestry.
 * Whether it *can* merge is a real trial merge. Nothing is declared, recorded,
 * or scripted.
 *
 * Runs through the same injected {@link GitRunner} the dispatch layer
 * provisions workspaces with, so there is one place git is spawned and one
 * place a host can route it somewhere else.
 */

import type { GitRunner } from "../dispatch/branch";

/** A git question that could not be asked, as opposed to one answered "no". */
export class LocalGitError extends Error {
  constructor(
    message: string,
    readonly argv: readonly string[],
    readonly stderr: string,
  ) {
    super(message);
    this.name = "LocalGitError";
  }
}

/** Run git, requiring success. Anything non-zero is a failed question. */
async function must(
  git: GitRunner,
  repoRoot: string,
  argv: readonly string[],
): Promise<string> {
  const result = await git(argv, repoRoot);
  if (result.code !== 0) {
    throw new LocalGitError(
      `git ${argv.join(" ")} failed in ${repoRoot} (exit ${result.code}).`,
      argv,
      result.stderr,
    );
  }
  return result.stdout.trim();
}

/**
 * The exit code `git rev-parse --verify` uses for "the repository answered, and
 * it has no such revision".
 *
 * Verified against git 2.43: a missing ref exits **1**, while a directory that
 * is not a checkout — or a revision spec git cannot parse — exits **128**.
 *
 * **Only this code means absence,** the same rule the branch layer's
 * `LS_REMOTE_NO_MATCHING_REFS` holds one layer up. Everything else means
 * the question was never asked, and reading it as absence does not merely lose
 * information, it asserts a different true fact: `resolveState` finds no head
 * for a live branch, reports the submission closed, and reconciliation
 * synthesizes `pr_closed` and escalates it. A transient git problem would
 * become a durable, wrong transition in the ledger.
 */
const REV_PARSE_NO_SUCH_REF = 1;

/**
 * The commit a ref points at, or `null` when the ref does not exist.
 *
 * Absence is an answer here rather than a failure: a branch that has been
 * deleted is exactly how a local submission gets closed, and `rev-parse` exits
 * {@link REV_PARSE_NO_SUCH_REF} for it. Any *other* non-zero exit is a question
 * that could not be asked and raises.
 *
 * @throws {LocalGitError} when the repository could not be queried.
 */
export async function headSha(
  git: GitRunner,
  repoRoot: string,
  ref: string,
): Promise<string | null> {
  const argv = ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`];
  const result = await git(argv, repoRoot);
  if (result.code === REV_PARSE_NO_SUCH_REF) return null;
  if (result.code !== 0) {
    throw new LocalGitError(
      `git ${argv.join(" ")} failed in ${repoRoot} (exit ${result.code}), so conductor ` +
        `cannot tell whether ${ref} exists. Refusing to answer: reading this as a missing ` +
        `ref would close a submission that is still open.`,
      argv,
      result.stderr,
    );
  }
  return result.stdout.trim() || null;
}

/**
 * True when `ancestor` is reachable from `descendant` — which is what "this
 * branch has been merged" *means*, rather than a flag somebody set.
 *
 * `--is-ancestor` exits 0 for yes and 1 for no; anything else is a real failure
 * (a bad revision, a broken repository) and must not be read as "no". Reading a
 * failed probe as "not merged" would leave a merged submission open forever.
 */
export async function isAncestor(
  git: GitRunner,
  repoRoot: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  const argv = ["merge-base", "--is-ancestor", ancestor, descendant];
  const result = await git(argv, repoRoot);
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  throw new LocalGitError(
    `git ${argv.join(" ")} failed in ${repoRoot} (exit ${result.code}), so conductor ` +
      `cannot tell whether ${ancestor} has merged into ${descendant}.`,
    argv,
    result.stderr,
  );
}

/**
 * Whether `head` merges into `base` cleanly, by performing the merge for real
 * and throwing the result away.
 *
 * `merge-tree --write-tree` computes the merge in the object database without
 * touching the working tree, exiting 0 for a clean merge and 1 for a conflicted
 * one. This is the local answer to GitHub's `mergeable`, and it is a stronger
 * one — GitHub's is a cached background computation that reports `null` until it
 * has run, while this is the merge itself.
 *
 * **Exit 1 does not mean "conflicted".** `git-merge-tree(1)` documents 1 as the
 * conflict code and "something other than 0 or 1" as an error, but a revision it
 * cannot resolve exits 1 too (verified against git 2.43). Reading that as a
 * conflict is the same failure the branch layer's `LS_REMOTE_NO_MATCHING_REFS`
 * guards against, one step downstream: it would report a perfectly mergeable
 * submission as conflicting and dispatch an agent to resolve nothing. What
 * separates the two is the output — a real conflict writes the merged tree's oid
 * first, and a failed merge writes nothing at all.
 *
 * @returns `true` clean, `false` conflicted. Never `null`: unlike GitHub's, this
 *   answer is always available, because computing it is the same work as asking.
 * @throws {LocalGitError} when the merge could not be attempted.
 */
export async function mergesCleanly(
  git: GitRunner,
  repoRoot: string,
  base: string,
  head: string,
): Promise<boolean> {
  const argv = ["merge-tree", "--write-tree", base, head];
  const result = await git(argv, repoRoot);
  if (result.code === 0) return true;
  if (result.code === 1 && /^[0-9a-f]{40}\b/.test(result.stdout.trimStart())) return false;
  throw new LocalGitError(
    `git ${argv.join(" ")} failed in ${repoRoot} (exit ${result.code}), so conductor ` +
      `cannot tell whether ${head} merges into ${base}. Refusing to answer: reading this ` +
      `as a conflict would dispatch an agent to resolve one that does not exist.`,
    argv,
    result.stderr,
  );
}

/**
 * The newest commit on `ref` that already existed at `at` — the head a review
 * written at that moment was written against.
 *
 * This is what lets a local review file omit the SHA it reviewed and still be
 * held to the staleness rule every approval gate depends on. The reviewer's file
 * carries a real modification time; git carries real commit times; the head at
 * that instant is the intersection of the two. Push a commit after approving and
 * the approval keeps pointing at the older head, which is precisely how
 * `hasFreshHumanApproval` decides it no longer stands.
 *
 * @returns The commit, or `null` when the ref had no commit that early.
 */
export async function headShaAt(
  git: GitRunner,
  repoRoot: string,
  ref: string,
  at: string,
): Promise<string | null> {
  const sha = await must(git, repoRoot, ["rev-list", "-1", `--before=${at}`, ref]);
  return sha || null;
}

/**
 * The blob hash of a file's current content, which is the same identity GitHub's
 * contents API reports — so a guidance hash means the same thing on both sources
 * and a change detected by one would be detected by the other.
 *
 * @returns The hash, or `null` when the file does not exist.
 */
export async function blobHash(
  git: GitRunner,
  repoRoot: string,
  path: string,
): Promise<string | null> {
  const result = await git(["hash-object", "--", path], repoRoot);
  const hash = result.stdout.trim();
  return result.code === 0 && hash ? hash : null;
}
