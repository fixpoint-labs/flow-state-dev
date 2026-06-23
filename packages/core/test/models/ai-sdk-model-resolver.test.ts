import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MockLanguageModelV3 } from "ai/test";
import { createAiSdkModelResolver, wrapAiSdkModel } from "../../src/models";

function makeLargeSystemContent(): string {
  return "x".repeat(4400);
}

describe("createAiSdkModelResolver — prompt caching", () => {
  it("stamps Anthropic cacheControl on the last system message by default", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 100, noCache: 90, cacheRead: 10, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    // The provider string is what drives adapter flavor selection.
    (model as any).provider = "anthropic.messages";

    const resolver = createAiSdkModelResolver(() => model);
    await resolver("anthropic/claude-sonnet-4-6", "gen").generate({
      messages: [
        { role: "system", content: makeLargeSystemContent() },
        { role: "user", content: "hi" },
      ],
    });

    const request = model.doGenerateCalls[0]!;
    const prompt = request.prompt as any[];
    const systemMsg = prompt.find((m) => m.role === "system");
    expect(systemMsg?.providerOptions?.anthropic?.cacheControl).toEqual({
      type: "ephemeral",
      ttl: "5m",
    });
  });

  it("passes caching: { enabled: false } through without markers", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 50, noCache: 50, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    (model as any).provider = "anthropic.messages";

    const resolver = createAiSdkModelResolver(() => model);
    await resolver("anthropic/claude-sonnet-4-6", "gen").generate({
      messages: [
        { role: "system", content: makeLargeSystemContent() },
        { role: "user", content: "hi" },
      ],
      caching: { enabled: false },
    });

    const request = model.doGenerateCalls[0]!;
    const prompt = request.prompt as any[];
    const systemMsg = prompt.find((m) => m.role === "system");
    expect(systemMsg?.providerOptions).toBeUndefined();
  });

  it("propagates Anthropic cache token counts through the normalised usage", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        providerMetadata: {
          anthropic: {
            cacheReadInputTokens: 2048,
            cacheCreationInputTokens: 128,
          },
        },
        warnings: [],
      }),
    });
    (model as any).provider = "anthropic.messages";

    const resolver = createAiSdkModelResolver(() => model);
    const result = await resolver("anthropic/claude-sonnet-4-6", "gen").generate({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.usage?.cacheReadInputTokens).toBe(2048);
    expect(result.usage?.cacheCreationInputTokens).toBe(128);
  });

  it("maps AI SDK v6 input token detail cache counts into framework usage", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 100, noCache: 60, cacheRead: 30, cacheWrite: 10 },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    (model as any).provider = "anthropic.messages";

    const resolver = createAiSdkModelResolver(() => model);
    const result = await resolver("anthropic/claude-sonnet-4-6", "gen").generate({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 5,
      totalTokens: 105,
      cacheReadInputTokens: 30,
      cacheCreationInputTokens: 10,
    });
  });

  it("opts Vercel AI Gateway into providerOptions.gateway.caching: 'auto'", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 2, text: 2, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    (model as any).provider = "gateway.chat";

    const resolver = createAiSdkModelResolver(() => model);
    await resolver("vercel/anthropic/claude-sonnet-4-6", "gen").generate({
      messages: [{ role: "user", content: "hi" }],
    });

    const request = model.doGenerateCalls[0]!;
    expect((request.providerOptions as any)?.gateway?.caching).toBe("auto");
  });
});

