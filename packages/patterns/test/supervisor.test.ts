import { describe, expect, it } from "vitest";
import { mockGenerator, testBlock } from "@flow-state-dev/testing";
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import {
  supervisor,
  captureGoal,
  updatePlanState,
  applyReview,
  supervisorStateSchema,
  reviewOutputSchema,
} from "../src/supervisor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const echoWorker = handler({
  name: "echo-worker",
  inputSchema: z.any(),
  outputSchema: z.object({
    source: z.string(),
    finding: z.string(),
  }),
  execute: (input) => ({
    source: typeof input === "string" ? input : JSON.stringify(input),
    finding: `Result for: ${typeof input === "string" ? input : JSON.stringify(input)}`,
  }),
});

const failingWorker = handler({
  name: "failing-worker",
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: () => {
    throw new Error("sub-task failed");
  },
});

let partialFailCallCount = 0;
const partialFailWorker = handler({
  name: "partial-fail-worker",
  inputSchema: z.any(),
  outputSchema: z.object({
    source: z.string(),
    finding: z.string(),
  }),
  execute: (input) => {
    partialFailCallCount += 1;
    if (partialFailCallCount === 2) {
      throw new Error("second task failed");
    }
    return {
      source: typeof input === "string" ? input : JSON.stringify(input),
      finding: `Result for: ${typeof input === "string" ? input : JSON.stringify(input)}`,
    };
  },
});

function makeDeterministicPlanner(
  name: string,
  tasks: Array<{ id: string; goal: string }>
) {
  return handler({
    name,
    inputSchema: z.any(),
    outputSchema: z.object({
      tasks: z.array(z.object({ id: z.string(), goal: z.string() })),
    }),
    execute: () => ({ tasks }),
  });
}

function makeDeterministicReviewer(
  name: string,
  script: Array<{
    assessments: Array<{
      taskId: string;
      verdict: "accepted" | "needs-revision" | "escalate";
      feedback: string;
      score: number;
    }>;
    needsReplanning: boolean;
    overallAssessment: string;
  }>
) {
  let callIndex = 0;
  return handler({
    name,
    inputSchema: z.any(),
    outputSchema: reviewOutputSchema,
    execute: () => {
      const result = script[Math.min(callIndex, script.length - 1)];
      callIndex += 1;
      return result;
    },
  });
}

