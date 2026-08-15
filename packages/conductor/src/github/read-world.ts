/**
 * World materialization — the step that lets `decide` be pure.
 *
 * A gate asks a question about the world and the world lives in GitHub. The
 * resolution the design commits to is that the tick answers it **first**: by
 * the time any predicate runs, everything it needs is plain data. This module
 * is that step. It reads GitHub and returns a `World`.
 *
 * What gets fetched is driven by the `reads` each gate declares
 * (`factsReadBy`), so a phase's I/O is a consequence of its own table entry
 * rather than of a hand-maintained fetch list. Two consequences follow, both
 * accepted by the design: the tick over-fetches (it reads for gates that turn
 * out not to apply), and a phase cannot gate on a fact it did not declare.
 *
 * **Bounded over-fetch is fine; unbounded I/O inside a predicate is not.** No
 * function here is called from a gate.
 *
 * Facts conductor owns rather than reads — `artifact.rounds`, `goalCheck`, the
 * child-issue roster — are inputs, not fetches. Nothing else has anywhere to
 * put `reviewRounds: 2`.
 */

import { factsReadBy, type EntityKind, type Phase, type WorldFact } from "../model/phases";
import {
  DEFAULT_POLICY,
  type ArtifactFacts,
  type ChildIssueFacts,
  type ConductorPolicy,
  type PullRequestFacts,
  type ReviewFacts,
  type World,
} from "../model/world";
import type { GitHubClient } from "./client";
import { GitHubApiError } from "./client";
import { isHumanActor, type ConductorIdentity, type GitHubActor } from "./identity";

/** What a caller hands the reader. Everything conductor owns arrives here. */
export interface ReadWorldInput {
  /** The entity being ticked — its kind and stored phase drive what is read. */
  readonly entity: { readonly kind: EntityKind; readonly phase: Phase };
  /**
   * The entity's artifacts from the ledger, carrying conductor-owned
   * `reviewRounds`. PR-hosted entries decide which pull requests are fetched.
   */
  readonly artifacts: readonly ArtifactFacts[];
  /** Conductor-owned. `null` when the goal check has not run. */
  readonly goalCheck?: "passed" | "failed" | null;
  /** Conductor-owned. The revision `goalCheck` was taken against, or `null`. */
  readonly goalCheckSha?: string | null;
  /** Conductor-owned. Empty for an issue. */
  readonly childIssues?: readonly ChildIssueFacts[];
  /** Repo-relative guidance paths to hash. Only read when a gate declares `guidance`. */
  readonly guidancePaths?: readonly string[];
  readonly policy?: ConductorPolicy;
}

export interface ReadWorldResult {
  /** The snapshot `decide` and every gate predicate reduce against. */
  readonly world: World;
  /** The facts this read materialized — exactly what the phase's gates declared. */
  readonly facts: readonly WorldFact[];
}

/** GitHub's pull-request payload, narrowed to what conductor reads. */
interface PullPayload {
  number: number;
  state: string;
  merged?: boolean | null;
  merged_at?: string | null;
  mergeable?: boolean | null;
  head?: { sha?: string | null } | null;
  base?: { ref?: string | null } | null;
}

/** GitHub's review payload, narrowed. */
interface ReviewPayload {
  id: number | string;
  user?: GitHubActor | null;
  state?: string | null;
  commit_id?: string | null;
  submitted_at?: string | null;
}

/** One check run on a commit, narrowed. */
interface CheckRunPayload {
  status?: string | null;
  conclusion?: string | null;
}

/**
 * One entry of GitHub's *combined status* for a commit, narrowed.
 *
 * The older of GitHub's two CI reporting mechanisms. A repository whose CI
 * reports through the Statuses API — Jenkins, CircleCI, Buildkite, anything
 * posting to `POST /statuses/{sha}` — produces **no check runs at all**, so a
 * reader that consults only the Check Runs API sees nothing forever.
 */
interface CommitStatusPayload {
  state?: string | null;
  context?: string | null;
}

/** The single value `PullRequestFacts.checks` carries. */
type ChecksConclusion = PullRequestFacts["checks"];

