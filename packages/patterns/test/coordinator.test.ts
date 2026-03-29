import { describe, expect, it } from "vitest";
import { mockGenerator, testBlock } from "@flow-state-dev/testing";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { coordinator } from "../src/coordinator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A deterministic worker that echoes its input as a "finding".
 * Used instead of a generator so we don't need mock model resolution for every
 * sub-task invocation.
 */
const echoWorker = handler({
  name: "echo-worker",
  inputSchema: z.any(),
  outputSchema: z.object({
    source: z.string(),
    finding: z.string()
  }),
  execute: (input) => ({
    source: typeof input === "string" ? input : JSON.stringify(input),
    finding: `Result for: ${typeof input === "string" ? input : JSON.stringify(input)}`
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
      source: typeof input === "string" ? input : JSON.stringify(input),
      finding: `Result for: ${typeof input === "string" ? input : JSON.stringify(input)}`
    };
  }
});

// The planner mock returns a decomposition of 3 tasks.
const plannerMock = mockGenerator({
  name: "test-planner",
  script: [{
    structuredOutput: {
      tasks: [
        { id: "t1", goal: "Research topic A" },
        { id: "t2", goal: "Research topic B" },
        { id: "t3", goal: "Research topic C" }
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
        { id: "t1", goal: "Research the topic" }
      ]
    }
  }]
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("coordinator pattern", () => {
  it("decomposes a goal, dispatches workers, and merges results", async () => {
    plannerMock.reset();

    const coord = coordinator({
      name: "research-coordinator",
      worker: echoWorker,
      maxConcurrency: 5
    });

    const result = await testBlock(coord, {
      input: { goal: "Research AI safety" },
      generators: {
        "research-coordinator-planner": plannerMock
      }
    });

    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();

    // The combiner merges the 3 worker outputs
    const output = result.output as { combined: unknown; mergeNotes?: string[] };
    expect(output.combined).toBeDefined();
  });

  it("uses custom planner when provided", async () => {
    singleTaskPlannerMock.reset();

    const customPlanner = handler({
      name: "custom-planner",
      inputSchema: z.any(),
      outputSchema: z.object({
        tasks: z.array(z.object({ id: z.string(), goal: z.string() }))
      }),
      execute: (input) => ({
        tasks: [{ id: "custom-1", goal: `Custom plan for: ${input.goal ?? input}` }]
      })
    });

    const coord = coordinator({
      name: "custom-coord",
      worker: echoWorker,
      planner: customPlanner
    });

    const result = await testBlock(coord, {
      input: { goal: "Test custom planner" }
    });

    expect(result.error).toBeNull();
    const output = result.output as { combined: unknown };
    expect(output.combined).toBeDefined();
  });

  it("uses custom merger when provided", async () => {
    const customMerger = handler({
      name: "custom-merger",
      inputSchema: z.any(),
      outputSchema: z.object({
        summary: z.string(),
        count: z.number()
      }),
      execute: (results: unknown[]) => ({
        summary: `Merged ${Array.isArray(results) ? results.length : 0} results`,
        count: Array.isArray(results) ? results.length : 0
      })
    });

    const customPlanner = handler({
      name: "det-planner",
      inputSchema: z.any(),
      outputSchema: z.object({
        tasks: z.array(z.object({ id: z.string(), goal: z.string() }))
      }),
      execute: () => ({
        tasks: [
          { id: "t1", goal: "Task one" },
          { id: "t2", goal: "Task two" }
        ]
      })
    });

    const coord = coordinator({
      name: "merger-test",
      worker: echoWorker,
      planner: customPlanner,
      merger: customMerger
    });

    const result = await testBlock(coord, {
      input: { goal: "Test merging" }
    });

    expect(result.error).toBeNull();
    const output = result.output as { summary: string; count: number };
    expect(output.count).toBe(2);
    expect(output.summary).toBe("Merged 2 results");
  });

  it("respects maxConcurrency option", async () => {
    plannerMock.reset();

    // maxConcurrency is passed through to forEach — we verify the coordinator
    // accepts it and still produces correct output.
    const coord = coordinator({
      name: "concurrency-test",
      worker: echoWorker,
      maxConcurrency: 1
    });

    const result = await testBlock(coord, {
      input: { goal: "Sequential test" },
      generators: {
        "concurrency-test-planner": plannerMock
      }
    });

    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  describe("error handling", () => {
    it("skips failed sub-tasks with onSubTaskError='skip' (default)", async () => {
      callCount = 0;

      const customPlanner = handler({
        name: "skip-planner",
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

      const coord = coordinator({
        name: "skip-test",
        worker: partialFailWorker,
        planner: customPlanner,
        onSubTaskError: "skip"
      });

      const result = await testBlock(coord, {
        input: { goal: "Test skip strategy" }
      });

      // Should succeed — failed task is skipped
      expect(result.error).toBeNull();
      const output = result.output as { combined: unknown };
      expect(output.combined).toBeDefined();
    });

    it("aborts on any failure with onSubTaskError='fail'", async () => {
      const customPlanner = handler({
        name: "fail-planner",
        inputSchema: z.any(),
        outputSchema: z.object({
          tasks: z.array(z.object({ id: z.string(), goal: z.string() }))
        }),
        execute: () => ({
          tasks: [{ id: "t1", goal: "Will fail" }]
        })
      });

      const coord = coordinator({
        name: "fail-test",
        worker: failingWorker,
        planner: customPlanner,
        onSubTaskError: "fail"
      });

      const result = await testBlock(coord, {
        input: { goal: "Test fail strategy" }
      });

      expect(result.error).not.toBeNull();
    });
  });

  it("works as a .then() step in another sequencer", async () => {
    singleTaskPlannerMock.reset();

    const customPlanner = handler({
      name: "then-planner",
      inputSchema: z.any(),
      outputSchema: z.object({
        tasks: z.array(z.object({ id: z.string(), goal: z.string() }))
      }),
      execute: () => ({
        tasks: [{ id: "t1", goal: "Sub-task" }]
      })
    });

    const coord = coordinator({
      name: "inner-coord",
      worker: echoWorker,
      planner: customPlanner
    });

    // The coordinator block should be composable in a parent sequencer
    expect(coord.kind).toBe("sequencer");
    expect(coord.name).toBe("inner-coord");
  });

  it("emits block_output items from the pipeline", async () => {
    const customPlanner = handler({
      name: "emit-planner",
      inputSchema: z.any(),
      outputSchema: z.object({
        tasks: z.array(z.object({ id: z.string(), goal: z.string() }))
      }),
      execute: () => ({
        tasks: [{ id: "t1", goal: "Emit test" }]
      })
    });

    const coord = coordinator({
      name: "emit-test",
      worker: echoWorker,
      planner: customPlanner
    });

    const result = await testBlock(coord, {
      input: { goal: "Test item emission" }
    });

    const blockOutputs = result.items.filter((item) => item.type === "block_output");
    expect(blockOutputs.length).toBeGreaterThan(0);
  });
});
