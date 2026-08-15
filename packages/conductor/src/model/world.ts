/**
 * The world snapshot — everything `decide` and every gate predicate may read.
 *
 * This type is the whole reason `decide` can be pure. A gate asks a question
 * about the world (*has this spec been approved?*) and the answer lives
 * somewhere with latency — a GitHub API, a git checkout and the files beside it.
 * The resolution is that the tick materializes the answer **before** `decide`
 * runs: by the time any predicate executes, everything it needs is plain data. A
 * gate is therefore an ordinary pure predicate and the whole phase × gate ×
 * signal matrix is testable by handing it a literal.
 *
 * Which source produced a snapshot is not recorded here and must not matter: an
 * `Observer` (see `../observe/types`) fills this shape, and a gate that could
 * tell GitHub's world from a local one would be reading the source rather than
 * the state.
 *
 * Nothing in this file performs or describes I/O. What gets fetched is driven
 * by the `reads` each gate declares (see `./phases`), which the tick resolves
 * during its read-world step.
 *
 * The types are the contract; {@link worldSchema} at the bottom is the same
 * shape as runtime data, because a ledger row stores the snapshot a transition
 * was reduced against and a stored thing needs a schema.
 */

import { z } from "zod";

/** A review submitted against an artifact, as its source reports it. */
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

/**
 * Structural facts about one submission under review — a GitHub pull request, a
 * branch in a local checkout. **The source always wins on these**, whichever it
 * is; conductor's copy of them is a cache with a designated winner, never a
 * second authority (see `../driver/reconcile`).
 */
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
  /**
   * Artifacts belonging to the entity being decided, **newest last**.
   *
   * The ordering is load-bearing, not documentation: an issue can hold more
   * than one artifact of a kind — a replacement PR after the first was closed,
   * a multi-PR build plan — and {@link artifactOfKind} resolves "the one this
   * phase is working on" as the last of its kind. The producer appends in
   * ledger order, which is that order. Reversing it silently points every gate,
   * every PR-signal scope check, and every review-round count at a dead
   * artifact.
   */
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

/**
 * The **active** artifact of a given kind for this entity, or `undefined`.
 *
 * Active means newest, because `World.artifacts` is newest-last and a second
 * artifact of a kind supersedes the first. Taking the oldest instead would gate
 * an issue on a PR that has already been closed or merged, scope incoming PR
 * signals to it, and count review rounds against it — and, worst of the three,
 * an already-merged first implementation would satisfy `awaiting_goal_check`
 * while the work that replaced it was still open.
 */