/** Conclusions that mean the check did not pass. */
const FAILING_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
  "stale",
]);

/** Commit-status states that mean the context did not pass. */
const FAILING_STATUS_STATES = new Set(["failure", "error"]);

/**
 * Aggregate a commit's check runs into the single value `PullRequestFacts.checks`
 * carries.
 *
 * **A definitive failure outranks a run still in flight.** A red check is
 * actionable the moment it reports; waiting for the rest of the suite only
 * delays the fix, and the aggregate cannot become green again while it stands.
 *
 * @returns `null` when nothing has reported — which the `awaiting_ci` gate reads
 *   as "no CI on this PR" rather than as a failure.
 */
export function aggregateChecks(runs: readonly CheckRunPayload[]): ChecksConclusion {
  if (runs.length === 0) return null;
  let pending = false;
  for (const run of runs) {
    if (run.status !== "completed") {
      pending = true;
      continue;
    }
    if (run.conclusion && FAILING_CONCLUSIONS.has(run.conclusion)) return "failure";
  }
  return pending ? "pending" : "success";
}

/**
 * The same aggregation over classic commit statuses.
 *
 * The combined-status endpoint already returns the *latest* status per context,
 * so each entry is one CI system's current word on the commit and no collapsing
 * is needed here.
 *
 * **Anything that is neither a failure nor `success` counts as pending**, which
 * includes a state this reader does not recognize. That is the fail-closed
 * direction: an unrecognized state read as success would open a merge gate on a
 * context nobody has seen pass, and read as pending it merely waits.
 *
 * @returns `null` when no context has reported. Deliberately derived from the
 *   entry count and never from the envelope's own `state`, which GitHub reports
 *   as `"pending"` for a commit that has no statuses at all — reading that would
 *   put every check-run repository into a permanent `awaiting_ci`.
 */
export function aggregateStatuses(
  statuses: readonly CommitStatusPayload[],
): ChecksConclusion {
  if (statuses.length === 0) return null;
  let pending = false;
  for (const status of statuses) {
    const state = (status.state ?? "").toLowerCase();
    if (FAILING_STATUS_STATES.has(state)) return "failure";
    if (state !== "success") pending = true;
  }
  return pending ? "pending" : "success";
}

/**
 * Fold the two mechanisms' answers into one.
 *
 * A repository may use either or both, and when it uses both they are equally
 * authoritative — a required status check and a required check run are the same
 * promise made through two APIs. So the combination is the same precedence each
 * aggregation already applies internally, raised one level: **failure outranks
 * pending outranks success, and `null` only survives when neither mechanism
 * reported anything.**
 *
 * Written as an explicit fold rather than falling back from one API to the
 * other. A fallback ("read statuses only when there are no check runs") reads a
 * repository with a green check run and a failing required status as green,
 * which is the exact exposure this whole path exists to prevent.
 */
export function combineChecks(
  a: ChecksConclusion,
  b: ChecksConclusion,
): ChecksConclusion {
  if (a === "failure" || b === "failure") return "failure";
  if (a === "pending" || b === "pending") return "pending";
  if (a === "success" || b === "success") return "success";
  return null;
}

/** Every check run reported against a git ref. */
async function checkRunsFor(
  client: GitHubClient,
  ref: string,
): Promise<CheckRunPayload[]> {
  return client.paginate<CheckRunPayload>(
    client.path("commits", encodeURIComponent(ref), "check-runs"),
    (page) => (page as { check_runs?: CheckRunPayload[] })?.check_runs ?? [],
  );
}

/**
 * Every classic commit status reported against a git ref.
 *
 * A 404 is read as "no statuses", the same leniency {@link contentHash} applies
 * and for the same reason: it is a repository that has not adopted this
 * mechanism, not a failure. The leniency is narrow rather than a blanket
 * softening — a ref that genuinely does not exist 404s the check-runs read
 * beside this one, which does raise, so a bad ref is still loud.
 */
async function commitStatusesFor(
  client: GitHubClient,
  ref: string,
): Promise<CommitStatusPayload[]> {
  try {
    return await client.paginate<CommitStatusPayload>(
      client.path("commits", encodeURIComponent(ref), "status"),
      (page) => (page as { statuses?: CommitStatusPayload[] })?.statuses ?? [],
    );
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return [];
    throw error;
  }
}

