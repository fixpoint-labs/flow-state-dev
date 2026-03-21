import { describe, expect, it } from "vitest";
import { createMockModelResolver, mockGenerator } from "../src";

describe("mockGenerator", () => {
  it("returns scripted steps in order and supports reset", () => {
    const mock = mockGenerator({
      name: "gpt-test",
      script: [
        { text: "one" },
        { structuredOutput: { done: true } }
      ]
    });

    expect(mock.next()).toEqual({ text: "one" });
    expect(mock.next()).toEqual({ structuredOutput: { done: true } });
    expect(mock.next()).toBeUndefined();

    mock.reset();

    expect(mock.next()).toEqual({ text: "one" });
  });

  it("resolves mocks by block name first, then model id", async () => {
    const byBlock = mockGenerator({
      name: "block-mock",
      script: [{ structuredOutput: { source: "block" } }]
    });
    const byModel = mockGenerator({
      name: "model-mock",
      script: [{ structuredOutput: { source: "model" } }]
    });

    const resolver = createMockModelResolver({
      generators: { "chat-generator": byBlock },
      models: { "openai/gpt-4o-mini": byModel }
    });

    const blockModel = resolver("openai/gpt-4o-mini", "chat-generator");
    const blockResult = await blockModel.generate({ messages: [] });
    expect(blockResult.structuredOutput).toEqual({ source: "block" });

    const modelModel = resolver("openai/gpt-4o-mini", "other-generator");
    const modelResult = await modelModel.generate({ messages: [] });
    expect(modelResult.structuredOutput).toEqual({ source: "model" });
  });
});
