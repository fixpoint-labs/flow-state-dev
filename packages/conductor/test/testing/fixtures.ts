/**
 * The realistic end-to-end script: one issue from a blank slate to `SETTLED`.
 *
 * Written as the world actually moves — a spec PR that gets a feedback round
 * before approval, an implementation PR that goes red before it goes green, the
 * spec PR closing *after* implementation has started, and a human merge. Every
 * world here is the snapshot as it stood when that signal arrived, which is what
 * the tick's read-world step would have produced.
 *
 * **This is the single-PR shape**, which is what makes it the realistic one:
 * `issue-implement` proves the goal on the real path at implementation
 * completion, *before* the PR opens (`issue-lifecycle` → Boundaries, "Goal
 * verification is part of done, not a gate"). So every implementation world
 * below carries `goalCheck: "passed"` from the moment the PR exists, and the
 * merge is what finishes the issue — see the contract note on `IMPLEMENTATION`
 * in `model/phases`.
 *
 * The other shape — work that reaches the base *unproved* — is
 * {@link UNPROVED_MERGE_STEPS}.
 */

import type { ReplayStep } from "../../src/testing/replay";
import type { World } from "../../src/model/world";
import { artifact, freshApproval, pr, world } from "../fixtures";

export const SPEC_PR = 10;
export const IMPL_PR = 20;
export const SPEC_HEAD_1 = "spec-sha-1";
export const SPEC_HEAD_2 = "spec-sha-2";
export const IMPL_HEAD_1 = "impl-sha-1";
export const IMPL_HEAD_2 = "impl-sha-2";

const ID = "FIX-1";
const AT = "2026-08-14T12:00:00Z";

/** Nothing exists yet: the issue has just been picked up. */
export const EMPTY_WORLD: World = world();

const specArtifact = (rounds: number) =>
  artifact("spec", SPEC_PR, { reviewRounds: rounds });
const implArtifact = (rounds: number) =>
  artifact("implementation", IMPL_PR, { reviewRounds: rounds });

/** The spec PR is open at its first head, unreviewed. */
const SPEC_OPEN: World = world({
  artifacts: [specArtifact(0)],
  pullRequests: { [SPEC_PR]: pr({ number: SPEC_PR, headSha: SPEC_HEAD_1 }) },
});

/** A revision has been pushed and a human approved it at the new head. */
const SPEC_APPROVED: World = world({
  artifacts: [specArtifact(1)],
  pullRequests: {
    [SPEC_PR]: pr({
      number: SPEC_PR,
      headSha: SPEC_HEAD_2,
      reviews: [freshApproval(SPEC_HEAD_2)],
    }),
  },
});

/** A closed, approved spec PR — it stays in the world after implementation starts. */
const CLOSED_SPEC_PR = pr({
  number: SPEC_PR,
  state: "closed",
  headSha: SPEC_HEAD_2,
  reviews: [freshApproval(SPEC_HEAD_2)],
});

const implWorld = (
  implPr: ReturnType<typeof pr>,
  rounds = 0,
  rest: Partial<World> = {},
): World =>
  world({
    artifacts: [specArtifact(1), implArtifact(rounds)],
    pullRequests: { [SPEC_PR]: CLOSED_SPEC_PR, [IMPL_PR]: implPr },
    ...rest,
  });

/**
 * The same, with the goal already proved — the single-PR shape, where the proof
 * lands at implementation completion and therefore predates the PR.
 *
 * The verdict is bound to the head each snapshot is at, which is what a proof
 * *is*: a statement about one revision. A script that carried `"passed"` across
 * a head change would be describing a world the tick cannot produce — the push
 * that moved the head either invalidated the proof or came with a fresh one.
 */
const provedImplWorld = (
  implPr: ReturnType<typeof pr>,
  rounds = 0,
): World =>
  implWorld(implPr, rounds, { goalCheck: "passed", goalCheckSha: implPr.headSha });

const IMPL_OPEN = provedImplWorld(pr({ number: IMPL_PR, headSha: IMPL_HEAD_1 }));
const IMPL_CI_RED = provedImplWorld(
  pr({ number: IMPL_PR, headSha: IMPL_HEAD_1, checks: "failure" }),
);
const IMPL_CI_GREEN = provedImplWorld(
  pr({ number: IMPL_PR, headSha: IMPL_HEAD_2, checks: "success" }),
  1,
);
const IMPL_APPROVED = provedImplWorld(
  pr({
    number: IMPL_PR,
    headSha: IMPL_HEAD_2,
    checks: "success",
    reviews: [freshApproval(IMPL_HEAD_2)],
  }),
  1,
);
const IMPL_MERGED = provedImplWorld(
  pr({
    number: IMPL_PR,
    state: "merged",
    headSha: IMPL_HEAD_2,
    checks: "success",
    reviews: [freshApproval(IMPL_HEAD_2)],
  }),
  1,
);

/**
 * The full path: SPEC → spec PR → feedback round → approval → IMPLEMENTATION →
 * CI red → fix → CI green → approval → merge → SETTLED.
 *
 * No goal-check step, and that is the shape rather than an omission: the goal
 * was proved before the implementation PR opened, so the merge is completion.
 */
