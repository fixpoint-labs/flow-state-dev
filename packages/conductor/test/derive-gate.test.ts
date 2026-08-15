/**
 * Gate derivation — the property that makes killing the process survivable.
 *
 * Every test here hands `deriveGate` a literal world and asserts the gate. If
 * any of these needed setup, state, or a prior call, the gate would be
 * remembered rather than derived, and a restart could lose it.
 */

import { describe, expect, it } from "vitest";
import { deriveGate, isPhaseComplete, nextPhase } from "../src/driver/derive-gate";
import { factsReadBy, ISSUE_PHASES } from "../src/model/phases";
import {
  artifact,
  epic,
  freshApproval,
  issue,
  pr,
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
      { goalCheck: "passed" },
    );
    expect(deriveGate(issue("IMPLEMENTATION"), w)).toBe("awaiting_review");
  });

  it("waits on a human to merge once the PR is approved and the goal is proved", () => {
    const w = worldWith(
      "implementation",
      pr({ checks: "success", reviews: [freshApproval()] }),
      {},
      { goalCheck: "passed" },
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
      { goalCheck: "passed" },
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
    const proved = world({ goalCheck: "passed" });
    expect(isPhaseComplete(issue("IMPLEMENTATION"), proved)).toBe(false);
    expect(deriveGate(issue("IMPLEMENTATION"), proved)).toBeNull();
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
      goalCheck: "passed",
    });
    expect(isPhaseComplete(issue("IMPLEMENTATION"), noPrOfItsOwn)).toBe(true);
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
      { goalCheck: "failed" },
    );
    expect(isPhaseComplete(issue("IMPLEMENTATION"), failed)).toBe(false);

    const passed = worldWith(
      "implementation",
      pr({ state: "merged", checks: "success" }),
      {},
      { goalCheck: "passed" },
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
    const w = worldWith("implementation", pr({ state: "merged" }), {}, {
      goalCheck: "passed",
    });
    expect(deriveGate(issue("SETTLED"), w)).toBeNull();
    expect(nextPhase(issue("SETTLED"))).toBeNull();
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
