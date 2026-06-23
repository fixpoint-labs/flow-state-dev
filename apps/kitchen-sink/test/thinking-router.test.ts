import { beforeEach, describe, expect, it } from "vitest";
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import {
  mockGenerator,
  testSequencer,
} from "@flow-state-dev/testing";
import {
  keywordHandler,
  autoClassifyStyle,
} from "../flows/chat-agent/run/thinking-styles/classify";
import { thinkingStyleSchema } from "../flows/chat-agent/shared/schemas";

// Minimal flow instance for thinking router tests.
const testFlow = defineFlow({
  kind: "thinking-router-test",
  actions: {
    run: {
      inputSchema: z.object({ message: z.string() }),
      block: autoClassifyStyle,
    },
  },
  session: {
    stateSchema: z.object({
      thinkingStyle: thinkingStyleSchema.optional(),
    }),
  },
})({ id: "test" });

// Wrap the keyword handler in a sequencer with state for isolated testing.
const keywordTestSeq = sequencer({
  name: "keyword-test",
  inputSchema: z.object({ message: z.string() }),
  stateSchema: z.object({
    keywordMatched: z.boolean().default(false),
  }),
}).tap(keywordHandler);

// Mock for the intent classifier generator inside Tier 2.
const classifierFixture = mockGenerator({
  name: "thinking-style-classifier",
  script: [
    {
      structuredOutput: {
        category: "default",
        confidence: 0.9,
        reasoning: "Direct question",
      },
    },
  ],
});

describe("thinking style detector — Tier 1 (keyword handler)", () => {
  it("selects supervisor for delegation keywords", async () => {
    const result = await testSequencer(keywordTestSeq, {
      input: { message: "Please coordinate the team effort" },
      flow: testFlow,
    });

    expect(result.error).toBeNull();
    expect(result.output).toEqual({
      message: "Please coordinate the team effort",
    });
    expect(result.state.session).toMatchObject({ thinkingStyle: "supervisor" });
  });

  it("selects plan-and-execute for planning keywords", async () => {
    const result = await testSequencer(keywordTestSeq, {
      input: { message: "Break down this feature into steps" },
      flow: testFlow,
    });

    expect(result.error).toBeNull();
    expect(result.state.session).toMatchObject({ thinkingStyle: "plan-and-execute" });
  });

  it("selects routed-specialists for multi-perspective keywords", async () => {
    const result = await testSequencer(keywordTestSeq, {
      input: { message: "Analyze this from multiple perspectives using expert perspectives" },
      flow: testFlow,
    });

    expect(result.error).toBeNull();
    expect(result.state.session).toMatchObject({ thinkingStyle: "routed-specialists" });
  });

  it("does not match reasoning keywords (no CoT style)", async () => {
    const result = await testSequencer(keywordTestSeq, {
      input: { message: "Explain why this approach works" },
      flow: testFlow,
    });

    expect(result.error).toBeNull();
    expect(result.state.session.thinkingStyle).toBeUndefined();
  });

  it("is case-insensitive", async () => {
    const result = await testSequencer(keywordTestSeq, {
      input: { message: "DELEGATE this task to sub-agents" },
      flow: testFlow,
    });

    expect(result.error).toBeNull();
    expect(result.state.session).toMatchObject({ thinkingStyle: "supervisor" });
  });

  it("makes no sequencer state mutations when no keywords match", async () => {
    const result = await testSequencer(keywordTestSeq, {
      input: { message: "Hello, how are you?" },
      flow: testFlow,
    });

    expect(result.error).toBeNull();
    expect(result.output).toEqual({ message: "Hello, how are you?" });
    const seqChanges = result.stateChanges.filter(
      (c) => c.scope === "block_instance",
    );
    expect(seqChanges).toHaveLength(0);
    expect(result.state.session.thinkingStyle).toBeUndefined();
  });

  it("prioritizes supervisor over plan keywords when both present", async () => {
    const result = await testSequencer(keywordTestSeq, {
      input: { message: "Coordinate a plan with steps" },
      flow: testFlow,
    });

    expect(result.error).toBeNull();
    expect(result.state.session).toMatchObject({ thinkingStyle: "supervisor" });
  });

  it("selects moderated-debate for debate keywords", async () => {
    const result = await testSequencer(keywordTestSeq, {
      input: { message: "Argue both sides of microservices vs monolith" },
      flow: testFlow,
    });

    expect(result.error).toBeNull();
    expect(result.state.session).toMatchObject({
      thinkingStyle: "moderated-debate",
    });
  });

  it("prefers debate over plan when 'should we' is used", async () => {
    // "should we" is in DEBATE_KEYWORDS; the debate branch runs ahead of
    // the plan-keyword branch in the handler.
    const result = await testSequencer(keywordTestSeq, {
      input: { message: "Should we adopt event sourcing for the order service?" },
      flow: testFlow,
    });

    expect(result.error).toBeNull();
    expect(result.state.session).toMatchObject({
      thinkingStyle: "moderated-debate",
    });
  });
});

