/**
 * World materialization from a local checkout.
 *
 * The GitHub reader asks an API what is true. This one asks git and the file
 * system, and the mapping is close to one-to-one because the questions a gate
 * needs answered were never really GitHub questions:
 *
 * | World fact | GitHub | Local |
 * |---|---|---|
 * | `headSha` | the PR's head | `git rev-parse <branch>` |
 * | `state: merged` | the merge flag | `git merge-base --is-ancestor <branch> <base>` |
 * | `state: closed` | the PR's state | the branch ref is gone and never landed |
 * | `mergeable` | a cached background computation | `git merge-tree --write-tree`, the merge itself |
 * | `checks` | check runs on the head | what a real check run recorded for that commit |
 * | `baseRed` | check runs on the base ref | the same, asked of the base's head |
 * | `reviews` | submitted reviews | verdict files a human wrote (see `./store`) |
 * | `guidanceHashes` | the contents API's blob sha | `git hash-object`, the same blob sha |
 *
 * **Nothing here is a stand-in.** Every row above is a real read of real state,
 * which is the whole difference between this and the replay harness in
 * `../testing`: that one is handed the answers, and this one goes and finds
 * them. An empty review inbox means nobody has reviewed the work — a true fact,
 * not a stub.
 *
 * Like the GitHub reader, what gets read is driven by the facts each gate
 * declares (`factsReadBy`), so a phase's I/O is a consequence of its own table
 * entry. Bounded over-fetch is fine; unbounded I/O inside a predicate is not,
 * and no function here is called from a gate.
 */

import { factsReadBy, type WorldFact } from "../model/phases";
import {
  DEFAULT_POLICY,
  type PullRequestFacts,
  type ReviewFacts,
  type World,
} from "../model/world";
import type { ObservationRequest } from "../observe/types";
import type { GitRunner } from "../dispatch/branch";
import { blobHash, headSha, headShaAt, isAncestor, mergesCleanly } from "./git";
import { readCheck, readReviews, readSubmission, type LocalSubmission } from "./store";

/** What the local source needs to know before it can read anything. */
export interface LocalSourceOptions {
  /** Absolute path to the checkout under management. */
  readonly repoRoot: string;
  /** The branch submissions are proposed against, when the record does not name one. */
  readonly baseBranch: string;
  /** How to run git. Injected so a host can route it, and so tests can watch it. */
  readonly git: GitRunner;
}

/** The snapshot, plus the facts this read covered. */
export interface LocalWorldResult {
  readonly world: World;
  readonly facts: readonly WorldFact[];
}

/** Which reads a set of world facts implies for a submission. */
function readPlan(facts: ReadonlySet<WorldFact>) {
  return {
    reviews: facts.has("artifact.reviews"),
    checks: facts.has("pr.checkRuns"),
    baseStatus: facts.has("pr.baseStatus"),
  };
}

/** A check record's conclusion, or `null` when nothing has run against the commit. */
async function checkConclusion(
  repoRoot: string,
  sha: string,
): Promise<PullRequestFacts["checks"]> {
  if (!sha) return null;
  const record = await readCheck(repoRoot, sha);
  return record?.conclusion ?? null;
}

/**
 * Where a submission stands, from git alone.
 *
 * The order matters. Merged is checked before open because a merged branch is
 * usually still *there* locally — `git merge` does not delete anything — so
 * "the ref exists" cannot mean "still open". And a ref that has gone missing is
 * only closed if its last known head never landed: deleting a branch after
 * merging it is the ordinary way a local merge finishes, and reading that as
 * "closed without merging" would escalate every successful merge to a human.
 *
 * @param lastKnownHead The head the previous observation recorded, used when the
 *   ref is gone. `undefined` when this submission has never been observed.
 */
async function resolveState(
  options: LocalSourceOptions,
  branch: string,
  base: string,
  lastKnownHead: string | undefined,
): Promise<{ state: PullRequestFacts["state"]; head: string }> {
  const { git, repoRoot } = options;

  const head = await headSha(git, repoRoot, branch);
  if (head) {
    const merged = await isAncestor(git, repoRoot, head, base);
    return { state: merged ? "merged" : "open", head };
  }

  // The branch is gone. Its last observed head still answers whether the work
  // landed — provided the commit itself is still reachable in this checkout.
  if (lastKnownHead && (await headSha(git, repoRoot, lastKnownHead))) {
    const merged = await isAncestor(git, repoRoot, lastKnownHead, base);
    return { state: merged ? "merged" : "closed", head: lastKnownHead };
  }

  return { state: "closed", head: lastKnownHead ?? "" };
}