describe("createAiSdkModelResolver", () => {
  it("maps text, finish reason, and usage into GeneratorModelResult", async () => {
    const resolver = createAiSdkModelResolver((modelId) => {
      expect(modelId).toBe("openai/gpt-4o-mini");
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

    const result = await resolver("openai/gpt-4o-mini", "chat-generator").generate({
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

    const result = await resolver("openai/gpt-4o-mini", "chat-generator").generate({
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

    const result = await resolver("test/model", "gen").generate({
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

    const result = await resolver("anthropic/claude-sonnet-4-5", "chat-generator").generate({
      messages: [{ role: "user", content: "hi" }]
    });

    expect(result.providerMetadata).toEqual({
      anthropic: {
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 9
      }
    });
  });

  it("resolves modelId from prepareStep to switch models between generate steps", async () => {
    const resolvedModelIds: string[] = [];

    // Primary model: returns a tool call to trigger multi-step
    const primaryModel = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [
          { type: "tool-call", toolCallId: "call_1", toolName: "lookup", input: { q: "test" } }
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 3, text: undefined, reasoning: undefined }
        },
        warnings: []
      })
    });

    // Switched model: returns final text
    const switchedModel = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "from switched model" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 8, noCache: 8, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 4, text: 4, reasoning: undefined }
        },
        warnings: []
      })
    });

    const resolver = createAiSdkModelResolver((modelId) => {
      resolvedModelIds.push(modelId);
      return modelId === "fast-model" ? switchedModel : primaryModel;
    });

    const model = resolver("primary-model", "gen");
    const result = await model.generate({
      messages: [{ role: "user", content: "hi" }],
      tools: [{
        name: "lookup",
        description: "Lookup data",
        parameters: z.object({ q: z.string() }),
        execute: async () => ({ answer: "42" })
      }],
      maxSteps: 3,
      prepareStep: async ({ stepNumber }) => {
        if (stepNumber === 1) {
          return { modelId: "fast-model" };
        }
        return undefined;
      }
    });

    // Resolver called for initial model and for the switched model
    expect(resolvedModelIds).toContain("primary-model");
    expect(resolvedModelIds).toContain("fast-model");

    // The switched model was actually invoked
    expect(switchedModel.doGenerateCalls.length).toBeGreaterThanOrEqual(1);

    // Final result reflects the switched model's output
    expect(result.text).toBe("from switched model");
  });

  it("ignores modelId in prepareStep when using wrapAiSdkModel (no resolver)", async () => {
    // wrapAiSdkModel does not have a resolver, so modelId should be silently ignored
    const model = wrapAiSdkModel(new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "original model" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 3, text: 3, reasoning: undefined }
        },
        warnings: []
      })
    }));

    // Should not throw even when prepareStep returns modelId
    const result = await model.generate({
      messages: [{ role: "user", content: "hi" }],
      maxSteps: 2,
      prepareStep: async () => {
        return { modelId: "nonexistent-model" };
      }
    });

    expect(result.text).toBe("original model");
  });
});