describe("thinking style detector — full (Tier 1 + Tier 2)", () => {
  beforeEach(() => {
    classifierFixture.reset();
  });

  it("resolves via keywords and writes to session state", async () => {
    const result = await testSequencer(autoClassifyStyle, {
      input: { message: "Outline a roadmap for this project" },
      flow: testFlow,
      generators: {
        "thinking-style-classifier": classifierFixture,
      },
    });

    expect(result.error).toBeNull();
    expect(result.state.session).toMatchObject({
      thinkingStyle: "plan-and-execute",
    });
  });

  it("falls back to LLM classifier when no keywords match", async () => {
    const result = await testSequencer(autoClassifyStyle, {
      input: { message: "Hello, how are you?" },
      flow: testFlow,
      generators: {
        "thinking-style-classifier": classifierFixture,
      },
    });

    expect(result.error).toBeNull();
    expect(result.state.session).toMatchObject({
      thinkingStyle: "default",
    });
  });

  it("LLM classifier can select plan-and-execute", async () => {
    const paeClassifier = mockGenerator({
      name: "thinking-style-classifier",
      script: [
        {
          structuredOutput: {
            category: "plan-and-execute",
            confidence: 0.85,
            reasoning: "Structured task",
          },
        },
      ],
    });

    const result = await testSequencer(autoClassifyStyle, {
      input: { message: "Write a comprehensive report on market trends" },
      flow: testFlow,
      generators: {
        "thinking-style-classifier": paeClassifier,
      },
    });

    expect(result.error).toBeNull();
    expect(result.state.session).toMatchObject({
      thinkingStyle: "plan-and-execute",
    });
  });

  it("LLM classifier can select moderated-debate", async () => {
    const debateClassifier = mockGenerator({
      name: "thinking-style-classifier",
      script: [
        {
          structuredOutput: {
            category: "moderated-debate",
            confidence: 0.85,
            reasoning: "Adversarial question",
          },
        },
      ],
    });

    const result = await testSequencer(autoClassifyStyle, {
      input: { message: "Evaluate the case for and against this decision" },
      flow: testFlow,
      generators: {
        "thinking-style-classifier": debateClassifier,
      },
    });

    expect(result.error).toBeNull();
    expect(result.state.session).toMatchObject({
      thinkingStyle: "moderated-debate",
    });
  });

  it("falls back to default when LLM confidence is below threshold", async () => {
    const lowConfidence = mockGenerator({
      name: "thinking-style-classifier",
      script: [
        {
          structuredOutput: {
            category: "supervisor",
            confidence: 0.4,
            reasoning: "Uncertain",
          },
        },
      ],
    });

    const result = await testSequencer(autoClassifyStyle, {
      input: { message: "Do something interesting" },
      flow: testFlow,
      generators: {
        "thinking-style-classifier": lowConfidence,
      },
    });

    expect(result.error).toBeNull();
    expect(result.state.session).toMatchObject({
      thinkingStyle: "default",
    });
  });
});
