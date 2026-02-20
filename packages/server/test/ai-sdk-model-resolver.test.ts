import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MockLanguageModelV3 } from "ai/test";
import { createAiSdkModelResolver } from "../src";

describe("createAiSdkModelResolver", () => {
  it("maps text, finish reason, and usage into GeneratorModelResult", async () => {
    const resolver = createAiSdkModelResolver((modelId) => {
      expect(modelId).toBe("openai:gpt-4o-mini");
      return new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: "text", text: "Hello from AI SDK mock" }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: {
              total: 10,
              noCache: 10,
              cacheRead: undefined,
              cacheWrite: undefined
            },
            outputTokens: {
              total: 20,
              text: 20,
              reasoning: undefined
            }
          },
          warnings: []
        })
      });
    });

    const result = await resolver("openai:gpt-4o-mini", "chat-generator").generate({
      messages: [{ role: "user", content: "hi" }]
    });

    expect(result.text).toBe("Hello from AI SDK mock");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30
    });
  });

  it("maps AI SDK tool calls into framework tool call format", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "lookup",
            input: { query: "status" }
          }
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage: {
          inputTokens: {
            total: 5,
            noCache: 5,
            cacheRead: undefined,
            cacheWrite: undefined
          },
          outputTokens: {
            total: 4,
            text: undefined,
            reasoning: undefined
          }
        },
        warnings: []
      })
    });

    const resolver = createAiSdkModelResolver(() => model);
    const abortController = new AbortController();

    const result = await resolver("openai:gpt-4o-mini", "chat-generator").generate({
      messages: [{ role: "user", content: "run tool" }],
      tools: [
        {
          name: "lookup",
          description: "Lookup status",
          parameters: z.object({ query: z.string() })
        }
      ],
      outputSchema: z.object({ done: z.boolean() }),
      maxTokens: 42,
      signal: abortController.signal
    });

    expect(result.toolCalls).toEqual([
      {
        toolCallId: "call_1",
        toolName: "lookup",
        args: { query: "status" }
      }
    ]);
    expect(result.finishReason).toBe("tool-calls");

    const request = model.doGenerateCalls[0];
    expect(request).toBeDefined();
    expect(request?.maxOutputTokens).toBe(42);
    expect(request?.abortSignal).toBe(abortController.signal);
    expect(request?.tools).toBeDefined();
    expect(request?.prompt[0]?.role).toBe("user");
  });
});
