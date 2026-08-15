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
import { deriveGate } from "../src/driver/derive-gate";
import type { Action } from "../src/model/actions";
import { EPIC_PHASES, ISSUE_PHASES } from "../src/model/phases";
import type { Signal } from "../src/model/signals";
import { DEFAULT_POLICY } from "../src/model/world";
import {
  ENTITY_ID,
  HEAD,
  SIGNAL_AT as AT,
  SIGNAL_KINDS as ISSUE_SIGNAL_KINDS,
  epic,
  freshApproval,
  issue,
  pr,
  review,
  signal,
  world,
  worldWith,
} from "./fixtures";

const kinds = (actions: Action[]) => actions.map((a) => a.kind);

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

  describe("and once review has started, a red base is still not our failure", () => {
    /**
     * The PR is under review with no aggregate check conclusion at its head, so
     * `awaiting_ci` does not apply and the entity is gated on `awaiting_review`
     * — the gate whose handling also has to answer a CI failure. Whether the
     * base broke before review or during it changes nothing about whose
     * breakage it is, so the suppression has to hold on both paths.
     */
    const underReview = (baseRed: boolean) =>
      worldWith("implementation", pr({ checks: null, baseRed, reviews: [review()] }));

    it("suppresses the dispatch while the base is broken, and waits for base_recovered", () => {
      const w = underReview(true);
      expect(deriveGate(issue("IMPLEMENTATION"), w)).toBe("awaiting_review");
      expect(decide(issue("IMPLEMENTATION"), signal("ci_concluded"), w)).toEqual([]);

      // Suppressed, not dropped: the recovery signal is what resumes the work.
      expect(kinds(decide(issue("IMPLEMENTATION"), signal("base_recovered"), w))).toEqual([
        "rebaseOnBase",
      ]);
    });

    it("still addresses the failure when the base is green — the guard suppresses nothing else", () => {
      const w = underReview(false);
      expect(deriveGate(issue("IMPLEMENTATION"), w)).toBe("awaiting_review");
      expect(kinds(decide(issue("IMPLEMENTATION"), signal("ci_concluded"), w))).toEqual([
        "addressFeedback",
      ]);
    });

    it("declares pr.baseStatus on the gate whose branch reads it, not just on its neighbour", () => {
      // The guard is only alive if the tick materializes `baseRed`, and the
      // tick materializes strictly what the gates declare. `awaiting_ci`
      // declaring it today is not this gate's guarantee.
      const gate = ISSUE_PHASES.find((p) => p.name === "IMPLEMENTATION")?.gates.find(
        (g) => g.name === "awaiting_review",
      );
      expect(gate?.reads).toContain("pr.baseStatus");
    });
  });
});

describe("recording the gate releases a human owns", () => {
  /** A world holding both PRs: the approved spec, and the implementation. */
  const bothPrs = (implOverrides: Partial<ReturnType<typeof pr>> = {}) =>
    world({
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
        10: pr({ number: 10, state: "closed", reviews: [freshApproval()] }),
        11: pr({ number: 11, checks: "success", ...implOverrides }),
      },
    });

  it("records the approval that opens the merge gate, even though the phase runs on past it", () => {
    // IMPLEMENTATION completes on the goal check, not on approval. Recording
    // only on the completing path would leave the ledger with the spec approval
    // and no trace of the human who released `awaiting_review` — a real state
    // change, driven by a human decision, that could not be replayed.
    const w = worldWith(
      "implementation",
      pr({ checks: "success", reviews: [freshApproval()] }),
    );
    expect(decide(issue("IMPLEMENTATION"), signal("approved"), w)).toEqual([
      {
        kind: "recordApproval",
        entityId: ENTITY_ID,
        gate: "awaiting_review",
        reviewer: "alice",
        sha: HEAD,
      },
    ]);
  });

  it("records the approval even while CI is red, because the human decided when they decided", () => {
    // The entity is still gated on `awaiting_ci`, so nothing advances — but the
    // approval happened, and a ledger that only records approvals on a green PR
    // cannot replay the order the two arrived in.
    const w = worldWith(
      "implementation",
      pr({ checks: "failure", reviews: [freshApproval()] }),
    );
    const actions = decide(issue("IMPLEMENTATION"), signal("approved"), w);
    expect(actions).toMatchObject([{ kind: "recordApproval", gate: "awaiting_review" }]);
  });

  it("records the approval exactly once when it also completes the phase", () => {
    // The completing path and the gate-release path are the same approval. Two
    // entries in the ledger would replay as two approvals by two reviewers.
    const w = worldWith("spec", pr({ reviews: [freshApproval()] }));
    const actions = decide(issue("SPEC"), signal("approved"), w);
    expect(kinds(actions)).toEqual(["recordApproval", "enterPhase"]);
    expect(actions[0]).toMatchObject({ gate: "awaiting_spec_approval" });
  });

  it("records nothing for a stale approval on the implementation PR — a push invalidates it", () => {
    const w = worldWith(
      "implementation",
      pr({ headSha: "sha-new", checks: "success", reviews: [freshApproval("sha-old")] }),
    );
    expect(decide(issue("IMPLEMENTATION"), signal("approved", { sha: "sha-old" }), w)).toEqual(
      [],
    );
  });

  it("records nothing for a bot approval on the implementation PR — no gate moved", () => {
    const w = worldWith(
      "implementation",
      pr({ checks: "success", reviews: [review({ state: "APPROVED", isHuman: false })] }),
    );
    expect(decide(issue("IMPLEMENTATION"), signal("approved"), w)).toEqual([]);
  });

  it("records nothing for an approval on the spec PR while the issue is implementing", () => {
    // Crediting a spec-PR approval to the merge gate would put a release in the
    // ledger that no human ever gave for this artifact.
    const w = bothPrs();
    expect(
      decide(issue("IMPLEMENTATION"), signal("approved", { pullNumber: 10 }), w),
    ).toEqual([]);
  });

  it("records the same single entry when the approval arrives twice", () => {
    // Duplicate delivery is normal. The ledger entry is derived from the world,
    // not from how many times the signal was seen.
    const w = bothPrs({ reviews: [freshApproval()] });
    const first = decide(issue("IMPLEMENTATION"), signal("approved", { pullNumber: 11 }), w);
    const second = decide(issue("IMPLEMENTATION"), signal("approved", { pullNumber: 11 }), w);
    expect(kinds(first)).toEqual(["recordApproval"]);
    expect(second).toEqual(first);
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
