/**
 * `mockEvaluationModel` drives an `evaluator` through `testBlock`: scripted
 * answers come back typed, a scripted confidence lands only where scripted,
 * calls are counted, and the failure modes fail the block.
 */
import { boolean, choice, evaluator } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { mockEvaluationModel, testBlock } from "../src";

const questions = {
  team: choice("Which team?", { billing: null, technical: null }),
  urgent: boolean("Urgent?"),
};

describe("mockEvaluationModel", () => {
  it("answers an evaluator with the scripted answers and counts the call", async () => {
    const model = mockEvaluationModel({
      answers: {
        team: { type: "choice", choice: "billing", confidence: 0.94 },
        urgent: { type: "boolean", probability: 0.2 },
      },
    });
    const result = await testBlock(evaluator({ name: "triage", model, questions }), {
      input: "I was charged twice",
    });

    expect(result.output.answers.team).toEqual({ type: "choice", choice: "billing", confidence: 0.94 });
    expect(result.output.answers.urgent).toEqual({ type: "boolean", probability: 0.2 });
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]!.state).toBe("I was charged twice");
  });

  it("fails the block with the scripted error", async () => {
    const model = mockEvaluationModel({ error: new Error("provider down") });
    const result = await testBlock(evaluator({ name: "triage", model, questions }), { input: "x" });
    expect(result.output).toBeUndefined();
    expect(result.error?.message).toMatch(/provider down/);
    expect(model.calls).toHaveLength(1);
  });

  it("fails the block when the scripted answers do not match the questions", async () => {
    const model = mockEvaluationModel({ answers: { team: { type: "choice", choice: "billing" } } });
    const result = await testBlock(evaluator({ name: "triage", model, questions }), { input: "x" });
    expect(result.output).toBeUndefined();
    expect(result.error?.message).toMatch(/exactly one answer for every question/);
  });
});
