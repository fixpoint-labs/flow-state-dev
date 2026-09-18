/**
 * typesafeEvaluate is a handler. Secrets stay on the host. Questions come
 * from the factory or the input — never a free-text prompt.
 */
import { describe, expect, it } from "vitest";
import { FlowError } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { typesafeEvaluate, jevDecide } from "../src/evaluate";
import { choice, noul } from "../src/schemas";
import { BILLING_RESULT, scriptedClient } from "./scripted-client";

const QUESTIONS = {
  department: choice("Which team?", {
    billing: "Payments",
    technical: "Bugs",
  }),
  urgent: noul("Is this urgent?"),
};

describe("typesafeEvaluate", () => {
  it("returns a handler block, not a generator", () => {
    const block = typesafeEvaluate({ name: "classify", questions: QUESTIONS });
    expect(block.kind).toBe("handler");
    expect(block.name).toBe("classify");
    expect(jevDecide).toBe(typesafeEvaluate);
  });

  it("posts factory questions with the input state through the injected client", async () => {
    const { client, calls } = scriptedClient(BILLING_RESULT);
    const block = typesafeEvaluate({
      name: "classify",
      questions: QUESTIONS,
      client,
    });

    const result = await testBlock(block, {
      input: { state: "My card was charged twice." },
    });

    expect(result.error).toBeNull();
    expect(result.output).toEqual(BILLING_RESULT);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.request).toMatchObject({
      state: "My card was charged twice.",
      questions: QUESTIONS,
      model: "~typesafe/jev-latest",
    });
  });

  it("lets input questions override the factory map", async () => {
    const { client, calls } = scriptedClient(BILLING_RESULT);
    const override = { only: noul("Is this a billing issue?") };
    const block = typesafeEvaluate({
      name: "classify",
      questions: QUESTIONS,
      client,
    });

    await testBlock(block, {
      input: { state: { ticket: "x" }, questions: override },
    });

    expect(calls[0]?.request.questions).toEqual(override);
    expect(calls[0]?.request.state).toEqual({ ticket: "x" });
  });

  it("throws when neither factory nor input supplies questions", async () => {
    const { client } = scriptedClient(BILLING_RESULT);
    const block = typesafeEvaluate({ name: "classify", client });

    const result = await testBlock(block, {
      input: { state: "hello" },
    });

    expect(result.error).toBeInstanceOf(FlowError);
    expect((result.error as FlowError).code).toBe("missing_questions");
    expect(String(result.error)).toContain("questions map");
  });

  it("does not read an apiKey smuggled on action input", async () => {
    const { client, calls } = scriptedClient(BILLING_RESULT);
    const block = typesafeEvaluate({
      name: "classify",
      questions: QUESTIONS,
      client,
    });

    const result = await testBlock(block, {
      input: {
        state: "hello",
        apiKey: "sk-attacker",
      } as { state: string },
    });

    expect(result.error).toBeNull();
    expect(JSON.stringify(calls[0]?.request)).not.toContain("sk-attacker");
    expect(JSON.stringify(calls[0]?.request)).not.toContain("apiKey");
  });

  it("refuses to call OpenRouter when no client is injected and no host key is set", async () => {
    const previous = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const block = typesafeEvaluate({
        name: "classify",
        questions: QUESTIONS,
      });
      const result = await testBlock(block, {
        input: { state: "hello" },
      });
      expect(result.error).toBeInstanceOf(FlowError);
      expect((result.error as FlowError).code).toBe("missing_api_key");
      expect(String(result.error)).toContain("OPENROUTER_API_KEY");
    } finally {
      if (previous !== undefined) process.env.OPENROUTER_API_KEY = previous;
    }
  });
});
