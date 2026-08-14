/**
 * `decide` — the phase × gate × signal matrix, the named edge paths, and the
 * guard rails that keep a model's judgment out of a transition.
 *
 * Each test states the *reason* the behaviour matters, not just the mapping.
 * A test that would still pass if the process changed underneath it is not
 * testing the process.
 */

import { describe, expect, it } from "vitest";
import { decide } from "../src/driver/decide";
import type { Action } from "../src/model/actions";
import { EPIC_PHASES, ISSUE_PHASES } from "../src/model/phases";
import type { Signal, SignalKind } from "../src/model/signals";
import { DEFAULT_POLICY } from "../src/model/world";
import {
  ENTITY_ID,
  HEAD,
  epic,
  freshApproval,
  issue,
  pr,
  review,
  world,
  worldWith,
} from "./fixtures";

const AT = "2026-08-14T12:00:00Z";

const kinds = (actions: Action[]) => actions.map((a) => a.kind);

/** Build a signal with the right payload shape for its kind. */
function signal(kind: SignalKind, overrides: Record<string, unknown> = {}): Signal {
  const base = { entityId: ENTITY_ID, at: AT };
  const payloads: Partial<Record<SignalKind, Record<string, unknown>>> = {
    pr_opened: { pullNumber: 10 },
    merged: { pullNumber: 10 },
    pr_closed: { pullNumber: 10 },
    merge_conflict: { pullNumber: 10 },
    base_recovered: { pullNumber: 10 },
    review_submitted: { reviewer: "alice", sha: HEAD, pullNumber: 10 },
    changes_requested: { reviewer: "alice", sha: HEAD, pullNumber: 10 },
    approved: { reviewer: "alice", sha: HEAD, pullNumber: 10 },
    ci_concluded: { conclusion: "failure", sha: HEAD },
    feedback_received: { author: "alice", commentId: "c1", pullNumber: 10 },
    question_asked: { author: "alice", commentId: "c1", pullNumber: 10 },
    approval_expressed: { author: "alice", commentId: "c1", pullNumber: 10 },
    dispatch_completed: { dispatchId: "d1" },
    dispatch_failed: { dispatchId: "d1" },
    guidance_changed: { path: "docs/philosophy.md" },
    issue_settled: { childId: "FIX-2" },
  };
  return { kind, ...base, ...payloads[kind], ...overrides } as Signal;
}

