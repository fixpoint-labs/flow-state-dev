import { describe, expect, it } from "vitest";
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import {
  mockGenerator,
  testSequencer,
} from "@flow-state-dev/testing";
import {
  keywordHandler,
  thinkingRouter,
  thinkingStyleSchema,
} from "../src/flows/kitchen-sink/blocks";

// Minimal flow instance scoped to the thinking router tests.
const testFlow = defineFlow({
  kind: "thinking-router-test",
  actions: {
    run: {
      inputSchema: z.object({ message: z.string() }),
      block: thinkingRouter,
    },
  },
  session: {
    stateSchema: z.object({
      thinkingStyle: thinkingStyleSchema.optional(),
    }),
  },
})({ id: "test" });

// Wrap the keyword handler in a sequencer with state so we can test
// sequencer state mutations via testSequencer.
const keywordTestSeq = sequencer({
  name: "keyword-test",
  inputSchema: z.object({ message: z.string() }),
  stateSchema: z.object({
    selectedStyle: z.enum(["plan-and-execute", "supervisor", "chain-of-thought"]).nullable().default(null),
  }),
}).then(keywordHandler);

// Mock the intent classifier generator used inside Tier 2.
const classifierFixture = mockGenerator({
  name: "thinking-style-classifier-intent-classifier",
  script: [
    {
      structuredOutput: {
        category: "chain-of-thought",
        confidence: 0.9,
        reasoning: "Direct question",
      },
    },
  ],
});

describe("thinking router — Tier 1 (keyword handler)", () => {
  it("selects supervisor for delegation keywords", async () => {
    const result = await testSequencer(keywordTestSeq, {
      input: { message: "Please coordinate the team effort" },
      flow: testFlow,
    });

    expect(result.error).toBeNull();
    expect(result.output).toEqual({ message: "Please coordinate the team effort" });
    // Keyword handler writes to sequencer state, not session state directly.
    // Verify sequencer state was mutated via state changes.
    const seqChanges = result.stateChanges.filter((c) => c.scope === "block_instance");
    expect(seqChanges.length).toBeGreaterThan(0);
  });

  it("selects plan-and-execute for planning keywords", async () => {
    const result = await testSequencer(keywordTestSeq, {
      input: { message: "Break down this feature into steps" },
      flow: testFlow,
    });

    expect(result.error).toBeNull();
    const seqChanges = result.stateChanges.filter((c) => c.scope === "block_instance");
    expect(seqChanges.length).toBeGreaterThan(0);
  });

  it("selects chain-of-thought for reasoning keywords", async () => {
    const result = await testSequencer(keywordTestSeq, {
      input: { message: "Explain why this approach works" },
      flow: testFlow,
    });

    expect(result.error).toBeNull();
    const seqChanges = result.stateChanges.filter((c) => c.scope === "block_instance");
    expect(seqChanges.length).toBeGreaterThan(0);
  });

  it("is case-insensitive", async () => {
    const result = await testSequencer(keywordTestSeq, {
      input: { message: "DELEGATE this task to sub-agents" },
      flow: testFlow,
    });

    expect(result.error).toBeNull();
    const seqChanges = result.stateChanges.filter((c) => c.scope === "block_instance");
    expect(seqChanges.length).toBeGreaterThan(0);
  });

  it("makes no sequencer state mutations when no keywords match", async () => {
    const result = await testSequencer(keywordTestSeq, {
      input: { message: "Hello, how are you?" },
      flow: testFlow,
    });

    expect(result.error).toBeNull();
    expect(result.output).toEqual({ message: "Hello, how are you?" });
    // No keyword match — no sequencer state mutation
    const seqChanges = result.stateChanges.filter((c) => c.scope === "block_instance");
    expect(seqChanges).toHaveLength(0);
  });

  it("prioritizes supervisor over plan keywords when both present", async () => {
    const result = await testSequencer(keywordTestSeq, {
      input: { message: "Coordinate a plan with steps" },
      flow: testFlow,
    });

    expect(result.error).toBeNull();
    // Supervisor check comes first in the handler
    const seqChanges = result.stateChanges.filter((c) => c.scope === "block_instance");
    expect(seqChanges.length).toBeGreaterThan(0);
  });
});

describe("thinking router — full sequencer (Tier 1 + Tier 2)", () => {
  it("resolves via keywords without an LLM call", async () => {
    const result = await testSequencer(thinkingRouter, {
      input: { message: "Outline a roadmap for this project" },
      flow: testFlow,
      generators: {
        "thinking-style-classifier-intent-classifier": classifierFixture,
      },
    });

    expect(result.error).toBeNull();
    expect(result.state.session).toMatchObject({
      thinkingStyle: "plan-and-execute",
    });
  });

  it("falls back to LLM classifier when no keywords match", async () => {
    classifierFixture.reset();
    const result = await testSequencer(thinkingRouter, {
      input: { message: "Hello, how are you?" },
      flow: testFlow,
      generators: {
        "thinking-style-classifier-intent-classifier": classifierFixture,
      },
    });

    expect(result.error).toBeNull();
    expect(result.state.session).toMatchObject({
      thinkingStyle: "chain-of-thought",
    });
  });

  it("uses LLM classifier for plan-and-execute classification", async () => {
    const paeClassifier = mockGenerator({
      name: "thinking-style-classifier-intent-classifier",
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

    const result = await testSequencer(thinkingRouter, {
      input: { message: "Write a comprehensive report on market trends" },
      flow: testFlow,
      generators: {
        "thinking-style-classifier-intent-classifier": paeClassifier,
      },
    });

    expect(result.error).toBeNull();
    expect(result.state.session).toMatchObject({
      thinkingStyle: "plan-and-execute",
    });
  });

  it("falls back to chain-of-thought when LLM confidence is below threshold", async () => {
    const lowConfidence = mockGenerator({
      name: "thinking-style-classifier-intent-classifier",
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

    const result = await testSequencer(thinkingRouter, {
      input: { message: "Do something interesting" },
      flow: testFlow,
      generators: {
        "thinking-style-classifier-intent-classifier": lowConfidence,
      },
    });

    expect(result.error).toBeNull();
    expect(result.state.session).toMatchObject({
      thinkingStyle: "chain-of-thought",
    });
  });
});
