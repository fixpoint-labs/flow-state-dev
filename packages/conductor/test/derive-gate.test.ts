/**
 * Gate derivation — the property that makes killing the process survivable.
 *
 * Every test here hands `deriveGate` a literal world and asserts the gate. If
 * any of these needed setup, state, or a prior call, the gate would be
 * remembered rather than derived, and a restart could lose it.
 */

import { describe, expect, it } from "vitest";
import {
  deriveGate,
  isPhaseComplete,
  isPhaseStranded,
  nextPhase,
} from "../src/driver/derive-gate";
import { factsReadBy, ISSUE_PHASES } from "../src/model/phases";
import {
  artifact,
  epic,
  freshApproval,
  issue,
  pr,
  proved,
  review,
  world,
  worldWith,
} from "./fixtures";

describe("issue gates", () => {
  it("waits on nothing while the spec is still being drafted", () => {
    // No PR yet means work is in flight — not that the phase is done.
    expect(deriveGate(issue("SPEC"), world())).toBeNull();
    expect(isPhaseComplete(issue("SPEC"), world())).toBe(false);
  });

  it("waits for review once the spec PR is open and untouched", () => {
    expect(deriveGate(issue("SPEC"), worldWith("spec", pr()))).toBe(
      "awaiting_spec_review",
    );
  });

  it("waits for approval once a human has reviewed at the current head", () => {
    const w = worldWith("spec", pr({ reviews: [review()] }));
    expect(deriveGate(issue("SPEC"), w)).toBe("awaiting_spec_approval");
  });

  it("releases every spec gate on a fresh human approval", () => {
    const w = worldWith("spec", pr({ reviews: [freshApproval()] }));
    expect(deriveGate(issue("SPEC"), w)).toBeNull();
    expect(isPhaseComplete(issue("SPEC"), w)).toBe(true);
  });

  it("holds the spec phase when its PR was merged, which the process forbids", () => {
    // A spec must never land on the base branch (BP-037). Both spec gates read
    // `state === "open"`, so a merged spec PR used to make every gate stop
    // applying: no gate, no completion, and nothing left that could move the
    // issue — a silent, permanent stall with no record that anything is wrong.
    const merged = worldWith("spec", pr({ state: "merged" }));
    expect(deriveGate(issue("SPEC"), merged)).toBe("awaiting_spec_unmerge");
    expect(isPhaseComplete(issue("SPEC"), merged)).toBe(false);
  });

  it("does not read an approval on a merged spec PR as permission to implement", () => {
    // The other half, and the dangerous one: with an approval standing, the old
    // `completedWhen` advanced the issue to IMPLEMENTATION — conductor carrying
    // on as normal while the forbidden artifact sits on the base branch.
    const approved = worldWith(
      "spec",
      pr({ state: "merged", reviews: [freshApproval()] }),
    );
    expect(isPhaseComplete(issue("SPEC"), approved)).toBe(false);
    expect(deriveGate(issue("SPEC"), approved)).toBe("awaiting_spec_unmerge");
  });

  it("still completes SPEC on the ordinary close-unmerged, approval standing", () => {
    // The hold must catch the forbidden shape only. Closing the spec PR
    // unmerged *is* the process (BP-037), and it is also the state conductor
    // finds when it first observes an issue whose spec was approved before it
    // was watching — holding there would strand every one of them.
    const closed = worldWith("spec", pr({ state: "closed", reviews: [freshApproval()] }));
    expect(isPhaseComplete(issue("SPEC"), closed)).toBe(true);
    expect(deriveGate(issue("SPEC"), closed)).toBeNull();
  });

  it("releases the hold when a replacement spec supersedes the merged one", () => {
    // Conductor cannot observe a human undoing the merge, so the release is the
    // recovery a human actually performs: a fresh spec artifact. `artifacts` is
    // newest-last, so the phase's active spec becomes the open replacement and
    // the hold stops applying — the gate is a wait, not a dead end.
    const replaced = world({
      artifacts: [artifact("spec", 10), artifact("spec", 11)],
      pullRequests: {
        10: pr({ number: 10, state: "merged" }),
        11: pr({ number: 11 }),
      },
    });
    expect(deriveGate(issue("SPEC"), replaced)).toBe("awaiting_spec_review");
  });

  it("waits on CI before review, so nobody is asked to review a red PR", () => {
    const w = worldWith("implementation", pr({ checks: "failure" }));
    expect(deriveGate(issue("IMPLEMENTATION"), w)).toBe("awaiting_ci");
  });

  it("moves to review once CI is green", () => {
    const w = worldWith("implementation", pr({ checks: "success" }));
    expect(deriveGate(issue("IMPLEMENTATION"), w)).toBe("awaiting_review");
  });

  it("withholds the review gate while one human objects and another approves", () => {
    // The helper-level rule (see `world.test.ts`) reaching the table: Bob's
    // approval must not carry the PR past review while Alice's change request
    // stands. Before the fix this derived `awaiting_merge` — conductor called a
    // PR ready to merge with an unanswered objection on it.
    const w = worldWith(
      "implementation",
      pr({
        checks: "success",
        reviews: [
          review({
            id: "r1",
            reviewer: "alice",
            state: "CHANGES_REQUESTED",
            at: "2026-08-14T10:00:00Z",
          }),
          review({
            id: "r2",
            reviewer: "bob",
            state: "APPROVED",
            at: "2026-08-14T11:00:00Z",
          }),
        ],
      }),
      {},
      proved("passed"),
    );
    expect(deriveGate(issue("IMPLEMENTATION"), w)).toBe("awaiting_review");
  });

  it("waits on a human to merge once the PR is approved and the goal is proved", () => {
    const w = worldWith(
      "implementation",
      pr({ checks: "success", reviews: [freshApproval()] }),
      {},
      proved("passed"),
    );
    expect(deriveGate(issue("IMPLEMENTATION"), w)).toBe("awaiting_merge");
  });

  it("never opens the merge gate on work whose goal has not passed", () => {
    // The old table applied `awaiting_merge` on the approval alone, so
    // conductor announced "ready to merge" for a change it had never proved.
    // That is the multi-PR ordering (ci → review → merge → goal) applied to a
    // single-PR issue, which proves its goal before its PR ever opens.
    const unproved = worldWith(
      "implementation",
      pr({ checks: "success", reviews: [freshApproval()] }),
    );
    expect(deriveGate(issue("IMPLEMENTATION"), unproved)).toBeNull();
    expect(isPhaseComplete(issue("IMPLEMENTATION"), unproved)).toBe(false);
  });

  it("does not settle an issue whose PR is still open, however the goal passed", () => {
    // A single-PR issue proves its goal at implementation completion, *before*
    // the PR opens — so `goalCheck === "passed"` holds the whole time the PR is
    // under review. Completing on the goal check alone made the phase complete
    // the moment the PR existed, so the very first signal settled an issue
    // nobody had reviewed or merged.
    const openButProved = worldWith(
      "implementation",
      pr({ checks: "success" }),
      {},
      proved("passed"),
    );
    expect(isPhaseComplete(issue("IMPLEMENTATION"), openButProved)).toBe(false);
    expect(deriveGate(issue("IMPLEMENTATION"), openButProved)).toBe("awaiting_review");
  });

  it("does not settle an issue whose implementation has produced nothing yet", () => {
    // The other half of the same rule, and the one absence gets wrong.
    // `implement` proves the goal *before* the submission exists, so there is a
    // window where the verdict has passed and the phase holds no artifact at
    // all — and `implPr(w)?.state !== "open"` is vacuously true for it. Read
    // that way, a passing verdict settles an issue seconds after the agent
    // finished: no CI, no review, no merge. Absence of an artifact is not
    // evidence that there is nothing left to wait for.
    const nothingProduced = world(proved("passed"));
    expect(isPhaseComplete(issue("IMPLEMENTATION"), nothingProduced)).toBe(false);
    expect(deriveGate(issue("IMPLEMENTATION"), nothingProduced)).toBeNull();
  });

  it("still settles an issue whose implementation is at no PR of its own", () => {
    // What the vacuous read was standing in for, said as a fact the snapshot
    // carries: the phase produced an implementation and it is not hosted at a
    // pull request, so there is no merge of its own to wait for. This is why
    // the PR test is `!== "open"` rather than `=== "merged"`, and requiring the
    // artifact positively is what keeps it from also covering "nothing yet".
    const noPrOfItsOwn = world({
      artifacts: [
        artifact("implementation", 10, {
          hostedAt: { type: "file", path: "docs/internal/assembled.md" },
        }),
      ],
      // And the proof names no revision, because there is no submission whose
      // head could move under it. That is the one shape where a bare verdict
      // still stands — see `goalCheckFor`.
      goalCheck: "passed",
      goalCheckSha: null,
    });
    expect(isPhaseComplete(issue("IMPLEMENTATION"), noPrOfItsOwn)).toBe(true);
  });

  it("never opens the merge gate on a proof taken against a head that has moved", () => {
    // The same approved, green, proved PR as the merge-gate case above — except
    // that the proof describes an earlier commit. Nothing about *how* the head
    // moved appears here, which is the point: the gate asks whether the verdict
    // describes what is in front of it, so a push conductor never dispatched and
    // a revision it did are the same answer.
    const movedOn = worldWith(
      "implementation",
      pr({ checks: "success", reviews: [freshApproval()] }),
      {},
      proved("passed", "an-earlier-commit"),
    );
    expect(deriveGate(issue("IMPLEMENTATION"), movedOn)).toBeNull();
    expect(isPhaseComplete(issue("IMPLEMENTATION"), movedOn)).toBe(false);
  });

  it("never opens the merge gate on a verdict that names no revision", () => {
    // The direction BP-030 chooses, said as a gate rather than as a default. A
    // record written before the revision was stored reads back with the verdict
    // standing and the revision `null`, and so does a verdict conductor has
    // recorded but cannot yet place — a dispatch proves code the snapshot in
    // hand predates. Both are proofs nobody can point at, and reading either as
    // a standing proof invites a merge of code no check ever saw.
    const unbound = { goalCheck: "passed", goalCheckSha: null } as const;

    const open = worldWith(
      "implementation",
      pr({ checks: "success", reviews: [freshApproval()] }),
      {},
      unbound,
    );
    expect(deriveGate(issue("IMPLEMENTATION"), open)).toBeNull();
    expect(isPhaseComplete(issue("IMPLEMENTATION"), open)).toBe(false);

    // And it does not slip through one gate lower either: `awaiting_goal_check`
    // holds the merged PR open until something proves what actually landed.
    const merged = worldWith(
      "implementation",
      pr({ state: "merged", checks: "success" }),
      {},
      unbound,
    );
    expect(deriveGate(issue("IMPLEMENTATION"), merged)).toBe("awaiting_goal_check");
    expect(isPhaseComplete(issue("IMPLEMENTATION"), merged)).toBe(false);
  });

  it("does not settle a merged PR on a proof of the code before the last push", () => {
    // The gate below `awaiting_merge`, and the one that would finish the issue
    // anyway if only the merge gate learned to ask. A human pushes past the
    // proof and merges: `awaiting_goal_check` must hold that open so the check
    // is re-run against what actually landed.
    const mergedPastTheProof = worldWith(
      "implementation",
      pr({ state: "merged", checks: "success" }),
      {},
      proved("passed", "an-earlier-commit"),
    );
    expect(deriveGate(issue("IMPLEMENTATION"), mergedPastTheProof)).toBe(
      "awaiting_goal_check",
    );
    expect(isPhaseComplete(issue("IMPLEMENTATION"), mergedPastTheProof)).toBe(false);
  });

  it("still dispatches the goal check for work that reached the base unproved", () => {
    // `awaiting_goal_check` stays reachable and is not redundant: it is the
    // path for a human merging ahead of the gate, and for the assembled
    // multi-PR goal. It is the only gate that dispatches `runGoalCheck`.
    const merged = worldWith(
      "implementation",
      pr({ state: "merged", checks: "success", reviews: [freshApproval()] }),
    );
    expect(deriveGate(issue("IMPLEMENTATION"), merged)).toBe("awaiting_goal_check");
  });

  it("waits on the goal check after merge, because merging is not proof", () => {
    const w = worldWith("implementation", pr({ state: "merged", checks: "success" }));
    expect(deriveGate(issue("IMPLEMENTATION"), w)).toBe("awaiting_goal_check");
  });

  it("completes IMPLEMENTATION only on a passing goal check", () => {
    const merged = worldWith(
      "implementation",
      pr({ state: "merged", checks: "success" }),
    );
    expect(isPhaseComplete(issue("IMPLEMENTATION"), merged)).toBe(false);

    const failed = worldWith(
      "implementation",
      pr({ state: "merged", checks: "success" }),
      {},
      proved("failed"),
    );
    expect(isPhaseComplete(issue("IMPLEMENTATION"), failed)).toBe(false);

    const passed = worldWith(
      "implementation",
      pr({ state: "merged", checks: "success" }),
      {},
      proved("passed"),
    );
    expect(isPhaseComplete(issue("IMPLEMENTATION"), passed)).toBe(true);
  });
});