describe("the decide table", () => {
  it("drafts the spec when an issue enters SPEC — a phase's entry work is the phase's job", () => {
    const actions = decide(issue("SPEC"), signal("phase_entered"), world());
    expect(kinds(actions)).toEqual(["draftSpec"]);
  });

  it("revises the spec on review feedback, because feedback below budget is ordinary work", () => {
    const w = worldWith("spec", pr({ reviews: [review()] }));
    const actions = decide(issue("SPEC"), signal("feedback_received"), w);
    expect(kinds(actions)).toEqual(["reviseSpec"]);
  });

  it("answers a question without touching the spec — a question is not feedback", () => {
    const w = worldWith("spec", pr({ reviews: [review()] }));
    const actions = decide(issue("SPEC"), signal("question_asked"), w);
    expect(kinds(actions)).toEqual(["answerQuestion"]);
  });

  it("records the approval and advances to IMPLEMENTATION on a fresh human approval", () => {
    const w = worldWith("spec", pr({ reviews: [freshApproval()] }));
    const actions = decide(issue("SPEC"), signal("approved"), w);
    expect(kinds(actions)).toEqual(["recordApproval", "enterPhase"]);
    expect(actions[1]).toMatchObject({ kind: "enterPhase", phase: "IMPLEMENTATION" });
  });

  it("addresses CI failure while awaiting CI", () => {
    const w = worldWith("implementation", pr({ checks: "failure" }));
    const actions = decide(issue("IMPLEMENTATION"), signal("ci_concluded"), w);
    expect(kinds(actions)).toEqual(["addressFeedback"]);
  });

  it("addresses changes requested on the implementation PR", () => {
    const w = worldWith(
      "implementation",
      pr({ checks: "success", reviews: [review({ state: "CHANGES_REQUESTED" })] }),
    );
    const actions = decide(issue("IMPLEMENTATION"), signal("changes_requested"), w);
    expect(kinds(actions)).toEqual(["addressFeedback"]);
  });

  it("resolves a merge conflict", () => {
    const w = worldWith("implementation", pr({ checks: "success", mergeable: false }));
    const actions = decide(issue("IMPLEMENTATION"), signal("merge_conflict"), w);
    expect(kinds(actions)).toEqual(["resolveConflict"]);
  });

  it("rebases when the base branch recovers", () => {
    const w = worldWith("implementation", pr({ checks: "failure", baseRed: false }));
    const actions = decide(issue("IMPLEMENTATION"), signal("base_recovered"), w);
    expect(kinds(actions)).toEqual(["rebaseOnBase"]);
  });

  it("runs the goal check once the PR merges — merging is the trigger, not the finish", () => {
    const w = worldWith("implementation", pr({ state: "merged", checks: "success" }));
    const actions = decide(issue("IMPLEMENTATION"), signal("merged"), w);
    expect(kinds(actions)).toEqual(["runGoalCheck"]);
  });

  it("settles the issue only when the goal check passes on the real path", () => {
    const w = worldWith(
      "implementation",
      pr({ state: "merged", checks: "success" }),
      {},
      { goalCheck: "passed" },
    );
    const actions = decide(issue("IMPLEMENTATION"), signal("goal_check_passed"), w);
    expect(actions).toEqual([
      { kind: "enterPhase", entityId: ENTITY_ID, phase: "SETTLED" },
    ]);
  });

  it("retrospects and polishes docs when an epic enters WRAP", () => {
    const actions = decide(epic("WRAP"), signal("phase_entered"), world());
    expect(kinds(actions)).toEqual(["retrospect", "polishDocs"]);
  });

  it("advances an epic to WRAP only when every child issue has settled", () => {
    const partial = world({
      childIssues: [
        { id: "FIX-2", settled: true },
        { id: "FIX-3", settled: false },
      ],
    });
    expect(decide(epic("ISSUES"), signal("issue_settled"), partial)).toEqual([]);

    const complete = world({
      childIssues: [
        { id: "FIX-2", settled: true },
        { id: "FIX-3", settled: true },
      ],
    });
    expect(decide(epic("ISSUES"), signal("issue_settled"), complete)).toEqual([
      { kind: "enterPhase", entityId: ENTITY_ID, phase: "WRAP" },
    ]);
  });

  it("reacts to changed guidance only when the policy configures a reaction", () => {
    const inert = worldWith("implementation", pr());
    expect(decide(issue("IMPLEMENTATION"), signal("guidance_changed"), inert)).toEqual([]);

    const reactive = worldWith(
      "implementation",
      pr(),
      {},
      { policy: { ...DEFAULT_POLICY, onGuidanceChanged: "reExamineOpenPrs" } },
    );
    expect(
      kinds(decide(issue("IMPLEMENTATION"), signal("guidance_changed"), reactive)),
    ).toEqual(["reExamineOpenPrs"]);
  });
});

describe("keeping judgment out of the transition", () => {
  it("never advances a gate on prose approval, however confident the classifier is", () => {
    // "lgtm, ship it" is a model's reading of a comment. A gate reads a review.
    const w = worldWith("spec", pr({ reviews: [review()] }));
    expect(decide(issue("SPEC"), signal("approval_expressed"), w)).toEqual([]);
  });

  it("does not treat a stale approval as approval — a push invalidates the review", () => {
    const w = worldWith(
      "spec",
      pr({ headSha: "sha-new", reviews: [freshApproval("sha-old")] }),
    );
    const actions = decide(issue("SPEC"), signal("approved", { sha: "sha-old" }), w);
    expect(actions).toEqual([]);
  });

  it("does not let a bot approval satisfy a human gate", () => {
    const w = worldWith(
      "spec",
      pr({ reviews: [review({ state: "APPROVED", isHuman: false })] }),
    );
    expect(decide(issue("SPEC"), signal("approved"), w)).toEqual([]);
  });

  it("never emits a merge — the merge gate is released by a human, always", () => {
    const w = worldWith(
      "implementation",
      pr({ checks: "success", reviews: [freshApproval()] }),
    );
    const everySignal = ISSUE_SIGNAL_KINDS.flatMap((k) =>
      decide(issue("IMPLEMENTATION"), signal(k), w),
    );
    expect(everySignal.map((a) => a.kind)).not.toContain("merge");
  });

  it("ignores a red base rather than dispatching an agent to chase someone else's break", () => {
    const w = worldWith("implementation", pr({ checks: "failure", baseRed: true }));
    expect(decide(issue("IMPLEMENTATION"), signal("ci_concluded"), w)).toEqual([]);
  });
});