/**
 * What CI says about a ref, across both of GitHub's reporting mechanisms.
 *
 * Both are always read, never one conditionally on the other — see
 * {@link combineChecks}. They are independent requests, so they run together and
 * a ref costs one round trip rather than two.
 */
async function checksFor(client: GitHubClient, ref: string): Promise<ChecksConclusion> {
  const [runs, statuses] = await Promise.all([
    checkRunsFor(client, ref),
    commitStatusesFor(client, ref),
  ]);
  return combineChecks(aggregateChecks(runs), aggregateStatuses(statuses));
}

/**
 * Map GitHub's review states onto `ReviewFacts`.
 *
 * `PENDING` and `DISMISSED` are dropped rather than mapped, and that is the
 * point of doing this here: a pending review has not been submitted, and a
 * dismissed approval has been explicitly withdrawn. Carrying either into the
 * snapshot would let `hasFreshHumanApproval` satisfy an approval gate from a
 * review nobody stands behind.
 */
function toReviewFacts(
  payload: ReviewPayload,
  identity: ConductorIdentity,
): ReviewFacts | null {
  const state = (payload.state ?? "").toUpperCase();
  if (state !== "APPROVED" && state !== "CHANGES_REQUESTED" && state !== "COMMENTED") {
    return null;
  }
  return {
    id: String(payload.id),
    reviewer: payload.user?.login ?? "",
    isHuman: isHumanActor(payload.user, identity),
    state,
    sha: payload.commit_id ?? "",
    at: payload.submitted_at ?? "",
  };
}

/** Which reads a set of world facts implies for a pull request. */
function prReadPlan(facts: ReadonlySet<WorldFact>) {
  return {
    reviews: facts.has("artifact.reviews"),
    checks: facts.has("pr.checkRuns"),
    baseStatus: facts.has("pr.baseStatus"),
  };
}

/**
 * Read one pull request into `PullRequestFacts`.
 *
 * `checks` is aggregated for the **current head SHA** — a check reported
 * against a SHA that has since been pushed over is not this PR's status, and
 * scoping it here is what keeps a stale green from releasing `awaiting_ci`. It
 * covers both of GitHub's CI mechanisms; see {@link combineChecks}.
 *
 * @param client The GitHub client.
 * @param pullNumber The pull request to read.
 * @param plan Which of the optional reads to perform, derived from declared facts.
 * @returns The PR's structural facts, ready to drop into a `World`.
 */
export async function readPullRequest(
  client: GitHubClient,
  pullNumber: number,
  plan: { reviews: boolean; checks: boolean; baseStatus: boolean } = {
    reviews: true,
    checks: true,
    baseStatus: true,
  },
): Promise<PullRequestFacts> {
  const pull = await client.request<PullPayload>("GET", client.path("pulls", pullNumber));
  const headSha = pull.head?.sha ?? "";
  const merged = pull.merged === true || pull.merged_at != null;
  const state: PullRequestFacts["state"] = merged
    ? "merged"
    : pull.state === "closed"
      ? "closed"
      : "open";

  const reviews: ReviewFacts[] = [];
  if (plan.reviews) {
    // Conductor submits reviews as well as reading them, so `isHuman` rests on
    // the same resolved identity the comment path does: a review conductor
    // wrote must not satisfy an approval gate.
    const identity = await client.identity();
    const payloads = await client.paginate<ReviewPayload>(
      client.path("pulls", pullNumber, "reviews"),
    );
    for (const payload of payloads) {
      const facts = toReviewFacts(payload, identity);
      if (facts) reviews.push(facts);
    }
  }

  const checks = plan.checks && headSha ? await checksFor(client, headSha) : null;

  const baseRef = pull.base?.ref ?? "";
  const baseRed =
    plan.baseStatus && baseRef ? (await checksFor(client, baseRef)) === "failure" : false;

  return {
    number: pull.number,
    state,
    headSha,
    mergeable: pull.mergeable ?? null,
    checks,
    baseRed,
    reviews,
  };
}