/**
 * Read one submission into the same `PullRequestFacts` the GitHub reader
 * produces.
 *
 * Producing the *same* shape is the point rather than a convenience: `reconcile`
 * and every gate predicate run over this snapshot unchanged, so a local run and
 * a GitHub run reduce identically and neither the driver nor the ledger can tell
 * which source it is looking at.
 */
async function readSubmissionFacts(
  options: LocalSourceOptions,
  submission: LocalSubmission,
  plan: ReturnType<typeof readPlan>,
  lastKnownHead: string | undefined,
): Promise<PullRequestFacts> {
  const { git, repoRoot } = options;
  const base = submission.base || options.baseBranch;

  const { state, head } = await resolveState(options, submission.branch, base, lastKnownHead);

  let reviews: ReviewFacts[] = [];
  if (plan.reviews) {
    // A review that names no SHA is resolved to the head the branch stood at
    // when the file was written. Once the branch is gone there is nothing to
    // walk, so the last known head is the honest answer. Consulted once per
    // review: `readReviews` keeps the first answer, so a review resolved while
    // the branch was open keeps pointing at the commit it was read against
    // rather than jumping to the last known head when the branch merges.
    const resolveSha = (at: string) =>
      state === "closed" || state === "merged" || !head
        ? Promise.resolve(head || null)
        : headShaAt(git, repoRoot, submission.branch, at);
    reviews = await readReviews(repoRoot, submission.number, resolveSha);
  }

  const checks = plan.checks ? await checkConclusion(repoRoot, head) : null;

  let baseRed = false;
  if (plan.baseStatus) {
    const baseHead = await headSha(git, repoRoot, base);
    baseRed = baseHead ? (await checkConclusion(repoRoot, baseHead)) === "failure" : false;
  }

  // Computed whenever there is something to merge, rather than behind
  // `pr.mergeable`, to match what GitHub's reader puts in the snapshot: its
  // `mergeable` arrives in the pull payload every read fetches anyway. Two
  // sources that filled this field on different conditions would produce
  // different worlds for the same situation, and the ledger would record the
  // difference as if something had changed.
  const mergeable = state === "open" && head ? await mergesCleanly(git, repoRoot, base, head) : null;

  return {
    number: submission.number,
    state,
    headSha: head,
    mergeable,
    checks,
    baseRed,
    reviews,
  };
}

/**
 * Read the checkout and materialize the snapshot `decide` consumes.
 *
 * Submissions come from the request's artifacts, exactly as the GitHub reader
 * takes its PR numbers from them: conductor reads what it is managing, never
 * what it happens to find. A submission an artifact names but that has no record
 * on disk is skipped rather than raised — the same treatment a hand-edited
 * ledger gets everywhere else in this package.
 *
 * @param options The checkout, its base branch, and the git runner.
 * @param request The entity, its ledger-owned artifacts, and the previous cursor.
 * @returns The world, plus the fact set this read covered.
 */
export async function readLocalWorld(
  options: LocalSourceOptions,
  request: ObservationRequest,
): Promise<LocalWorldResult> {
  const facts = new Set<WorldFact>(factsReadBy(request.entity.kind, request.entity.phase));
  const plan = readPlan(facts);

  const numbers = [
    ...new Set(
      request.artifacts
        .filter((artifact) => artifact.hostedAt.type === "pr")
        .map((artifact) => (artifact.hostedAt as { number: number }).number),
    ),
  ];

  const lastHeads = new Map(
    request.cursor.pullRequests.map((observed) => [observed.number, observed.headSha]),
  );

  const pullRequests: Record<number, PullRequestFacts> = {};
  for (const number of numbers) {
    const submission = await readSubmission(options.repoRoot, number);
    if (!submission) continue;
    pullRequests[number] = await readSubmissionFacts(
      options,
      submission,
      plan,
      lastHeads.get(number),
    );
  }

  const guidanceHashes: Record<string, string> = {};
  if (facts.has("guidance")) {
    for (const path of request.guidancePaths ?? []) {
      const hash = await blobHash(options.git, options.repoRoot, path);
      if (hash !== null) guidanceHashes[path] = hash;
    }
  }

  return {
    world: {
      artifacts: request.artifacts,
      pullRequests,
      goalCheck: request.goalCheck ?? null,
      childIssues: request.childIssues ?? [],
      guidanceHashes,
      policy: request.policy ?? DEFAULT_POLICY,
    },
    facts: [...facts],
  };
}
