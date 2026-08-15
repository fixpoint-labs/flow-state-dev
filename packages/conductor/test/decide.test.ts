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
import { deriveGate, isPhaseComplete } from "../src/driver/derive-gate";
import { reconcile } from "../src/driver/reconcile";
import type { Action } from "../src/model/actions";
import { EPIC_PHASES, ISSUE_PHASES, factsReadBy } from "../src/model/phases";
import type { Signal } from "../src/model/signals";
import { DEFAULT_POLICY } from "../src/model/world";
import {
  ENTITY_ID,
  HEAD,
  SIGNAL_AT as AT,
  SIGNAL_KINDS as ISSUE_SIGNAL_KINDS,
  artifact,
  epic,
  freshApproval,
  issue,
  pr,
  proved,
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

  it("does not settle an issue on its own PR opening, goal already proved or not", () => {
    // A single-PR issue proves its goal at implementation completion, *before*
    // the PR opens, so `goalCheck` is `passed` while the PR sits open and
    // unreviewed. Completing the phase on the goal check alone reduced this
    // exact signal to `enterPhase SETTLED`: the issue finished before CI ran,
    // before anyone reviewed it, and before anyone merged it.
    const w = worldWith(
      "implementation",
      pr({ checks: "success" }),
      {},
      proved("passed"),
    );
    expect(decide(issue("IMPLEMENTATION"), signal("pr_opened"), w)).toEqual([]);
  });

  it("settles the issue only when the goal check passes on the real path", () => {
    const w = worldWith(
      "implementation",
      pr({ state: "merged", checks: "success" }),
      {},
      proved("passed"),
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

  it("credits the approval that actually released the gate, not the signal that happened to arrive", () => {
    // Alice approved at the head and that is what opened `awaiting_review`. Bob's
    // approval against an older SHA arrives late and releases nothing — it is
    // already stale by the time it is reduced. Taking the gate from the world and
    // the reviewer from the signal is two sources of truth for one fact, and the
    // ledger would name Bob at a SHA nobody approved: a row asserting a human
    // release that never happened, on the one transition a human actually
    // authorized.
    const w = worldWith(
      "implementation",
      pr({
        checks: "success",
        reviews: [
          freshApproval(),
          review({ id: "rev-bob", reviewer: "bob", state: "APPROVED", sha: "sha-old" }),
        ],
      }),
    );
    expect(
      decide(issue("IMPLEMENTATION"), signal("approved", { reviewer: "bob", sha: "sha-old" }), w),
    ).toEqual([
      {
        kind: "recordApproval",
        entityId: ENTITY_ID,
        gate: "awaiting_review",
        reviewer: "alice",
        sha: HEAD,
      },
    ]);
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

  /**
   * The cap is a *loop detector*, and the loop it exists to catch is as often a
   * build nobody can get green as a thread nobody can settle. The process doc is
   * explicit that new CI results are among the things that "still arrive and are
   * still recorded; they are simply not acted on" — so a CI failure past the cap
   * has to reach the same escalation a comment does, not a paid agent run.
   *
   * These assert the *actions*, not a flag: a regression here spends money, and
   * the failure message should name the dispatch that was bought.
   */
  describe("and the cap covers a red build, not only a red reviewer", () => {
    const CAP = DEFAULT_POLICY.implementationReviewRoundBudget;

    /** Gated on `awaiting_ci`: CI is the only thing outstanding. */
    const failingCi = (reviewRounds: number) =>
      worldWith("implementation", pr({ checks: "failure" }), { reviewRounds });

    /** Gated on `awaiting_review`: the build goes red after review started. */
    const failingCiUnderReview = (reviewRounds: number) =>
      worldWith("implementation", pr({ checks: null, reviews: [review()] }), {
        reviewRounds,
      });

    it("escalates instead of dispatching when CI fails at the cap", () => {
      const w = failingCi(CAP);
      expect(deriveGate(issue("IMPLEMENTATION"), w)).toBe("awaiting_ci");
      const actions = decide(issue("IMPLEMENTATION"), signal("ci_concluded"), w);
      expect(kinds(actions)).toEqual(["escalate"]);
      expect(actions[0]).toMatchObject({
        reason: expect.stringContaining("approach may need re-examining"),
      });
    });

    it("still dispatches on the last permitted round", () => {
      const w = failingCi(CAP - 1);
      expect(kinds(decide(issue("IMPLEMENTATION"), signal("ci_concluded"), w))).toEqual([
        "addressFeedback",
      ]);
    });

    it("escalates a failure that lands after review started, too", () => {
      const w = failingCiUnderReview(CAP);
      expect(deriveGate(issue("IMPLEMENTATION"), w)).toBe("awaiting_review");
      expect(kinds(decide(issue("IMPLEMENTATION"), signal("ci_concluded"), w))).toEqual([
        "escalate",
      ]);
    });

    it("still dispatches under review on the last permitted round", () => {
      const w = failingCiUnderReview(CAP - 1);
      expect(kinds(decide(issue("IMPLEMENTATION"), signal("ci_concluded"), w))).toEqual([
        "addressFeedback",
      ]);
    });

    it("charges a red base nothing, at the cap as below it", () => {
      // Someone else's breakage is not a round, so it must neither dispatch
      // (which is what `countReviewRound` charges against) nor escalate as if
      // this PR had exhausted anything. The entity waits for `base_recovered`,
      // exactly as it does below the cap.
      const w = worldWith("implementation", pr({ checks: "failure", baseRed: true }), {
        reviewRounds: CAP,
      });
      expect(decide(issue("IMPLEMENTATION"), signal("ci_concluded"), w)).toEqual([]);
    });

    it("materializes artifact.rounds for the phase, or the cap reads zero forever", () => {
      // The guard is only alive if the tick fetches the number it compares.
      // `awaiting_ci` does not declare `artifact.rounds` itself — it is carried
      // by `awaiting_review`, and the tick unions a phase's declarations. That
      // union is what this pins. The stronger form, the one `pr.baseStatus`
      // already earned on its own neighbour, is for `awaiting_ci` to declare it
      // directly; until it does, deleting it from `awaiting_review` silently
      // resets every implementation's CI budget to zero.
      expect(factsReadBy("issue", "IMPLEMENTATION")).toContain("artifact.rounds");
    });
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
    // 8 phases × 8 worlds × 22 signals — the matrix M0 claims to cover.
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
      proved("passed"),
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

describe("reducing against the artifact the phase is actually working on", () => {
  /**
   * An implementation PR that was closed and replaced. Both artifacts stay in
   * the ledger — newest last — and the first one has already merged, which is
   * the shape that hurts: reducing against it satisfies `awaiting_goal_check`
   * and settles an issue whose real work is still open.
   */
  const replaced = () =>
    world({
      artifacts: [
        {
          id: "a-impl-1",
          kind: "implementation",
          hostedAt: { type: "pr", number: 11 },
          reviewRounds: DEFAULT_POLICY.implementationReviewRoundBudget,
        },
        {
          id: "a-impl-2",
          kind: "implementation",
          hostedAt: { type: "pr", number: 12 },
          reviewRounds: 0,
        },
      ],
      pullRequests: {
        11: pr({ number: 11, state: "merged", checks: "success" }),
        12: pr({
          number: 12,
          checks: "success",
          reviews: [review({ state: "CHANGES_REQUESTED" })],
        }),
      },
    });

  it("gates on the live PR, not the one it replaced", () => {
    expect(deriveGate(issue("IMPLEMENTATION"), replaced())).toBe("awaiting_review");
  });

  it("does not settle the issue on the merge of a superseded PR", () => {
    // The dangerous cell. Against the obsolete artifact this is `runGoalCheck`
    // on work that has already been thrown away.
    expect(
      decide(issue("IMPLEMENTATION"), signal("merged", { pullNumber: 11 }), replaced()),
    ).toEqual([]);
  });

  it("scopes incoming feedback to the live PR and counts its own rounds", () => {
    // The obsolete artifact has spent the whole budget, so reducing against it
    // escalates instead of doing the work — and drops the signal entirely,
    // because PR 12 is not the PR it thinks the phase owns.
    expect(
      kinds(
        decide(
          issue("IMPLEMENTATION"),
          signal("changes_requested", { pullNumber: 12 }),
          replaced(),
        ),
      ),
    ).toEqual(["addressFeedback"]);
  });
});

describe("a signal queued from the phase the entity has just left", () => {
  it("does not escalate the spec PR closure that is the process working", () => {
    // The first poll of an issue whose spec was approved and whose spec PR was
    // then closed unmerged — which *is* the process (BP-037: a spec lives on
    // its spec PR and in Linear, never on the base branch). Reconciliation
    // replays the whole batch, and the backdated `pr_opened` advances the
    // entity to IMPLEMENTATION before the `pr_closed` behind it is reduced.
    // The new phase holds no implementation artifact yet, so nothing scopes the
    // stale spec signal and the universal handler files a human-intervention
    // escalation against correct behaviour. An escalation that fires on the
    // happy path is worse than none: it trains everyone to ignore escalations.
    //
    // Only visible as a batch. Reduced on its own, this `pr_closed` arrives
    // while the entity is still in SPEC, where the spec PR is the phase's own
    // artifact and the guard has something to compare against.
    const fresh = pr({ state: "closed", reviews: [freshApproval()] });
    const w = worldWith("spec", fresh);
    const signals = reconcile({
      entityId: ENTITY_ID,
      observed: [],
      fresh: [fresh],
      now: AT,
    });
    // The ordering is what makes the defect reachable, so it is pinned rather
    // than assumed: `pr_opened` is backdated to the approval it missed, and the
    // closure carries the poll's own timestamp.
    expect(signals.map((s) => s.kind)).toEqual(["pr_opened", "approved", "pr_closed"]);

    let entity = issue("SPEC");
    const actions = signals.flatMap((s) => {
      const produced = decide(entity, s, w);
      for (const action of produced) {
        if (action.kind === "enterPhase") entity = issue(action.phase);
      }
      return produced;
    });

    // Asserted on the actions, so a regression reports the false escalation
    // rather than an internal predicate's answer about the signal.
    expect(actions.filter((a) => a.kind === "escalate")).toEqual([]);
    // The batch advances the issue and asks for nothing else. No
    // `recordApproval` rides along, and that is a *separate* gap from this
    // one — both spec gates apply only while the spec PR is open, so an
    // approval first observed on an already-closed PR releases no gate to
    // credit. Pinned as it stands rather than as it ought to be, because
    // fixing it is a change to the phase table, not to this guard.
    expect(kinds(actions)).toEqual(["enterPhase"]);
    expect(entity.phase).toBe("IMPLEMENTATION");
  });

  it("does not aim a conflict on the old spec PR at the implementation branch", () => {
    // The same hole, one signal along: an issue that has moved to
    // IMPLEMENTATION but has no PR of its own yet still owns a spec PR, and a
    // queued `merge_conflict` from it would dispatch an agent to rebase a
    // branch GitHub never complained about.
    const w = worldWith("spec", pr({ mergeable: false }));
    expect(decide(issue("IMPLEMENTATION"), signal("merge_conflict"), w)).toEqual([]);
  });

  it("still lets through a pr_opened for a PR the phase holds no artifact for", () => {
    // The leniency this guard was written for, and it is narrowed rather than
    // removed. A synthesized `pr_opened` arrives *because* conductor had no
    // record of the PR, and it is the one PR-bound signal that can dispatch
    // nothing of its own: the most it does is re-derive completion against the
    // snapshot, which only moves the phase if the world already says it is
    // done. Here that is the nested multi-PR shape — the assembled goal passed
    // and the issue holds no implementation PR of its own. Its implementation
    // artifact is not PR-hosted, which is what makes that a *finished* phase
    // rather than one whose submission has not appeared yet: `IMPLEMENTATION`
    // requires the artifact positively, so an issue holding none has produced
    // nothing and completes nothing (see `model/phases`).
    const w = world({
      artifacts: [
        artifact("implementation", 10, {
          hostedAt: { type: "file", path: "docs/internal/assembled.md" },
        }),
      ],
      // Deliberately no revision beside the verdict: an assembled goal is a
      // proof about an issue, not about a submission, and there is no head that
      // could move under it. `goalCheckFor` is what says so.
      goalCheck: "passed",
      goalCheckSha: null,
    });
    expect(decide(issue("IMPLEMENTATION"), signal("pr_opened"), w)).toEqual([
      { kind: "enterPhase", entityId: ENTITY_ID, phase: "SETTLED" },
    ]);
  });
});

describe("an approval a reviewer withdrew", () => {
  const at = (hour: string) => `2026-08-14T${hour}:00:00Z`;

  /** Approved, then changes requested by the same human against the same head. */
  const withdrawn = () =>
    worldWith(
      "spec",
      pr({
        reviews: [
          review({ id: "r1", state: "APPROVED", at: at("10") }),
          review({ id: "r2", state: "CHANGES_REQUESTED", at: at("11") }),
        ],
      }),
    );

  it("does not advance the phase — the gate is for the reviewer's current answer", () => {
    expect(isPhaseComplete(issue("SPEC"), withdrawn())).toBe(false);
    expect(deriveGate(issue("SPEC"), withdrawn())).toBe("awaiting_spec_approval");
  });

  it("records nothing when the retracted approval is replayed", () => {
    // A duplicate or reconciled `approved` for the review that has since been
    // superseded must not put a release in the ledger that no longer holds.
    expect(decide(issue("SPEC"), signal("approved"), withdrawn())).toEqual([]);
  });

  it("does the work the change request asked for instead", () => {
    expect(kinds(decide(issue("SPEC"), signal("changes_requested"), withdrawn()))).toEqual([
      "reviseSpec",
    ]);
  });

  it("opens the gate again once the same human re-approves", () => {
    const reApproved = worldWith(
      "spec",
      pr({
        reviews: [
          review({ id: "r1", state: "CHANGES_REQUESTED", at: at("10") }),
          review({ id: "r2", state: "APPROVED", at: at("11") }),
        ],
      }),
    );
    const actions = decide(issue("SPEC"), signal("approved"), reApproved);
    expect(kinds(actions)).toEqual(["recordApproval", "enterPhase"]);
    expect(actions[0]).toMatchObject({ gate: "awaiting_spec_approval" });
  });
});

describe("a CI conclusion is scoped to the PR and the commit it ran on", () => {
  /** An issue implementing on PR 11, with its spec PR still sitting at PR 10. */
  const implementing = (specChecks: "failure" | null = "failure") =>
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
        10: pr({ number: 10, checks: specChecks }),
        11: pr({ number: 11, headSha: "sha-impl", checks: "failure" }),
      },
    });

  it("ignores a check that failed on the spec PR while the issue implements", () => {
    // `readWorld` reads every PR the entity owns, so a newly red spec PR is
    // read on the same tick. Unscoped, it dispatches an agent to fix an
    // implementation branch that CI never complained about.
    expect(
      decide(
        issue("IMPLEMENTATION"),
        signal("ci_concluded", { pullNumber: 10, sha: HEAD }),
        implementing(),
      ),
    ).toEqual([]);
  });

  it("acts on the check that failed on the implementation PR", () => {
    expect(
      kinds(
        decide(
          issue("IMPLEMENTATION"),
          signal("ci_concluded", { pullNumber: 11, sha: "sha-impl" }),
          implementing(),
        ),
      ),
    ).toEqual(["addressFeedback"]);
  });

  it("ignores a conclusion for a commit the branch has moved past", () => {
    // The SHA is the second scope, and it is the one that still holds for a
    // ledger row or a check-run webhook that named no PR at all.
    expect(
      decide(
        issue("IMPLEMENTATION"),
        signal("ci_concluded", { pullNumber: undefined, sha: "sha-stale" }),
        implementing(),
      ),
    ).toEqual([]);

    // Same signal shape, current head: still real work, so the SHA scope has
    // not simply turned the branch off.
    expect(
      kinds(
        decide(
          issue("IMPLEMENTATION"),
          signal("ci_concluded", { pullNumber: undefined, sha: "sha-impl" }),
          implementing(),
        ),
      ),
    ).toEqual(["addressFeedback"]);
  });
});

describe("a phase that finishes without waiting on anything", () => {
  it("moves the epic out of CROSS_SPEC_REVIEW on entry", () => {
    // It dispatches nothing and gates on nothing, so its own `phase_entered` is
    // the only signal it is guaranteed to get. Absorbing it strands the epic in
    // a finished phase forever.
    expect(decide(epic("CROSS_SPEC_REVIEW"), signal("phase_entered"), world())).toEqual([
      { kind: "enterPhase", entityId: ENTITY_ID, phase: "ISSUES" },
    ]);
  });

  it("settles the epic when the retrospective dispatch reports back", () => {
    // `dispatch_completed` produces no action of its own. If that swallows the
    // signal, WRAP sits complete with nothing else due to arrive.
    const w = world({ artifacts: [{ id: "a-retro", kind: "retrospective", hostedAt: { type: "file", path: "docs/internal/retro.md" }, reviewRounds: 0 }] });
    expect(decide(epic("WRAP"), signal("dispatch_completed"), w)).toEqual([
      { kind: "enterPhase", entityId: ENTITY_ID, phase: "SETTLED" },
    ]);
  });

  it("still dispatches WRAP's entry work rather than skipping past it", () => {
    // The fall-through must only catch branches that produced nothing. A phase
    // with real entry work still does it.
    expect(kinds(decide(epic("WRAP"), signal("phase_entered"), world()))).toEqual([
      "retrospect",
      "polishDocs",
    ]);
  });

  it("does not let a completed phase swallow an escalation", () => {
    // The other half of the ordering. A universal signal that answers keeps its
    // answer — a dispatch that exhausted its attempts is a human's problem
    // whether or not the phase it was working for has since completed.
    const w = worldWith("spec", pr({ reviews: [freshApproval()] }));
    expect(kinds(decide(issue("SPEC"), signal("dispatch_failed"), w))).toEqual([
      "escalate",
    ]);
  });

  it("keeps a completing signal advancing rather than being absorbed by its gate", () => {
    // The rule the ordering was built for in the first place, re-pinned: the
    // approval that releases `awaiting_spec_approval` must advance the phase,
    // not be answered by the gate it just released.
    const w = worldWith("spec", pr({ reviews: [freshApproval()] }));
    expect(kinds(decide(issue("SPEC"), signal("approved"), w))).toEqual([
      "recordApproval",
      "enterPhase",
    ]);
  });
});

describe("an approval that landed before conductor was watching", () => {
  /**
   * The first poll of a spec PR that is already approved. Reconciliation
   * backdates the missed `pr_opened` so it reduces *ahead* of the approval that
   * revealed it — and the snapshot both reduce against already carries the
   * approval, so the `pr_opened` is what completes the phase.
   */
  const alreadyApproved = () => worldWith("spec", pr({ reviews: [freshApproval()] }));

  it("records the approval on whichever signal completes the phase", () => {
    // Advancing without the record loses it for good: by the time the later
    // `approved` is reduced the entity is in IMPLEMENTATION, where that
    // approval releases nothing and cannot be credited to any gate.
    const actions = decide(
      issue("SPEC"),
      signal("pr_opened", { synthesized: true }),
      alreadyApproved(),
    );
    expect(kinds(actions)).toEqual(["recordApproval", "enterPhase"]);
    expect(actions[0]).toMatchObject({
      kind: "recordApproval",
      gate: "awaiting_spec_approval",
      reviewer: "alice",
      sha: HEAD,
    });
  });

  it("credits the human who actually approved, not the phase's entry", () => {
    const w = worldWith(
      "spec",
      pr({ reviews: [freshApproval(), review({ id: "r2", reviewer: "bob", state: "APPROVED" })] }),
    );
    const actions = decide(issue("SPEC"), signal("pr_opened"), w);
    expect(actions[0]).toMatchObject({ kind: "recordApproval", reviewer: "bob" });
  });

  it("records nothing when the phase completes on something no human released", () => {
    // IMPLEMENTATION completes on the goal check. There is no approval standing
    // at the merged PR's head, so inventing a `recordApproval` here would put a
    // release in the ledger that never happened.
    const w = worldWith(
      "implementation",
      pr({ state: "merged", checks: "success" }),
      {},
      proved("passed"),
    );
    expect(decide(issue("IMPLEMENTATION"), signal("goal_check_passed"), w)).toEqual([
      { kind: "enterPhase", entityId: ENTITY_ID, phase: "SETTLED" },
    ]);
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
      proved("failed"),
    );
    const actions = decide(issue("IMPLEMENTATION"), signal("goal_check_failed"), w);
    expect(kinds(actions)).toEqual(["escalate"]);
  });
});

describe("a goal check that fails before the merge", () => {
  it("sends the work back, because an unmet goal on an open PR is ordinary", () => {
    // The escalation above used to fire on *every* failed goal check in
    // IMPLEMENTATION, with no predicate reading the PR state — so a check that
    // failed on an open PR filed a human-intervention report whose reason said
    // the change was already on the base branch. It was not: there is an open PR
    // sitting right there to push the fix to, which is what makes this feedback
    // rather than an intervention.
    const w = worldWith(
      "implementation",
      pr({ state: "open", checks: "success" }),
      {},
      proved("failed"),
    );
    const actions = decide(issue("IMPLEMENTATION"), signal("goal_check_failed"), w);
    expect(kinds(actions)).toEqual(["addressFeedback"]);
  });

  it("sends it back before any PR exists, which is where a single-PR issue proves its goal", () => {
    // `implement` proves the goal at completion, before the submission is
    // opened, so the first failed verdict an issue ever sees arrives with no PR
    // in the world at all. Not merged is not merged: the work goes back.
    const w = world({ goalCheck: "failed" });
    const actions = decide(issue("IMPLEMENTATION"), signal("goal_check_failed"), w);
    expect(kinds(actions)).toEqual(["addressFeedback"]);
  });

  it("stops buying revisions on the same budget every other feedback path uses", () => {
    // A goal nobody can meet is the same loop as a thread nobody can settle, and
    // the cap is a loop detector. Spending the budget here rather than in a
    // comparison of its own is what keeps the three paths from drifting apart.
    const w = worldWith(
      "implementation",
      pr({ state: "open", checks: "success" }),
      { reviewRounds: DEFAULT_POLICY.implementationReviewRoundBudget },
      proved("failed"),
    );
    const actions = decide(issue("IMPLEMENTATION"), signal("goal_check_failed"), w);
    expect(kinds(actions)).toEqual(["escalate"]);
    expect(actions[0]).toMatchObject({ reason: expect.stringContaining("budget") });
  });
});

describe("recovery work aimed at a PR that is no longer open", () => {
  it("does not rebase a branch whose PR merged in the same poll", () => {
    // The base went red while the implementation PR was in flight, and by the
    // next poll two things had happened at once: a human merged the PR, and
    // someone fixed the base. Reconciliation reports both, and `base_recovered`
    // is reduced second — against an entity still in IMPLEMENTATION, waiting on
    // its post-merge goal check.
    //
    // Handling recovery phase-wide is right: a conflict or a recovery that
    // lands while CI is still running is just as real as one at the merge gate.
    // What phase-wide must not mean is artifact-state-blind. A rebase here
    // spends a paid dispatch on work that is already on the base, and the agent
    // it dispatches pushes commits to the branch of a PR that has merged — a
    // real change to someone's repository, not merely waste.
    //
    // Only visible as a batch. Reduced on its own, `base_recovered` arrives
    // while the PR is still open and the dispatch is correct; it is the merge
    // landing in the same poll that puts the branch past the point where a
    // rebase means anything.
    const fresh = pr({
      state: "merged",
      checks: "success",
      baseRed: false,
      reviews: [freshApproval()],
    });
    const signals = reconcile({
      entityId: ENTITY_ID,
      observed: [
        {
          number: 10,
          state: "open",
          headSha: HEAD,
          checks: "success",
          mergeable: true,
          baseRed: true,
          knownReviewIds: ["rev-approve"],
          observedAt: "2026-08-14T09:00:00Z",
        },
      ],
      fresh: [fresh],
      now: AT,
    });
    // Pinned rather than assumed: the pairing is what makes the defect
    // reachable, and the merge is reduced first.
    expect(signals.map((s) => s.kind)).toEqual(["merged", "base_recovered"]);

    const w = worldWith("implementation", fresh);
    let entity = issue("IMPLEMENTATION");
    const actions = signals.flatMap((s) => {
      const produced = decide(entity, s, w);
      for (const action of produced) {
        if (action.kind === "enterPhase") entity = issue(action.phase);
      }
      return produced;
    });

    // Asserted on the actions, so a regression reports the paid dispatch rather
    // than an internal predicate's answer about the PR.
    expect(kinds(actions)).toEqual(["runGoalCheck"]);
    expect(entity.phase).toBe("IMPLEMENTATION");
  });

  it("does not resolve a conflict reported against a PR that has merged", () => {
    // The twin of the same rule. No poll produces this pairing today — both
    // readers report `mergeable: null` once a PR is no longer open, so
    // reconciliation cannot put `merge_conflict` behind `merged` the way it puts
    // `base_recovered` there — but `decide` is a reducer over whatever signal it
    // is handed, and this file's header promises that an input it cannot act on
    // is inert rather than expensive. A conflict on a merged PR is exactly that:
    // there is no open branch left to resolve it on. Guarded alongside its twin
    // rather than left for a later round, because one predicate covering one
    // half of a pair is how the other half stays broken.
    const w = worldWith(
      "implementation",
      pr({ state: "merged", checks: "success", mergeable: false }),
    );
    expect(decide(issue("IMPLEMENTATION"), signal("merge_conflict"), w)).toEqual([]);
  });

  it("does not chase a base recovery onto a PR that was closed unmerged", () => {
    // The predicate is "still open", not "not merged". A closed implementation
    // PR is already escalated as a human intervention, and dispatching an agent
    // to rebase the abandoned branch on top of that is the same paid mistake
    // wearing a different PR state.
    const w = worldWith("implementation", pr({ state: "closed", checks: "failure" }));
    expect(decide(issue("IMPLEMENTATION"), signal("base_recovered"), w)).toEqual([]);
  });

  it("still dispatches both while the PR is open, which is what the branch is for", () => {
    // The guard narrows the branch, it does not remove it: deleting the
    // phase-wide handling outright would satisfy both tests above while
    // stranding every real conflict and every real recovery.
    const conflicting = worldWith(
      "implementation",
      pr({ checks: "success", mergeable: false }),
    );
    expect(
      kinds(decide(issue("IMPLEMENTATION"), signal("merge_conflict"), conflicting)),
    ).toEqual(["resolveConflict"]);

    const recovered = worldWith("implementation", pr({ checks: "failure", baseRed: false }));
    expect(
      kinds(decide(issue("IMPLEMENTATION"), signal("base_recovered"), recovered)),
    ).toEqual(["rebaseOnBase"]);
  });
});
