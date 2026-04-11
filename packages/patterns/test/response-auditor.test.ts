import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  responseAuditor,
  captureContext,
  aggregateResults,
  AnalyzerResultSchema,
  auditorInputSchema,
  responseAuditorStateSchema,
} from "../src/response-auditor";

// ---------------------------------------------------------------------------
// Example Analyzers
// ---------------------------------------------------------------------------

/**
 * Trivial "echo" analyzer for testing the pattern independently.
 * Always returns a single annotation with a fixed score.
 */
const echoAnalyzer = handler({
  name: "echo-analyzer",
  inputSchema: auditorInputSchema,
  outputSchema: AnalyzerResultSchema,
  execute: (input) => ({
    analyzerId: "echo",
    category: "test",
    score: 0.5,
    shouldSurface: true,
    annotations: [
      {
        type: "echo",
        label: "Echo Detection",
        severity: "info" as const,
        description: `Echoed input of length ${input.userInput.length}`,
        evidence: input.userInput.slice(0, 50),
      },
    ],
  }),
});

/**
 * Analyzer that always returns a low score — should be filtered by threshold.
 */
const lowScoreAnalyzer = handler({
  name: "low-score-analyzer",
  inputSchema: auditorInputSchema,
  outputSchema: AnalyzerResultSchema,
  execute: () => ({
    analyzerId: "low-score",
    category: "test",
    score: 0.1,
    shouldSurface: false,
    annotations: [
      {
        type: "low",
        label: "Low Score Finding",
        severity: "info" as const,
        description: "This should be filtered out by threshold",
      },
    ],
  }),
});

/**
 * Analyzer that always returns a high/critical score.
 */
const criticalAnalyzer = handler({
  name: "critical-analyzer",
  inputSchema: auditorInputSchema,
  outputSchema: AnalyzerResultSchema,
  execute: (input) => ({
    analyzerId: "critical",
    category: "compliance",
    score: 0.9,
    shouldSurface: true,
    annotations: [
      {
        type: "policy_violation",
        label: "Policy Violation",
        severity: "critical" as const,
        description: "Response contains flagged content",
        evidence: input.response.slice(0, 30),
      },
    ],
  }),
});

/**
 * Analyzer that throws — should be handled gracefully.
 */
