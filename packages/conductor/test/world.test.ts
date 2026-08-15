/**
 * The snapshot's own accessors — the two questions every gate is built on.
 *
 * `artifactOfKind` answers *which artifact is this phase working on*, and
 * `hasFreshHumanApproval` answers *does a human approve this, right now*. Both
 * are read by predicates that look obviously correct, which is exactly why a
 * wrong answer here is invisible: the gate table reads fine and reduces against
 * the wrong PR, or against an approval its author already took back.
 */

import { describe, expect, it } from "vitest";
import {
  artifactOfKind,
  effectiveHumanReviewsAtHead,
  freshHumanApprovals,
  hasFreshHumanApproval,
  hasHumanReviewAtHead,
} from "../src/model/world";
import { HEAD, artifact, freshApproval, pr, review, world } from "./fixtures";

describe("which artifact a phase is working on", () => {
  it("takes the newest of a kind, because a second one supersedes the first", () => {
    // A closed-and-replaced implementation PR, or a build plan's second PR.
    // Both artifacts stay in the ledger; only the last is still being worked
    // on, and `World.artifacts` is newest-last for exactly this reason.
    const w = world({
      artifacts: [
        artifact("implementation", 11, { id: "a-impl-1", reviewRounds: 9 }),
        artifact("implementation", 12, { id: "a-impl-2" }),
      ],
    });
    expect(artifactOfKind(w, "implementation")?.id).toBe("a-impl-2");
  });

  it("does not confuse kinds when an entity holds several", () => {
    const w = world({
      artifacts: [
        artifact("spec", 10),
        artifact("implementation", 11, { id: "a-impl-1" }),
        artifact("implementation", 12, { id: "a-impl-2" }),
      ],
    });
    expect(artifactOfKind(w, "spec")?.id).toBe("art-spec");
    expect(artifactOfKind(w, "implementation")?.id).toBe("a-impl-2");
    expect(artifactOfKind(w, "retrospective")).toBeUndefined();
  });
});

