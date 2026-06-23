/**
 * Plan-and-Execute pattern tests (post-FIX-447 migration onto taskBoard).
 *
 * Preserves all externally-visible behavioral assertions from the
 * pre-migration test suite — output shape, dependency ordering, cascade-
 * skip on failure, max-iteration cap, single-pass mode, synthesizer
 * disablement, custom planner/evaluator invocation. Adds new replan-
 * loop tests that exercise re-entry across iterations.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { mockGenerator, testBlock } from "@flow-state-dev/testing";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  planAndExecute,
  planAndExecuteInputSchema,
  planAndExecuteStateSchema,
} from "../src/plan-and-execute";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Echo executor — receives legacy `{ stepId, goal, dependencyResults? }`. */
const echoExecutor = handler({
  name: "echo-executor",
  inputSchema: z.any(),
  outputSchema: z.object({
    summary: z.string(),
    success: z.boolean(),
  }),
  execute: (input) => ({
    summary: `Done: ${(input as any)?.goal ?? "?"}`,
    success: true,
  }),
});

/** Build a deterministic planner that returns a fixed task list. */
function createDeterministicPlanner(
  tasks: Array<{ id: string; goal: string; deps?: string[] }>,
) {
  return handler({
    name: "det-planner",
    inputSchema: z.any(),
    outputSchema: z.object({
      tasks: z.array(
        z.object({
          id: z.string(),
          goal: z.string(),
          deps: z.array(z.string()).optional(),
        }),
      ),
    }),
    execute: () => ({ tasks }),
  });
}

/** Pull the last `task-change` status per id off the items stream. */
function lastTaskState(items: unknown[]): Map<string, string> {
  const finalStatus = new Map<string, string>();
  for (const item of items as Array<{
    type?: string;
    component?: string;
    data?: { task?: { id: string; status: string } };
  }>) {
    if (
      item.type === "component" &&
      item.component === "task-change" &&
      item.data?.task !== undefined
    ) {
      finalStatus.set(item.data.task.id, item.data.task.status);
    }
  }
  return finalStatus;
}