function makeDeterministicSynthesizer(name: string) {
  return handler({
    name,
    inputSchema: z.any(),
    outputSchema: z.object({
      synthesis: z.string(),
      rationale: z.array(z.string()),
    }),
    execute: (input: unknown) => {
      const results = input && typeof input === "object" && "results" in input
        ? (input as { results: unknown[] }).results
        : Array.isArray(input) ? input : [];
      return {
        synthesis: `Synthesized ${results.length} results`,
        rationale: ["test synthesis"],
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("supervisor pattern", () => {
  it("single-pass success: all tasks accepted on first review", async () => {
    const planner = makeDeterministicPlanner("sp-planner", [
      { id: "t1", goal: "Task A" },
      { id: "t2", goal: "Task B" },
    ]);
    const reviewer = makeDeterministicReviewer("sp-reviewer", [
      {
        assessments: [
          { taskId: "t1", verdict: "accepted", feedback: "Good", score: 0.9 },
          { taskId: "t2", verdict: "accepted", feedback: "Good", score: 0.85 },
        ],
        needsReplanning: false,
        overallAssessment: "All tasks accepted",
      },
    ]);
    const synth = makeDeterministicSynthesizer("sp-synthesizer");

    const sup = supervisor({
      name: "single-pass",
      worker: echoWorker,
      planner,
      reviewer,
      synthesizer: synth,
    });

    const result = await testBlock(sup, {
      input: { goal: "Test single pass" },
    });

    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
    const output = result.output as { synthesis: string; rationale: string[] };
    expect(output.synthesis).toContain("Synthesized");
  });

  it("one re-plan cycle: reviewer requests revision, then accepts", async () => {
    let plannerCalls = 0;
    const planner = handler({
      name: "replan-planner",
      inputSchema: z.any(),
      outputSchema: z.object({
        tasks: z.array(z.object({ id: z.string(), goal: z.string() })),
      }),
      execute: () => {
        plannerCalls += 1;
        if (plannerCalls === 1) {
          return {
            tasks: [
              { id: "t1", goal: "Task A" },
              { id: "t2", goal: "Task B" },
            ],
          };
        }
        // Re-plan: only revised task
        return {
          tasks: [{ id: "t2-v2", goal: "Revised Task B" }],
        };
      },
    });

    const reviewer = makeDeterministicReviewer("replan-reviewer", [
      {
        assessments: [
          { taskId: "t1", verdict: "accepted", feedback: "Good", score: 0.9 },
          {
            taskId: "t2",
            verdict: "needs-revision",
            feedback: "Incomplete",
            score: 0.3,
          },
        ],
        needsReplanning: true,
        overallAssessment: "One task needs revision",
      },
      {
        assessments: [
          {
            taskId: "t2-v2",
            verdict: "accepted",
            feedback: "Good now",
            score: 0.8,
          },
        ],
        needsReplanning: false,
        overallAssessment: "All tasks accepted",
      },
    ]);

    const synth = makeDeterministicSynthesizer("replan-synthesizer");

    const sup = supervisor({
      name: "replan-test",
      worker: echoWorker,
      planner,
      reviewer,
      synthesizer: synth,
      maxIterations: 5,
    });

    const result = await testBlock(sup, {
      input: { goal: "Test re-planning" },
    });

    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
    // Should have gone through 2 iterations
    expect(plannerCalls).toBe(2);
  });

  it("maxIterations exhaustion: stops looping after max iterations", async () => {
    const planner = makeDeterministicPlanner("exhaust-planner", [
      { id: "t1", goal: "Task A" },
    ]);

    // Reviewer always requests replanning
    const reviewer = makeDeterministicReviewer("exhaust-reviewer", [
      {
        assessments: [
          {
            taskId: "t1",
            verdict: "needs-revision",
            feedback: "Not good enough",
            score: 0.2,
          },
        ],
        needsReplanning: true,
        overallAssessment: "Needs work",
      },
    ]);

    const synth = makeDeterministicSynthesizer("exhaust-synthesizer");

    const sup = supervisor({
      name: "exhaust-test",
      worker: echoWorker,
      planner,
      reviewer,
      synthesizer: synth,
      maxIterations: 2,
    });

    const result = await testBlock(sup, {
      input: { goal: "Test exhaustion" },
    });

    // Should complete without error, even though reviewer always wants replanning
    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("uses custom planner when provided", async () => {
    let customPlannerCalled = false;
    const customPlanner = handler({
      name: "my-custom-planner",
      inputSchema: z.any(),
      outputSchema: z.object({
        tasks: z.array(z.object({ id: z.string(), goal: z.string() })),
      }),
      execute: (input) => {
        customPlannerCalled = true;
        return {
          tasks: [
            {
              id: "custom-1",
              goal: `Custom: ${input.goal ?? input}`,
            },
          ],
        };
      },
    });

    const reviewer = makeDeterministicReviewer("custom-planner-reviewer", [
      {
        assessments: [
          {
            taskId: "custom-1",
            verdict: "accepted",
            feedback: "OK",
            score: 0.9,
          },
        ],
        needsReplanning: false,
        overallAssessment: "Done",
      },
    ]);

    const synth = makeDeterministicSynthesizer("custom-planner-synth");

    const sup = supervisor({
      name: "custom-planner-test",
      worker: echoWorker,
      planner: customPlanner,
      reviewer,
      synthesizer: synth,
    });

    const result = await testBlock(sup, {
      input: { goal: "Test custom planner" },
    });

    expect(result.error).toBeNull();
    expect(customPlannerCalled).toBe(true);
  });

  it("uses custom reviewer when provided", async () => {
    let customReviewerCalled = false;
    const customReviewer = handler({
      name: "my-custom-reviewer",
      inputSchema: z.any(),
      outputSchema: reviewOutputSchema,
      execute: () => {
        customReviewerCalled = true;
        return {
          assessments: [
            {
              taskId: "t1",
              verdict: "accepted" as const,
              feedback: "Custom review",
              score: 1,
            },
          ],
          needsReplanning: false,
          overallAssessment: "Custom review done",
        };
      },
    });

    const planner = makeDeterministicPlanner("custom-rev-planner", [
      { id: "t1", goal: "Task" },
    ]);

    const synth = makeDeterministicSynthesizer("custom-rev-synth");

    const sup = supervisor({
      name: "custom-reviewer-test",
      worker: echoWorker,
      planner,
      reviewer: customReviewer,
      synthesizer: synth,
    });

    const result = await testBlock(sup, {
      input: { goal: "Test custom reviewer" },
    });

    expect(result.error).toBeNull();
    expect(customReviewerCalled).toBe(true);
  });

  it("uses custom synthesizer when provided", async () => {
    const customSynth = handler({
      name: "my-custom-synth",
      inputSchema: z.any(),
      outputSchema: z.object({ summary: z.string(), count: z.number() }),
      execute: (input: unknown) => ({
        summary: `Custom synth: ${Array.isArray(input) ? input.length : 0} results`,
        count: Array.isArray(input) ? input.length : 0,
      }),
    });

    const planner = makeDeterministicPlanner("custom-synth-planner", [
      { id: "t1", goal: "Task" },
    ]);

    const reviewer = makeDeterministicReviewer("custom-synth-reviewer", [
      {
        assessments: [
          {
            taskId: "t1",
            verdict: "accepted",
            feedback: "OK",
            score: 0.9,
          },
        ],
        needsReplanning: false,
        overallAssessment: "Done",
      },
    ]);

    const sup = supervisor({
      name: "custom-synth-test",
      worker: echoWorker,
      planner,
      reviewer,
      synthesizer: customSynth,
    });

    const result = await testBlock(sup, {
      input: { goal: "Test custom synthesizer" },
    });

    expect(result.error).toBeNull();
    const output = result.output as { summary: string; count: number };
    expect(output.summary).toContain("Custom synth");
  });

  describe("error handling", () => {
    it("skips failed sub-tasks with onSubTaskError='skip' (default)", async () => {
      partialFailCallCount = 0;

      const planner = makeDeterministicPlanner("skip-planner", [
        { id: "t1", goal: "First task" },
        { id: "t2", goal: "Second task (will fail)" },
        { id: "t3", goal: "Third task" },
      ]);

      const reviewer = makeDeterministicReviewer("skip-reviewer", [
        {
          assessments: [
            {
              taskId: "t1",
              verdict: "accepted",
              feedback: "OK",
              score: 0.9,
            },
            {
              taskId: "t3",
              verdict: "accepted",
              feedback: "OK",
              score: 0.8,
            },
          ],
          needsReplanning: false,
          overallAssessment: "Done",
        },
      ]);

      const synth = makeDeterministicSynthesizer("skip-synth");

      const sup = supervisor({
        name: "skip-test",
        worker: partialFailWorker,
        planner,
        reviewer,
        synthesizer: synth,
        onSubTaskError: "skip",
      });

      const result = await testBlock(sup, {
        input: { goal: "Test skip strategy" },
      });

      expect(result.error).toBeNull();
      expect(result.output).toBeDefined();
      const output = result.output as { synthesis: string };
      expect(output.synthesis).toContain("Synthesized 2 results");
      const skippedWarnings = result.items.filter(
        (item) =>
          item.type === "status" &&
          (item as { message?: string }).message?.includes(
            'skipped task "t2"'
          )
      );
      expect(skippedWarnings).toHaveLength(1);
    });

    it("aborts on any failure with onSubTaskError='fail'", async () => {
      const planner = makeDeterministicPlanner("fail-planner", [
        { id: "t1", goal: "Will fail" },
      ]);

      const sup = supervisor({
        name: "fail-test",
        worker: failingWorker,
        planner,
        onSubTaskError: "fail",
      });

      const result = await testBlock(sup, {
        input: { goal: "Test fail strategy" },
      });

      expect(result.error).not.toBeNull();
    });
  });

  it("is composable: kind is sequencer", () => {
    const planner = makeDeterministicPlanner("comp-planner", [
      { id: "t1", goal: "Task" },
    ]);
    const reviewer = makeDeterministicReviewer("comp-reviewer", [
      {
        assessments: [
          {
            taskId: "t1",
            verdict: "accepted",
            feedback: "OK",
            score: 0.9,
          },
        ],
        needsReplanning: false,
        overallAssessment: "Done",
      },
    ]);
    const synth = makeDeterministicSynthesizer("comp-synth");

    const sup = supervisor({
      name: "comp-test",
      worker: echoWorker,
      planner,
      reviewer,
      synthesizer: synth,
    });

    expect(sup.kind).toBe("sequencer");
    expect(sup.name).toBe("comp-test");
  });

  it("emits block_output items from the pipeline", async () => {
    const planner = makeDeterministicPlanner("emit-planner", [
      { id: "t1", goal: "Emit test" },
    ]);

    const reviewer = makeDeterministicReviewer("emit-reviewer", [
      {
        assessments: [
          {
            taskId: "t1",
            verdict: "accepted",
            feedback: "OK",
            score: 0.9,
          },
        ],
        needsReplanning: false,
        overallAssessment: "Done",
      },
    ]);

    const synth = makeDeterministicSynthesizer("emit-synth");

    const sup = supervisor({
      name: "emit-test",
      worker: echoWorker,
      planner,
      reviewer,
      synthesizer: synth,
    });

    const result = await testBlock(sup, {
      input: { goal: "Test emission" },
    });

    const blockOutputs = result.items.filter(
      (item) => item.type === "block_output"
    );
    expect(blockOutputs.length).toBeGreaterThan(0);
  });

  it("exported blocks can be composed independently", () => {
    // Verify the individual blocks are importable and have correct types
    expect(captureGoal.kind).toBe("handler");
    expect(captureGoal.name).toBe("capture-goal");
    expect(updatePlanState.kind).toBe("handler");
    expect(updatePlanState.name).toBe("update-plan-state");
    expect(applyReview.kind).toBe("handler");
    expect(applyReview.name).toBe("apply-review");

    // Verify schemas are importable
    expect(supervisorStateSchema).toBeDefined();
    expect(reviewOutputSchema).toBeDefined();
  });
});