describe("epic gates", () => {
  it("waits on the objective approval while framing", () => {
    const w = worldWith("epic_spec", pr());
    expect(deriveGate(epic("FRAMING"), w)).toBe("awaiting_objective_approval");
  });

  it("waits on its children while they run", () => {
    const w = world({ childIssues: [{ id: "FIX-2", settled: false }] });
    expect(deriveGate(epic("ISSUES"), w)).toBe("awaiting_issues");
  });

  it("holds no gate when it has no children yet", () => {
    expect(deriveGate(epic("ISSUES"), world())).toBeNull();
    expect(isPhaseComplete(epic("ISSUES"), world())).toBe(false);
  });

  it("does not pass a set of issues through cross-spec review on its own", () => {
    // The pass is a human step conductor cannot run or observe
    // (`orchestration.md` → "Cross-spec coherence"): it is gated on the user
    // approving it, and it clears only once every alignment has landed and been
    // re-approved. The phase used to be unconditionally complete, so every
    // multi-issue epic went straight to ISSUES with the gate never asked for.
    const set = world({
      childIssues: [
        { id: "FIX-2", settled: false },
        { id: "FIX-3", settled: false },
      ],
    });
    expect(isPhaseComplete(epic("CROSS_SPEC_REVIEW"), set)).toBe(false);
    expect(deriveGate(epic("CROSS_SPEC_REVIEW"), set)).toBe("awaiting_cross_spec_review");
  });

  it("passes cross-spec review straight through for an epic holding one issue", () => {
    // One spec has nothing to be incoherent with, so there is no pass to run
    // and holding would be a stall with no work behind it.
    const single = world({ childIssues: [{ id: "FIX-2", settled: false }] });
    expect(isPhaseComplete(epic("CROSS_SPEC_REVIEW"), single)).toBe(true);
    expect(deriveGate(epic("CROSS_SPEC_REVIEW"), single)).toBeNull();
  });
});

