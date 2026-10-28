/**
 * What a completed run hands back: the run's answer, its branch and how many
 * commits it made, beside the issue, phase and session it always returned.
 *
 * A task a conversation filed is read off its row's output by the
 * conversation, so the answer is the result. It is cut at a fixed size, so
 * a run that writes a book does not put one on the row. The fields are
 * additive: a feature row's output keeps every field it had.
 */
import { afterAll, describe, expect, it } from "vitest";
import { runTopic } from "../src";
import { runBoardSegment } from "../src/workspace";
import { CONVERSATIONS, FIXED_BOARD, PHASE, claimHost, cleanUpHosts, messageOf } from "./claim-host";

afterAll(cleanUpHosts);

describe("a completed run's output", () => {
  it("carries the answer, the branch and the commits the run made", async () => {
    const lab = claimHost({ mode: "claim", script: [{ answer: "the repo has two packages", commits: 2 }] });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "look at the repo", input: {} });

    const { result } = await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    expect(result.error, messageOf(result.error)).toBeUndefined();

    const record = await lab.record(runTopic(runBoardSegment(CONVERSATIONS, "conv-a"), "t1", PHASE));
    const row = await lab.row(CONVERSATIONS, "t1", "conv-a");
    expect(row.status).toBe("completed");
    expect(row.output).toMatchObject({
      issue: "t1",
      phase: PHASE,
      sessionId: "sess_1",
      answer: "the repo has two packages",
      branch: record!.branch,
      commits: 2,
      judged: false,
    });
    // The phase's own check reads the answer too.
    expect(lab.answersSeen).toEqual(["the repo has two packages"]);
  }, 60_000);

  it("cuts a long answer at 8,000 characters, and counts no commits for a run that made none", async () => {
    const long = "x".repeat(9_000);
    const lab = claimHost({ mode: "claim", script: [{ answer: long }] });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "look at the repo", input: {} });

    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");

    const output = (await lab.row(CONVERSATIONS, "t1", "conv-a")).output as { answer: string; commits: number };
    expect(output.answer).toBe(long.slice(0, 8_000));
    expect(output.commits).toBe(0);
  }, 60_000);

  it("keeps a feature row's fields, and adds the new ones", async () => {
    const lab = claimHost({ mode: "fixed", script: [{ answer: "implemented", commits: 1 }] });
    await lab.seed({ ledgerId: FIXED_BOARD, id: "fix-1--implement", goal: "the feature", input: { issue: "FIX-1", phase: PHASE } });

    await lab.runAttempt(FIXED_BOARD, "fix-1--implement");

    const record = await lab.record(runTopic(FIXED_BOARD, "FIX-1", PHASE));
    expect((await lab.row(FIXED_BOARD, "fix-1--implement")).output).toEqual({
      issue: "FIX-1",
      phase: PHASE,
      sessionId: "sess_1",
      answer: "implemented",
      branch: record!.branch,
      commits: 1,
      judged: false,
      // No review was asked: a manager built without `reviewChanges`.
      review: null,
    });
  }, 60_000);
});
