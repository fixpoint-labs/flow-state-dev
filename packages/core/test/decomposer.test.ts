import { describe, expect, it } from "vitest";
import { z } from "zod";
import { utility, sequencer, assertStrictCompatible } from "../src";
import { decomposerOutputSchema } from "../src/utility/decomposer";
import { createMockContext, runForTest } from "./helpers";
describe("utility.decomposer", () => {
  it("returns a generator block definition", () => {
    const block = utility.decomposer({
      name: "task-decompose"
    });

    expect(block.kind).toBe("generator");
    expect(block.name).toBe("task-decompose");
  });

  it("default output schema is OpenAI strict-compatible (BP-016)", () => {
    // title/context are z.string().nullable() (not optional) precisely so
    // the schema survives makeSchemaStrict. Assert it directly so a future
    // change to optional/record/union is caught at the seam.
    expect(() => assertStrictCompatible(decomposerOutputSchema, "decomposerOutputSchema")).not.toThrow();
  });

  it("carries title and context through the decomposed plan (FIX-827)", async () => {
    const block = utility.decomposer({ name: "title-context" });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              tasks: [
                {
                  id: "task-1",
                  title: "Subdomain research",
                  goal: "Research the listed subdomains for asset info",
                  context: "Subdomains: a.example.com, b.example.com"
                }
              ]
            }
          };
        }
      })
    });

    const result = await runForTest(block, "research subdomains", ctx);
    expect(result.tasks[0]?.title).toBe("Subdomain research");
    expect(result.tasks[0]?.context).toBe("Subdomains: a.example.com, b.example.com");
  });

  it("uses default output schema for a single task", async () => {
    const block = utility.decomposer({ name: "single-task" });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              tasks: [{ id: "task-1", title: null, goal: "Implement the change", context: null }]
            }
          };
        }
      })
    });

    await expect(runForTest(block, "do one thing", ctx)).resolves.toEqual({
      tasks: [{ id: "task-1", title: null, goal: "Implement the change", context: null }]
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
                { id: "task-1", title: null, goal: "Gather requirements", context: null, priority: "high" },
                { id: "task-2", title: null, goal: "Implement feature", context: null, deps: ["task-1"], priority: "high" },
                { id: "task-3", title: null, goal: "Write tests", context: null, deps: ["task-2"], priority: "medium" }
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
      .step(decompose);

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              tasks: [
                { id: "task-1", title: null, goal: "Plan", context: null },
                { id: "task-2", title: null, goal: "Execute", context: null, deps: ["task-1"] }
              ]
            }
          };
        }
      })
    });

    await expect(runForTest(chain, { request: "launch feature" }, ctx)).resolves.toEqual({
      tasks: [
        { id: "task-1", title: null, goal: "Plan", context: null },
        { id: "task-2", title: null, goal: "Execute", context: null, deps: ["task-1"] }
      ]
    });
  });
});
