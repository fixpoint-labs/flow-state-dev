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
