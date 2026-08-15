/**
 * `reconcile` — the paths that make a dropped event recoverable.
 *
 * The whole reason conductor keeps a copy of the world is that a divergence
 * between the copy and the world is *information*. These tests pin the three
 * shapes that information takes.
 */

import { describe, expect, it } from "vitest";
import { decide } from "../src/driver/decide";
import { divergences, reconcile, type ObservedPr } from "../src/driver/reconcile";
import type { ReviewFacts } from "../src/model/world";
import { ENTITY_ID, HEAD, freshApproval, issue, pr, review, worldWith } from "./fixtures";

const NOW = "2026-08-14T12:00:00Z";

function observed(overrides: Partial<ObservedPr> = {}): ObservedPr {
  return {
    number: 10,
    state: "open",
    headSha: HEAD,
    checks: null,
    mergeable: true,
    baseRed: false,
    knownReviewIds: [],
    observedAt: "2026-08-14T09:00:00Z",
    ...overrides,
  };
}

describe("a PR conductor never saw opened", () => {
  it("synthesizes the missed pr_opened and orders it ahead of what revealed the gap", () => {
    // The review is what conductor noticed. The PR opening is what it missed.
    const signals = reconcile({
      entityId: ENTITY_ID,
      observed: [],
      fresh: [pr({ reviews: [review({ at: "2026-08-14T10:00:00Z" })] })],
      now: NOW,
    });

    expect(signals.map((s) => s.kind)).toEqual(["pr_opened", "review_submitted"]);
    // Ordering is the point: reducing the review first would decide against a
    // world in which the PR does not exist.
    expect(signals[0]!.at <= signals[1]!.at).toBe(true);
    expect(signals.every((s) => s.synthesized)).toBe(true);
  });

  it("replays every review on the unseen PR, not just the newest", () => {
    const signals = reconcile({
      entityId: ENTITY_ID,
      observed: [],
      fresh: [
        pr({
          reviews: [
            review({ id: "r1", at: "2026-08-14T10:00:00Z" }),
            review({ id: "r2", state: "APPROVED", at: "2026-08-14T11:00:00Z" }),
          ],
        }),
      ],
      now: NOW,
    });
    expect(signals.map((s) => s.kind)).toEqual([
      "pr_opened",
      "review_submitted",
      "approved",
    ]);
  });

  it("keeps the human's release in the ledger when the whole batch is reduced", () => {
    // The first poll of an already-approved spec PR, played through end to end
    // the way a tick plays it: every synthesized signal reduced in order,
    // against the one snapshot, with the entity's phase carried between them.
    //
    // The ordering is deliberate — `pr_opened` is backdated ahead of the review
    // that revealed it — so `pr_opened` is what finds the phase complete. If
    // that advance skips the record, nothing later can restore it: the entity
    // is in IMPLEMENTATION by the time `approved` is reduced, where a spec
    // approval releases no gate at all. The ledger would then show a phase that
    // moved with no human release behind it, which is the one thing it exists
    // to make replayable.
    const fresh = pr({ reviews: [freshApproval()] });
    const w = worldWith("spec", fresh);
    const signals = reconcile({
      entityId: ENTITY_ID,
      observed: [],
      fresh: [fresh],
      now: NOW,
    });
    expect(signals.map((s) => s.kind)).toEqual(["pr_opened", "approved"]);

    let entity = issue("SPEC");
    const actions = signals.flatMap((s) => {
      const produced = decide(entity, s, w);
      for (const action of produced) {
        if (action.kind === "enterPhase") entity = issue(action.phase);
      }
      return produced;
    });

    expect(actions.filter((a) => a.kind === "recordApproval")).toEqual([
      {
        kind: "recordApproval",
        entityId: ENTITY_ID,
        gate: "awaiting_spec_approval",
        reviewer: "alice",
        sha: HEAD,
      },
    ]);
    expect(entity.phase).toBe("IMPLEMENTATION");
  });

  it("feeds the driver a world it can actually act on", () => {
    // End to end: the synthesized approval advances the phase, which is the
    // recovery the local copy exists to enable.
    const fresh = pr({ reviews: [freshApproval()] });
    const signals = reconcile({
      entityId: ENTITY_ID,
      observed: [],
      fresh: [fresh],
      now: NOW,
    });
    const w = worldWith("spec", fresh);
    const approval = signals.find((s) => s.kind === "approved")!;
    expect(decide(issue("SPEC"), approval, w).map((a) => a.kind)).toEqual([
      "recordApproval",
      "enterPhase",
    ]);
  });
});

