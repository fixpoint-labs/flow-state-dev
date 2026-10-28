/**
 * The judge: a second reading of a run that passed the phase's own check,
 * against the task's goal, before the row closes.
 *
 * The phase's check knows whether the run ended well, not whether its answer
 * meets what was asked. The host's judge reads the goal, the answer and the
 * commits and says done, not done (the attempt fails with its reason, which
 * the next attempt is told), or ask (the task is held on its question). A
 * verdict under the host's floor counts as done. A judge that fails gives no
 * verdict, and the run settles on its check alone: an outage never fails work
 * that passed. Only a board read from the claim is judged.
 */
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { handler, sequencer } from "@flow-state-dev/core";
import { openRowQuestions } from "@flow-state-dev/orchestration/tasks";
import { harnessJudgeInputSchema, type HarnessJudgeInput } from "../src";
import { CONVERSATIONS, FIXED_BOARD, PHASE, claimHost, cleanUpHosts, messageOf } from "./claim-host";

afterAll(cleanUpHosts);

const FLOOR = 0.5;

/** A judge that answers from a script, one entry per call, and records what it read. */
function scriptedJudge(script: Array<unknown | Error>) {
  const read: HarnessJudgeInput[] = [];
  const block = handler({
    name: "scripted-judge",
    inputSchema: harnessJudgeInputSchema,
    outputSchema: z.unknown(),
    execute: (input) => {
      read.push(input);
      const next = script[read.length - 1];
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { judge: { block, floor: FLOOR }, read };
}

const verdict = (v: "done" | "not-done" | "ask", confidence: number, reason: string) => ({ verdict: v, confidence, reason });

describe("a judged run on a board read from the claim", () => {
  it("completes on done, judged, having read the goal, the answer and the commits", async () => {
    const { judge, read } = scriptedJudge([verdict("done", 0.9, "it answers the goal")]);
    const lab = claimHost({ mode: "claim", script: [{ answer: "two packages", commits: 1 }], manager: { judge } });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "how many packages?", input: {} });

    const { result } = await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    expect(result.error, messageOf(result.error)).toBeUndefined();

    const row = await lab.row(CONVERSATIONS, "t1", "conv-a");
    expect(row.status).toBe("completed");
    expect(row.output).toMatchObject({ answer: "two packages", commits: 1, judged: true });
    expect(read).toEqual([{ goal: "how many packages?", answer: "two packages", commits: { count: 1, subjects: ["call1 commit 0"] } }]);
  }, 60_000);

  it("fails the attempt on not done, tells the next attempt why, and ends errored on the second miss", async () => {
    const { judge } = scriptedJudge([
      verdict("not-done", 0.9, "the answer never reads the repository"),
      verdict("not-done", 0.9, "still guessing"),
    ]);
    const lab = claimHost({ mode: "claim", script: [{ answer: "I could not find it" }, { answer: "Storefront is a project." }], manager: { judge } });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "look at our repo", input: {}, maxAttempts: 2 });

    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    expect((await lab.row(CONVERSATIONS, "t1", "conv-a")).status).toBe("pending");
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");

    expect(lab.seen[1]!.prompt).toContain("FEEDBACK:");
    expect(lab.seen[1]!.prompt).toContain("the answer never reads the repository");
    const row = await lab.row(CONVERSATIONS, "t1", "conv-a");
    expect(row.status).toBe("errored");
    expect(row.error).toContain("still guessing");
  }, 60_000);

  it("holds the task on ask with the judge's question, and the answer's turn resumes the session on the same attempt", async () => {
    const { judge } = scriptedJudge([verdict("ask", 0.8, "which repository did you mean?"), verdict("done", 0.9, "fine")]);
    const lab = claimHost({ mode: "claim", script: [{ answer: "which one?" }, { answer: "storefront has two packages" }], manager: { judge } });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "look at our repo", input: {} });

    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    const held = await lab.row(CONVERSATIONS, "t1", "conv-a");
    expect(held).toMatchObject({ status: "in_progress", attempts: 1 });
    expect(openRowQuestions(held).map((hold) => hold.ask.prompt)).toEqual(["which repository did you mean?"]);

    await lab.act("answer", { ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", answer: "storefront" });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");

    expect(lab.seen[1]!.prompt).toContain("ANSWERED: which repository did you mean? => storefront");
    expect(lab.seen[1]!.resume).toBe("sess_1");
    expect(await lab.row(CONVERSATIONS, "t1", "conv-a")).toMatchObject({ status: "completed", attempts: 1, output: { judged: true } });
  }, 60_000);

  it("completes a not-done under the floor, judged", async () => {
    const { judge } = scriptedJudge([verdict("not-done", FLOOR - 0.1, "not sure")]);
    const lab = claimHost({ mode: "claim", script: [{ answer: "an answer" }], manager: { judge } });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "look at our repo", input: {} });

    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");

    expect(await lab.row(CONVERSATIONS, "t1", "conv-a")).toMatchObject({ status: "completed", output: { judged: true } });
  }, 60_000);

  it.each([
    ["throws", new Error("the gateway is down")],
    ["answers something that is not a verdict", { thumbs: "up" }],
    // Out of range would read as sure enough under any floor: not a verdict.
    ["answers a not-done with a confidence over 1", verdict("not-done", 2, "very sure")],
  ])("settles on the phase's check alone when the judge %s", async (_how, answer) => {
    const { judge, read } = scriptedJudge([answer]);
    const lab = claimHost({ mode: "claim", script: [{ answer: "an answer" }], manager: { judge } });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "look at our repo", input: {} });

    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");

    expect(read).toHaveLength(1);
    expect(await lab.row(CONVERSATIONS, "t1", "conv-a")).toMatchObject({ status: "completed", output: { judged: false } });
  }, 60_000);
});

