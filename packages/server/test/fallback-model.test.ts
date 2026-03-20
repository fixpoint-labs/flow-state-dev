import { describe, expect, it, vi } from "vitest";
import type { GeneratorModel, GeneratorModelResult } from "@flow-state-dev/core/types";
import { createFallbackModel, isRetryableError } from "../src/models/fallbackModel";
import type { FallbackModelEntry } from "../src/models/fallbackModel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockModel(
  modelId: string,
  overrides: Partial<GeneratorModel> = {}
): GeneratorModel {
  return {
    modelId,
    generate: vi.fn().mockResolvedValue({
      text: `response from ${modelId}`,
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    } satisfies GeneratorModelResult),
    ...overrides,
  };
}

function mockEntry(
  modelId: string,
  overrides: Partial<GeneratorModel> = {}
): FallbackModelEntry {
  const [providerName] = modelId.split(":");
  return {
    modelId,
    providerName: providerName!,
    model: mockModel(modelId, overrides),
  };
}

function retryableError(message: string): Error {
  const err = new Error(message);
  (err as any).isRetryable = true;
  return err;
}

function nonRetryableError(message: string): Error {
  return new Error(message);
}

function statusCodeError(message: string, statusCode: number): Error {
  const err = new Error(message);
  (err as any).statusCode = statusCode;
  return err;
}

const FAST_RETRY = {
  maxAttemptsPerModel: 2,
  baseDelayMs: 1,
  maxDelayMs: 10,
};

// ---------------------------------------------------------------------------
// isRetryableError
// ---------------------------------------------------------------------------

