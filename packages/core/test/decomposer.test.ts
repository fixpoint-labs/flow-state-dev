import { describe, expect, it } from "vitest";
import { z } from "zod";
import { utility, sequencer } from "../src";
import { createMockContext, runForTest } from "./helpers";
describe("utility.decomposer", () => {
  it("returns a generator block definition", () => {
    const block = utility.decomposer({
      name: "task-decompose"
    });

    expect(block.kind).toBe("generator");
    expect(block.name).toBe("task-decompose");
  });

  it("uses default output schema for a single task", async () => {
    const block = utility.decomposer({ name: "single-task" });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              tasks: [{ id: "task-1", goal: "Implement the change" }]
            }
          };
        }
      })
    });

    await expect(runForTest(block, "do one thing", ctx)).resolves.toEqual({
      tasks: [{ id: "task-1", goal: "Implement the change" }]
    });
  });

  it("supports multiple tasks with dependency references", async () => {
    const block = utility.decomposer({ name: "many-tasks" });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              tasks: [
                { id: "task-1", goal: "Gather requirements", priority: "high" },
                { id: "task-2", goal: "Implement feature", deps: ["task-1"], priority: "high" },
                { id: "task-3", goal: "Write tests", deps: ["task-2"], priority: "medium" }
              ]
            }
          };
        }
      })
    });

    const result = await runForTest(block, "ship feature", ctx);
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks[1]?.deps).toEqual(["task-1"]);
    expect(result.tasks[2]?.deps).toEqual(["task-2"]);
    expect(result.tasks[0]?.priority).toBe("high");
  });

  it("supports output schema overrides", async () => {
    const block = utility.decomposer({
      name: "custom-schema",
      outputSchema: z.object({
        tasks: z.array(
          z.object({
            id: z.string(),
            goal: z.string(),
            owner: z.string()
          })
        )
      })
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              tasks: [{ id: "task-1", goal: "Implement", owner: "agent-a" }]
            }
          };
        }
      })
    });

    await expect(runForTest(block, "x", ctx)).resolves.toEqual({
      tasks: [{ id: "task-1", goal: "Implement", owner: "agent-a" }]
    });
  });

  it("is composable inside sequencers", async () => {
    const decompose = utility.decomposer({
      name: "decompose-in-sequencer"
    });

    const chain = sequencer({
      name: "decompose-chain",
      inputSchema: z.object({ request: z.string() })
    })
      .map((input) => input.request)
      .then(decompose);

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              tasks: [
                { id: "task-1", goal: "Plan" },
                { id: "task-2", goal: "Execute", deps: ["task-1"] }
              ]
            }
          };
        }
      })
    });

    await expect(runForTest(chain, { request: "launch feature" }, ctx)).resolves.toEqual({
      tasks: [
        { id: "task-1", goal: "Plan" },
        { id: "task-2", goal: "Execute", deps: ["task-1"] }
      ]
    });
  });
});