describe("review-round budgets", () => {
  it("escalates instead of revising once the spec budget is spent", () => {
    const w = worldWith(
      "spec",
      pr({ reviews: [review()] }),
      { reviewRounds: DEFAULT_POLICY.specReviewRoundBudget },
    );
    const actions = decide(issue("SPEC"), signal("feedback_received"), w);
    expect(kinds(actions)).toEqual(["escalate"]);
    expect(actions[0]).toMatchObject({
      reason: expect.stringContaining("approach may need re-examining"),
    });
  });

  it("keeps revising while the budget has room", () => {
    const w = worldWith("spec", pr({ reviews: [review()] }), { reviewRounds: 1 });
    expect(kinds(decide(issue("SPEC"), signal("feedback_received"), w))).toEqual([
      "reviseSpec",
    ]);
  });

  it("gives the implementation PR its own, larger budget than a spec", () => {
    const w = worldWith(
      "implementation",
      pr({ checks: "success", reviews: [review({ state: "CHANGES_REQUESTED" })] }),
      { reviewRounds: DEFAULT_POLICY.specReviewRoundBudget },
    );
    // Spent for a spec, nowhere near spent for an implementation.
    expect(kinds(decide(issue("IMPLEMENTATION"), signal("changes_requested"), w))).toEqual(
      ["addressFeedback"],
    );
  });
});

/** Every signal kind, for totality sweeps. */
const ISSUE_SIGNAL_KINDS: SignalKind[] = [
  "pr_opened",
  "review_submitted",
  "changes_requested",
  "approved",
  "ci_concluded",
  "merge_conflict",
  "base_recovered",
  "merged",
  "pr_closed",
  "feedback_received",
  "question_asked",
  "approval_expressed",
  "phase_entered",
  "dispatch_completed",
  "dispatch_failed",
  "goal_check_passed",
  "goal_check_failed",
  "guidance_changed",
  "external_status_changed",
  "objective_approved",
  "issue_settled",
];

describe("the full phase × gate × signal matrix is total", () => {
  const worlds = [
    ["no artifact yet", world()],
    ["spec PR open, unreviewed", worldWith("spec", pr())],
    ["spec PR reviewed", worldWith("spec", pr({ reviews: [review()] }))],
    ["spec PR approved", worldWith("spec", pr({ reviews: [freshApproval()] }))],
    ["impl PR, CI red", worldWith("implementation", pr({ checks: "failure" }))],
    ["impl PR, CI green", worldWith("implementation", pr({ checks: "success" }))],
    [
      "impl PR approved",
      worldWith("implementation", pr({ checks: "success", reviews: [freshApproval()] })),
    ],
    [
      "impl PR merged",
      worldWith("implementation", pr({ state: "merged", checks: "success" })),
    ],
  ] as const;

  const phases = [
    ...ISSUE_PHASES.map((p) => ["issue", p.name] as const),
    ...EPIC_PHASES.map((p) => ["epic", p.name] as const),
  ];

  it("returns an action list for every cell and never throws", () => {
    let cells = 0;
    for (const [kind, phase] of phases) {
      for (const [, w] of worlds) {
        for (const signalKind of ISSUE_SIGNAL_KINDS) {
          const entity = kind === "issue" ? issue(phase) : epic(phase);
          const actions = decide(entity, signal(signalKind), w);
          expect(Array.isArray(actions)).toBe(true);
          cells += 1;
        }
      }
    }
    // 8 phases × 8 worlds × 21 signals — the matrix M0 claims to cover.
    expect(cells).toBe(phases.length * worlds.length * ISSUE_SIGNAL_KINDS.length);
  });

  it("only ever emits actions addressed to the entity being decided", () => {
    for (const [kind, phase] of phases) {
      for (const [, w] of worlds) {
        for (const signalKind of ISSUE_SIGNAL_KINDS) {
          const entity = kind === "issue" ? issue(phase) : epic(phase);
          for (const action of decide(entity, signal(signalKind), w)) {
            expect(action.entityId).toBe(entity.id);
          }
        }
      }
    }
  });
});

