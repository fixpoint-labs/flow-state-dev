import { describe, expect, it } from "vitest";
import { mockGenerator, testBlock } from "@flow-state-dev/testing";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { parallelTasks } from "../src/parallelTasks";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic worker — echoes its input as a "finding".
 * Workers now receive TaskWorkerInput from taskBoard, so we stringify
 * the whole object to get a stable output shape.
 */
const echoWorker = handler({
  name: "echo-worker",
  inputSchema: z.any(),
  outputSchema: z.object({
    source: z.string(),
    finding: z.string()
  }),
  execute: (input) => ({
    source: JSON.stringify(input),
    finding: `Result for: ${JSON.stringify(input)}`
  })
});

/** Worker that always throws — used to test error strategies. */
const failingWorker = handler({
  name: "failing-worker",
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: () => {
    throw new Error("sub-task failed");
  }
});

/** Worker that fails on the second invocation only. */
let callCount = 0;
const partialFailWorker = handler({
  name: "partial-fail-worker",
  inputSchema: z.any(),
  outputSchema: z.object({
    source: z.string(),
    finding: z.string()
  }),
  execute: (input) => {
    callCount += 1;
    if (callCount === 2) {
      throw new Error("second task failed");
    }
    return {
      source: JSON.stringify(input),
      finding: `Result for: ${JSON.stringify(input)}`
    };
  }
});

// The planner mock returns a decomposition of 3 tasks.
const plannerMock = mockGenerator({
  name: "test-planner",
  script: [{
    structuredOutput: {
      tasks: [
        { id: "t1", title: null, goal: "Research topic A", context: null },
        { id: "t2", title: null, goal: "Research topic B", context: null },
        { id: "t3", title: null, goal: "Research topic C", context: null }
      ]
    }
  }]
});