const plannerMock = mockGenerator({
  name: "test-plan-planner",
  script: [
    {
      structuredOutput: {
        tasks: [
          { id: "step-1", title: null, goal: "First task", context: null },
          { id: "step-2", title: null, goal: "Second task", context: null },
          { id: "step-3", title: null, goal: "Third task", context: null },
        ],
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// Output shape (preserved external contract)
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
      // Output preserves legacy task shape
      expect(output.tasks).toHaveLength(2);
      expect(output.tasks[0]).toMatchObject({
        id: "s1",
        goal: "Design API",
        status: "completed",
      });
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
      const order: string[] = [];
      const trackingExecutor = handler({
        name: "tracking-executor",
        inputSchema: z.any(),
        outputSchema: z.object({ summary: z.string(), success: z.boolean() }),
        execute: (input) => {
          const goal = (input as any)?.goal ?? "";
          order.push(goal);
          return { summary: `Done: ${goal}`, success: true };
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
      expect(order).toEqual(["First", "Second", "Third"]);
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
          return { summary: "ok", success: true };
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
          execute: () => {
            throw new Error("Failed");
          },
        }),
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test blocked dependencies" },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.tasks.find((t: any) => t.id === "s1")?.status).toBe(
        "failed",
      );
      expect(output.tasks.find((t: any) => t.id === "s2")?.status).toBe(
        "skipped",
      );
      expect(output.tasks.find((t: any) => t.id === "s3")?.status).toBe(
        "skipped",
      );
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
          {
            structuredOutput: {
              decision: "complete",
              reasoning: "All done",
            },
          },
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

    it("recovers off-schema evaluator output via coercion and honors the decision (FIX-841)", async () => {
      const planner = createDeterministicPlanner([{ id: "s1", goal: "First task" }]);

      // The evaluator model returns the right decision under the wrong field
      // names on the first pass (the reported GLM 5.2 failure), then a valid
      // verdict on the second pass so the loop exits.
      const evaluatorMock = mockGenerator({
        name: "coerce-test-evaluate-llm",
        script: [
          { structuredOutput: { action: "replan", reason: "need more work" } },
          { structuredOutput: { decision: "complete", reasoning: "done" } },
        ],
      });

      // The default coercion model (`intent/utility`) reshapes the off-schema
      // output back to the schema. It returns plain text, which the repair
      // pipeline parses.
      const coercionMock = mockGenerator({
        name: "intent/utility",
        script: [{ text: JSON.stringify({ decision: "replan", reasoning: "need more work" }) }],
      });

      const replannerMock = mockGenerator({
        name: "coerce-test-replanner",
        script: [{ structuredOutput: { tasks: [{ id: "s2", goal: "Replanned task" }] } }],
      });

      const block = planAndExecute({
        name: "coerce-test",
        planner,
        stepExecutor: echoExecutor,
        enableReplanning: true,
        maxIterations: 5,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test off-schema recovery" },
        generators: {
          "coerce-test-evaluate-llm": evaluatorMock,
          "coerce-test-replanner": replannerMock,
        },
        models: {
          "intent/utility": coercionMock,
        },
      });

      // The run completed instead of crashing on the off-schema verdict.
      expect(result.error).toBeNull();
      expect((result.output as any).status).toBe("completed");
      // Coercion ran exactly once (only the first, off-schema pass needed it).
      expect(coercionMock.calls.length).toBe(1);
      // The coerced decision was "replan" — proven by the replanner running.
      // A deterministic/canned fallback would never reach the replanner.
      expect(replannerMock.calls.length).toBe(1);
    });

    it("forces completion when maxIterations is reached", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "Task 1" },
      ]);

      const block = planAndExecute({
        name: "max-iter-test",
        planner,
        stepExecutor: echoExecutor,
        enableReplanning: false,
        maxIterations: 1,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test max iterations" },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.status).toBe("completed");
    });
  });

  // -----------------------------------------------------------------------
  // Replan loop re-entry (FIX-447 new tests)
  // -----------------------------------------------------------------------
  describe("replan loop re-entry", () => {
    it("re-enters the board across multiple iterations with new tasks each time", async () => {
      let plannerCalls = 0;
      const planner = handler({
        name: "iterative-planner",
        inputSchema: z.any(),
        outputSchema: z.object({
          tasks: z.array(
            z.object({ id: z.string(), goal: z.string() }),
          ),
        }),
        execute: () => {
          plannerCalls += 1;
          return { tasks: [{ id: "s1", goal: "Initial work" }] };
        },
      });

      // Each replanner call adds one fresh task; after iteration 3 the
      // evaluator returns "complete" so the loop exits.
      let replanCalls = 0;
      const evaluatorScript: Array<{ structuredOutput: any }> = [
        { structuredOutput: { decision: "replan", reasoning: "more work" } },
        { structuredOutput: { decision: "replan", reasoning: "still more" } },
        { structuredOutput: { decision: "complete", reasoning: "done" } },
      ];
      const evaluatorMock = mockGenerator({
        name: "reentry-test-evaluate-llm",
        script: evaluatorScript,
      });

      const replannerMock = mockGenerator({
        name: "reentry-test-replanner",
        script: [
          { structuredOutput: { tasks: [{ id: "extra-1", goal: "second pass" }] } },
          { structuredOutput: { tasks: [{ id: "extra-2", goal: "third pass" }] } },
        ],
      });
      // mockGenerator's onCall hook fires on every script entry consumed
      replannerMock.reset();

      const trackingExecutor = handler({
        name: "tracking-executor-reentry",
        inputSchema: z.any(),
        outputSchema: z.object({ summary: z.string(), success: z.boolean() }),
        execute: (input) => {
          replanCalls += 1;
          return {
            summary: (input as any).goal,
            success: true,
          };
        },
      });

      const block = planAndExecute({
        name: "reentry-test",
        planner,
        stepExecutor: trackingExecutor,
        enableReplanning: true,
        maxIterations: 5,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test re-entry" },
        generators: {
          "reentry-test-evaluate-llm": evaluatorMock,
          "reentry-test-replanner": replannerMock,
        },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.status).toBe("completed");
      // Three tasks should have run: s1, extra-1, extra-2.
      expect(output.totalSteps).toBe(3);
      expect(output.completedSteps).toBe(3);
      // Planner is called once at the start.
      expect(plannerCalls).toBe(1);
      // Worker ran for each task that ever existed.
      expect(replanCalls).toBe(3);
    });

    it("evaluator returning decision: 'complete' mid-loop exits early", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "Initial" },
      ]);

      const evaluatorMock = mockGenerator({
        name: "early-exit-test-evaluate-llm",
        script: [
          { structuredOutput: { decision: "complete", reasoning: "all good" } },
        ],
      });

      const block = planAndExecute({
        name: "early-exit-test",
        planner,
        stepExecutor: echoExecutor,
        enableReplanning: true,
        maxIterations: 10,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test early exit" },
        generators: {
          "early-exit-test-evaluate-llm": evaluatorMock,
        },
      });

      expect(result.error).toBeNull();
      const output = result.output as any;
      expect(output.status).toBe("completed");
      expect(output.totalSteps).toBe(1);
    });

    it("evaluator returning replan with inline tasks skips the replanner step", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "Initial" },
      ]);

      // Evaluator returns inline tasks → applyReplan adds them, replanner is bypassed.
      const evaluatorMock = mockGenerator({
        name: "inline-tasks-test-evaluate-llm",
        script: [
          {
            structuredOutput: {
              decision: "replan",
              reasoning: "added inline tasks",
              tasks: [{ id: "added", goal: "Added by evaluator" }],
            },
          },
          {
            structuredOutput: { decision: "complete", reasoning: "done" },
          },
        ],
      });

      // Replanner should NOT be invoked. We track invocations via a
      // throw-handler — if it runs, the test fails.
      let replannerInvoked = false;
      const replanner = handler({
        name: "inline-tasks-test-replanner",
        inputSchema: z.any(),
        outputSchema: z.object({ tasks: z.array(z.unknown()) }),
        execute: () => {
          replannerInvoked = true;
          return { tasks: [] };
        },
      });

      const block = planAndExecute({
        name: "inline-tasks-test",
        planner,
        replanner,
        stepExecutor: echoExecutor,
        enableReplanning: true,
        maxIterations: 5,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test inline replan tasks" },
        generators: {
          "inline-tasks-test-evaluate-llm": evaluatorMock,
        },
      });

      expect(result.error).toBeNull();
      // The evaluator's `decision: "replan" + tasks: [...]` should mean
      // replanner is skipped (tasks pre-baked) and applyReplan adds them.
      expect(replannerInvoked).toBe(false);
      const output = result.output as any;
      expect(output.totalSteps).toBe(2);
      expect(output.tasks.find((t: any) => t.id === "added")).toBeDefined();
    });

    it("preserves a passthrough title on replanned tasks (FIX-827)", async () => {
      const planner = createDeterministicPlanner([{ id: "s1", goal: "Initial" }]);

      // A custom evaluator emits an inline task carrying a title → applyReplan
      // seeds it. Title must survive the same way it does on initial seeding.
      // (The default LLM evaluator/replanner schemas deliberately omit title —
      // enriching them is a Non-Goal; this covers the custom-emitter contract.)
      let evalCalls = 0;
      const customEvaluator = handler({
        name: "replan-title-eval",
        inputSchema: z.any(),
        outputSchema: z.object({
          decision: z.enum(["continue", "complete", "replan"]),
          tasks: z
            .array(z.object({ id: z.string(), goal: z.string(), title: z.string() }))
            .optional(),
        }),
        execute: () => {
          evalCalls += 1;
          if (evalCalls === 1) {
            return {
              decision: "replan" as const,
              tasks: [{ id: "added", goal: "Added task", title: "Added label" }],
            };
          }
          return { decision: "complete" as const };
        },
      });

      const block = planAndExecute({
        name: "replan-title-test",
        planner,
        stepExecutor: echoExecutor,
        evaluator: customEvaluator,
        enableReplanning: true,
        maxIterations: 5,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test title preservation" },
      });

      expect(result.error).toBeNull();
      const items = result.items as Array<{
        type?: string;
        component?: string;
        data?: { task?: { id?: string; title?: string } };
      }>;
      const addedChange = items.find(
        (i) =>
          i.type === "component" &&
          i.component === "task-change" &&
          i.data?.task?.id === "added",
      );
      expect(addedChange?.data?.task?.title).toBe("Added label");
    });

    it("auto-suffixes replanner-emitted ids that collide with existing tasks", async () => {
      // Real-world LLM replanners often re-emit an id that already lives
      // in the collection (e.g. asking to "redo task-1"). The substrate
      // rejects duplicate ids, so applyReplan suffixes the colliding id
      // and remaps any within-batch deps.
      const planner = createDeterministicPlanner([
        { id: "task-1", goal: "Initial work" },
      ]);

      let pass = 0;
      const partialFailExecutor = handler({
        name: "partial-fail-executor",
        inputSchema: z.any(),
        outputSchema: z.object({ summary: z.string(), success: z.boolean() }),
        execute: () => {
          pass += 1;
          // Fail the first task to provoke a replan.
          if (pass === 1) {
            return {
              summary: "needed context",
              success: false,
            };
          }
          return { summary: "ok", success: true };
        },
      });

      // Evaluator triggers replan on first call, completes on second.
      const evaluatorMock = mockGenerator({
        name: "id-collision-test-evaluate-llm",
        script: [
          { structuredOutput: { decision: "replan", reasoning: "redo it" } },
          { structuredOutput: { decision: "complete", reasoning: "done" } },
        ],
      });

      // Replanner re-emits "task-1" — exactly the colliding case.
      // Includes a within-batch dep that references the colliding id.
      const replannerMock = mockGenerator({
        name: "id-collision-test-replanner",
        script: [
          {
            structuredOutput: {
              tasks: [
                { id: "task-1", goal: "redo first task" },
                { id: "task-2", goal: "depends on redo", deps: ["task-1"] },
              ],
            },
          },
        ],
      });

      const block = planAndExecute({
        name: "id-collision-test",
        planner,
        stepExecutor: partialFailExecutor,
        enableReplanning: true,
        maxIterations: 3,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test id collision" },
        generators: {
          "id-collision-test-evaluate-llm": evaluatorMock,
          "id-collision-test-replanner": replannerMock,
        },
      });

      expect(result.error).toBeNull();
      const output = result.output as { tasks: Array<{ id: string }> };
      const ids = output.tasks.map((t) => t.id).sort();
      // Original task-1, replan-suffixed task-1, and task-2 (which had
      // its dep remapped from task-1 → task-1-replan-1).
      expect(ids).toContain("task-1");
      expect(ids).toContain("task-1-replan-1");
      expect(ids).toContain("task-2");
    });
  });

  // -----------------------------------------------------------------------
  // Composability + custom blocks
  // -----------------------------------------------------------------------
  describe("composability", () => {
    it("is a sequencer block", () => {
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

    it("invokes a custom evaluator block", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "task" },
      ]);

      let evaluatorCalled = false;
      const customEvaluator = handler({
        name: "custom-eval",
        inputSchema: z.any(),
        outputSchema: z.object({
          decision: z.enum(["continue", "complete", "replan"]),
        }),
        execute: () => {
          evaluatorCalled = true;
          return { decision: "complete" as const };
        },
      });

      const block = planAndExecute({
        name: "custom-eval-test",
        planner,
        stepExecutor: echoExecutor,
        evaluator: customEvaluator,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test custom evaluator" },
      });

      expect(result.error).toBeNull();
      expect(evaluatorCalled).toBe(true);
    });

    it("uses board.block.name as the loopBack target step name", async () => {
      // The substrate names the board's block exactly the `name` passed
      // to `taskBoard()` → `${configName}-board`. The pattern uses
      // `board.block.name` as its `loopBack` target so the loop re-
      // enters the same registered step on each iteration.
      const { taskBoard } = await import("../src/task-board");
      const board = taskBoard({
        name: "loopback-name-test-board",
        collection: { backing: "request", collectionId: "loopback-name-test" },
        workers: echoExecutor,
      });
      expect(board.block.name).toBe("loopback-name-test-board");
    });

    it("accepts string priority from default decomposer-shaped planners", async () => {
      // Regression: the default `utility.decomposer()` outputs `priority`
      // as `"high" | "medium" | "low"`. The seed step must accept the
      // string shape and silently drop it (the substrate's TaskInit
      // `priority` is numeric).
      const planner = handler({
        name: "string-priority-planner",
        inputSchema: z.any(),
        outputSchema: z.object({
          tasks: z.array(
            z.object({
              id: z.string(),
              goal: z.string(),
              priority: z.enum(["high", "medium", "low"]),
            }),
          ),
        }),
        execute: () => ({
          tasks: [
            { id: "s1", goal: "first", priority: "high" as const },
            { id: "s2", goal: "second", priority: "medium" as const },
          ],
        }),
      });

      const block = planAndExecute({
        name: "string-priority-test",
        planner,
        stepExecutor: echoExecutor,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test string priority" },
      });

      expect(result.error).toBeNull();
      const output = result.output as { totalSteps: number; completedSteps: number };
      expect(output.totalSteps).toBe(2);
      expect(output.completedSteps).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Per-task context threading (FIX-827)
  // -----------------------------------------------------------------------
  describe("per-task context (FIX-827)", () => {
    it("default taskContext='goal' fills each task's context with the goal", async () => {
      // Planner emits no context — the default enricher copies the goal in.
      const planner = createDeterministicPlanner([{ id: "s1", goal: "do A" }]);

      let seen: string | undefined;
      const capture = handler({
        name: "ctx-default-capture",
        inputSchema: z.any(),
        outputSchema: z.object({ summary: z.string(), success: z.boolean() }),
        execute: (input: any) => {
          seen = input.context;
          return { summary: "ok", success: true };
        },
      });

      const block = planAndExecute({
        name: "ctx-default",
        planner,
        stepExecutor: capture,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, { input: { goal: "Build the MVP" } });

      expect(result.error).toBeNull();
      expect(seen).toBe("Build the MVP");
    });

    it("taskContext=false leaves task context empty", async () => {
      const planner = createDeterministicPlanner([{ id: "s1", goal: "do A" }]);

      let seen: unknown = "SENTINEL";
      const capture = handler({
        name: "ctx-off-capture",
        inputSchema: z.any(),
        outputSchema: z.object({ summary: z.string(), success: z.boolean() }),
        execute: (input: any) => {
          seen = input.context;
          return { summary: "ok", success: true };
        },
      });

      const block = planAndExecute({
        name: "ctx-off",
        planner,
        stepExecutor: capture,
        taskContext: false,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, { input: { goal: "Build the MVP" } });

      expect(result.error).toBeNull();
      expect(seen).toBeUndefined();
    });

    it("taskContext as a custom block fills per-task context in one pass", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "do A" },
        { id: "s2", goal: "do B" },
      ]);

      // Custom enricher: receives { goal, tasks }, returns { tasks } with a
      // per-task context derived from both the goal and the task id.
      const customEnricher = handler({
        name: "custom-enricher",
        inputSchema: z.object({ goal: z.string(), tasks: z.array(z.any()) }),
        outputSchema: z.object({ tasks: z.array(z.any()) }),
        execute: (input: any) => ({
          tasks: input.tasks.map((t: any) => ({
            ...t,
            context: `enriched:${t.id}:${input.goal}`,
          })),
        }),
      });

      const seen: Record<string, string> = {};
      const capture = handler({
        name: "ctx-custom-capture",
        inputSchema: z.any(),
        outputSchema: z.object({ summary: z.string(), success: z.boolean() }),
        execute: (input: any) => {
          seen[input.stepId] = input.context;
          return { summary: "ok", success: true };
        },
      });

      const block = planAndExecute({
        name: "ctx-custom",
        planner,
        stepExecutor: capture,
        taskContext: customEnricher,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, { input: { goal: "Build" } });

      expect(result.error).toBeNull();
      expect(seen["s1"]).toBe("enriched:s1:Build");
      expect(seen["s2"]).toBe("enriched:s2:Build");
    });

    it("fills replanned tasks' context with the goal too (FIX-827)", async () => {
      // The replan loop re-enters the board directly, so applyReplan applies
      // the same goal→context gap-fill the planning-entry enricher does.
      const planner = createDeterministicPlanner([{ id: "s1", goal: "initial" }]);
      const evaluatorMock = mockGenerator({
        name: "replan-ctx-evaluate-llm",
        script: [
          { structuredOutput: { decision: "replan", reasoning: "more" } },
          { structuredOutput: { decision: "complete", reasoning: "done" } },
        ],
      });
      const replannerMock = mockGenerator({
        name: "replan-ctx-replanner",
        script: [
          { structuredOutput: { tasks: [{ id: "extra-1", goal: "replanned task" }] } },
        ],
      });

      const seen: Record<string, string | undefined> = {};
      const capture = handler({
        name: "replan-ctx-capture",
        inputSchema: z.any(),
        outputSchema: z.object({ summary: z.string(), success: z.boolean() }),
        execute: (input: any) => {
          seen[input.stepId] = input.context;
          return { summary: "ok", success: true };
        },
      });

      const block = planAndExecute({
        name: "replan-ctx",
        planner,
        stepExecutor: capture,
        enableReplanning: true,
        maxIterations: 5,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Build the thing" },
        generators: {
          "replan-ctx-evaluate-llm": evaluatorMock,
          "replan-ctx-replanner": replannerMock,
        },
      });

      expect(result.error).toBeNull();
      // Initial task — context filled by the planning-entry enricher.
      expect(seen["s1"]).toBe("Build the thing");
      // Replanned task — context filled by applyReplan on re-seed.
      expect(seen["extra-1"]).toBe("Build the thing");
    });

    it("threads planner-supplied context to the worker", async () => {
      const planner = handler({
        name: "ctx-planner",
        inputSchema: z.any(),
        outputSchema: z.object({
          tasks: z.array(
            z.object({ id: z.string(), goal: z.string(), context: z.string() }),
          ),
        }),
        execute: () => ({
          tasks: [
            {
              id: "s1",
              goal: "research the listed subdomains",
              context: "Subdomains: a.example.com, b.example.com",
            },
          ],
        }),
      });

      let seenContext: string | undefined;
      const captureExecutor = handler({
        name: "ctx-capture-executor",
        inputSchema: z.any(),
        outputSchema: z.object({ summary: z.string(), success: z.boolean() }),
        execute: (input: any) => {
          seenContext = input.context;
          return { summary: "ok", success: true };
        },
      });

      const block = planAndExecute({
        name: "ctx-thread",
        planner,
        stepExecutor: captureExecutor,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, { input: { goal: "research" } });

      expect(result.error).toBeNull();
      expect(seenContext).toBe("Subdomains: a.example.com, b.example.com");
    });
  });

  // -----------------------------------------------------------------------
  // Goal synthesis (FIX-827)
  // -----------------------------------------------------------------------
  describe("goal synthesis (FIX-827)", () => {
    /** Planner that records the goal it was handed. */
    function makeGoalCapturingPlanner() {
      const seen: { goal?: string } = {};
      const block = handler({
        name: "synth-planner",
        inputSchema: z.any(),
        outputSchema: z.object({
          tasks: z.array(z.object({ id: z.string(), goal: z.string() })),
        }),
        execute: (input: any) => {
          seen.goal = input.goal;
          return { tasks: [{ id: "s1", goal: "do the work" }] };
        },
      });
      return Object.assign(block, { seen });
    }

    it("synthesizeGoal=true rewrites the goal the planner receives", async () => {
      const planner = makeGoalCapturingPlanner();
      const synthMock = mockGenerator({
        name: "synth-on-synthesize-goal",
        script: [{ structuredOutput: { goal: "Research asset info for a.com, b.com, c.com" } }],
      });

      const block = planAndExecute({
        name: "synth-on",
        planner,
        stepExecutor: echoExecutor,
        synthesizeGoal: true,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "now do that for all of them" },
        generators: { "synth-on-synthesize-goal": synthMock },
      });

      expect(result.error).toBeNull();
      expect(planner.seen.goal).toBe("Research asset info for a.com, b.com, c.com");
    });

    it("synthesized goal reaches the outer pipeline state (replan/synthesize basis)", async () => {
      // The replanner and synthesizer reason against the outer pipeline
      // state's goal. A custom evaluator runs as a direct outer-pipeline
      // step, so reading its state.goal proves the synthesized goal was
      // stamped into the outer state — not just handed to the planner.
      const planner = makeGoalCapturingPlanner();
      const synthMock = mockGenerator({
        name: "synth-outer-synthesize-goal",
        script: [{ structuredOutput: { goal: "Self-contained objective" } }],
      });

      let evaluatorSawGoal: string | undefined;
      const evaluator = handler({
        name: "synth-outer-eval",
        inputSchema: z.any(),
        sequencerStateSchema: planAndExecuteStateSchema,
        outputSchema: z.object({
          decision: z.enum(["continue", "complete", "replan"]),
        }),
        execute: (_input: unknown, ctx: any) => {
          evaluatorSawGoal = ctx.sequencer?.state?.goal;
          return { decision: "complete" as const };
        },
      });

      const block = planAndExecute({
        name: "synth-outer",
        planner,
        stepExecutor: echoExecutor,
        evaluator,
        synthesizeGoal: true,
        synthesizer: false,
        enableReplanning: false,
      });

      const result = await testBlock(block, {
        input: { goal: "do that for all of them" },
        generators: { "synth-outer-synthesize-goal": synthMock },
      });

      expect(result.error).toBeNull();
      expect(evaluatorSawGoal).toBe("Self-contained objective");
    });

    it("default (synthesizeGoal off) leaves the goal verbatim", async () => {
      const planner = makeGoalCapturingPlanner();

      const block = planAndExecute({
        name: "synth-off",
        planner,
        stepExecutor: echoExecutor,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "verbatim goal" },
      });

      expect(result.error).toBeNull();
      expect(planner.seen.goal).toBe("verbatim goal");
    });

    it("synthesis failure falls back to the original goal (planning continues)", async () => {
      const planner = makeGoalCapturingPlanner();
      // An empty-script mock throws when the synthesizer generator runs.
      // Synthesis is an enhancement, not a correctness gate, so the run must
      // continue with the original goal (the synthesizer's internal rescue).
      const failingSynth = mockGenerator({
        name: "synth-fail-synthesize-goal",
        script: [],
      });

      const block = planAndExecute({
        name: "synth-fail",
        planner,
        stepExecutor: echoExecutor,
        synthesizeGoal: true,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "original request" },
        generators: { "synth-fail-synthesize-goal": failingSynth },
      });

      expect(result.error).toBeNull();
      expect(planner.seen.goal).toBe("original request");
    });
  });

  // -----------------------------------------------------------------------
  // Output emission (preserves task-change visibility on the stream)
  // -----------------------------------------------------------------------
  describe("emission", () => {
    it("emits task-change items via the substrate", async () => {
      const planner = createDeterministicPlanner([
        { id: "a", goal: "alpha" },
        { id: "b", goal: "beta" },
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
      const final = lastTaskState(result.items);
      expect(final.get("a")).toBe("completed");
      expect(final.get("b")).toBe("completed");
    });

    it("emits task-board-meta items for phase transitions", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "task" },
      ]);
      const block = planAndExecute({
        name: "meta-test",
        planner,
        stepExecutor: echoExecutor,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test meta" },
      });

      expect(result.error).toBeNull();
      const metaItems = result.items.filter(
        (it: any) =>
          it.type === "component" && it.component === "task-board-meta",
      ) as Array<{ data: { status: string; collectionId: string } }>;
      // FIX-491: keyed component emissions upsert in place. The pattern
      // emits "planning" → "active" → "completed" against the same key, so
      // the persisted record collapses to the latest snapshot. Live SSE
      // consumers see every transition via the event log.
      expect(metaItems.length).toBe(1);
      expect(metaItems[0]?.data?.status).toBe("completed");
    });

    it("does not emit legacy plan-meta or plan-task items", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "task" },
      ]);
      const block = planAndExecute({
        name: "no-legacy-emission",
        planner,
        stepExecutor: echoExecutor,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "Test no legacy items" },
      });

      expect(result.error).toBeNull();
      const components = result.items.filter(
        (it: any) => it.type === "component",
      ) as Array<{ component: string }>;
      const types = components.map((it) => it.component);
      expect(types).not.toContain("plan-meta");
      expect(types).not.toContain("plan-task");
    });
  });

  // -----------------------------------------------------------------------
  // Exports
  // -----------------------------------------------------------------------
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
      expect(exports.evaluatePlanProgress).toBeDefined();
      expect(exports.createTaskEvaluator).toBeDefined();
      expect(exports.createLLMEvaluator).toBeDefined();
      expect(exports.createCaptureAndPlan).toBeDefined();
      expect(exports.createApplyReplan).toBeDefined();
      expect(exports.createCascadeSkipDependents).toBeDefined();
      expect(exports.createSynthesize).toBeDefined();
      expect(exports.normalizeOutputStatus).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // FIX-447 regression — seed step writes must reach board reads
  // -----------------------------------------------------------------------
  describe("captureAndPlan → board.block request-state bridge (FIX-447 regression)", () => {
    it("seed step writes survive into board.block reads in the same request", async () => {
      const planner = createDeterministicPlanner([
        { id: "t1", goal: "first" },
        { id: "t2", goal: "second" },
      ]);

      const sawTasks: string[] = [];
      const captureWorker = handler({
        name: "capture-worker",
        inputSchema: z.any(),
        outputSchema: z.object({ summary: z.string(), success: z.boolean() }),
        execute: (input: any) => {
          sawTasks.push(input.goal ?? input.stepId ?? "?");
          return { summary: "ok", success: true };
        },
      });

      const block = planAndExecute({
        name: "seed-board-bridge",
        planner,
        stepExecutor: captureWorker,
        enableReplanning: false,
        synthesizer: false,
      });

      const result = await testBlock(block, { input: { goal: "test" } });
      expect(result.error).toBeNull();
      expect(sawTasks).toHaveLength(2);
    });

    it("seed step writes survive into board.block reads with enableReplanning: true", async () => {
      const planner = createDeterministicPlanner([
        { id: "t1", goal: "first" },
        { id: "t2", goal: "second" },
      ]);

      const sawTasks: string[] = [];
      const captureWorker = handler({
        name: "capture-worker-replan",
        inputSchema: z.any(),
        outputSchema: z.object({ summary: z.string(), success: z.boolean() }),
        execute: (input: any) => {
          sawTasks.push(input.goal ?? input.stepId ?? "?");
          return { summary: "ok", success: true };
        },
      });

      // Evaluator says "complete" so loop exits after one drain.
      const evaluatorMock = mockGenerator({
        name: "seed-board-bridge-replan-evaluate-llm",
        script: [
          { structuredOutput: { decision: "complete", reasoning: "ok" } },
        ],
      });

      const block = planAndExecute({
        name: "seed-board-bridge-replan",
        planner,
        stepExecutor: captureWorker,
        enableReplanning: true,
        synthesizer: false,
      });

      const result = await testBlock(block, {
        input: { goal: "test" },
        generators: {
          "seed-board-bridge-replan-evaluate-llm": evaluatorMock,
        },
      });
      expect(result.error).toBeNull();
      expect(sawTasks).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Instructions slot
  // -----------------------------------------------------------------------
  describe("instructions prop", () => {
    it("accepts static instructions without crashing", async () => {
      const planner = createDeterministicPlanner([
        { id: "s1", goal: "Task" },
      ]);
      const block = planAndExecute({
        name: "instr-static",
        planner,
        stepExecutor: echoExecutor,
        instructions: "You are in debate mode.",
        enableReplanning: false,
        synthesizer: false,
      });
      const result = await testBlock(block, {
        input: { goal: "Test static instructions" },
      });
      expect(result.error).toBeNull();
    });

    it("does not invoke the planner with an instructions wrapper when custom planner is provided", async () => {
      let plannerCalled = false;
      const customPlanner = handler({
        name: "custom-planner",
        inputSchema: z.any(),
        outputSchema: z.object({
          tasks: z.array(z.object({ id: z.string(), goal: z.string() })),
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
        instructions: "These shouldn't reach the custom planner.",
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
});