describe("a composite judge", () => {
  it("settles on the phase's check alone when a step inside it fails", async () => {
    // A judge is usually a sequencer around an evaluator: a failure inside it is still no verdict.
    const reading = handler({
      name: "judge-reading",
      inputSchema: harnessJudgeInputSchema,
      outputSchema: z.unknown(),
      execute: () => {
        throw new Error("the gateway is down");
      },
    });
    const block = sequencer({ name: "composite-judge", inputSchema: harnessJudgeInputSchema }).step(reading);
    const lab = claimHost({ mode: "claim", script: [{ answer: "an answer" }], manager: { judge: { block: block as never, floor: FLOOR } } });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "look at our repo", input: {} });

    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");

    expect(await lab.row(CONVERSATIONS, "t1", "conv-a")).toMatchObject({ status: "completed", attempts: 1, output: { judged: false } });
  }, 60_000);
});

describe("the judge's floor", () => {
  it.each([[-0.1], [1.5], [Number.NaN]])("is refused when the manager is built, at %s", (floor) => {
    const { judge } = scriptedJudge([]);
    expect(() => claimHost({ mode: "claim", manager: { judge: { ...judge, floor } } })).toThrow(/floor is a confidence, from 0 to 1/);
  });
});

describe("a run the judge does not read", () => {
  it("never judges a fixed board's row", async () => {
    const { judge, read } = scriptedJudge([verdict("not-done", 1, "never asked")]);
    const lab = claimHost({ mode: "fixed", script: [{ answer: "implemented", commits: 1 }], manager: { judge } });
    await lab.seed({ ledgerId: FIXED_BOARD, id: "fix-1--implement", goal: "the feature", input: { issue: "FIX-1", phase: PHASE } });

    await lab.runAttempt(FIXED_BOARD, "fix-1--implement");

    expect(read).toHaveLength(0);
    expect(await lab.row(FIXED_BOARD, "fix-1--implement")).toMatchObject({ status: "completed", output: { judged: false } });
  }, 60_000);
});