describe("a PR first seen after it had already moved", () => {
  // The bug this block exists for: a first observation is the *only* chance to
  // emit what a PR already is. On the next tick the copy agrees with the world,
  // the divergence is gone, and nothing will ever emit it. A fact missed here is
  // missed permanently, and the entity waits on a gate no signal will release.

  it("emits every transition the first read reveals, not only the opening", () => {
    const signals = reconcile({
      entityId: ENTITY_ID,
      observed: [],
      fresh: [pr({ state: "closed", checks: "failure", mergeable: false })],
      now: NOW,
    });

    expect(signals.map((s) => s.kind)).toEqual([
      "pr_opened",
      "pr_closed",
      "ci_concluded",
      "merge_conflict",
    ]);
  });

  it("still emits the merge of a PR that was already merged when first read", () => {
    expect(
      reconcile({
        entityId: ENTITY_ID,
        observed: [],
        fresh: [pr({ state: "merged" })],
        now: NOW,
      }).map((s) => s.kind),
    ).toEqual(["pr_opened", "merged"]);
  });

  it("invents no base recovery for a base it never saw red", () => {
    // The one emit a zero-valued prior must *not* produce. `base_recovered`
    // fires on red → green, and a first read has no red to have come from —
    // whichever way the base happens to stand right now. There is no signal for
    // a base going red, so both cases are correctly silent.
    for (const baseRed of [false, true]) {
      expect(
        reconcile({
          entityId: ENTITY_ID,
          observed: [],
          fresh: [pr({ baseRed })],
          now: NOW,
        }).map((s) => s.kind),
      ).toEqual(["pr_opened"]);
    }
  });

  it("gets the driver moving on a build that was already red when it first looked", () => {
    // The batch reduced end to end, the way a tick reduces it: every signal in
    // order, against the one snapshot, with the phase carried between them. A
    // per-signal assertion would not show the symptom — the symptom is that the
    // issue sits in `awaiting_ci` with nothing left to release it.
    const fresh = pr({ checks: "failure" });
    const w = worldWith("implementation", fresh);
    const signals = reconcile({
      entityId: ENTITY_ID,
      observed: [],
      fresh: [fresh],
      now: NOW,
    });

    let entity = issue("IMPLEMENTATION");
    const actions = signals.flatMap((s) => {
      const produced = decide(entity, s, w);
      for (const action of produced) {
        if (action.kind === "enterPhase") entity = issue(action.phase);
      }
      return produced;
    });

    expect(actions.map((a) => a.kind)).toEqual(["addressFeedback"]);
  });
});