export const LIFECYCLE_STEPS: readonly ReplayStep[] = [
  // Picked up: the phase's entry work is dispatched.
  { signal: { kind: "phase_entered", entityId: ID, at: AT }, world: EMPTY_WORLD },
  // The spec lands on a PR.
  {
    signal: { kind: "pr_opened", entityId: ID, at: AT, pullNumber: SPEC_PR },
    world: SPEC_OPEN,
  },
  // A human leaves feedback. M1 has no classifier: any human comment is feedback.
  {
    signal: {
      kind: "feedback_received",
      entityId: ID,
      at: AT,
      author: "alice",
      commentId: "c1",
      pullNumber: SPEC_PR,
    },
  },
  // The revision is approved at the new head — the gate the human owns.
  {
    signal: {
      kind: "approved",
      entityId: ID,
      at: AT,
      reviewer: "alice",
      sha: SPEC_HEAD_2,
      pullNumber: SPEC_PR,
    },
    world: SPEC_APPROVED,
  },
  // Implementation opens its own PR.
  {
    signal: { kind: "pr_opened", entityId: ID, at: AT, pullNumber: IMPL_PR },
    world: IMPL_OPEN,
  },
  // The spec PR closes at approval — late, and on a PR this phase does not own.
  {
    signal: { kind: "pr_closed", entityId: ID, at: AT, pullNumber: SPEC_PR },
  },
  // CI goes red on the implementation.
  {
    signal: {
      kind: "ci_concluded",
      entityId: ID,
      at: AT,
      conclusion: "failure",
      sha: IMPL_HEAD_1,
    },
    world: IMPL_CI_RED,
  },
  // The fix pushes a new head and CI goes green.
  {
    signal: {
      kind: "ci_concluded",
      entityId: ID,
      at: AT,
      conclusion: "success",
      sha: IMPL_HEAD_2,
    },
    world: IMPL_CI_GREEN,
  },
  // A human approves the implementation.
  {
    signal: {
      kind: "approved",
      entityId: ID,
      at: AT,
      reviewer: "alice",
      sha: IMPL_HEAD_2,
      pullNumber: IMPL_PR,
    },
    world: IMPL_APPROVED,
  },
  // A human merges. Conductor never does — and it only invited this merge
  // because the goal was already proved.
  {
    signal: { kind: "merged", entityId: ID, at: AT, pullNumber: IMPL_PR },
    world: IMPL_MERGED,
  },
];

/**
 * The other shape: work that reached the base **unproved**.
 *
 * A human merging ahead of the gate, and — once sub-PRs become nested tasks —
 * the assembled multi-PR goal that only runs after the last one lands. Both
 * arrive here, at `awaiting_goal_check`, which is the only gate that dispatches
 * `runGoalCheck`. Starts in `IMPLEMENTATION`, since the spec half is already
 * covered by {@link LIFECYCLE_STEPS}.
 */
export const UNPROVED_MERGE_STEPS: readonly ReplayStep[] = [
  {
    signal: { kind: "pr_opened", entityId: ID, at: AT, pullNumber: IMPL_PR },
    world: implWorld(pr({ number: IMPL_PR, headSha: IMPL_HEAD_2 })),
  },
  {
    signal: {
      kind: "ci_concluded",
      entityId: ID,
      at: AT,
      conclusion: "success",
      sha: IMPL_HEAD_2,
    },
    world: implWorld(pr({ number: IMPL_PR, headSha: IMPL_HEAD_2, checks: "success" })),
  },
  // Approved, but nothing has proved the goal — so conductor does not invite
  // the merge. It holds no merge gate here at all.
  {
    signal: {
      kind: "approved",
      entityId: ID,
      at: AT,
      reviewer: "alice",
      sha: IMPL_HEAD_2,
      pullNumber: IMPL_PR,
    },
    world: implWorld(
      pr({
        number: IMPL_PR,
        headSha: IMPL_HEAD_2,
        checks: "success",
        reviews: [freshApproval(IMPL_HEAD_2)],
      }),
    ),
  },
  // A human merges it anyway. That is allowed — conductor gates itself, not the
  // human — and it is exactly what `awaiting_goal_check` exists to catch.
  {
    signal: { kind: "merged", entityId: ID, at: AT, pullNumber: IMPL_PR },
    world: implWorld(
      pr({
        number: IMPL_PR,
        state: "merged",
        headSha: IMPL_HEAD_2,
        checks: "success",
        reviews: [freshApproval(IMPL_HEAD_2)],
      }),
    ),
  },
  // The goal check runs on the real path and passes. Only now is it done.
  {
    signal: { kind: "goal_check_passed", entityId: ID, at: AT },
    world: implWorld(
      pr({
        number: IMPL_PR,
        state: "merged",
        headSha: IMPL_HEAD_2,
        checks: "success",
        reviews: [freshApproval(IMPL_HEAD_2)],
      }),
      0,
      { goalCheck: "passed", goalCheckSha: IMPL_HEAD_2 },
    ),
  },
];
