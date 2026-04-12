/**
 * Tests for the componentFlow factory.
 *
 * All generator output is mocked — no API keys or network calls required.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import { z } from "zod";
import { componentFlow } from "../src/index";

function createComponentMock(name: string) {
  return mockGenerator({
    name: `${name}-generator`,
    script: Array.from({ length: 10 }, () => ({
      text: "Improved version of the content.",
    })),
  });
}

function withMocks(actionNames: string[]) {
  const generators: Record<string, ReturnType<typeof mockGenerator>> = {};
  const models: Record<string, ReturnType<typeof mockGenerator>> = {};

  for (const name of actionNames) {
    const mock = createComponentMock(name);
    generators[`${name}-generator`] = mock;
    models["openai/gpt-4o-mini"] = mock;
  }

  return { generators, models };
}

describe("componentFlow", () => {
  beforeAll(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      throw new Error(`Unexpected network request: ${String(input)}`);
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // -- FlowType shape --

  it("creates a valid FlowType with string actions", () => {
    const flow = componentFlow({
      actions: {
        improve: "Improve the writing quality.",
        shorten: "Make this more concise.",
      },
    });
    expect(flow.kind).toBe("component");
    expect(flow.requireUser).toBe(true);
    expect(flow.actions.improve).toBeDefined();
    expect(flow.actions.shorten).toBeDefined();
  });

  it("creates a valid FlowType with object actions", () => {
    const flow = componentFlow({
      actions: {
        extract: {
          prompt: "Extract key entities.",
          outputSchema: z.object({ entities: z.array(z.string()) }),
        },
      },
    });
    expect(flow.actions.extract).toBeDefined();
    expect(flow.actions.extract.inputSchema).toBeDefined();
  });

  it("creates a valid FlowType with mixed string and object actions", () => {
    const flow = componentFlow({
      actions: {
        improve: "Improve writing quality.",
        extract: {
          prompt: "Extract entities.",
          outputSchema: z.object({ entities: z.array(z.string()) }),
        },
      },
    });
    expect(flow.actions.improve).toBeDefined();
    expect(flow.actions.extract).toBeDefined();
  });

  // -- FlowInstance creation --

  it("creates a callable FlowType that produces FlowInstance", () => {
    const flowType = componentFlow({
      actions: { improve: "Improve the writing." },
    });
    const instance = flowType({ id: "test-component" });
    expect(instance.id).toBe("test-component");
    expect(instance.kind).toBe("component");
    expect(instance.actions.improve).toBeDefined();
  });

  it("allows FlowInstanceOptions overrides", () => {
    const flow = componentFlow({
      actions: { improve: "Improve the writing." },
    });
    const instance = flow({ id: "override-test", kind: "custom-component" });
    expect(instance.id).toBe("override-test");
    expect(instance.kind).toBe("custom-component");
  });

  // -- Action execution --

  it("completes a string-configured action with mocked generator", async () => {
    const flow = componentFlow({
      actions: { improve: "Improve the writing quality." },
    })({ id: "test-component" });

    const result = await testFlow({
      flow,
      action: "improve",
      userId: "test-user",
      input: { content: "This is some text." },
      ...withMocks(["improve"]),
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(result.output).toBeDefined();
  });

  it("emits block_output items", async () => {
    const flow = componentFlow({
      actions: { shorten: "Make this more concise." },
    })({ id: "test-component" });

    const result = await testFlow({
      flow,
      action: "shorten",
      userId: "test-user",
      input: { content: "This is a long text that needs shortening." },
      ...withMocks(["shorten"]),
    });

    const blockOutputs = result.items.filter((item) => item.type === "block_output");
    expect(blockOutputs.length).toBeGreaterThan(0);
  });

  it("passes optional instruction to the generator", async () => {
    const flow = componentFlow({
      actions: { improve: "Improve the writing quality." },
    })({ id: "test-component" });

    const result = await testFlow({
      flow,
      action: "improve",
      userId: "test-user",
      input: { content: "Draft text.", instruction: "Keep it casual." },
      ...withMocks(["improve"]),
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
  });

  // -- Multiple actions on same flow --

  it("supports multiple actions on a single flow instance", async () => {
    const flow = componentFlow({
      actions: {
        improve: "Improve the writing quality.",
        shorten: "Make this more concise.",
      },
    })({ id: "multi-action" });

    const improveResult = await testFlow({
      flow,
      action: "improve",
      userId: "test-user",
      input: { content: "Some text." },
      ...withMocks(["improve"]),
    });

    expect(improveResult.error).toBeUndefined();
    expect(improveResult.status).toBe("completed");

    const shortenResult = await testFlow({
      flow,
      action: "shorten",
      userId: "test-user",
      input: { content: "Some long text." },
      ...withMocks(["shorten"]),
    });

    expect(shortenResult.error).toBeUndefined();
    expect(shortenResult.status).toBe("completed");
  });

  // -- Config --

  it("accepts custom model config", () => {
    const flow = componentFlow({
      model: "anthropic/claude-sonnet-4-20250514",
      actions: { improve: "Improve writing." },
    });
    const instance = flow({ id: "model-test" });
    expect(instance.kind).toBe("component");
  });

  it("accepts base prompt that applies to all actions", () => {
    const flow = componentFlow({
      prompt: "You are a professional editor for technical documentation.",
      actions: {
        simplify: "Rewrite for a non-technical audience.",
        formalize: "Rewrite in a formal tone.",
      },
    });
    const instance = flow({ id: "prompt-test" });
    expect(instance.kind).toBe("component");
    expect(instance.actions.simplify).toBeDefined();
    expect(instance.actions.formalize).toBeDefined();
  });

  it("accepts object action config with outputSchema", () => {
    const flow = componentFlow({
      actions: {
        extract: {
          prompt: "Extract key entities from the text.",
          outputSchema: z.object({
            people: z.array(z.string()),
            places: z.array(z.string()),
          }),
        },
      },
    });
    const instance = flow({ id: "schema-test" });
    expect(instance.actions.extract).toBeDefined();
  });
});