describe("a machine's review", () => {
  function botReview(overrides: Partial<ReviewFacts> = {}): ReviewFacts {
    return review({
      id: "bot-1",
      reviewer: "coderabbit",
      isHuman: false,
      state: "CHANGES_REQUESTED",
      ...overrides,
    });
  }

  it("produces no signal on catch-up", () => {
    expect(
      reconcile({
        entityId: ENTITY_ID,
        observed: [observed()],
        fresh: [pr({ reviews: [botReview()] })],
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("produces no signal on the first observation either, where every review replays", () => {
    expect(
      reconcile({
        entityId: ENTITY_ID,
        observed: [],
        fresh: [pr({ reviews: [botReview({ state: "APPROVED", reviewer: "renovate" })] })],
        now: NOW,
      }).map((s) => s.kind),
    ).toEqual(["pr_opened"]);
  });

  it("does not silence the human reviewing the same PR", () => {
    const signals = reconcile({
      entityId: ENTITY_ID,
      observed: [observed()],
      fresh: [
        pr({
          reviews: [
            botReview({ at: "2026-08-14T10:00:00Z" }),
            review({ id: "r2", state: "CHANGES_REQUESTED", at: "2026-08-14T11:00:00Z" }),
          ],
        }),
      ],
      now: NOW,
    });

    expect(signals.map((s) => [s.kind, (s as { reviewer?: string }).reviewer])).toEqual([
      ["changes_requested", "alice"],
    ]);
  });

  it("costs the implementation no review round and dispatches no agent to answer it", () => {
    // The sharp case, reduced as a batch: under `awaiting_review` a change
    // request dispatches `addressFeedback` and spends one of the twelve rounds
    // the budget holds for humans. A bot must buy neither.
    // No checks reported, so `awaiting_ci` does not apply and the derived gate
    // is `awaiting_review` — the gate whose handling spends the budget.
    const fresh = pr({ reviews: [botReview()] });
    const w = worldWith("implementation", fresh);
    const signals = reconcile({
      entityId: ENTITY_ID,
      observed: [],
      fresh: [fresh],
      now: NOW,
    });

    let entity = issue("IMPLEMENTATION");
    const actions = signals.flatMap((s) => {
      const produced = decide(entity, s, w);
      for (const action of produced) {
        if (action.kind === "enterPhase") entity = issue(action.phase);
      }
      return produced;
    });

    // Asserted before the signal list, so a regression reports the cost — an
    // agent dispatched to answer a machine — rather than the signal that bought
    // it.
    expect(actions).toEqual([]);
    expect(signals.map((s) => s.kind)).toEqual(["pr_opened"]);
  });
});

describe("a stale read", () => {
  it("emits no signal when the world looks behind conductor's copy", () => {
    // Conductor saw the merge. A later read says open — that read is stale, and
    // walking the PR backwards would undo a real transition.
    const signals = reconcile({
      entityId: ENTITY_ID,
      observed: [observed({ state: "merged" })],
      fresh: [pr({ state: "open" })],
      now: NOW,
    });
    expect(signals).toEqual([]);
  });

  it("still records the disagreement, so the conflict is resolvable later", () => {
    const found = divergences([observed({ state: "merged" })], [pr({ state: "open" })]);
    expect(found).toEqual([
      { pullNumber: 10, fact: "state", observed: "merged", fresh: "open" },
    ]);
  });
});

describe("conductor's copy disagreeing with GitHub", () => {
  it("records a head SHA divergence — GitHub owns the fact, we own the note", () => {
    const found = divergences(
      [observed({ headSha: "sha-old" })],
      [pr({ headSha: "sha-new" })],
    );
    expect(found).toEqual([
      { pullNumber: 10, fact: "headSha", observed: "sha-old", fresh: "sha-new" },
    ]);
  });

  it("reports nothing when the copy already agrees", () => {
    expect(divergences([observed()], [pr()])).toEqual([]);
  });
});

describe("ordinary catch-up", () => {
  it("does not re-fire reviews it has already reduced over", () => {
    const signals = reconcile({
      entityId: ENTITY_ID,
      observed: [observed({ knownReviewIds: ["r1"] })],
      fresh: [
        pr({
          reviews: [
            review({ id: "r1" }),
            review({ id: "r2", state: "CHANGES_REQUESTED" }),
          ],
        }),
      ],
      now: NOW,
    });
    expect(signals.map((s) => s.kind)).toEqual(["changes_requested"]);
  });

  it("emits merged when the PR moved forward while conductor was down", () => {
    const signals = reconcile({
      entityId: ENTITY_ID,
      observed: [observed()],
      fresh: [pr({ state: "merged" })],
      now: NOW,
    });
    expect(signals.map((s) => s.kind)).toEqual(["merged"]);
  });

  it("emits a CI conclusion the webhook never delivered", () => {
    const signals = reconcile({
      entityId: ENTITY_ID,
      observed: [observed({ checks: "pending" })],
      fresh: [pr({ checks: "failure" })],
      now: NOW,
    });
    expect(signals.map((s) => s.kind)).toEqual(["ci_concluded"]);
  });

  it("says which PR the checks ran on, so the driver can scope them", () => {
    // Conductor reads every PR an entity owns on the same tick — an issue in
    // IMPLEMENTATION still has its spec PR. A conclusion that names no PR is
    // unscoped, and an unscoped failure from the spec PR reduces as a failure
    // of the implementation branch.
    const signals = reconcile({
      entityId: ENTITY_ID,
      observed: [observed({ number: 7, checks: "pending" })],
      fresh: [pr({ number: 7, headSha: "sha-seven", checks: "failure" })],
      now: NOW,
    });
    expect(signals).toEqual([
      {
        kind: "ci_concluded",
        entityId: ENTITY_ID,
        at: NOW,
        synthesized: true,
        conclusion: "failure",
        sha: "sha-seven",
        pullNumber: 7,
      },
    ]);
  });

  it("emits the second red build, because it condemns a different commit", () => {
    // The feedback loop's sharpest moment: the previous head failed, an agent
    // pushed a fix, and that fix failed too before the next poll. Both snapshots
    // read `checks: "failure"`, so a value comparison sees nothing move — but
    // the failure belongs to a new SHA, and it is precisely the evidence that
    // the agent's fix did not work.
    //
    // Reduced as a batch with the phase carried between signals, because the
    // symptom is not a missing signal, it is an issue left in `awaiting_ci`
    // with nothing that will ever release it: the cursor adopts the new head,
    // the copy then agrees with the world, and no later tick can emit this.
    const fresh = pr({ headSha: "sha-fix", checks: "failure" });
    const w = worldWith("implementation", fresh);
    const signals = reconcile({
      entityId: ENTITY_ID,
      observed: [observed({ headSha: "sha-broken", checks: "failure" })],
      fresh: [fresh],
      now: NOW,
    });

    let entity = issue("IMPLEMENTATION");
    const actions = signals.flatMap((s) => {
      const produced = decide(entity, s, w);
      for (const action of produced) {
        if (action.kind === "enterPhase") entity = issue(action.phase);
      }
      return produced;
    });

    // Asserted first, so a regression reports the stranding rather than the
    // missing signal that caused it.
    expect(actions.map((a) => a.kind)).toEqual(["addressFeedback"]);
    // The conclusion has to name the new head — `decide` drops a `ci_concluded`
    // whose SHA is not the PR's current one as stale.
    expect(signals).toEqual([
      {
        kind: "ci_concluded",
        entityId: ENTITY_ID,
        at: NOW,
        synthesized: true,
        conclusion: "failure",
        sha: "sha-fix",
        pullNumber: 10,
      },
    ]);
  });

  it("emits the second conflict, because a new head is a different repair", () => {
    // The sibling of the second red build, and the same defect: `mergeable` is
    // a fact about a *commit*, so two reads that both say `false` have not
    // said the same thing when the commit under them changed. Conductor
    // dispatched `resolveConflict`, the agent pushed a head that still
    // conflicts, and a value comparison sees nothing move — precisely at the
    // moment conductor was supposed to notice the repair did not work.
    //
    // Reduced as a batch with the phase carried between signals, because the
    // symptom is not a missing signal: the cursor adopts the new head, the copy
    // then agrees with the world, and no later tick can dispatch another
    // resolution pass. The PR stays unmergeable forever.
    const fresh = pr({ headSha: "sha-repair", mergeable: false });
    const w = worldWith("implementation", fresh);
    const signals = reconcile({
      entityId: ENTITY_ID,
      observed: [observed({ headSha: "sha-conflicted", mergeable: false })],
      fresh: [fresh],
      now: NOW,
    });

    let entity = issue("IMPLEMENTATION");
    const actions = signals.flatMap((s) => {
      const produced = decide(entity, s, w);
      for (const action of produced) {
        if (action.kind === "enterPhase") entity = issue(action.phase);
      }
      return produced;
    });

    // Asserted first, so a regression reports the PR left unmergeable rather
    // than the missing signal that caused it.
    expect(actions.map((a) => a.kind)).toEqual(["resolveConflict"]);
    expect(signals).toEqual([
      {
        kind: "merge_conflict",
        entityId: ENTITY_ID,
        at: NOW,
        synthesized: true,
        pullNumber: 10,
      },
    ]);
  });

  it("notices mergeability lost and the base recovering", () => {
    expect(
      reconcile({
        entityId: ENTITY_ID,
        observed: [observed({ mergeable: true })],
        fresh: [pr({ mergeable: false })],
        now: NOW,
      }).map((s) => s.kind),
    ).toEqual(["merge_conflict"]);

    expect(
      reconcile({
        entityId: ENTITY_ID,
        observed: [observed({ baseRed: true })],
        fresh: [pr({ baseRed: false })],
        now: NOW,
      }).map((s) => s.kind),
    ).toEqual(["base_recovered"]);
  });

  it("stays quiet when nothing moved — a redundant tick costs nothing", () => {
    expect(
      reconcile({
        entityId: ENTITY_ID,
        observed: [observed()],
        fresh: [pr()],
        now: NOW,
      }),
    ).toEqual([]);
  });
});
