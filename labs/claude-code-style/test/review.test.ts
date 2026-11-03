/**
 * A thread ready for review reads its run's review in a few short lines: a
 * real run's branch is long enough to run off the panel, so the card shows
 * the part that names the task, and the judge's verdict reads as one line.
 */
import { describe, expect, it } from "vitest";
import type { ReviewDetail } from "../src/adapter";
import { commitCount, judgeLine, shortBranch } from "../src/components/flow-state/review-hold";

const BRANCH = "conductor/t0/ha62422c9f1e0b7d4c2a8e5f3b1d6a9c0e4f7b2d-h0163a0cb8e2d4f6a1c3b5d7e9f0a2c4e6b8d0f1a/t-7f3c2e1a9b--code";
const review = (patch: Partial<ReviewDetail> = {}): ReviewDetail => ({
  branch: BRANCH,
  commits: 1,
  subjects: ["docs: note the vendor pick"],
  judge: { verdict: "done", confidence: 0.912, reason: "One line added." },
  ...patch,
});

describe("shortBranch", () => {
  it("keeps the last segment, which names the task and its phase, and drops the hashes before it", () => {
    expect(shortBranch(BRANCH)).toBe("…/t-7f3c2e1a9b--code");
  });

  it("cuts the middle of a long last segment, keeping its start and its phase", () => {
    const short = shortBranch("conductor/t0/a-very-long-task-identifier-0123456789--code");
    expect(short).toBe("…/a-very-lon…3456789--code");
    expect(short.length).toBeLessThan(30);
  });

  it("leaves a short one-segment branch as it is", () => {
    expect(shortBranch("main")).toBe("main");
  });
});

describe("the review's lines", () => {
  it("counts commits, and says so when they couldn't be read rather than reading as none", () => {
    expect(commitCount(review())).toBe("1 commit");
    expect(commitCount(review({ commits: 3 }))).toBe("3 commits");
    expect(commitCount(review({ commits: null }))).toBe("Commits couldn't be read");
  });

  it("puts the judge's verdict and confidence on one line, or says no judge read the run", () => {
    expect(judgeLine(review())).toBe("Judge: done, 0.91");
    expect(judgeLine(review({ judge: null }))).toBe("No judge read this run");
  });
});

describe("reviewStopOf", () => {
  // After a revise round the run stops for review again; the card must show that round, never
  // fall back to an older round's commits and verdict when the latest stop's data is unreadable.
  it("reads the latest review stop only", async () => {
    const { reviewStopOf } = await import("../src/adapter");
    const stop = (data: unknown) => ({ type: "suspension", kind: "review", data }) as Parameters<typeof reviewStopOf>[0][number];
    const earlier = stop({ branch: "t-1--code", commits: 1, subjects: ["first round"], judge: null });
    expect(reviewStopOf([earlier, stop({ question: "not a review's data" })])).toBeUndefined();
    expect(reviewStopOf([earlier, stop({ branch: "t-1--code", commits: 2, subjects: ["second", "first round"], judge: null })])?.commits).toBe(2);
  });
});