/**
 * The pull request whose head is `branch`, or `null` when there is none.
 *
 * The GitHub half of the observer seam's `submissionForBranch`. Conductor knows
 * the branch a phase's work goes on — it named it — and this turns that into the
 * PR number an artifact can be hosted at, whoever opened it.
 *
 * `state=all` rather than `state=open` on purpose: a PR that was opened and then
 * closed is news conductor has to reduce (`decide` escalates a `pr_closed`), and
 * filtering to open ones would make a closed PR indistinguishable from a branch
 * nobody has submitted at all.
 *
 * The **newest** is returned when a branch has hosted several, matching
 * `artifactOfKind`'s "the last one supersedes the earlier ones" rule: a
 * replacement PR opened after the first was closed is the one this phase is
 * working on.
 *
 * @param client The GitHub client.
 * @param branch The branch to look up, in this repository.
 * @returns The pull request number, or `null`.
 */
export async function pullRequestForBranch(
  client: GitHubClient,
  branch: string,
): Promise<number | null> {
  const head = encodeURIComponent(`${client.owner}:${branch}`);
  const payloads = await client.paginate<{ number?: number | null }>(
    `${client.path("pulls")}?head=${head}&state=all`,
  );
  const numbers = payloads
    .map((payload) => payload.number)
    .filter((number): number is number => typeof number === "number");
  return numbers.length === 0 ? null : Math.max(...numbers);
}

/**
 * Project fresh PR facts into the copy conductor persists for the next tick.
 *
 * Re-exported from `driver/reconcile`, where it moved once a second source
 * needed it: the projection is the same for every source, and it belongs beside
 * the `ObservedPr` it produces and the diff that consumes it.
 */
export { toObservedPr } from "../driver/reconcile";

/** The blob SHA of a repo file, which is its content hash. `null` when absent. */
async function contentHash(client: GitHubClient, path: string): Promise<string | null> {
  try {
    const payload = await client.request<{ sha?: string | null }>(
      "GET",
      client.path("contents", path.split("/").map(encodeURIComponent).join("/")),
    );
    return payload?.sha ?? null;
  } catch (error) {
    // A guidance file that does not exist is not an error — it is a repo that
    // has not adopted that document. Anything else is a real failure.
    if (error instanceof GitHubApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Read GitHub and materialize the snapshot `decide` consumes.
 *
 * @param client The GitHub client.
 * @param input The entity, its ledger-owned artifacts, and conductor-owned facts.
 * @returns The world, plus the fact set this read covered.
 */
export async function readWorld(
  client: GitHubClient,
  input: ReadWorldInput,
): Promise<ReadWorldResult> {
  const facts = new Set<WorldFact>(factsReadBy(input.entity.kind, input.entity.phase));
  const plan = prReadPlan(facts);

  const pullNumbers = [
    ...new Set(
      input.artifacts
        .filter((artifact) => artifact.hostedAt.type === "pr")
        .map((artifact) => (artifact.hostedAt as { number: number }).number),
    ),
  ];

  // One PR's read tells the next one nothing, so they run together: an epic
  // with several open PRs pays one PR's latency rather than the sum. The
  // results are keyed back by position, so the record still maps each number to
  // its own facts no matter what order the responses land in.
  const read = await Promise.all(
    pullNumbers.map((number) => readPullRequest(client, number, plan)),
  );
  const pullRequests: Record<number, PullRequestFacts> = {};
  pullNumbers.forEach((number, index) => {
    pullRequests[number] = read[index]!;
  });

  const guidanceHashes: Record<string, string> = {};
  if (facts.has("guidance")) {
    for (const path of input.guidancePaths ?? []) {
      const hash = await contentHash(client, path);
      if (hash !== null) guidanceHashes[path] = hash;
    }
  }

  return {
    world: {
      artifacts: input.artifacts,
      pullRequests,
      goalCheck: input.goalCheck ?? null,
      goalCheckSha: input.goalCheckSha ?? null,
      childIssues: input.childIssues ?? [],
      guidanceHashes,
      policy: input.policy ?? DEFAULT_POLICY,
    },
    facts: [...facts],
  };
}