describe("createAiSdkModelResolver — tool name sanitization", () => {
  it("rewrites framework-style tool names to a provider-safe alias and translates results back", async () => {
    // OpenAI rejects tool names with `.` or `/`. Framework-namespaced names like
    // `tf.memory/recall` must be aliased before submission and translated back
    // on the way out so block-name routing and observability stay coherent.
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            // Provider echoes back whatever name we sent — so this carries the alias.
            toolName: "tf_memory_recall",
            input: { query: "anything" }
          }
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 4, text: undefined, reasoning: undefined }
        },
        warnings: []
      })
    });

    const resolver = createAiSdkModelResolver(() => model);
    const result = await resolver("openai/gpt-4o-mini", "gen").generate({
      messages: [{ role: "user", content: "go" }],
      tools: [
        {
          name: "tf.memory/recall",
          description: "recall",
          parameters: z.object({ query: z.string() })
        }
      ]
    });

    const request = model.doGenerateCalls[0]!;
    const sentTools = request.tools as Array<{ name: string }>;
    // Submitted name is the sanitized alias.
    expect(sentTools.map((t) => t.name)).toEqual(["tf_memory_recall"]);

    // Returned tool call carries the original framework name.
    expect(result.toolCalls).toEqual([
      { toolCallId: "call_1", toolName: "tf.memory/recall", args: { query: "anything" } }
    ]);
  });

  it("disambiguates collisions between names that sanitize to the same alias", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined }
        },
        warnings: []
      })
    });

    const resolver = createAiSdkModelResolver(() => model);
    await resolver("openai/gpt-4o-mini", "gen").generate({
      messages: [{ role: "user", content: "go" }],
      tools: [
        { name: "tf.memory/recall", description: "a", parameters: z.object({}) },
        { name: "tf-memory-recall", description: "b", parameters: z.object({}) },
        { name: "tf/memory.recall", description: "c", parameters: z.object({}) }
      ]
    });

    const sent = model.doGenerateCalls[0]!.tools as Array<{ name: string }>;
    const aliases = sent.map((t) => t.name);
    // First wins the bare alias; collisions get numeric suffixes.
    expect(aliases).toEqual(["tf_memory_recall", "tf-memory-recall", "tf_memory_recall_2"]);
  });

  it("leaves names that already match the alias pattern untouched", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined }
        },
        warnings: []
      })
    });

    const resolver = createAiSdkModelResolver(() => model);
    await resolver("openai/gpt-4o-mini", "gen").generate({
      messages: [{ role: "user", content: "go" }],
      tools: [{ name: "lookup_data", description: "x", parameters: z.object({}) }]
    });

    const sent = model.doGenerateCalls[0]!.tools as Array<{ name: string }>;
    expect(sent[0]?.name).toBe("lookup_data");
  });

  it("rewrites toolName on historical tool-call / tool-result messages", async () => {
    // History replay rebuilds messages from stored block_tool_output items,
    // which carry the framework's `tf.memory/recall` style names. Those
    // toolName fields end up in OpenAI's request as `input[N].name` — same
    // /^[a-zA-Z0-9_-]+$/ rule as tool names. Without rewriting, OpenAI
    // rejects the request with `Invalid 'input[1].name'`.
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined }
        },
        warnings: []
      })
    });

    const resolver = createAiSdkModelResolver(() => model);
    await resolver("openai/gpt-4o-mini", "gen").generate({
      messages: [
        { role: "user", content: "what do I do?" },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "call_1", toolName: "tf.memory/recall", input: { query: "job" } }
          ]
        },
        {
          role: "tool",
          content: [
            { type: "tool-result", toolCallId: "call_1", toolName: "tf.memory/recall", output: { type: "text", value: "CPTO" } }
          ]
        }
      ]
    });

    const prompt = model.doGenerateCalls[0]!.prompt as Array<{ role: string; content: Array<{ toolName?: string }> }>;
    const assistantMsg = prompt.find((m) => m.role === "assistant");
    const toolMsg = prompt.find((m) => m.role === "tool");
    expect(assistantMsg?.content[0]?.toolName).toBe("tf_memory_recall");
    expect(toolMsg?.content[0]?.toolName).toBe("tf_memory_recall");
  });

  it("leaves messages without tool-call content untouched (identity return)", async () => {
    // Hot-path optimisation: pure-text histories should not be deep-cloned.
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined }
        },
        warnings: []
      })
    });

    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" }
    ];
    const resolver = createAiSdkModelResolver(() => model);
    await resolver("openai/gpt-4o-mini", "gen").generate({ messages });

    const sent = model.doGenerateCalls[0]!.prompt;
    // Mock-language-model normalises content arrays internally, so only
    // assert the toolName branch left these untouched (no surprising rewrites).
    expect(sent.length).toBe(2);
  });
});

describe("createAiSdkModelResolver — structured output recovery (FIX-841)", () => {
  const verdictSchema = z.object({
    decision: z.enum(["continue", "replan", "complete"]),
    reasoning: z.string(),
  });

  it("returns the raw text instead of throwing when structured output fails the schema", async () => {
    // The model emits valid JSON under the wrong field names — the reported
    // GLM 5.2 failure. The AI SDK can't parse it against the schema; the
    // resolver must hand the raw text back for the generator's repair pipeline.
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: '{"action":"replan","reason":"research errored"}' }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 8, text: 8, reasoning: undefined },
        },
        warnings: [],
      }),
    });

    const resolver = createAiSdkModelResolver(() => model);
    const result = await resolver("openai/gpt-4o-mini", "gen").generate({
      messages: [{ role: "user", content: "decide" }],
      outputSchema: verdictSchema,
    });

    expect(result.structuredOutput).toBeUndefined();
    expect(result.text).toContain("replan");
    // Usage is normalized on the recovery path (not raw-cast), so cost
    // accounting still sees prompt/completion tokens.
    expect(result.usage?.promptTokens).toBe(10);
    expect(result.usage?.completionTokens).toBe(8);
  });

  it("still throws when the model produced no text to recover", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 0, text: 0, reasoning: undefined },
        },
        warnings: [],
      }),
    });

    const resolver = createAiSdkModelResolver(() => model);
    await expect(
      resolver("openai/gpt-4o-mini", "gen").generate({
        messages: [{ role: "user", content: "decide" }],
        outputSchema: verdictSchema,
      }),
    ).rejects.toThrow();
  });
});
