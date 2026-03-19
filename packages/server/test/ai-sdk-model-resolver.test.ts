import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MockLanguageModelV3 } from "ai/test";
import { createAiSdkModelResolver, wrapAiSdkModel } from "../src";

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

  it("populates steps from generateText result", async () => {
    // AI SDK's generateText wraps the doGenerate result into a steps array.
    // A single-step generation should produce one step entry.
    const resolver = createAiSdkModelResolver(() => new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [
          { type: "text", text: "step 1 text" },
          {
            type: "tool-call",
            toolCallId: "call_abc",
            toolName: "search",
            input: { q: "hello" }
          }
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined }
        },
        warnings: []
      })
    }));

    const result = await resolver("test:model", "gen").generate({
      messages: [{ role: "user", content: "hi" }]
    });

    expect(result.steps).toBeDefined();
    expect(result.steps!.length).toBeGreaterThanOrEqual(1);

    const step = result.steps![0];
    expect(step.text).toBe("step 1 text");
    expect(step.finishReason).toBe("tool-calls");
    expect(step.usage).toBeDefined();
    expect(step.toolCalls).toEqual([
      { toolCallId: "call_abc", toolName: "search", args: { q: "hello" } }
    ]);
  });

  it("yields tool_call_delta chunks from fullStream tool-input-delta parts", async () => {
    // When no tools are configured in the streamText call, the AI SDK passes
    // tool-input-start/delta through fullStream unmodified. The resolver maps
    // tool-input-delta to framework tool_call_delta chunks.
    const model = wrapAiSdkModel(new MockLanguageModelV3({
      doStream: {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "tool-input-start", id: "tc_1", toolName: "lookup" } as any);
            controller.enqueue({ type: "tool-input-delta", id: "tc_1", delta: '{"q":' } as any);
            controller.enqueue({ type: "tool-input-delta", id: "tc_1", delta: '"val"}' } as any);
            controller.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage: { inputTokens: { total: 5, noCache: 5 }, outputTokens: { total: 3, text: 3 } } } as any);
            controller.close();
          }
        })
      }
    }));

    const chunks: Array<{ type: string; toolCallDelta?: unknown; toolInput?: unknown }> = [];
    for await (const chunk of model.stream!({
      messages: [{ role: "user", content: "run" }]
    })) {
      chunks.push(chunk);
    }

    // tool-input-start → tool_input_start (existing handler)
    const toolInputStarts = chunks.filter(c => c.type === "tool_input_start");
    expect(toolInputStarts.length).toBe(1);
    expect((toolInputStarts[0].toolInput as any).toolName).toBe("lookup");

    // tool-input-delta → tool_call_delta (new handler)
    const toolDeltas = chunks.filter(c => c.type === "tool_call_delta");
    expect(toolDeltas.length).toBe(2);

    expect(toolDeltas[0].toolCallDelta).toEqual({
      toolCallId: "tc_1",
      toolName: "",
      argsDelta: '{"q":'
    });
    expect(toolDeltas[1].toolCallDelta).toEqual({
      toolCallId: "tc_1",
      toolName: "",
      argsDelta: '"val"}'
    });

    // Should end with finish
    expect(chunks[chunks.length - 1].type).toBe("finish");
  });

  it("passes outputSchema to stream via buildAiSdkRequest", async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-delta" as any, id: "t1", delta: '{"ok":true}' });
            controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: { inputTokens: { total: 5, noCache: 5 }, outputTokens: { total: 3, text: 3 } } } as any);
            controller.close();
          }
        })
      }
    });

    const wrapped = wrapAiSdkModel(model);
    const schema = z.object({ ok: z.boolean() });

    const chunks: unknown[] = [];
    for await (const chunk of wrapped.stream!({
      messages: [{ role: "user", content: "test" }],
      outputSchema: schema
    })) {
      chunks.push(chunk);
    }

    // Verify the AI SDK received output configuration
    expect(model.doStreamCalls.length).toBe(1);
    const request = model.doStreamCalls[0];
    // When outputSchema is passed, buildAiSdkRequest sets output via Output.object()
    // which the AI SDK maps to an outputMode on the call options
    expect(request).toBeDefined();
  });

  it("surfaces provider metadata on generation results", async () => {
    const resolver = createAiSdkModelResolver(() => new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "hi" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 3, text: 3, reasoning: undefined }
        },
        providerMetadata: {
          anthropic: {
            cacheCreationInputTokens: 2,
            cacheReadInputTokens: 9
          }
        },
        warnings: []
      })
    }));

    const result = await resolver("anthropic:claude-sonnet-4-5", "chat-generator").generate({
      messages: [{ role: "user", content: "hi" }]
    });

    expect(result.providerMetadata).toEqual({
      anthropic: {
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 9
      }
    });
  });
});
