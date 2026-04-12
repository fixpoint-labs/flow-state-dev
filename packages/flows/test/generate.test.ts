/**
 * Tests for the generateFlow factory.
 *
 * All generator output is mocked — no API keys or network calls required.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import { z } from "zod";
import { generateFlow, textInputSchema } from "../src/index";

function createGenerateMock() {
  return mockGenerator({
    name: "generate",
    script: Array.from({ length: 10 }, () => ({
      text: "This is a concise summary of the provided text.",
    })),
  });
}

function withMocks(mock: ReturnType<typeof createGenerateMock>) {
  return {
    generators: { generate: mock },
    models: { "openai/gpt-4o-mini": mock },
  };
}

describe("generateFlow", () => {
  beforeAll(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      throw new Error(`Unexpected network request: ${String(input)}`);
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("creates a valid FlowType with default config", () => {
    const flow = generateFlow();
    expect(flow.kind).toBe("generate");
    expect(flow.requireUser).toBe(true);
    expect(flow.actions.generate).toBeDefined();
    expect(flow.actions.generate.inputSchema).toBeDefined();
  });

  it("creates a callable FlowType that produces FlowInstance", () => {
    const flowType = generateFlow();
    const instance = flowType({ id: "test-generate" });
    expect(instance.id).toBe("test-generate");
    expect(instance.kind).toBe("generate");
    expect(instance.actions.generate).toBeDefined();
  });

  it("completes a generate action with mocked generator", async () => {
    const mock = createGenerateMock();
    const flow = generateFlow({
      prompt: "Summarize the following text.",
    })({ id: "test-summarizer" });

    const result = await testFlow({
      flow,
      action: "generate",
      userId: "test-user",
      input: { input: "This is a long text about TypeScript that needs summarization." },
      ...withMocks(mock),
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(result.output).toBeDefined();
  });

  it("emits block_output items", async () => {
    const mock = createGenerateMock();
    const flow = generateFlow()({ id: "test-generate" });

    const result = await testFlow({
      flow,
      action: "generate",
      userId: "test-user",
      input: { input: "Some input text." },
      ...withMocks(mock),
    });

    const blockOutputs = result.items.filter((item) => item.type === "block_output");
    expect(blockOutputs.length).toBeGreaterThan(0);
  });

  it("has no session state (stateless flow)", () => {
    const flow = generateFlow();
    expect(flow.session).toBeUndefined();
  });

  it("accepts custom model config", () => {
    const flow = generateFlow({ model: "anthropic/claude-sonnet-4-20250514" });
    const instance = flow({ id: "custom-model" });
    expect(instance.kind).toBe("generate");
  });

  it("accepts outputSchema for structured generation", () => {
    const entitySchema = z.object({
      people: z.array(z.string()),
      places: z.array(z.string()),
    });

    const flow = generateFlow({
      prompt: "Extract entities from the text.",
      outputSchema: entitySchema,
    });
    const instance = flow({ id: "entity-extractor" });
    expect(instance.kind).toBe("generate");
  });

  it("allows FlowInstanceOptions overrides", () => {
    const flow = generateFlow();
    const instance = flow({ id: "override-test", kind: "custom-generate" });
    expect(instance.id).toBe("override-test");
    expect(instance.kind).toBe("custom-generate");
  });
});
