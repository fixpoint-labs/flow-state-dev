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
      lands: [],
      landFailed: null,
      landAttempts: [],
      checks: null,
    });
  });

  it("reads the ways an accept can land, and the last landing that failed, dropping what it can't read", () => {
    const failed = { land: "merge", message: "Merging conflicts in a.txt." };
    expect(reviewDetail({ branch: "b", lands: ["pull-request", "merge", "deploy", 3], landFailed: failed })).toMatchObject({
      lands: ["pull-request", "merge"],
      landFailed: failed,
    });
    expect(reviewDetail({ branch: "b", lands: "merge", landFailed: { land: "deploy", message: "x" } })).toMatchObject({
      lands: [],
      landFailed: null,
    });
    // Each try of the last landing, oldest first, dropping what isn't one.
    expect(reviewDetail({ branch: "b", landAttempts: [failed, { land: "deploy", message: "x" }, "y"] })?.landAttempts).toEqual([failed]);
  });

  it("is null for data that is no review", () => {
    for (const data of [undefined, null, "x", 3, [], { question: "which?" }]) expect(reviewDetail(data)).toBeNull();
  });

  it("is null when none of a review's fields is readable, so the card shows the stop's prompt", () => {
    for (const data of [{ judge: null }, { commits: -1 }, { branch: null, commits: null, subjects: [], judge: null }])
      expect(reviewDetail(data)).toBeNull();
  });

  it("drops each field it can't read instead of guessing", () => {
    expect(reviewDetail({ branch: 4, commits: 1.5, subjects: ["ok", 7], judge: { verdict: "done" } })).toEqual({
      branch: null,
      commits: null,
      subjects: ["ok"],
      judge: null,
      lands: [],
      landFailed: null,
      landAttempts: [],
      checks: null,
    });
    expect(reviewDetail({ branch: "b", commits: -1 })?.commits).toBeNull();
    expect(reviewDetail({ commits: null, judge: { verdict: "not_done", confidence: 0.4 } })).toEqual({
      branch: null,
      commits: null,
      subjects: [],
      judge: { verdict: "not_done", confidence: 0.4, reason: "" },
      lands: [],
      landFailed: null,
      landAttempts: [],
      checks: null,
    });
  });

  it("reads the checks the phase ran, red ones included, so the card can say which command failed", () => {
    const red = { command: "pnpm test", exitCode: 1, timedOut: false, skipped: false, durationMs: 900, tail: "1 failed" };
    const green = { command: "pnpm typecheck", exitCode: 0, timedOut: false, skipped: false, durationMs: 1200, tail: "" };
    expect(reviewDetail({ branch: "b", checks: [green, red] })?.checks).toEqual([green, red]);
    // A review with nothing but checks is still a review.
    expect(reviewDetail({ checks: [red] })?.checks).toEqual([red]);
  });

  it("drops a check it can't read, and is null when none ran", () => {
    const ok = { command: "pnpm test", exitCode: null, timedOut: true, skipped: false, durationMs: 5, tail: "" };
    expect(reviewDetail({ branch: "b", checks: [ok, { command: 4 }, "x", { command: "c", exitCode: "0", timedOut: false, skipped: false }] })?.checks).toEqual([ok]);
    for (const checks of [undefined, null, [], "pnpm test", [{ exitCode: 0 }]]) expect(reviewDetail({ branch: "b", checks })?.checks).toBeNull();
  });
});
