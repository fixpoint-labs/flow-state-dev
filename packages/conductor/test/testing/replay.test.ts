/**
 * The replay harness against the realistic end-to-end path.
 *
 * This is the test the whole dispatch layer exists to make possible: one issue
 * from a blank slate to `SETTLED`, asserted on the sequence of actions and the
 * sequence of dispatches, with no repository, no PR, and no vendor. If the
 * process changes, this test changes — which is the point. It cannot pass on a
 * driver that skips a phase, drops a dispatch, or advances on the wrong signal.
 */

import { describe, expect, it } from "vitest";
import type { Action } from "../../src/model/actions";
import { fakeDispatcher } from "../../src/testing/fake";
import { replay } from "../../src/testing/replay";
import { issue } from "../fixtures";
import { EMPTY_WORLD, LIFECYCLE_STEPS, UNPROVED_MERGE_STEPS } from "./fixtures";

const script = (overrides: Partial<Parameters<typeof replay>[0]> = {}) => ({
  entity: issue("SPEC"),
  world: EMPTY_WORLD,
  steps: LIFECYCLE_STEPS,
  ...overrides,
});

describe("one issue, end to end", () => {
  it("reaches SETTLED — the phase progression is driven entirely by signals, never set directly", async () => {
    const result = await replay(script());
    expect(result.entity.phase).toBe("SETTLED");

    const phases = result.actions
      .filter((a): a is Extract<Action, { kind: "enterPhase" }> => a.kind === "enterPhase")
      .map((a) => a.phase);
    expect(phases).toEqual(["IMPLEMENTATION", "SETTLED"]);
  });

  it("dispatches exactly the work each phase and gate calls for, in order", async () => {
    const dispatcher = fakeDispatcher();
    await replay(script({ dispatcher }));

    expect(dispatcher.actionsRun()).toEqual([
      "draftSpec", // entering SPEC
      "reviseSpec", // a feedback round on the spec PR
      "implement", // entering IMPLEMENTATION on approval
      "addressFeedback", // CI went red
      // One `runGoalCheck`, and only after the merge. The branch proof taken at
      // implementation completion is what opened the merge gate — conductor
      // never invited a merge it had not proved — but it says nothing about what
      // *landed*, so the issue owes exactly one more check and gets it.
      "runGoalCheck",
    ]);
  });

  it("records every human gate release, so each transition a human drove is reproducible", async () => {
    // Both approvals are gate releases: one lets the spec through, one opens
    // the merge gate. The second does not complete its phase — IMPLEMENTATION
    // ends on the merge — and a ledger that only recorded phase-completing
    // approvals would have no trace of the human who released `awaiting_review`.
    const result = await replay(script());
    const approvals = result.actions.filter((a) => a.kind === "recordApproval");
    expect(approvals).toEqual([
      {
        kind: "recordApproval",
        entityId: "FIX-1",
        gate: "awaiting_spec_approval",
        reviewer: "alice",
        sha: "spec-sha-2",
      },
      {
        kind: "recordApproval",
        entityId: "FIX-1",
        gate: "awaiting_review",
        reviewer: "alice",
        sha: "impl-sha-2",
      },
    ]);
  });

  it("never escalates on the happy path — every step between the human gates moves without asking", async () => {
    const result = await replay(script());
    expect(result.actions.filter((a) => a.kind === "escalate")).toEqual([]);
  });

  it("waits at awaiting_merge instead of merging — the merge gate belongs to a human", async () => {
    const result = await replay(script());
    const atMerge = result.records.filter((r) => r.gate === "awaiting_merge");
    expect(atMerge.length).toBeGreaterThan(0);
    // Writing the human's approval into the ledger is allowed here. Doing
    // anything *to* the PR is not: no dispatch, no phase move, and above all no
    // merge — this gate is released by a human or not at all.
    const actedOn = atMerge.flatMap((r) => r.actions).filter((a) => a.kind !== "recordApproval");
    expect(actedOn).toEqual([]);
  });

  it("ignores the spec PR closing after implementation started — a late signal on another PR is not this phase's", async () => {
    const result = await replay(script());
    const closed = result.records.find((r) => r.signal === "pr_closed");
    expect(closed?.phaseBefore).toBe("IMPLEMENTATION");
    // Unscoped, `pr_closed` escalates. Scoped to the phase's own PR, it is inert.
    expect(closed?.actions).toEqual([]);
  });

  it("walks the gates in process order as the world moves", async () => {
    const result = await replay(script());
    const gates = result.records
      .filter((r) => !r.derived)
      .map((r) => r.gate);
    // `null` is ambiguous by design: it means either nothing has been produced
    // yet, or every gate is released and the phase is about to advance. Both
    // appear here, at the start and at each completing signal.
    expect(gates).toEqual([
      null, // nothing exists yet
      "awaiting_spec_review",
      "awaiting_spec_review",
      null, // the approval is already in the world — SPEC is complete
      "awaiting_review", // impl PR open, no checks reported yet
      "awaiting_review",
      "awaiting_ci", // CI reported red
      "awaiting_review", // CI green, no fresh approval yet
      "awaiting_merge", // approved *and* the branch proved; conductor waits
      "awaiting_goal_check", // merged — what landed has not been proved yet
      null, // proved on the base, so IMPLEMENTATION is complete
    ]);
  });
});

