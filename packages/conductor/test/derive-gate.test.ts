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
import { epic, freshApproval, issue, pr, review, world, worldWith } from "./fixtures";

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

  it("waits on CI before review, so nobody is asked to review a red PR", () => {
    const w = worldWith("implementation", pr({ checks: "failure" }));
    expect(deriveGate(issue("IMPLEMENTATION"), w)).toBe("awaiting_ci");
  });

  it("moves to review once CI is green", () => {
    const w = worldWith("implementation", pr({ checks: "success" }));
    expect(deriveGate(issue("IMPLEMENTATION"), w)).toBe("awaiting_review");
  });

  it("waits on a human to merge once the PR is approved", () => {
    const w = worldWith(
      "implementation",
      pr({ checks: "success", reviews: [freshApproval()] }),
    );
    expect(deriveGate(issue("IMPLEMENTATION"), w)).toBe("awaiting_merge");
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
