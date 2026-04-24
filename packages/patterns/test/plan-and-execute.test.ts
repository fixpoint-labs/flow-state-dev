import { describe, expect, it, beforeEach } from "vitest";
import { mockGenerator, testBlock } from "@flow-state-dev/testing";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  planAndExecute,
  planAndExecuteInputSchema,
} from "../src/plan-and-execute";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic step executor — echoes step goal as result. */
const echoExecutor = handler({
  name: "echo-executor",
  inputSchema: z.any(),
  outputSchema: z.object({
    result: z.string(),
  }),
  execute: (input) => ({
    result: `Done: ${typeof input === "object" && input !== null && "goal" in input ? (input as any).goal : JSON.stringify(input)}`,
  }),
});

/** Deterministic planner that returns specified tasks. */
function createDeterministicPlanner(tasks: Array<{ id: string; goal: string; deps?: string[] }>) {
  return handler({
    name: "det-planner",
    inputSchema: z.any(),
    outputSchema: z.object({
      tasks: z.array(z.object({
        id: z.string(),
        goal: z.string(),
        deps: z.array(z.string()).optional(),
      })),
    }),
    execute: () => ({ tasks }),
  });
}

// Mock planner for generator-based tests
const plannerMock = mockGenerator({
  name: "test-plan-planner",
  script: [{
    structuredOutput: {
      tasks: [
        { id: "step-1", goal: "First task" },
        { id: "step-2", goal: "Second task" },
        { id: "step-3", goal: "Third task" },
      ],
    },
  }],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("plan-and-execute pattern", () => {
  beforeEach(() => {
    plannerMock.reset();
  });

  describe("simple mode (no replanning)", () => {
    it("plans and executes all steps to completion", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "Design API" },
        { id: "s2", goal: "Implement" },
      ]);

      const block = planAndExecute({
        name: "simple-test",
        planner,
        stepExecutor: echoExecutor,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Build MVP" },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.status).toBe("completed");
      expect(output.completedSteps).toBe(2);
      expect(output.totalSteps).toBe(2);
    });

    it("handles single-step plans", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "Do the thing" },
      ]);

      const block = planAndExecute({
        name: "single-step",
        planner,
        stepExecutor: echoExecutor,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Simple goal" },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.completedSteps).toBe(1);
      expect(output.totalSteps).toBe(1);
      expect(output.status).toBe("completed");
    });

    it("handles empty plan (no steps)", async () => {
      const planner = createDeterministicPlanner([]);

      const block = planAndExecute({
        name: "empty-plan",
        planner,
        stepExecutor: echoExecutor,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Nothing to do" },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.totalSteps).toBe(0);
      expect(output.status).toBe("completed");
    });
  });

  describe("step dependencies", () => {
    it("respects dependency ordering", async () => {
      const executionOrder: string[] = [];

      const trackingExecutor = handler({
        name: "tracking-executor",
        inputSchema: z.any(),
        outputSchema: z.object({ result: z.string() }),
        execute: (input) => {
          const goal = (input as any)?.goal ?? "";
          executionOrder.push(goal);
          return { result: `Done: ${goal}` };
        },
      });

      const planner = createDeterministicPlanner([
        { id: "s1", goal: "First" },
        { id: "s2", goal: "Second", deps: ["s1"] },
        { id: "s3", goal: "Third", deps: ["s2"] },
      ]);

      const block = planAndExecute({
        name: "deps-test",
        planner,
        stepExecutor: trackingExecutor,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Ordered execution" },
      });

      expect(result.error).toBeNull();
      expect(executionOrder).toEqual(["First", "Second", "Third"]);
    });
  });

  describe("step failure handling", () => {
    it("records failed steps and continues to completion", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "Will succeed" },
        { id: "s2", goal: "Will fail" },
        { id: "s3", goal: "Also succeeds" },
      ]);

      const failExecutor = handler({
        name: "selective-fail-executor",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: (input) => {
          const stepId = (input as any)?.stepId;
          if (stepId === "s2") {
            throw new Error("Step s2 failed");
          }
          return { result: "ok" };
        },
      });

      const block = planAndExecute({
        name: "fail-test",
        planner,
        stepExecutor: failExecutor,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test failure" },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.totalSteps).toBe(3);
      const failedStep = output.tasks.find((s: any) => s.id === "s2");
      expect(failedStep?.status).toBe("failed");
      expect(failedStep?.error).toBeDefined();
    });

    it("completes when downstream tasks are blocked by a failed dependency", async () => {
      // s2 and s3 depend on s1 — when s1 fails, they can never run.
      // The evaluator must detect no executable tasks remain and complete.
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "Will fail" },
        { id: "s2", goal: "Depends on s1", deps: ["s1"] },
        { id: "s3", goal: "Also depends on s1", deps: ["s1"] },
      ]);

      const block = planAndExecute({
        name: "blocked-dep-test",
        planner,
        stepExecutor: handler({
          name: "always-fail-executor",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: () => { throw new Error("Failed"); },
        }),
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test blocked dependencies" },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.tasks.find((t: any) => t.id === "s1")?.status).toBe("failed");
      // s2 and s3 are cascade-skipped (their dep s1 failed)
      expect(output.tasks.find((t: any) => t.id === "s2")?.status).toBe("skipped");
      expect(output.tasks.find((t: any) => t.id === "s3")?.status).toBe("skipped");
    });

    it("marks task failed when executor returns success: false", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "Will signal failure" },
        { id: "s2", goal: "Will succeed" },
      ]);

      const signalingExecutor = handler({
        name: "signaling-executor",
        inputSchema: z.any(),
        outputSchema: z.object({
          summary: z.string().optional(),
          success: z.boolean(),
          reason: z.string().optional(),
        }),
        execute: (input) => {
          const stepId = (input as any)?.stepId;
          if (stepId === "s1") {
            return { success: false, reason: "Information not available" };
          }
          return { summary: "Found something", success: true };
        },
      });

      const block = planAndExecute({
        name: "signal-fail-test",
        planner,
        stepExecutor: signalingExecutor,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test failure signaling" },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      const failedStep = output.tasks.find((s: any) => s.id === "s1");
      expect(failedStep?.status).toBe("failed");
      expect(failedStep?.error).toBe("Information not available");
      const succeededStep = output.tasks.find((s: any) => s.id === "s2");
      expect(succeededStep?.status).toBe("completed");
    });
  });

  describe("replanning mode", () => {
    it("uses LLM evaluator when enableReplanning is true", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "First task" },
        { id: "s2", goal: "Second task" },
      ]);

      const evaluatorMock = mockGenerator({
        name: "replan-test-evaluate-llm",
        script: [
          { structuredOutput: { decision: "continue", reasoning: "More steps remain" } },
          { structuredOutput: { decision: "complete", reasoning: "All done" } },
        ],
      });

      const block = planAndExecute({
        name: "replan-test",
        planner,
        stepExecutor: echoExecutor,
        enableReplanning: true,
        maxIterations: 5,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test replanning" },
        generators: {
          "replan-test-evaluate-llm": evaluatorMock,
        },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.status).toBe("completed");
    });

    it("forces completion when maxIterations replan rounds is reached", async () => {
      // Scenario: 2 tasks, evaluator triggers one replan (iteration → 1),
      // then the maxIterations:1 guard fires before calling the LLM again.
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "Task 1" },
        { id: "s2", goal: "Task 2" },
      ]);

      // After s1 completes (s2 still pending), evaluator requests replan.
      // After replan: iteration=1 >= maxIterations=1 → guard fires, no second LLM call.
      const evaluatorMock = mockGenerator({
        name: "max-iter-test-evaluate-llm",
        script: [
          { structuredOutput: { decision: "replan", reasoning: "Need adjustment" } },
        ],
      });

      // Replanner produces one replacement task.
      const replannerMock = mockGenerator({
        name: "max-iter-test-replanner",
        script: [
          { structuredOutput: { tasks: [{ id: "s3", goal: "Replanned task" }] } },
        ],
      });

      const block = planAndExecute({
        name: "max-iter-test",
        planner,
        stepExecutor: echoExecutor,
        enableReplanning: true,
        maxIterations: 1,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test max iterations" },
        generators: {
          "max-iter-test-evaluate-llm": evaluatorMock,
          "max-iter-test-replanner": replannerMock,
        },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.status).toBe("completed");
    });
  });

  describe("composability", () => {
    it("is a sequencer block that can compose with .then()", () => {
      const block = planAndExecute({
        name: "composable-test",
        stepExecutor: echoExecutor,
      });

      expect(block.kind).toBe("sequencer");
      expect(block.name).toBe("composable-test");
    });

    it("uses mock generator planner when no custom planner provided", async () => {
      const block = planAndExecute({
        name: "mock-planner-test",
        stepExecutor: echoExecutor,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test with mock planner" },
        generators: {
          "mock-planner-test-planner": plannerMock,
        },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.totalSteps).toBe(3);
      expect(output.completedSteps).toBe(3);
    });
  });

  describe("exports", () => {
    it("exports all expected symbols", async () => {
      const exports = await import("../src/plan-and-execute");

      expect(exports.planAndExecute).toBeDefined();
      expect(exports.planAndExecuteStateSchema).toBeDefined();
      expect(exports.PlanSchema).toBeDefined();
      expect(exports.PlanStepSchema).toBeDefined();
      expect(exports.PlanTaskSchema).toBeDefined();
      expect(exports.planAndExecuteInputSchema).toBeDefined();
      expect(exports.iterationOutputSchema).toBeDefined();
      expect(exports.selectNextStep).toBeDefined();
      expect(exports.recordStepResult).toBeDefined();
      expect(exports.evaluatePlanProgress).toBeDefined();
      expect(exports.createTaskEvaluator).toBeDefined();
      expect(exports.createLLMEvaluator).toBeDefined();
    });
  });

  describe("instructions prop", () => {
    it("accepts static instructions without crashing", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "Analyze topic" },
        { id: "s2", goal: "Summarize findings" },
      ]);

      const block = planAndExecute({
        name: "instr-static",
        planner,
        stepExecutor: echoExecutor,
        instructions: "You are in debate mode. Challenge all claims.",
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test static instructions" },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.status).toBe("completed");
      expect(output.completedSteps).toBe(2);
    });

    it("accepts dynamic instructions function without crashing", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "Research" },
      ]);

      const block = planAndExecute({
        name: "instr-dynamic",
        planner,
        stepExecutor: echoExecutor,
        instructions: (_input: any, _ctx: any) => "Dynamic interview instructions",
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test dynamic instructions" },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.status).toBe("completed");
    });

    it("composes instructions with executionInstructions", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "Task with both" },
      ]);

      const block = planAndExecute({
        name: "instr-compose",
        planner,
        stepExecutor: echoExecutor,
        instructions: "Top-level debate stance",
        executionInstructions: "Be thorough in each step",
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test composition" },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.status).toBe("completed");
    });

    it("does not inject instructions when custom planner is provided", async () => {
      let plannerCalled = false;
      const customPlanner = handler({
        name: "custom-planner",
        inputSchema: z.any(),
        outputSchema: z.object({
          tasks: z.array(z.object({
            id: z.string(),
            goal: z.string(),
            deps: z.array(z.string()).optional(),
          })),
        }),
        execute: () => {
          plannerCalled = true;
          return { tasks: [{ id: "s1", goal: "Custom task" }] };
        },
      });

      const block = planAndExecute({
        name: "instr-custom-planner",
        planner: customPlanner,
        stepExecutor: echoExecutor,
        instructions: "These instructions bypass planner when custom planner provided",
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test custom planner" },
      });

      expect(result.error).toBeNull();
      expect(plannerCalled).toBe(true);
    });
  });

  describe("block_output emission", () => {
    it("emits block_output items from the pipeline", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "Emit test" },
      ]);

      const block = planAndExecute({
        name: "emit-test",
        planner,
        stepExecutor: echoExecutor,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test emission" },
      });

      expect(result.error).toBeNull();
      const blockOutputs = result.items.filter((item) => item.type === "block_output");
      expect(blockOutputs.length).toBeGreaterThan(0);
    });
  });
});