export function artifactOfKind(
  world: World,
  kind: ArtifactKind,
): ArtifactFacts | undefined {
  const matching = world.artifacts.filter((a) => a.kind === kind);
  return matching.at(-1);
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
 * Each human's **current position** on the PR at its head, one review per
 * reviewer, oldest position first.
 *
 * GitHub keeps every review ever submitted, so a reviewer who approves and then
 * submits `CHANGES_REQUESTED` against the same head SHA leaves both records
 * standing. Asking "is there an approval in this list?" therefore answers a
 * question nobody asked: it reports that someone approved *at some point*, not
 * that anyone approves *now*. Collapsing to the latest review per reviewer is
 * what makes a withdrawn approval actually withdraw.
 *
 * `COMMENTED` is skipped rather than counted as a position, matching GitHub's
 * own model: leaving a comment does not retract an approval or a change
 * request. Only the two stateful verdicts move a reviewer's position.
 */
export function effectiveHumanReviewsAtHead(
  pr: PullRequestFacts | undefined,
): readonly ReviewFacts[] {
  if (!pr) return [];
  const latest = new Map<string, ReviewFacts>();
  for (const r of pr.reviews) {
    if (!r.isHuman || r.sha !== pr.headSha) continue;
    if (r.state !== "APPROVED" && r.state !== "CHANGES_REQUESTED") continue;
    const prior = latest.get(r.reviewer);
    // `<=` so equal timestamps fall back to GitHub's own ordering of the list.
    if (!prior || prior.at <= r.at) latest.set(r.reviewer, r);
  }
  return [...latest.values()]
    .slice()
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * The approvals that **stand right now** at the PR's head, oldest first. Empty
 * when every approval has been superseded by its own author or is stale.
 */
export function freshHumanApprovals(
  pr: PullRequestFacts | undefined,
): readonly ReviewFacts[] {
  return effectiveHumanReviewsAtHead(pr).filter((r) => r.state === "APPROVED");
}

/**
 * True when a human approves the PR **at its current head, right now**, and no
 * human is asking for changes.
 *
 * Three ways an approval fails to count, and all three matter:
 *
 * - **Stale.** An approval against an older SHA is not an approval — the check
 *   that keeps "approved" from meaning "was approved once, before the push".
 * - **Withdrawn.** A reviewer who has since requested changes on the same head
 *   no longer approves, whatever GitHub's retained history still says.
 * - **Outvoted by an outstanding change request.** `orchestration.md` → "What
 *   counts as approval" gates on the latest review per human reviewer being
 *   `APPROVED` **and no** reviewer's latest being `CHANGES_REQUESTED`, because
 *   a human `CHANGES_REQUESTED` "outranks all three channels": it is the one
 *   signal that withholds a gate no matter how approval arrived. Without this
 *   clause, Alice objecting while Bob approves opens the gate.
 *
 * Deliberately **not** `freshHumanApprovals(pr).length > 0`. Bob's approval is
 * still a standing fact about Bob — it stays in {@link freshHumanApprovals},
 * and it is still who the ledger credits when the gate does open. What it does
 * not do is release the gate over Alice's head.
 */
export function hasFreshHumanApproval(pr: PullRequestFacts | undefined): boolean {
  const positions = effectiveHumanReviewsAtHead(pr);
  if (positions.some((r) => r.state === "CHANGES_REQUESTED")) return false;
  return positions.some((r) => r.state === "APPROVED");
}

/**
 * True when any human has reviewed the PR at its current head, in any state.
 *
 * Deliberately *not* collapsed to current positions the way
 * {@link hasFreshHumanApproval} is. This answers "has a human looked at it
 * yet?", and a `COMMENTED` review — or an approval a reviewer later withdrew —
 * is proof that one did. Collapsing here would send an issue back to
 * `awaiting_spec_review` after a change request, asking for a review that has
 * already happened.
 */
export function hasHumanReviewAtHead(pr: PullRequestFacts | undefined): boolean {
  if (!pr) return false;
  return pr.reviews.some((r) => r.isHuman && r.sha === pr.headSha);
}

/*
 * ---------------------------------------------------------------------------
 * RUNTIME SHAPES
 * ---------------------------------------------------------------------------
 *
 * Each schema below mirrors the interface above it and is annotated with it, so
 * a field added to the type and forgotten here fails to compile rather than
 * going quietly missing from a persisted snapshot. The annotation catches the
 * dangerous direction only — a schema missing a field the type has — which is
 * exactly the drift that would silently weaken the ledger's replay claim.
 */

/** Where an artifact is hosted. A PR is not an entity — it is a hosting location. */
export const hostedAtSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pr"), number: z.number().int() }),
  z.object({ type: z.literal("file"), path: z.string() }),
]);

const reviewFactsSchema: z.ZodType<ReviewFacts> = z.object({
  id: z.string(),
  reviewer: z.string(),
  isHuman: z.boolean(),
  state: z.enum(["COMMENTED", "CHANGES_REQUESTED", "APPROVED"]),
  sha: z.string(),
  at: z.string(),
});

const pullRequestFactsSchema: z.ZodType<PullRequestFacts> = z.object({
  number: z.number().int(),
  state: z.enum(["open", "closed", "merged"]),
  headSha: z.string(),
  mergeable: z.boolean().nullable(),
  checks: z.enum(["pending", "success", "failure"]).nullable(),
  baseRed: z.boolean(),
  reviews: z.array(reviewFactsSchema),
});

const artifactFactsSchema: z.ZodType<ArtifactFacts> = z.object({
  id: z.string(),
  kind: z.enum(["spec", "implementation", "epic_spec", "retrospective"]),
  hostedAt: hostedAtSchema,
  reviewRounds: z.number().int(),
});

const conductorPolicySchema: z.ZodType<ConductorPolicy> = z.object({
  specReviewRoundBudget: z.number().int(),
  implementationReviewRoundBudget: z.number().int(),
  onGuidanceChanged: z.enum(["reExamineOpenPrs", "ignore"]),
});

/**
 * {@link World} as runtime data.
 *
 * `pullRequests` is keyed by PR number, and JSON has no numeric object keys —
 * hence the coercion, so a snapshot survives a round trip through a store
 * without the keys quietly becoming strings.
 */
export const worldSchema: z.ZodType<World> = z.object({
  artifacts: z.array(artifactFactsSchema),
  pullRequests: z.record(z.coerce.number().int(), pullRequestFactsSchema),
  goalCheck: z.enum(["passed", "failed"]).nullable(),
  childIssues: z.array(z.object({ id: z.string(), settled: z.boolean() })),
  guidanceHashes: z.record(z.string(), z.string()),
  policy: conductorPolicySchema,
});
