/**
 * The world snapshot — everything `decide` and every gate predicate may read.
 *
 * This type is the whole reason `decide` can be pure. A gate asks a question
 * about the world (*has this spec been approved?*) and the world lives in
 * GitHub. The resolution is that the tick materializes the answer **before**
 * `decide` runs: by the time any predicate executes, everything it needs is
 * plain data. A gate is therefore an ordinary pure predicate and the whole
 * phase × gate × signal matrix is testable by handing it a literal.
 *
 * Nothing in this file performs or describes I/O. What gets fetched is driven
 * by the `reads` each gate declares (see `./phases`), which the tick resolves
 * during its read-world step.
 */

/** A review submitted against an artifact, as GitHub reports it. */
export interface ReviewFacts {
  readonly id: string;
  readonly reviewer: string;
  /**
   * False for bots and for conductor's own identity. Bot reviews never satisfy
   * a gate and bot comments never become signals at all — they are dropped on
   * author, structurally, before classification.
   */
  readonly isHuman: boolean;
  readonly state: "COMMENTED" | "CHANGES_REQUESTED" | "APPROVED";
  /** Head SHA the review was submitted against — a stale approval is not an approval. */
  readonly sha: string;
  readonly at: string;
}

/** Structural facts about one pull request. GitHub always wins on these. */
export interface PullRequestFacts {
  readonly number: number;
  readonly state: "open" | "closed" | "merged";
  readonly headSha: string;
  /** `null` when GitHub has not computed mergeability yet. */
  readonly mergeable: boolean | null;
  /** Aggregate check conclusion for `headSha`; `null` when no checks have reported. */
  readonly checks: "pending" | "success" | "failure" | null;
  /** True when the base branch is itself red, so a failure here may not be ours. */
  readonly baseRed: boolean;
  readonly reviews: readonly ReviewFacts[];
}

/** What kind of reviewable output an artifact is. */
export type ArtifactKind = "spec" | "implementation" | "epic_spec" | "retrospective";

/**
 * A reviewable output of a phase. Unifies spec review and code review — a "PR"
 * is not an entity, it is where an artifact happens to be hosted.
 */
export interface ArtifactFacts {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly hostedAt:
    | { readonly type: "pr"; readonly number: number }
    | { readonly type: "file"; readonly path: string };
  /**
   * Completed review rounds. Carries the budget `orchestration.md` sets — past
   * it, `decide` escalates rather than revising again.
   */
  readonly reviewRounds: number;
}

/** A child issue of an epic, as far as the epic needs to know. */
export interface ChildIssueFacts {
  readonly id: string;
  readonly settled: boolean;
}

/** Budgets and policy the driver reduces against. */
export interface ConductorPolicy {
  /** Review rounds allowed on a spec artifact before escalating. Default 2. */
  readonly specReviewRoundBudget: number;
  /** Review rounds allowed on an implementation PR before escalating. Default 12. */
  readonly implementationReviewRoundBudget: number;
  /** What a `guidance_changed` signal dispatches, if anything. */
  readonly onGuidanceChanged: "reExamineOpenPrs" | "ignore";
}

/** The default policy, matching `docs/contributing/orchestration.md`. */
export const DEFAULT_POLICY: ConductorPolicy = {
  specReviewRoundBudget: 2,
  implementationReviewRoundBudget: 12,
  onGuidanceChanged: "ignore",
};

/**
 * Everything materialized before `decide` runs.
 *
 * Deliberately flat and plain: no refs, no lazy accessors, no promises. If a
 * predicate would need to `await` something, that fact belongs in this snapshot
 * and in some gate's `reads`.
 */
export interface World {
  /** Artifacts belonging to the entity being decided, newest last. */
  readonly artifacts: readonly ArtifactFacts[];
  /** PR facts keyed by PR number, for every PR any artifact is hosted at. */
  readonly pullRequests: Readonly<Record<number, PullRequestFacts>>;
  /** Result of the goal check on the real path; `null` when it has not run. */
  readonly goalCheck: "passed" | "failed" | null;
  /** Children, for an epic. Empty for an issue. */
  readonly childIssues: readonly ChildIssueFacts[];
  /** Content hash per guidance path, as last read from the repo. */
  readonly guidanceHashes: Readonly<Record<string, string>>;
  readonly policy: ConductorPolicy;
}

/** The artifact of a given kind for this entity, or `undefined`. */
export function artifactOfKind(
  world: World,
  kind: ArtifactKind,
): ArtifactFacts | undefined {
  return world.artifacts.find((a) => a.kind === kind);
}

/** The PR an artifact is hosted at, or `undefined` when it is file-hosted or absent. */
export function prForArtifact(
  world: World,
  artifact: ArtifactFacts | undefined,
): PullRequestFacts | undefined {
  if (!artifact || artifact.hostedAt.type !== "pr") return undefined;
  return world.pullRequests[artifact.hostedAt.number];
}

/**
 * True when a human approved the PR **at its current head**. A stale approval
 * against an older SHA does not satisfy a gate — this is the one check that
 * keeps "approved" from meaning "was approved once, before the last push".
 */
export function hasFreshHumanApproval(pr: PullRequestFacts | undefined): boolean {
  if (!pr) return false;
  return pr.reviews.some(
    (r) => r.isHuman && r.state === "APPROVED" && r.sha === pr.headSha,
  );
}

/** True when any human has reviewed the PR at its current head, in any state. */
export function hasHumanReviewAtHead(pr: PullRequestFacts | undefined): boolean {
  if (!pr) return false;
  return pr.reviews.some((r) => r.isHuman && r.sha === pr.headSha);
}