describe("derivation is stateless", () => {
  it("returns the same gate for the same world however many times it is asked", () => {
    const w = worldWith("implementation", pr({ checks: "success" }));
    const answers = Array.from({ length: 5 }, () =>
      deriveGate(issue("IMPLEMENTATION"), w),
    );
    expect(new Set(answers).size).toBe(1);
  });

  it("never returns a gate for a terminal phase", () => {
    const w = worldWith("implementation", pr({ state: "merged" }), {}, proved("passed"));
    expect(deriveGate(issue("SETTLED"), w)).toBeNull();
    expect(nextPhase(issue("SETTLED"))).toBeNull();
  });
});

/**
 * A phase left with nowhere to go — the world half of *stuck*.
 *
 * Three clauses, and each has to be checked against the real tables rather than
 * argued for: a phase no gate **applies** to, that has not completed, and that is
 * not terminal. The runtime adds what only the ledger and the dispatch record can
 * say (`runtime/tick`'s `stalled`); everything here is a literal in and a boolean
 * out, which is what keeps the three separable.
 */
describe("a phase the world leaves nowhere to go", () => {
  it("says so when the implementation produced nothing at all", () => {
    // The shape the whole thing exists for: a dispatch settled `completed` and
    // left nothing. Every IMPLEMENTATION gate turns on a submission, so not one
    // of them applies; `completedWhen` requires an artifact, so the phase cannot
    // finish. Nothing observable will ever arrive, because there is nothing for
    // an observation to be about.
    expect(isPhaseStranded(issue("IMPLEMENTATION"), world())).toBe(true);
    expect(isPhaseStranded(issue("SPEC"), world())).toBe(true);
  });

  it("says so when the phase's artifact is somewhere no gate can read", () => {
    // The vendor really did produce something, and it is at a path rather than a
    // pull request — so it has no reviews, no approval, and no way to complete
    // the phase. A test for "does an artifact exist" calls this progress.
    const atAPath = world({
      artifacts: [
        artifact("spec", 10, { hostedAt: { type: "file", path: "spec/FIX-1.md" } }),
      ],
    });
    expect(isPhaseStranded(issue("SPEC"), atAPath)).toBe(true);
  });

  it("does not say so while a gate applies, released or not", () => {
    // Waiting is not being stuck. Both halves matter: an outstanding gate is the
    // obvious one, and a *satisfied* one is the case that separates this
    // predicate from `deriveGate(...) === null`.
    const underReview = worldWith("implementation", pr({ checks: "failure" }));
    expect(deriveGate(issue("IMPLEMENTATION"), underReview)).toBe("awaiting_ci");
    expect(isPhaseStranded(issue("IMPLEMENTATION"), underReview)).toBe(false);

    // Approved, green, and never proved. `awaiting_merge` refuses to apply on
    // unproved work and every other gate is satisfied, so the derived gate is
    // `null` — and this is the ordinary end of a review, on an open submission a
    // human can act on. Reading the derived gate here files a report on the
    // happy path of every issue whose harness reports no verdict.
    const approvedUnproved = worldWith(
      "implementation",
      pr({ checks: "success", reviews: [freshApproval()] }),
    );
    expect(deriveGate(issue("IMPLEMENTATION"), approvedUnproved)).toBeNull();
    expect(isPhaseStranded(issue("IMPLEMENTATION"), approvedUnproved)).toBe(false);
  });

  it("does not say so about a phase that has completed", () => {
    // A phase with somewhere to go is not stranded, whatever its gates say. The
    // shapes that reach this are the ones whose gates stop applying at exactly
    // the moment the phase finishes: a spec PR closed unmerged with an approval
    // standing, and an implementation hosted at no PR of its own.
    const specClosedApproved = worldWith(
      "spec",
      pr({ state: "closed", reviews: [freshApproval()] }),
    );
    expect(isPhaseComplete(issue("SPEC"), specClosedApproved)).toBe(true);
    expect(isPhaseStranded(issue("SPEC"), specClosedApproved)).toBe(false);

    const assembled = world({
      artifacts: [
        artifact("implementation", 10, {
          hostedAt: { type: "file", path: "docs/internal/assembled.md" },
        }),
      ],
      goalCheck: "passed",
      goalCheckSha: null,
    });
    expect(isPhaseComplete(issue("IMPLEMENTATION"), assembled)).toBe(true);
    expect(isPhaseStranded(issue("IMPLEMENTATION"), assembled)).toBe(false);
  });

  it("never says so about a terminal phase, which is what being finished means", () => {
    // `SETTLED` holds no gates and completes nothing — the exact shape of a
    // stranded phase one step earlier. The phase table says `next === null`, so
    // nothing has to be inferred from the absence.
    const settledWorld = worldWith(
      "implementation",
      pr({ state: "merged" }),
      {},
      proved("passed"),
    );
    expect(isPhaseStranded(issue("SETTLED"), settledWorld)).toBe(false);
    expect(isPhaseStranded(issue("SETTLED"), world())).toBe(false);
    expect(isPhaseStranded(epic("SETTLED"), world())).toBe(false);
  });

  it("does not say so about the spec PR a human merged, which a gate is holding", () => {
    // The forbidden shape has its own gate (`awaiting_spec_unmerge`), and a gate
    // that applies is the phase table still describing where the entity is. That
    // hold has its own missing ask — a `decide` branch — and this must not become
    // a second, vaguer report standing in for it.
    const merged = worldWith("spec", pr({ state: "merged" }));
    expect(isPhaseStranded(issue("SPEC"), merged)).toBe(false);
  });

  it("says so about an epic wrap whose retrospective never appeared", () => {
    // `WRAP` declares no gates at all, so "no gate applies" is trivially true
    // and its completion is the only thing standing between the epic and a
    // permanent stall.
    expect(isPhaseStranded(epic("WRAP"), world())).toBe(true);
    expect(
      isPhaseStranded(epic("WRAP"), world({ artifacts: [artifact("retrospective")] })),
    ).toBe(false);
  });
});

describe("declared reads", () => {
  it("every gate declares the facts its predicates touch", () => {
    // A phase cannot gate on a fact it did not declare — the tick only fetches
    // what `reads` names, so an undeclared fact would be silently absent.
    for (const phase of ISSUE_PHASES) {
      for (const gate of phase.gates) {
        expect(gate.reads.length).toBeGreaterThan(0);
      }
    }
  });

  it("collects a phase's reads without duplicates, so the tick fetches once", () => {
    const reads = factsReadBy("issue", "IMPLEMENTATION");
    expect(new Set(reads).size).toBe(reads.length);
    expect(reads).toContain("pr.state");
    expect(reads).toContain("goalCheck");
  });
});