describe("isRetryableError", () => {
  it("returns true for errors with isRetryable = true", () => {
    expect(isRetryableError(retryableError("rate limited"))).toBe(true);
  });

  it("returns false for plain errors", () => {
    expect(isRetryableError(new Error("bad request"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isRetryableError("string error")).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });

  it("returns true for 429 status code", () => {
    expect(isRetryableError(statusCodeError("rate limit", 429))).toBe(true);
  });

  it("returns true for 500 status code", () => {
    expect(isRetryableError(statusCodeError("server error", 500))).toBe(true);
  });

  it("returns true for 502 status code", () => {
    expect(isRetryableError(statusCodeError("bad gateway", 502))).toBe(true);
  });

  it("returns true for 503 status code", () => {
    expect(isRetryableError(statusCodeError("unavailable", 503))).toBe(true);
  });

  it("returns false for 400 status code", () => {
    expect(isRetryableError(statusCodeError("bad request", 400))).toBe(false);
  });

  it("returns true for network errors", () => {
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableError(new Error("ECONNREFUSED"))).toBe(true);
    expect(isRetryableError(new Error("ETIMEDOUT"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createFallbackModel
// ---------------------------------------------------------------------------

describe("createFallbackModel", () => {
  it("throws when no models are provided", () => {
    expect(() =>
      createFallbackModel({
        groupName: "empty",
        models: [],
        retryPolicy: FAST_RETRY,
      })
    ).toThrow('Model group "empty" has no available models');
  });

  it("has modelId of fsd:groupName", () => {
    const model = createFallbackModel({
      groupName: "fast",
      models: [mockEntry("anthropic:claude-haiku")],
      retryPolicy: FAST_RETRY,
    });
    expect(model.modelId).toBe("fsd:fast");
  });

  describe("generate", () => {
    it("succeeds with the first model when no errors", async () => {
      const entry = mockEntry("anthropic:claude-haiku");
      const model = createFallbackModel({
        groupName: "fast",
        models: [entry, mockEntry("openai:gpt-4o-mini")],
        retryPolicy: FAST_RETRY,
      });

      const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });
      expect(result.text).toBe("response from anthropic:claude-haiku");
      expect(entry.model.generate).toHaveBeenCalledTimes(1);
    });

    it("retries on retryable error then succeeds", async () => {
      const generate = vi
        .fn()
        .mockRejectedValueOnce(retryableError("rate limited"))
        .mockResolvedValueOnce({ text: "ok", finishReason: "stop" });

      const model = createFallbackModel({
        groupName: "fast",
        models: [mockEntry("anthropic:claude-haiku", { generate })],
        retryPolicy: FAST_RETRY,
      });

      const result = await model.generate({ messages: [] });
      expect(result.text).toBe("ok");
      expect(generate).toHaveBeenCalledTimes(2);
    });

    it("falls back to next model after max retries", async () => {
      const failingGenerate = vi
        .fn()
        .mockRejectedValue(retryableError("always fails"));

      const model = createFallbackModel({
        groupName: "fast",
        models: [
          mockEntry("anthropic:claude-haiku", { generate: failingGenerate }),
          mockEntry("openai:gpt-4o-mini"),
        ],
        retryPolicy: FAST_RETRY,
      });

      const result = await model.generate({ messages: [] });
      expect(result.text).toBe("response from openai:gpt-4o-mini");
      expect(failingGenerate).toHaveBeenCalledTimes(2); // maxAttemptsPerModel
    });

    it("skips to next model immediately on non-retryable error", async () => {
      const failingGenerate = vi
        .fn()
        .mockRejectedValue(nonRetryableError("auth failed"));

      const model = createFallbackModel({
        groupName: "fast",
        models: [
          mockEntry("anthropic:claude-haiku", { generate: failingGenerate }),
          mockEntry("openai:gpt-4o-mini"),
        ],
        retryPolicy: FAST_RETRY,
      });

      const result = await model.generate({ messages: [] });
      expect(result.text).toBe("response from openai:gpt-4o-mini");
      expect(failingGenerate).toHaveBeenCalledTimes(1); // no retry
    });

    it("throws with summary when all models fail", async () => {
      const model = createFallbackModel({
        groupName: "fast",
        models: [
          mockEntry("anthropic:claude-haiku", {
            generate: vi.fn().mockRejectedValue(retryableError("rate limited")),
          }),
          mockEntry("openai:gpt-4o-mini", {
            generate: vi.fn().mockRejectedValue(retryableError("timeout")),
          }),
        ],
        retryPolicy: FAST_RETRY,
      });

      await expect(model.generate({ messages: [] })).rejects.toThrow(
        'All models in group "fast" failed'
      );
    });
  });

  describe("stream", () => {
    it("is undefined when no model supports streaming", () => {
      const model = createFallbackModel({
        groupName: "fast",
        models: [
          mockEntry("anthropic:claude-haiku", { stream: undefined }),
        ],
        retryPolicy: FAST_RETRY,
      });
      expect(model.stream).toBeUndefined();
    });

    it("streams from the first model", async () => {
      async function* fakeStream() {
        yield { type: "text_delta" as const, textDelta: "hello" };
        yield { type: "finish" as const, finishReason: "stop" };
      }

      const model = createFallbackModel({
        groupName: "fast",
        models: [mockEntry("anthropic:claude-haiku", { stream: fakeStream })],
        retryPolicy: FAST_RETRY,
      });

      expect(model.stream).toBeDefined();
      const chunks = [];
      for await (const chunk of model.stream!({ messages: [] })) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(2);
      expect(chunks[0]?.type).toBe("text_delta");
    });

    it("falls back to next model when first stream throws", async () => {
      async function* failingStream(): AsyncGenerator<any> {
        throw retryableError("connection reset");
      }

      async function* workingStream() {
        yield { type: "text_delta" as const, textDelta: "fallback" };
        yield { type: "finish" as const, finishReason: "stop" };
      }

      const model = createFallbackModel({
        groupName: "fast",
        models: [
          mockEntry("anthropic:claude-haiku", { stream: failingStream }),
          mockEntry("openai:gpt-4o-mini", { stream: workingStream }),
        ],
        retryPolicy: FAST_RETRY,
      });

      const chunks = [];
      for await (const chunk of model.stream!({ messages: [] })) {
        chunks.push(chunk);
      }
      expect(chunks[0]?.textDelta).toBe("fallback");
    });
  });

  describe("defaults merging", () => {
    it("applies group maxTokens when not set by caller", async () => {
      const generate = vi.fn().mockResolvedValue({ text: "ok" });
      const model = createFallbackModel({
        groupName: "fast",
        models: [mockEntry("anthropic:claude-haiku", { generate })],
        defaults: { maxTokens: 1024 },
        retryPolicy: FAST_RETRY,
      });

      await model.generate({ messages: [] });
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokens: 1024 })
      );
    });

    it("caller maxTokens overrides group default", async () => {
      const generate = vi.fn().mockResolvedValue({ text: "ok" });
      const model = createFallbackModel({
        groupName: "fast",
        models: [mockEntry("anthropic:claude-haiku", { generate })],
        defaults: { maxTokens: 1024 },
        retryPolicy: FAST_RETRY,
      });

      await model.generate({ messages: [], maxTokens: 2048 });
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokens: 2048 })
      );
    });

    it("filters providerOptions to resolved provider only", async () => {
      const generate = vi.fn().mockResolvedValue({ text: "ok" });
      const model = createFallbackModel({
        groupName: "thinking",
        models: [mockEntry("anthropic:claude-sonnet-4", { generate })],
        defaults: {
          providerOptions: {
            anthropic: { thinking: { budgetTokens: 10000 } },
          },
        },
        retryPolicy: FAST_RETRY,
      });

      await model.generate({ messages: [] });
      const call = generate.mock.calls[0]![0];
      expect(call.providerOptions).toEqual({
        anthropic: { thinking: { budgetTokens: 10000 } },
      });
    });

    it("does not apply providerOptions for mismatched provider", async () => {
      const generate = vi.fn().mockResolvedValue({ text: "ok" });
      const model = createFallbackModel({
        groupName: "thinking",
        models: [
          // Simulating fallback to openai - anthropic-specific options should not apply
          mockEntry("openai:o3", { generate }),
        ],
        defaults: {
          providerOptions: {
            anthropic: { thinking: { budgetTokens: 10000 } },
          },
        },
        retryPolicy: FAST_RETRY,
      });

      await model.generate({ messages: [] });
      const call = generate.mock.calls[0]![0];
      expect(call.providerOptions).toBeUndefined();
    });
  });
});
