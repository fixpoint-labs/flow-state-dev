/**
 * Tests for the chatFlow factory.
 *
 * All generator output is mocked — no API keys or network calls required.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mockGenerator, testBlock, testFlow } from "@flow-state-dev/testing";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { chatFlow, chatInputSchema } from "../src/index";

function createChatMock() {
  return mockGenerator({
    name: "chat-generator",
    script: Array.from({ length: 10 }, () => ({
      text: "Hello! How can I help you today?",
    })),
  });
}

function withMocks(mock: ReturnType<typeof createChatMock>) {
  return {
    generators: { "chat-generator": mock },
    models: { "openai/gpt-4o-mini": mock },
  };
}

describe("chatFlow", () => {
  beforeAll(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      throw new Error(`Unexpected network request: ${String(input)}`);
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("creates a valid FlowType with default config", () => {
    const flow = chatFlow();
    expect(flow.kind).toBe("chat");
    expect(flow.requireUser).toBe(true);
    expect(flow.actions.chat).toBeDefined();
    expect(flow.actions.chat.inputSchema).toBeDefined();
  });

  it("creates a callable FlowType that produces FlowInstance", () => {
    const flowType = chatFlow();
    const instance = flowType({ id: "test-chat" });
    expect(instance.id).toBe("test-chat");
    expect(instance.kind).toBe("chat");
    expect(instance.actions.chat).toBeDefined();
  });

  it("completes a chat action with mocked generator", async () => {
    const mock = createChatMock();
    const flow = chatFlow()({ id: "test-chat" });

    const result = await testFlow({
      flow,
      action: "chat",
      userId: "test-user",
      input: { message: "Hello" },
      ...withMocks(mock),
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(result.output).toBeDefined();
  });

  it("emits block_output items", async () => {
    const mock = createChatMock();
    const flow = chatFlow()({ id: "test-chat" });

    const result = await testFlow({
      flow,
      action: "chat",
      userId: "test-user",
      input: { message: "Hello" },
      ...withMocks(mock),
    });

    const blockOutputs = result.items.filter((item) => item.type === "block_output");
    expect(blockOutputs.length).toBeGreaterThan(0);
  });

  it("increments messageCount in session state", async () => {
    const mock = createChatMock();
    const flow = chatFlow();
    const pipeline = (flow.actions.chat as any).block;

    const result = await testBlock(pipeline, {
      input: { message: "Hi there" },
      session: { state: { messageCount: 3 } },
      ...withMocks(mock),
    });

    expect(result.error).toBeNull();
    const patchOp = result.stateChanges.find(
      (change) => change.scope === "session" && change.operation === "patchState",
    );
    expect(patchOp).toBeDefined();
    expect(patchOp?.resultingState.messageCount).toBe(4);
  });

  it("accepts custom model config", () => {
    const flow = chatFlow({ model: "anthropic/claude-sonnet-4-20250514" });
    expect(flow.kind).toBe("chat");
    // The model is baked into the generator block — verify flow creates without error
    const instance = flow({ id: "custom-model" });
    expect(instance.id).toBe("custom-model");
  });

  it("accepts custom prompt config", () => {
    const flow = chatFlow({ prompt: "You are a pirate assistant." });
    const instance = flow({ id: "pirate-chat" });
    expect(instance.kind).toBe("chat");
  });

  it("accepts tools config", () => {
    const dummyTool = handler({
      name: "dummy-tool",
      description: "A test tool",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ answer: z.string() }),
      execute: async (input) => ({ answer: `echo: ${input.q}` }),
    });

    const flow = chatFlow({ tools: [dummyTool] });
    const instance = flow({ id: "tool-chat" });
    expect(instance.kind).toBe("chat");
  });

  it("allows FlowInstanceOptions overrides", () => {
    const flow = chatFlow();
    const instance = flow({ id: "override-test", kind: "custom-chat" });
    expect(instance.id).toBe("override-test");
    expect(instance.kind).toBe("custom-chat");
  });
});