const failingAnalyzer = handler({
  name: "failing-analyzer",
  inputSchema: auditorInputSchema,
  outputSchema: AnalyzerResultSchema,
  execute: () => {
    throw new Error("Analyzer internal error");
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("response auditor pattern", () => {
  it("runs a single analyzer and returns results", async () => {
    const auditor = responseAuditor({
      analyzers: [echoAnalyzer],
      threshold: 0.3,
    });

    const result = await testBlock(auditor, {
      input: { userInput: "Hello world", response: "Hi there!" },
    });

    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();

    const output = result.output as {
      results: z.infer<typeof AnalyzerResultSchema>[];
      surfacedResults: z.infer<typeof AnalyzerResultSchema>[];
      overallScore: number;
    };

    expect(output.results).toHaveLength(1);
    expect(output.results[0].analyzerId).toBe("echo");
    expect(output.surfacedResults).toHaveLength(1);
    expect(output.overallScore).toBe(0.5);
  });

  it("runs multiple analyzers in parallel", async () => {
    const auditor = responseAuditor({
      analyzers: [echoAnalyzer, criticalAnalyzer],
      threshold: 0.3,
    });

    const result = await testBlock(auditor, {
      input: { userInput: "Test input", response: "Test response" },
    });

    expect(result.error).toBeNull();

    const output = result.output as {
      results: z.infer<typeof AnalyzerResultSchema>[];
      surfacedResults: z.infer<typeof AnalyzerResultSchema>[];
      overallScore: number;
    };

    expect(output.results).toHaveLength(2);
    expect(output.surfacedResults).toHaveLength(2);
    // Average of 0.5 and 0.9
    expect(output.overallScore).toBe(0.7);
  });

  it("applies threshold filtering correctly", async () => {
    const auditor = responseAuditor({
      analyzers: [echoAnalyzer, lowScoreAnalyzer],
      threshold: 0.3,
    });

    const result = await testBlock(auditor, {
      input: { userInput: "Test", response: "Response" },
    });

    expect(result.error).toBeNull();

    const output = result.output as {
      results: z.infer<typeof AnalyzerResultSchema>[];
      surfacedResults: z.infer<typeof AnalyzerResultSchema>[];
      overallScore: number;
    };

    // Both results collected
    expect(output.results).toHaveLength(2);
    // Only echoAnalyzer passes threshold (score 0.5 >= 0.3, shouldSurface true)
    // lowScoreAnalyzer filtered (score 0.1 < 0.3, shouldSurface false)
    expect(output.surfacedResults).toHaveLength(1);
    expect(output.surfacedResults[0].analyzerId).toBe("echo");
  });

  it("surfaces results when shouldSurface is true regardless of threshold", async () => {
    const alwaysSurfaceAnalyzer = handler({
      name: "always-surface",
      inputSchema: auditorInputSchema,
      outputSchema: AnalyzerResultSchema,
      execute: () => ({
        analyzerId: "always-surface",
        category: "test",
        score: 0.05, // Very low score
        shouldSurface: true, // But explicitly requests surfacing
        annotations: [
          {
            type: "notice",
            label: "Always Surfaced",
            severity: "info" as const,
            description: "This should always appear",
          },
        ],
      }),
    });

    const auditor = responseAuditor({
      analyzers: [alwaysSurfaceAnalyzer],
      threshold: 0.5,
    });

    const result = await testBlock(auditor, {
      input: { userInput: "Test", response: "Response" },
    });

    const output = result.output as {
      surfacedResults: z.infer<typeof AnalyzerResultSchema>[];
    };

    expect(output.surfacedResults).toHaveLength(1);
    expect(output.surfacedResults[0].analyzerId).toBe("always-surface");
  });

  it("handles analyzer failures gracefully", async () => {
    const auditor = responseAuditor({
      analyzers: [echoAnalyzer, failingAnalyzer],
      threshold: 0.3,
    });

    const result = await testBlock(auditor, {
      input: { userInput: "Test", response: "Response" },
    });

    // Should not fail — failing analyzer is silently skipped
    expect(result.error).toBeNull();

    const output = result.output as {
      results: z.infer<typeof AnalyzerResultSchema>[];
    };

    // Only the successful analyzer's result
    expect(output.results).toHaveLength(1);
    expect(output.results[0].analyzerId).toBe("echo");
  });

  it("returns empty surfaced results when all below threshold", async () => {
    const auditor = responseAuditor({
      analyzers: [lowScoreAnalyzer],
      threshold: 0.5,
    });

    const result = await testBlock(auditor, {
      input: { userInput: "Test", response: "Response" },
    });

    expect(result.error).toBeNull();

    const output = result.output as {
      results: z.infer<typeof AnalyzerResultSchema>[];
      surfacedResults: z.infer<typeof AnalyzerResultSchema>[];
    };

    expect(output.results).toHaveLength(1);
    expect(output.surfacedResults).toHaveLength(0);
  });

  it("respects maxConcurrency option", async () => {
    const auditor = responseAuditor({
      analyzers: [echoAnalyzer, criticalAnalyzer, lowScoreAnalyzer],
      threshold: 0.3,
      maxConcurrency: 1,
    });

    const result = await testBlock(auditor, {
      input: { userInput: "Test", response: "Response" },
    });

    expect(result.error).toBeNull();

    const output = result.output as {
      results: z.infer<typeof AnalyzerResultSchema>[];
    };

    // All three ran, even with concurrency 1
    expect(output.results).toHaveLength(3);
  });

  it("uses default threshold of 0.3 when not specified", async () => {
    const auditor = responseAuditor({
      analyzers: [lowScoreAnalyzer], // score 0.1, shouldSurface false
    });

    const result = await testBlock(auditor, {
      input: { userInput: "Test", response: "Response" },
    });

    const output = result.output as {
      surfacedResults: z.infer<typeof AnalyzerResultSchema>[];
    };

    // 0.1 < default threshold 0.3 → filtered out
    expect(output.surfacedResults).toHaveLength(0);
  });

  it("produces a sequencer block compatible with .work()", () => {
    const auditor = responseAuditor({
      analyzers: [echoAnalyzer],
    });

    expect(auditor.kind).toBe("sequencer");
    expect(auditor.name).toBe("response-auditor");
  });

  it("emits block_output items from the pipeline", async () => {
    const auditor = responseAuditor({
      analyzers: [echoAnalyzer],
    });

    const result = await testBlock(auditor, {
      input: { userInput: "Test", response: "Response" },
    });

    const blockOutputs = result.items.filter(
      (item) => item.type === "block_output",
    );
    expect(blockOutputs.length).toBeGreaterThan(0);
  });

  it("handles empty analyzer list", async () => {
    const auditor = responseAuditor({
      analyzers: [],
      threshold: 0.3,
    });

    const result = await testBlock(auditor, {
      input: { userInput: "Test", response: "Response" },
    });

    expect(result.error).toBeNull();

    const output = result.output as {
      results: z.infer<typeof AnalyzerResultSchema>[];
      surfacedResults: z.infer<typeof AnalyzerResultSchema>[];
      overallScore: number;
    };

    expect(output.results).toHaveLength(0);
    expect(output.surfacedResults).toHaveLength(0);
    expect(output.overallScore).toBe(0);
  });
});