describe("one issue whose goal was never proved before the merge", () => {
  const unproved = () =>
    replay({
      entity: issue("IMPLEMENTATION"),
      world: EMPTY_WORLD,
      steps: UNPROVED_MERGE_STEPS,
    });

  it("never invites the merge, because it has nothing proving the work", async () => {
    // The whole point of the merge gate holding back. An approved, green PR
    // used to derive `awaiting_merge` on the approval alone — conductor
    // announcing "ready to merge" for a change nothing had verified.
    const result = await unproved();
    expect(result.records.filter((r) => r.gate === "awaiting_merge")).toEqual([]);
  });

  it("still runs the goal check when a human merges anyway, and settles only on its pass", async () => {
    // `awaiting_goal_check` stays reachable and load-bearing: it is the path
    // for a human merging ahead of the gate, and for the assembled multi-PR
    // goal once sub-PRs become nested tasks.
    const dispatcher = fakeDispatcher();
    const result = await replay({
      entity: issue("IMPLEMENTATION"),
      world: EMPTY_WORLD,
      steps: UNPROVED_MERGE_STEPS,
      dispatcher,
    });

    expect(dispatcher.actionsRun()).toEqual(["runGoalCheck"]);
    expect(result.records.map((r) => r.gate)).toContain("awaiting_goal_check");
    expect(result.entity.phase).toBe("SETTLED");
  });

  it("does not settle on the merge itself — merging is not proof", async () => {
    const result = await unproved();
    const merged = result.records.find((r) => r.signal === "merged");
    expect(merged?.phaseAfter).toBe("IMPLEMENTATION");
  });
});

describe("the briefs a dispatch carries", () => {
  it("puts spec work on the spec branch and implementation work on the fix branch", async () => {
    const dispatcher = fakeDispatcher();
    await replay(script({ dispatcher }));
    const byAction = new Map(dispatcher.briefs.map((b) => [b.action, b]));
    expect(byAction.get("draftSpec")?.branch).toBe("spec/FIX-1");
    expect(byAction.get("reviseSpec")?.branch).toBe("spec/FIX-1");
    expect(byAction.get("implement")?.branch).toBe("fix/FIX-1");
    expect(byAction.get("addressFeedback")?.branch).toBe("fix/FIX-1");
  });

  it("carries the reason from the action, so the harness knows why it was woken", async () => {
    const dispatcher = fakeDispatcher();
    await replay(script({ dispatcher }));
    const ci = dispatcher.briefs.find((b) => b.action === "addressFeedback");
    expect(ci?.because).toContain("CI failed on impl-sha-1");
  });

  it("points a worktree dispatcher at the entity's own tree and a remote one at nothing", async () => {
    const local = fakeDispatcher({ isolation: "worktree" });
    await replay(script({ dispatcher: local, repoRoot: "/work" }));
    expect(local.briefs[0]?.workspacePath).toBe("/work/.conductor/worktrees/FIX-1");

    const remote = fakeDispatcher({ isolation: "remote" });
    await replay(script({ dispatcher: remote }));
    expect(remote.briefs[0]?.workspacePath).toBeNull();
  });

  it("passes the configured guidance paths through unchanged", async () => {
    const dispatcher = fakeDispatcher();
    await replay(script({ dispatcher, guidancePaths: ["AGENTS.md"] }));
    expect(dispatcher.briefs[0]?.guidancePaths).toEqual(["AGENTS.md"]);
  });
});

describe("when a dispatch fails", () => {
  it("escalates instead of retrying — a harness that broke needs a human, not another turn", async () => {
    const dispatcher = fakeDispatcher({
      results: [{ outcome: "failed", error: "context window exceeded" }],
    });
    const result = await replay(
      script({
        dispatcher,
        steps: [LIFECYCLE_STEPS[0]!],
      }),
    );

    expect(dispatcher.actionsRun()).toEqual(["draftSpec"]);
    expect(result.actions.map((a) => a.kind)).toEqual(["draftSpec", "escalate"]);
  });

  it("leaves the phase where it was — a failed dispatch is not progress", async () => {
    const dispatcher = fakeDispatcher({ results: [{ outcome: "failed" }] });
    const result = await replay(script({ dispatcher, steps: [LIFECYCLE_STEPS[0]!] }));
    expect(result.entity.phase).toBe("SPEC");
  });
});

describe("the fake dispatcher", () => {
  it("records every brief it was handed, which is what makes the loop assertable", async () => {
    const dispatcher = fakeDispatcher();
    await replay(script({ dispatcher }));
    // Five, matching the lifecycle's dispatches above — the four coding runs and
    // the one post-merge `runGoalCheck` that proves what landed.
    expect(dispatcher.briefs).toHaveLength(5);
    expect(dispatcher.results).toHaveLength(5);
    expect(dispatcher.results.map((r) => r.dispatchId)).toEqual(
      dispatcher.briefs.map((b) => b.dispatchId),
    );
  });

  it("completes past the end of its script, so a test scripts only the runs it cares about", async () => {
    const dispatcher = fakeDispatcher({ results: [{ costUsd: 0.5 }] });
    await replay(script({ dispatcher }));
    expect(dispatcher.results[0]?.costUsd).toBe(0.5);
    expect(dispatcher.results[1]?.outcome).toBe("completed");
    expect(dispatcher.results[1]?.costUsd).toBeNull();
  });
});