describe("whether a human approves this right now", () => {
  const at = (hour: string) => `2026-08-14T${hour}:00:00Z`;

  it("stops counting an approval its own author took back", () => {
    // GitHub keeps both records. Asking "is there an approval in this list?"
    // answers a question nobody asked — it reports that someone approved at
    // some point, not that anyone approves now. A reviewer changing their mind
    // is the one thing an approval gate exists to notice.
    const withdrawn = pr({
      reviews: [
        review({ id: "r1", state: "APPROVED", at: at("10") }),
        review({ id: "r2", state: "CHANGES_REQUESTED", at: at("11") }),
      ],
    });
    expect(hasFreshHumanApproval(withdrawn)).toBe(false);
    expect(freshHumanApprovals(withdrawn)).toEqual([]);
  });

  it("counts an approval that came after the change request it answers", () => {
    // The collapse has to work in both directions, or fixing the feedback could
    // never re-open the gate.
    const reApproved = pr({
      reviews: [
        review({ id: "r1", state: "CHANGES_REQUESTED", at: at("10") }),
        review({ id: "r2", state: "APPROVED", at: at("11") }),
      ],
    });
    expect(hasFreshHumanApproval(reApproved)).toBe(true);
  });

  it("does not let a later comment retract an approval", () => {
    // Matching GitHub's own model: `COMMENTED` is not a verdict, so it moves
    // nobody's position. Treating it as one would drop the gate every time a
    // reviewer replied to a thread after approving.
    const commentedAfter = pr({
      reviews: [
        review({ id: "r1", state: "APPROVED", at: at("10") }),
        review({ id: "r2", state: "COMMENTED", at: at("11") }),
      ],
    });
    expect(hasFreshHumanApproval(commentedAfter)).toBe(true);
  });

  it("still ignores an approval against a superseded head", () => {
    const pushedOver = pr({ headSha: "sha-new", reviews: [freshApproval("sha-old")] });
    expect(hasFreshHumanApproval(pushedOver)).toBe(false);
    expect(effectiveHumanReviewsAtHead(pushedOver)).toEqual([]);
  });

  it("still ignores a bot, whatever it submitted", () => {
    const botApproved = pr({
      reviews: [review({ state: "APPROVED", isHuman: false })],
    });
    expect(hasFreshHumanApproval(botApproved)).toBe(false);
  });

  it("withholds the gate while a different human's change request stands", () => {
    // The scope of the *collapse* is unchanged: it answers "has this human
    // changed their mind", not "is anyone unhappy". What governs here is the
    // other half of `orchestration.md` → "What counts as approval" — an
    // approval counts only if the latest review per human reviewer is
    // `APPROVED` **and no** reviewer's latest is `CHANGES_REQUESTED`. A human
    // change request "outranks all three channels", so Bob cannot carry the
    // gate over Alice's objection.
    //
    // Bob's approval is still a standing fact about Bob — hence the second
    // assertion, which is what proves the rule is the change-request clause and
    // not the per-reviewer collapse quietly eating his review.
    const split = pr({
      reviews: [
        review({ id: "r1", reviewer: "alice", state: "CHANGES_REQUESTED", at: at("10") }),
        review({ id: "r2", reviewer: "bob", state: "APPROVED", at: at("11") }),
      ],
    });
    expect(hasFreshHumanApproval(split)).toBe(false);
    expect(freshHumanApprovals(split).map((r) => r.reviewer)).toEqual(["bob"]);
  });

  it("opens the gate again once the objecting reviewer approves", () => {
    // The withholding has to lift, or a change request would be permanent and
    // no amount of addressing it could re-open the gate.
    const resolved = pr({
      reviews: [
        review({ id: "r1", reviewer: "alice", state: "CHANGES_REQUESTED", at: at("10") }),
        review({ id: "r2", reviewer: "bob", state: "APPROVED", at: at("11") }),
        review({ id: "r3", reviewer: "alice", state: "APPROVED", at: at("12") }),
      ],
    });
    expect(hasFreshHumanApproval(resolved)).toBe(true);
    expect(freshHumanApprovals(resolved).map((r) => r.reviewer)).toEqual(["bob", "alice"]);
  });

  it("keeps 'has a human looked at this' answering yes under a split verdict", () => {
    // `hasHumanReviewAtHead` must stay uncollapsed for the same reason it does
    // after a withdrawal: the gate it feeds asks whether a review has happened,
    // and withholding approval is not the same as nobody having looked.
    const split = pr({
      reviews: [
        review({ id: "r1", reviewer: "alice", state: "CHANGES_REQUESTED", at: at("10") }),
        review({ id: "r2", reviewer: "bob", state: "APPROVED", at: at("11") }),
      ],
    });
    expect(hasHumanReviewAtHead(split)).toBe(true);
  });

  it("keeps 'has a human looked at this' answering yes after a withdrawal", () => {
    // `hasHumanReviewAtHead` gates `awaiting_spec_review`. Collapsing it too
    // would send the issue back to waiting for a review that already happened.
    const withdrawn = pr({
      reviews: [
        review({ id: "r1", state: "APPROVED", at: at("10") }),
        review({ id: "r2", state: "CHANGES_REQUESTED", at: at("11") }),
      ],
    });
    expect(hasHumanReviewAtHead(withdrawn)).toBe(true);
  });

  it("reads a reviewer's last position when GitHub timestamps two reviews alike", () => {
    // Equal `at` values fall back to the order GitHub returned them in, which
    // is the only ordering left.
    const sameSecond = pr({
      reviews: [
        review({ id: "r1", state: "APPROVED", at: at("10") }),
        review({ id: "r2", state: "CHANGES_REQUESTED", at: at("10") }),
      ],
    });
    expect(hasFreshHumanApproval(sameSecond)).toBe(false);
  });

  it("says no about a PR that is not in the snapshot at all", () => {
    expect(hasFreshHumanApproval(undefined)).toBe(false);
    expect(effectiveHumanReviewsAtHead(undefined)).toEqual([]);
    expect(freshHumanApprovals(undefined)).toEqual([]);
  });

  it("is unmoved by an approval at head from a human with nothing else on file", () => {
    expect(hasFreshHumanApproval(pr({ reviews: [freshApproval()] }))).toBe(true);
    expect(freshHumanApprovals(pr({ reviews: [freshApproval()] }))[0]?.sha).toBe(HEAD);
  });
});
