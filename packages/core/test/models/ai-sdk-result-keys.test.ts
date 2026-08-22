/**
 * Pins which keys the AI SDK adapter reads off a provider result.
 *
 * The adapter's result normalizers are module-private and only ever fed the
 * value `generateText` returns, so the sibling suites — which drive the real
 * `generateText` over a `MockLanguageModelV3` — can never present a result
 * whose shape differs from what this `ai` version emits. Stubbing
 * `generateText` itself is the seam that lets a test hand the normalizers an
 * arbitrary result object and assert which key is honoured.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn();

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: generateTextMock };
});

const { wrapAiSdkModel } = await import("../../src/models");

/** Run one generate call against a hand-built provider result. */
async function generateWithResult(result: Record<string, unknown>) {
  generateTextMock.mockResolvedValue(result);
  const model = wrapAiSdkModel({ modelId: "mock-model-id" }, "test/mock-model");
  return model.generate({
    messages: [{ role: "user", content: "hi" }]
  } as never);
}

describe("AI SDK result normalization — structured output", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
  });

  it("reads structured output from `output`", async () => {
    const result = await generateWithResult({
      text: "",
      output: { answer: 42 },
      finalStep: {},
      steps: []
    });

    expect(result.structuredOutput).toEqual({ answer: 42 });
  });

  it("ignores the pre-v7 `experimental_output` key", async () => {
    const result = await generateWithResult({
      text: "",
      experimental_output: { answer: 42 },
      finalStep: {},
      steps: []
    });

    expect(result.structuredOutput).toBeUndefined();
  });

  it("returns undefined when the lazy `output` getter throws", async () => {
    const result = await generateWithResult({
      text: "",
      get output(): unknown {
        throw new Error("No output specified");
      },
      finalStep: {},
      steps: []
    });

    expect(result.structuredOutput).toBeUndefined();
  });
});

describe("AI SDK result normalization — per-step provider metadata", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
  });

  const stepUsage = {
    inputTokens: { total: 100 },
    outputTokens: { total: 5 }
  };

  it("reads a step's cache tokens from `providerMetadata`", async () => {
    const result = await generateWithResult({
      text: "ok",
      finalStep: {},
      steps: [
        {
          text: "ok",
          usage: stepUsage,
          providerMetadata: { anthropic: { cacheReadInputTokens: 2048 } }
        }
      ]
    });

    expect(result.steps?.[0]?.usage?.cacheReadInputTokens).toBe(2048);
  });

  it("ignores the pre-v5 `experimental_providerMetadata` key", async () => {
    const result = await generateWithResult({
      text: "ok",
      finalStep: {},
      steps: [
        {
          text: "ok",
          usage: stepUsage,
          experimental_providerMetadata: {
            anthropic: { cacheReadInputTokens: 2048 }
          }
        }
      ]
    });

    expect(result.steps?.[0]?.usage?.cacheReadInputTokens).toBeUndefined();
  });
});
