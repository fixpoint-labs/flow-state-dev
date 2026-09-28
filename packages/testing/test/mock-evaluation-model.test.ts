/**
 * `mockEvaluationModel` drives an `evaluator` through `testBlock`: scripted
 * answers come back typed, a scripted confidence lands only where scripted,
 * calls are counted, and the failure modes fail the block.
 */
import { boolean, choice, evaluator } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { createMockModelResolver, mockEvaluationModel, testBlock } from "../src";

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

  it("answers from the state it is handed when the answers are a function", async () => {
    // A script that reads its state is what lets one scripted evaluation route
    // several posts: the answer depends on what was asked, not on call order.
    const model = mockEvaluationModel({
      answers: ({ state }) => ({
        team: { type: "choice", choice: String(state).includes("charged") ? "billing" : "technical" },
        urgent: { type: "boolean", probability: 0.2 },
      }),
    });
    const triage = evaluator({ name: "triage", model, questions });
    const billing = await testBlock(triage, { input: "I was charged twice" });
    const technical = await testBlock(triage, { input: "The page is blank" });
    expect(billing.output.answers.team.choice).toBe("billing");
    expect(technical.output.answers.team.choice).toBe("technical");
  });

  it("fails the call when the answers function throws", async () => {
    const model = mockEvaluationModel({
      answers: () => {
        throw new Error("no idea");
      },
    });
    const result = await testBlock(evaluator({ name: "triage", model, questions }), { input: "x" });
    expect(result.output).toBeUndefined();
    expect(result.error?.message).toMatch(/no idea/);
    expect(model.calls).toHaveLength(1);
  });

  it("fails the block when the scripted answers do not match the questions", async () => {
    const model = mockEvaluationModel({ answers: { team: { type: "choice", choice: "billing" } } });
    const result = await testBlock(evaluator({ name: "triage", model, questions }), { input: "x" });
    expect(result.output).toBeUndefined();
    expect(result.error?.message).toMatch(/exactly one answer for every question/);
  });
});

describe("createMockModelResolver's evaluators", () => {
  it("resolves an evaluator's model string to the evaluation scripted under its block name", async () => {
    // A block that names a model string is how an app writes an evaluator; the
    // scripted model has to reach it through the resolver, keyed as generators are.
    const scripted = mockEvaluationModel({
      answers: {
        team: { type: "choice", choice: "technical" },
        urgent: { type: "boolean", probability: 0.9 },
      },
    });
    const other = mockEvaluationModel({ error: new Error("the wrong block's script ran") });
    const modelResolver = createMockModelResolver({ evaluators: { triage: scripted, other } });
    const result = await testBlock(evaluator({ name: "triage", model: "typesafe-ai/jev", questions }), {
      input: "The page is blank",
      modelResolver,
    });
    expect(result.error).toBeFalsy();
    expect(result.output.answers.team.choice).toBe("technical");
    expect(scripted.calls).toHaveLength(1);
    expect(other.calls).toHaveLength(0);
  });

  it("refuses a block it has no evaluation scripted for, naming the block", async () => {
    const modelResolver = createMockModelResolver({ evaluators: {} });
    const result = await testBlock(evaluator({ name: "triage", model: "typesafe-ai/jev", questions }), {
      input: "x",
      modelResolver,
    });
    expect(result.error?.message).toMatch(/evaluators\["triage"\]/);
  });

  it("keeps a resolver built without evaluators refusing model strings, as before", async () => {
    const result = await testBlock(evaluator({ name: "triage", model: "typesafe-ai/jev", questions }), {
      input: "x",
      modelResolver: createMockModelResolver({}),
    });
    expect(result.error?.message).toMatch(/resolveEvaluationModel/);
  });
});