describe("the five edge paths the current harness drops", () => {
  it("restart mid-gate: the same world re-derives the same answer, with nothing remembered", () => {
    // Nothing is carried between these two calls but the stored phase — which
    // is exactly what survives a process kill.
    const w = worldWith("spec", pr({ reviews: [review()] }));
    const before = decide(issue("SPEC"), signal("feedback_received"), w);
    const afterRestart = decide(issue("SPEC"), signal("feedback_received"), w);
    expect(afterRestart).toEqual(before);
  });

  it("duplicate signal: reducing the same signal twice yields the same actions", () => {
    const w = worldWith("spec", pr({ reviews: [freshApproval()] }));
    const first = decide(issue("SPEC"), signal("approved"), w);
    const second = decide(issue("SPEC"), signal("approved"), w);
    expect(second).toEqual(first);
  });

  it("out-of-order signal: a late CI result against a merged PR advances nothing", () => {
    const w = worldWith(
      "implementation",
      pr({ state: "merged", checks: "success" }),
      {},
      { goalCheck: "passed" },
    );
    // The issue has settled; CI reporting late must not reopen it.
    expect(decide(issue("SETTLED"), signal("ci_concluded"), w)).toEqual([]);
  });

  it("backwards phase move: late feedback on the spec PR does not touch the implementation", () => {
    // An issue in IMPLEMENTATION still has its spec PR sitting there, and
    // someone can always comment on it. `changes_requested` IS handled under
    // `awaiting_review`, so without PR scoping this dispatches an agent to
    // rework the implementation because of a comment on the spec.
    const w = world({
      artifacts: [
        { id: "a-spec", kind: "spec", hostedAt: { type: "pr", number: 10 }, reviewRounds: 1 },
        {
          id: "a-impl",
          kind: "implementation",
          hostedAt: { type: "pr", number: 11 },
          reviewRounds: 0,
        },
      ],
      pullRequests: {
        10: pr({ number: 10, reviews: [review({ state: "CHANGES_REQUESTED" })] }),
        11: pr({ number: 11, checks: "success" }),
      },
    });

    // On the spec PR: ignored, because that is not what this phase is reviewing.
    expect(
      decide(issue("IMPLEMENTATION"), signal("changes_requested", { pullNumber: 10 }), w),
    ).toEqual([]);

    // The same signal on the implementation PR is real work.
    expect(
      kinds(
        decide(issue("IMPLEMENTATION"), signal("changes_requested", { pullNumber: 11 }), w),
      ),
    ).toEqual(["addressFeedback"]);
  });

  it("backwards phase move: a foreign approval cannot complete a phase it is not about", () => {
    // The spec PR genuinely is approved, so the phase IS complete — but this
    // particular signal came from elsewhere, and crediting the approval to the
    // wrong reviewer and SHA would put a false record in the ledger.
    const w = world({
      artifacts: [
        { id: "a-spec", kind: "spec", hostedAt: { type: "pr", number: 10 }, reviewRounds: 1 },
      ],
      pullRequests: {
        10: pr({ number: 10, reviews: [freshApproval()] }),
        99: pr({ number: 99, reviews: [freshApproval()] }),
      },
    });
    expect(
      decide(issue("SPEC"), signal("approved", { pullNumber: 99, reviewer: "mallory" }), w),
    ).toEqual([]);

    // The approval on the PR this phase owns advances it, crediting the right reviewer.
    const actions = decide(issue("SPEC"), signal("approved", { pullNumber: 10 }), w);
    expect(kinds(actions)).toEqual(["recordApproval", "enterPhase"]);
    expect(actions[0]).toMatchObject({ reviewer: "alice" });
  });

  it("unknown signal: an unrecognized kind is inert rather than fatal", () => {
    const w = worldWith("spec", pr());
    const bogus = { kind: "not_a_real_signal", entityId: ENTITY_ID, at: AT } as unknown as Signal;
    expect(() => decide(issue("SPEC"), bogus, w)).not.toThrow();
    expect(decide(issue("SPEC"), bogus, w)).toEqual([]);
  });

  it("a phase that does not belong to the entity kind degrades instead of crashing", () => {
    // A hand-edited or partially-migrated ledger must not take the tick down.
    const w = worldWith("spec", pr());
    expect(decide(epic("SPEC"), signal("phase_entered"), w)).toEqual([]);
  });

  it("a signal addressed to another entity is ignored", () => {
    const w = worldWith("spec", pr({ reviews: [review()] }));
    const other = signal("feedback_received", { entityId: "FIX-999" });
    expect(decide(issue("SPEC"), other, w)).toEqual([]);
  });
});

describe("escalation", () => {
  it("escalates when a dispatch exhausts its attempts", () => {
    const actions = decide(issue("SPEC"), signal("dispatch_failed"), worldWith("spec", pr()));
    expect(kinds(actions)).toEqual(["escalate"]);
  });

  it("escalates when a PR is closed without merging — that is a human's decision", () => {
    const w = worldWith("implementation", pr({ state: "closed" }));
    expect(kinds(decide(issue("IMPLEMENTATION"), signal("pr_closed"), w))).toEqual([
      "escalate",
    ]);
  });

  it("escalates a goal check that fails after merge, because there is no PR left to fix", () => {
    const w = worldWith(
      "implementation",
      pr({ state: "merged", checks: "success" }),
      {},
      { goalCheck: "failed" },
    );
    const actions = decide(issue("IMPLEMENTATION"), signal("goal_check_failed"), w);
    expect(kinds(actions)).toEqual(["escalate"]);
  });
});