// Single-task planner for simpler tests.
const singleTaskPlannerMock = mockGenerator({
  name: "single-planner",
  script: [{
    structuredOutput: {
      tasks: [
        { id: "t1", title: null, goal: "Research the topic", context: null }
      ]
    }
  }]
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parallelTasks pattern", () => {
  it("decomposes a goal, dispatches workers, and merges results", async () => {
    plannerMock.reset();

    const block = parallelTasks({
      name: "research-pt",
      worker: echoWorker,
      maxConcurrency: 5
    });

    const result = await testBlock(block, {
      input: { goal: "Research AI safety" },
      generators: {
        "research-pt-planner": plannerMock
      }
    });

    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();

    const output = result.output as { combined: unknown; mergeNotes?: string[] };
    expect(output.combined).toBeDefined();
  });

  it("uses custom planner when provided", async () => {
    singleTaskPlannerMock.reset();

    const customPlanner = handler({
      name: "pt-custom-planner",
      inputSchema: z.any(),
      outputSchema: z.object({
        tasks: z.array(z.object({ id: z.string(), goal: z.string() }))
      }),
      execute: (input) => ({
        tasks: [{ id: "custom-1", goal: `Custom plan for: ${input.goal ?? input}` }]
      })
    });

    const block = parallelTasks({
      name: "pt-custom-coord",
      worker: echoWorker,
      planner: customPlanner
    });

    const result = await testBlock(block, {
      input: { goal: "Test custom planner" }
    });

    expect(result.error).toBeNull();
    const output = result.output as { combined: unknown };
    expect(output.combined).toBeDefined();
  });

  it("uses custom synthesizer when provided", async () => {
    const customSynthesizer = handler({
      name: "pt-synthesizer",
      inputSchema: z.any(),
      outputSchema: z.object({ total: z.number() }),
      execute: (results: unknown[]) => ({
        total: Array.isArray(results) ? results.length : 0
      })
    });

    const customPlanner = handler({
      name: "pt-synth-planner",
      inputSchema: z.any(),
      outputSchema: z.object({
        tasks: z.array(z.object({ id: z.string(), goal: z.string() }))
      }),
      execute: () => ({
        tasks: [{ id: "t1", goal: "Task one" }, { id: "t2", goal: "Task two" }]
      })
    });

    const block = parallelTasks({
      name: "pt-synth-test",
      worker: echoWorker,
      planner: customPlanner,
      synthesizer: customSynthesizer
    });

    const result = await testBlock(block, { input: { goal: "Test synthesizer" } });
    expect(result.error).toBeNull();
    const output = result.output as { total: number };
    expect(output.total).toBe(2);
  });

  it("respects maxConcurrency option", async () => {
    plannerMock.reset();

    const block = parallelTasks({
      name: "pt-concurrency-test",
      worker: echoWorker,
      maxConcurrency: 1
    });

    const result = await testBlock(block, {
      input: { goal: "Sequential test" },
      generators: {
        "pt-concurrency-test-planner": plannerMock
      }
    });

    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  describe("error handling", () => {
    it("skips failed sub-tasks with onSubTaskError='skip' (default)", async () => {
      callCount = 0;

      const customPlanner = handler({
        name: "pt-skip-planner",
        inputSchema: z.any(),
        outputSchema: z.object({
          tasks: z.array(z.object({ id: z.string(), goal: z.string() }))
        }),
        execute: () => ({
          tasks: [
            { id: "t1", goal: "First task" },
            { id: "t2", goal: "Second task (will fail)" },
            { id: "t3", goal: "Third task" }
          ]
        })
      });

      const block = parallelTasks({
        name: "pt-skip-test",
        worker: partialFailWorker,
        planner: customPlanner,
        onSubTaskError: "skip"
      });

      const result = await testBlock(block, {
        input: { goal: "Test skip strategy" }
      });

      expect(result.error).toBeNull();
      const output = result.output as { combined: unknown };
      expect(output.combined).toBeDefined();
    });

    it("aborts on any failure with onSubTaskError='fail'", async () => {
      const customPlanner = handler({
        name: "pt-fail-planner",
        inputSchema: z.any(),
        outputSchema: z.object({
          tasks: z.array(z.object({ id: z.string(), goal: z.string() }))
        }),
        execute: () => ({
          tasks: [{ id: "t1", goal: "Will fail" }]
        })
      });

      const block = parallelTasks({
        name: "pt-fail-test",
        worker: failingWorker,
        planner: customPlanner,
        onSubTaskError: "fail"
      });

      const result = await testBlock(block, {
        input: { goal: "Test fail strategy" }
      });

      expect(result.error).not.toBeNull();
    });
  });

  it("works as a .step() step in another sequencer", async () => {
    const customPlanner = handler({
      name: "pt-then-planner",
      inputSchema: z.any(),
      outputSchema: z.object({
        tasks: z.array(z.object({ id: z.string(), goal: z.string() }))
      }),
      execute: () => ({
        tasks: [{ id: "t1", goal: "Sub-task" }]
      })
    });

    const block = parallelTasks({
      name: "inner-pt",
      worker: echoWorker,
      planner: customPlanner
    });

    expect(block.kind).toBe("sequencer");
    expect(block.name).toBe("inner-pt");
  });

  it("emits block_output items from the pipeline", async () => {
    const customPlanner = handler({
      name: "pt-emit-planner",
      inputSchema: z.any(),
      outputSchema: z.object({
        tasks: z.array(z.object({ id: z.string(), goal: z.string() }))
      }),
      execute: () => ({
        tasks: [{ id: "t1", goal: "Emit test" }]
      })
    });

    const block = parallelTasks({
      name: "pt-emit-test",
      worker: echoWorker,
      planner: customPlanner
    });

    const result = await testBlock(block, {
      input: { goal: "Test item emission" }
    });

    const blockOutputs = result.items.filter((item) => item.type === "block_trace");
    expect(blockOutputs.length).toBeGreaterThan(0);
  });
});
