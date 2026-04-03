import { describe, expect, it, beforeEach } from "vitest";
import { mockGenerator, testBlock } from "@flow-state-dev/testing";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  planAndExecute,
  planResources,
  planAndExecuteInputSchema,
} from "../src/plan-and-execute";

// ---------------------------------------------------------------------------
// Test flow factory — needed so testBlock creates proper ResourceCollectionRef
// instances for the plan collection via createExecutionContext.
// ---------------------------------------------------------------------------

function createTestFlow(block: ReturnType<typeof planAndExecute>) {
  return defineFlow({
    kind: "plan-execute-test",
    actions: {
      run: {
        inputSchema: planAndExecuteInputSchema,
        block,
      },
    },
    session: {
      stateSchema: z.object({}),
      resources: { ...planResources },
    },
  })({ id: "test" });
}

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
        planId: "test-plan",
      });

      const result = await testBlock(block, {
        input: { goal: "Build MVP" },
        flow: createTestFlow(block),
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.planId).toBe("test-plan");
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
        planId: "single",
      });

      const result = await testBlock(block, {
        input: { goal: "Simple goal" },
        flow: createTestFlow(block),
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
        planId: "empty",
      });

      const result = await testBlock(block, {
        input: { goal: "Nothing to do" },
        flow: createTestFlow(block),
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
        planId: "deps",
      });

      const result = await testBlock(block, {
        input: { goal: "Ordered execution" },
        flow: createTestFlow(block),
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
        planId: "fail-plan",
      });

      const result = await testBlock(block, {
        input: { goal: "Test failure" },
        flow: createTestFlow(block),
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.totalSteps).toBe(3);
      const failedStep = output.tasks.find((s: any) => s.id === "s2");
      expect(failedStep?.status).toBe("failed");
      expect(failedStep?.error).toBeDefined();
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
        planId: "replan",
        maxIterations: 5,
      });

      const result = await testBlock(block, {
        input: { goal: "Test replanning" },
        flow: createTestFlow(block),
        generators: {
          "replan-test-evaluate-llm": evaluatorMock,
        },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.planId).toBe("replan");
    });

    it("forces completion when maxIterations is reached", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "Task 1" },
        { id: "s2", goal: "Task 2" },
        { id: "s3", goal: "Task 3" },
        { id: "s4", goal: "Task 4" },
        { id: "s5", goal: "Task 5" },
      ]);

      const evaluatorMock = mockGenerator({
        name: "max-iter-test-evaluate-llm",
        script: [
          { structuredOutput: { decision: "continue", reasoning: "Keep going" } },
          { structuredOutput: { decision: "continue", reasoning: "Keep going" } },
        ],
      });

      const block = planAndExecute({
        name: "max-iter-test",
        planner,
        stepExecutor: echoExecutor,
        enableReplanning: true,
        planId: "max-iter",
        maxIterations: 2,
      });

      const result = await testBlock(block, {
        input: { goal: "Test max iterations" },
        flow: createTestFlow(block),
        generators: {
          "max-iter-test-evaluate-llm": evaluatorMock,
        },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.planId).toBe("max-iter");
      expect(output.status).toBe("completed");
    });
  });

  describe("composability", () => {
    it("is a sequencer block that can compose with .then()", () => {
      const block = planAndExecute({
        name: "composable-test",
        stepExecutor: echoExecutor,
        planId: "compose",
      });

      expect(block.kind).toBe("sequencer");
      expect(block.name).toBe("composable-test");
    });

    it("supports dynamic planId from function", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "Research" },
      ]);

      const block = planAndExecute({
        name: "dynamic-id",
        planner,
        stepExecutor: echoExecutor,
        enableReplanning: false,
        planId: (input: any) => `plan-${input.goal.toLowerCase().replace(/\s+/g, "-")}`,
      });

      const result = await testBlock(block, {
        input: { goal: "Test Dynamic" },
        flow: createTestFlow(block),
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.planId).toBe("plan-test-dynamic");
    });

    it("uses mock generator planner when no custom planner provided", async () => {
      const block = planAndExecute({
        name: "mock-planner-test",
        stepExecutor: echoExecutor,
        enableReplanning: false,
        planId: "mock",
      });

      const result = await testBlock(block, {
        input: { goal: "Test with mock planner" },
        flow: createTestFlow(block),
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
      expect(exports.PlanSchema).toBeDefined();
      expect(exports.PlanStepSchema).toBeDefined();
      expect(exports.planCollection).toBeDefined();
      expect(exports.planResources).toBeDefined();
      expect(exports.planAndExecuteInputSchema).toBeDefined();
      expect(exports.iterationOutputSchema).toBeDefined();
      expect(exports.initPlan).toBeDefined();
      expect(exports.savePlan).toBeDefined();
      expect(exports.selectNextStep).toBeDefined();
      expect(exports.recordStepResult).toBeDefined();
      expect(exports.evaluatePlanProgress).toBeDefined();
      expect(exports.planListClientData).toBeDefined();
      expect(exports.planDetailClientData).toBeDefined();
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
        planId: "emit",
      });

      const result = await testBlock(block, {
        input: { goal: "Test emission" },
        flow: createTestFlow(block),
      });

      expect(result.error).toBeNull();
      const blockOutputs = result.items.filter((item) => item.type === "block_output");
      expect(blockOutputs.length).toBeGreaterThan(0);
    });
  });
});
