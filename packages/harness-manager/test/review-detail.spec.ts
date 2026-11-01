/**
 * The browser reader of a review stop's data. A card draws whatever this
 * returns, so a record it can't read must come back as "nothing readable"
 * (null fields, or null for not-a-review), never as a throw or a made-up
 * value: a wrong commit count or verdict would be read as the run's.
 */
import { describe, expect, it } from "vitest";
import { reviewDetail } from "../src/browser";

describe("reviewDetail", () => {
  it("reads a full review's data", () => {
    const judge = { verdict: "done", confidence: 0.9, reason: "tests pass" };
    expect(reviewDetail({ branch: "fix-1/implement", commits: 2, subjects: ["B", "A"], judge })).toEqual({
      branch: "fix-1/implement",
      commits: 2,
      subjects: ["B", "A"],
      judge,
    });
  });

  it("is null for data that is no review", () => {
    for (const data of [undefined, null, "x", 3, [], { question: "which?" }]) expect(reviewDetail(data)).toBeNull();
  });

  it("drops each field it can't read instead of guessing", () => {
    expect(reviewDetail({ branch: 4, commits: 1.5, subjects: ["ok", 7], judge: { verdict: "done" } })).toEqual({
      branch: null,
      commits: null,
      subjects: ["ok"],
      judge: null,
    });
    expect(reviewDetail({ commits: -1 })?.commits).toBeNull();
    expect(reviewDetail({ commits: null, judge: { verdict: "not_done", confidence: 0.4 } })).toEqual({
      branch: null,
      commits: null,
      subjects: [],
      judge: { verdict: "not_done", confidence: 0.4, reason: "" },
    });
  });
});
