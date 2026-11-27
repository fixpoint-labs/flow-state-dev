/**
 * The thread's pure reads of a landing: the verdict an accept sends, and which review round is the
 * latest. A plain accept sends no `land`, so a review that can't land reads as it always did. Where
 * an accepted run's work went is the coding board view's, read by harness-manager's one reader.
 */
import { describe, expect, it } from "vitest";
import { suspensionHoldId } from "@flow-state-dev/orchestration/inbox";
import { acceptOf, reviewStopIdOf } from "../src/lib/review-stop";

describe("acceptOf", () => {
  it("is a plain accept without a land", () => {
    expect(acceptOf()).toStrictEqual({ verdict: "accepted" });
  });

  it("names the land the accept takes", () => {
    expect(acceptOf("pull-request")).toStrictEqual({ verdict: "accepted", land: "pull-request" });
    expect(acceptOf("merge")).toStrictEqual({ verdict: "accepted", land: "merge" });
  });
});

describe("reviewStopIdOf", () => {
  // Each review round is one stop: a run sent back, or a landing retried, stops under a new id.
  // The id is the board's review hold id, so an answer can check the round on screen is the round the board holds.
  it("names the latest review stop by its hold id, so a new round is told apart from the one an accept answered", () => {
    const stop = (id: string) => ({ id: `item-${id}`, type: "suspension", requestId: "req_1", suspensionId: id, kind: "review", data: null }) as unknown as Parameters<typeof reviewStopIdOf>[0][number];
    expect(reviewStopIdOf([stop("stop-1")])).toBe(suspensionHoldId("req_1", "stop-1"));
    expect(reviewStopIdOf([stop("stop-1"), stop("stop-2")])).toBe(suspensionHoldId("req_1", "stop-2"));
    expect(reviewStopIdOf([])).toBeUndefined();
  });
});
