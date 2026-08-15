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
 * Where a goal check stood when it took its verdict — and therefore **what the
 * verdict is about**.
 *
 * The third part of a proof, beside the verdict and the revision, because a
 * check taken on the submission's branch and a check taken on the base prove
 * two different claims:
 *
 * - **`"branch"`** — *this change does what the issue asked.* It is what the
 *   merge gate needs: an invitation to merge is an invitation to merge **this**,
 *   and the only code that answers for it is the code on the branch. Every
 *   verdict a coding dispatch reports is one of these, because a dispatch runs
 *   in a workspace standing on the phase's own branch.
 * - **`"base"`** — *what landed does what the issue asked.* It is what settles
 *   the issue, and it is not implied by the first however green the branch was:
 *   the merge may have squashed, resolved a conflict, or landed on a base that
 *   moved underneath it. Conductor cannot see which of those happened — no fact
 *   in this snapshot describes a merge commit — so it re-proves rather than
 *   assuming, which is the fail-closed direction and the only one available.
 *
 * A verdict and its ground travel together for the same reason a verdict and its
 * revision do: read without one, "proved" answers a question nobody asked. The
 * revision says *of what code*; the ground says *of what claim*.
 */
export type ProofGround = "branch" | "base";

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
}

/** The default policy, matching `docs/contributing/orchestration.md`. */
export const DEFAULT_POLICY: ConductorPolicy = {
  specReviewRoundBudget: 2,
  implementationReviewRoundBudget: 12,
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
  /**
   * The revision {@link World.goalCheck} was taken against, and the half that
   * makes the verdict mean something. `null` when no check has run, or when the
   * revision it proved is not yet known — see {@link goalCheckAtHead}, which is
   * the only thing that should read this field.
   */
  readonly goalCheckSha: string | null;
  /**
   * The ground {@link World.goalCheck} was taken on — see {@link ProofGround},
   * and {@link standingVerdict} for the rule that reads it. Meaningless when no
   * check has run, and `"branch"` is what a record written before the field
   * existed reads back as (BP-030): the claim a pre-merge dispatch makes, which
   * is the direction that re-proves after a merge rather than settling on a
   * proof of the branch.
   */
  readonly goalCheckGround: ProofGround;
  /** Children, for an epic. Empty for an issue. */
  readonly childIssues: readonly ChildIssueFacts[];
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
 * The goal verdict **as it applies to the work in front of us** — the stored
 * verdict when it describes the revision that work is sitting at, and `null`
 * when it describes some other revision or none.
 *
 * ---------------------------------------------------------------------------
 * WHY THE VERDICT IS BOUND TO A REVISION RATHER THAN GUARDED BY A LIST
 * ---------------------------------------------------------------------------
 *
 * A merge gate never opens on unproved work, and `awaiting_merge` used to hold
 * that by turning on `goalCheck === "passed"` alone. That reads as *this change
 * was proved*, and it is only ever true of the revision the check actually ran
 * on. Everything that could put a different revision under the same verdict then
 * had to be enumerated somewhere — and the enumeration lived over conductor's own
 * dispatch kinds (`runtime/tick`'s `INVALIDATES_GOAL_CHECK`), which cannot be
 * complete, because **a head can change with no dispatch at all**. A human or an
 * external automation pushing another commit to the implementation PR is
 * observed, recorded as a divergence, and produces no action; nothing consults
 * the dispatch table, the verdict stands, and green CI plus a fresh approval on
 * the new head open the merge gate on proof of code that is no longer there.
 *
 * Storing the revision the proof describes closes that as a property instead of
 * as a list. The question the gate asks — *does this verdict describe the head
 * in front of me?* — is answered the same way for a dispatch conductor ran, for
 * a push it never saw, and for a cause nobody has thought of yet.
 *
 * **A verdict with no revision reads as unproved, never as proved-at-unknown.**
 * That is the direction a record written before the field existed falls (BP-030,
 * see `model/entities`), and it is also the direction a verdict whose revision is
 * not yet knowable falls — see `runtime/tick`, where a dispatch that may have
 * pushed leaves the proof unbound until the next observation reveals what it
 * pushed. Falling the other way opens a merge gate.
 *
 * **Work that is not hosted at a submission has no head to go stale**, and the
 * verdict stands for it. That is not a loophole, it is the other shape the
 * `IMPLEMENTATION` contract already describes: a multi-PR issue's assembled goal
 * belongs to the issue and to none of its pull requests, and its artifact is
 * file-hosted. Nothing can push a commit to a proof that names no submission.
 * The one gate this could otherwise loosen cannot be reached without a PR —
 * `awaiting_merge` turns on a fresh human approval *on the implementation PR*,
 * and `awaiting_goal_check` on that PR having merged — so the only thing it
 * releases is the completion the multi-PR shape needs.
 *
 * An artifact recorded at a PR whose facts are missing from the snapshot lands
 * in that same branch. It is a failed read rather than a state of the work, and
 * `./phases` already states why the honest fix is for the observer not to hand
 * back a snapshot missing a PR it was asked for.
 */
export function goalCheckFor(
  world: World,
  artifact: ArtifactFacts | undefined,
): World["goalCheck"] {
  if (world.goalCheck === null) return null;
  const pr = prForArtifact(world, artifact);
  if (!pr) return world.goalCheck;
  if (world.goalCheckSha === null) return null;
  return world.goalCheckSha === pr.headSha ? world.goalCheck : null;
}

/**
 * The ground the work in front of us has to be proved on **right now**.
 *
 * One question, asked from three places that must agree: the gate that demands
 * the proof, the phase's completion, and the tick that provisions the workspace
 * a check runs in. A submission that has merged needs the base proved; anything
 * else needs its own branch proved. Written once so the workspace a check stands
 * in cannot disagree with the claim its verdict is recorded as — a pre-merge
 * check provisioned at the base would pass while proving nothing about the work,
 * which is worse than not running.
 *
 * Work hosted at no submission (the multi-PR assembled goal) reads as `"branch"`:
 * there is no merge of its own, so nothing has landed for a base proof to be
 * about, and the verdict such an issue holds is its own assembled one.
 */
export function requiredGround(pr: PullRequestFacts | undefined): ProofGround {
  return pr?.state === "merged" ? "base" : "branch";
}

/**
 * The goal verdict that **stands for the work in front of us** — the stored
 * verdict, kept only where it describes both the revision that work is sitting
 * at ({@link goalCheckFor}) and the claim that work now needs proving
 * ({@link requiredGround}).
 *
 * Every predicate in `IMPLEMENTATION` reads this rather than either half alone,
 * and the two halves close two different holes:
 *
 * - **The revision** stops a proof outliving the code it was taken against, by
 *   the property argued on {@link goalCheckFor}.
 * - **The ground** stops a proof outliving the *claim* it was taken for. A
 *   merged submission keeps the head SHA its branch ended on, so a branch proof
 *   at that revision matches the head exactly — and reading it as a proof of
 *   what landed settles the issue on a check that never saw the base. The
 *   revision cannot catch that, because nothing about the revision changed; only
 *   the question did.
 *
 * Both directions of an unbound answer read as **unproved**, which is the
 * direction that costs a re-run rather than a merge.
 */
export function standingVerdict(
  world: World,
  artifact: ArtifactFacts | undefined,
): World["goalCheck"] {
  const verdict = goalCheckFor(world, artifact);
  if (verdict === null) return null;
  const ground = requiredGround(prForArtifact(world, artifact));
  return world.goalCheckGround === ground ? verdict : null;
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
});

/**
 * {@link World} as runtime data.
 *
 * `pullRequests` is keyed by PR number, and JSON has no numeric object keys —
 * hence the coercion, so a snapshot survives a round trip through a store
 * without the keys quietly becoming strings.
 *
 * The input type is `unknown` rather than `World`, which the other schemas here
 * do not need. `goalCheckSha` and `goalCheckGround` carry defaults so that a
 * ledger row written before either field existed parses back with the proof
 * unbound and claimed for the branch (BP-030), and a default is precisely a
 * field the *input* may omit. Only the output is pinned to {@link World}, which
 * is the direction the annotation exists for: a field added to the type and
 * forgotten here still fails to compile.
 */
export const worldSchema: z.ZodType<World, z.ZodTypeDef, unknown> = z.object({
  artifacts: z.array(artifactFactsSchema),
  pullRequests: z.record(z.coerce.number().int(), pullRequestFactsSchema),
  goalCheck: z.enum(["passed", "failed"]).nullable(),
  goalCheckSha: z.string().nullable().default(null),
  goalCheckGround: z.enum(["branch", "base"]).default("branch"),
  childIssues: z.array(z.object({ id: z.string(), settled: z.boolean() })),
  policy: conductorPolicySchema,
});
