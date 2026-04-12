/**
 * Tests for the agentFlow factory.
 *
 * All generator output is mocked — no API keys or network calls required.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mockGenerator, testBlock, testFlow } from "@flow-state-dev/testing";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { agentFlow, goalInputSchema } from "../src/index";

const searchTool = handler({
  name: "search",
  description: "Search the web for information",
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
  execute: async (input) => ({ results: [`Result for: ${input.query}`] }),
});

function createAgentMock() {
  return mockGenerator({
    name: "agent-generator",
    script: Array.from({ length: 10 }, () => ({
      text: "Task completed successfully.",
    })),
  });
}

function withMocks(mock: ReturnType<typeof createAgentMock>) {
  return {
    generators: { "agent-generator": mock },
    models: { "openai/gpt-4o-mini": mock },
  };
}

describe("agentFlow", () => {
  beforeAll(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      throw new Error(`Unexpected network request: ${String(input)}`);
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("creates a valid FlowType with required tools", () => {
    const flow = agentFlow({ tools: [searchTool] });
    expect(flow.kind).toBe("agent");
    expect(flow.requireUser).toBe(true);
    expect(flow.actions.run).toBeDefined();
    expect(flow.actions.run.inputSchema).toBeDefined();
  });

  it("creates a callable FlowType that produces FlowInstance", () => {
    const flowType = agentFlow({ tools: [searchTool] });
    const instance = flowType({ id: "test-agent" });
    expect(instance.id).toBe("test-agent");
    expect(instance.kind).toBe("agent");
    expect(instance.actions.run).toBeDefined();
  });

  it("completes a run action with mocked generator", async () => {
    const mock = createAgentMock();
    const flow = agentFlow({ tools: [searchTool] })({ id: "test-agent" });

    const result = await testFlow({
      flow,
      action: "run",
      userId: "test-user",
      input: { goal: "Find information about TypeScript" },
      ...withMocks(mock),
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(result.output).toBeDefined();
  });

  it("emits block_output items", async () => {
    const mock = createAgentMock();
    const flow = agentFlow({ tools: [searchTool] })({ id: "test-agent" });

    const result = await testFlow({
      flow,
      action: "run",
      userId: "test-user",
      input: { goal: "Research AI" },
      ...withMocks(mock),
    });

    const blockOutputs = result.items.filter((item) => item.type === "block_output");
    expect(blockOutputs.length).toBeGreaterThan(0);
  });

  it("increments taskCount in session state", async () => {
    const mock = createAgentMock();
    const flow = agentFlow({ tools: [searchTool] });
    const pipeline = (flow.actions.run as any).block;

    const result = await testBlock(pipeline, {
      input: { goal: "Do something" },
      session: { state: { taskCount: 7 } },
      ...withMocks(mock),
    });

    expect(result.error).toBeNull();
    const patchOp = result.stateChanges.find(
      (change) => change.scope === "session" && change.operation === "patchState",
    );
    expect(patchOp).toBeDefined();
    expect(patchOp?.resultingState.taskCount).toBe(8);
  });

  it("accepts custom model and prompt config", () => {
    const flow = agentFlow({
      model: "anthropic/claude-sonnet-4-20250514",
      prompt: "You are a research agent.",
      tools: [searchTool],
    });
    const instance = flow({ id: "custom-agent" });
    expect(instance.kind).toBe("agent");
  });

  it("allows FlowInstanceOptions overrides", () => {
    const flow = agentFlow({ tools: [searchTool] });
    const instance = flow({ id: "override-test", kind: "custom-agent" });
    expect(instance.id).toBe("override-test");
    expect(instance.kind).toBe("custom-agent");
  });
});
