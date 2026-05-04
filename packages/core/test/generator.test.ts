import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  generator,
  handler,
  readResourceContentTool,
  writeResourceContentTool
} from "../src";
import { createMockContext, runForTest } from "./helpers";
describe("generator builder", () => {
  it("defaults output schema to string when omitted", async () => {
    const block = generator({
      name: "string-output",
      model: "mock-model",
      prompt: "Return a string"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "mock-model",
        async generate() {
          return { text: "hello" };
        }
      })
    });
    await expect(runForTest(block, { value: "x" }, ctx)).resolves.toBe("hello");
  });

  it("accepts a direct GeneratorModel instance in config.model", async () => {
    const model = {
      modelId: "custom:model",
      async generate() {
        return {
          text: "from-direct-model"
        };
      }
    };

    const block = generator({
      name: "direct-model",
      model,
      prompt: "Return text"
    });

    const ctx = createMockContext();
    await expect(runForTest(block, { value: "x" }, ctx)).resolves.toBe("from-direct-model");
  });

  it("resolves model and prompt from functions", async () => {
    const seen: Array<{ modelId: string; prompt: unknown }> = [];
    const block = generator({
      name: "dynamic-model-prompt",
      inputSchema: z.object({ count: z.number() }),
      model: (input) => `model-${input.count}`,
      prompt: (input) => `prompt-${input.count}`
    });

    const ctx = createMockContext({
      resolveModel: (modelId) => ({
        modelId,
        async generate(options) {
          seen.push({
            modelId,
            prompt: (options.messages[0] as { content?: unknown } | undefined)?.content
          });
          return { text: "ok" };
        }
      })
    });
    await expect(runForTest(block, { count: 2 }, ctx)).resolves.toBe("ok");
    expect(seen[0]).toEqual({
      modelId: "model-2",
      prompt: "prompt-2"
    });
  });

  it("supports repair mode auto with custom repairOutput", async () => {
    const repairOutput = vi.fn().mockReturnValue({ done: true });
    const block = generator({
      name: "repair-auto",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ done: z.boolean() }),
      repair: { mode: "auto", maxAttempts: 1 },
      repairOutput
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: { done: "nope" }
          };
        }
      })
    });
    await expect(runForTest(block, { value: 1 }, ctx)).resolves.toEqual({ done: true });
    expect(repairOutput).toHaveBeenCalledTimes(1);
  });

  it("fails immediately in repair fail/rescue modes", async () => {
    const blockFail = generator({
      name: "repair-fail",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ done: z.boolean() }),
      repair: { mode: "fail", maxAttempts: 4 }
    });

    const blockRescue = generator({
      name: "repair-rescue",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ done: z.boolean() }),
      repair: { mode: "rescue", maxAttempts: 4 }
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: { done: "bad" }
          };
        }
      })
    });
    await expect(runForTest(blockFail, { value: 1 }, ctx)).rejects.toThrow("validation failed");
    await expect(runForTest(blockRescue, { value: 1 }, ctx)).rejects.toThrow("validation failed");
  });

  it("runs model-requested tools via execute wrappers", async () => {
    // The generator compiles tools with `execute` closures. The model layer
    // (AI SDK) calls `execute` during its built-in multi-step loop.
    // This test simulates that behavior in the mock model.
    const toolCalls: string[] = [];
    const succeedTool = handler({
      name: "succeeds",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ text: z.string(), ok: z.boolean() }),
      execute: (input) => {
        toolCalls.push("ok");
        return {
          text: input.text,
          ok: true
        };
      }
    });

    const block = generator({
      name: "tool-loop",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ text: z.string(), ok: z.boolean() }),
      maxIterations: 2,
      tools: [succeedTool]
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          // Simulate AI SDK: call tool execute, then return final result
          if (options.tools?.length > 0) {
            const tool = options.tools[0];
            if (tool.execute) {
              await tool.execute({ text: "hello" });
            }
          }
          return {
            structuredOutput: {
              text: "hello",
              ok: true
            }
          };
        }
      })
    });
    await expect(runForTest(block, { text: "hello" }, ctx)).resolves.toEqual({
      text: "hello",
      ok: true
    });
    expect(toolCalls).toEqual(["ok"]);
  });

  it("tools resolver receives the current input alongside ctx", async () => {
    // A tools function closes over per-invocation state via its `input`
    // argument. Verifies that `tools: (input, ctx) => ...` can select tools
    // based on the invocation's input — used by e.g. the skills fork
    // generator to resolve catalog subsets per SKILL's allowed-tools.
    const toolA = handler({
      name: "toolA",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => ({}),
    });
    const toolB = handler({
      name: "toolB",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => ({}),
    });

    let seenToolNames: string[] = [];
    const block = generator({
      name: "tools-input-resolver",
      inputSchema: z.object({ pick: z.enum(["a", "b", "both"]) }),
      model: "m",
      prompt: "p",
      outputSchema: z.object({ ok: z.boolean() }),
      tools: (input) => {
        if (input.pick === "a") return [toolA];
        if (input.pick === "b") return [toolB];
        return [toolA, toolB];
      },
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          seenToolNames = (options.tools ?? []).map((t: any) => t.name);
          return { structuredOutput: { ok: true } };
        },
      }),
    });

    await runForTest(block, { pick: "a" }, ctx);
    expect(seenToolNames).toEqual(["toolA"]);

    await runForTest(block, { pick: "b" }, ctx);
    expect(seenToolNames).toEqual(["toolB"]);

    await runForTest(block, { pick: "both" }, ctx);
    expect(seenToolNames).toEqual(["toolA", "toolB"]);
  });

  it("passes maxSteps to model.generate", async () => {
    let receivedMaxSteps: number | undefined;
    const block = generator({
      name: "max-steps",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ done: z.literal(true) }),
      maxIterations: 4
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          receivedMaxSteps = options.maxSteps;
          return {
            structuredOutput: { done: true }
          };
        }
      })
    });
    await expect(runForTest(block, { n: 1 }, ctx)).resolves.toEqual({ done: true });
    expect(receivedMaxSteps).toBe(4);
  });

  it("forwards the resolved caching config to model.generate", async () => {
    let receivedCaching: unknown;
    const block = generator({
      name: "cache-config",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ ok: z.literal(true) }),
      caching: { ttl: "1h" }
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          receivedCaching = options.caching;
          return { structuredOutput: { ok: true } };
        }
      })
    });
    await runForTest(block, { n: 1 }, ctx);
    expect(receivedCaching).toEqual({ ttl: "1h" });
  });

  it("resolves a function-form caching config per call", async () => {
    let receivedCaching: unknown;
    const block = generator({
      name: "dynamic-cache",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ ok: z.literal(true) }),
      caching: (input: { disable: boolean }) =>
        input.disable ? { enabled: false } : { ttl: "5m" }
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          receivedCaching = options.caching;
          return { structuredOutput: { ok: true } };
        }
      })
    });
    await runForTest(block, { disable: true }, ctx);
    expect(receivedCaching).toEqual({ enabled: false });
  });


  it("does not auto-inject resource content tools", async () => {
    const block = generator({
      name: "no-auto-resource-tools",
      model: "m",
      prompt: "p"
    });

    const ctx = createMockContext({
      session: {
        identity: { type: "session", id: "s1", userId: "u1" },
        state: {},
        resources: {
          get: () => ({}) as any,
          list: () => [
            {
              name: "soul",
              scope: "session",
              config: { llmReadable: true, llmWritable: true },
              state: {},
              patchState: async () => undefined,
              setState: async () => undefined,
              updateState: async () => undefined,
              readContent: async () => "x",
              readContentRaw: async () => "x",
              writeContent: async () => undefined
            } as any
          ]
        },
        patchState: async () => undefined,
        setState: async () => undefined,
        incState: async () => undefined,
        pushState: async () => undefined,
        setStateRecord: async () => undefined,
        deleteStateRecord: async () => undefined,
        atomicState: async () => undefined,
        appendJournal: async () => undefined,
        getJournal: async () => []
      } as any,
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          expect(options.tools).toBeUndefined();
          return { text: "ok" };
        }
      })
    });

    await expect(runForTest(block, { value: "x" }, ctx)).resolves.toBe("ok");
  });
  it("skips tool invocation when loop.runTools is false", async () => {
    const toolCall = vi.fn();
    const tool = handler({
      name: "unused-tool",
      inputSchema: z.object({ value: z.number() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => {
        toolCall();
        return { ok: false };
      }
    });
    const block = generator({
      name: "no-tools",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ ok: z.boolean() }),
      tools: [tool],
      loop: {
        runTools: false
      }
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            toolCalls: [
              {
                toolCallId: "unused",
                toolName: "unused-tool",
                args: { value: 1 }
              }
            ],
            structuredOutput: { ok: true }
          };
        }
      })
    });
    await expect(runForTest(block, { value: 1 }, ctx)).resolves.toEqual({ ok: true });
    expect(toolCall).not.toHaveBeenCalled();
  });

  it("emits block_tool_output items when a tool executes with toolCallId", async () => {
    const emittedEvents: Array<{ type: string; item?: Record<string, unknown> }> = [];
    const tool = handler({
      name: "lookup-tool",
      inputSchema: z.object({ query: z.string() }),
      outputSchema: z.object({ answer: z.string() }),
      execute: (input) => ({ answer: `result for ${input.query}` })
    });

    const block = generator({
      name: "tool-generator",
      model: "m",
      prompt: "Use the tool",
      tools: [tool]
    });

    let toolExecutionCount = 0;
    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          if (toolExecutionCount === 0) {
            toolExecutionCount++;
            // Simulate AI SDK calling the tool's execute with toolCallId.
            const toolDef = (options.tools as any[])?.find(
              (t: any) => t.name === "lookup-tool"
            );
            if (toolDef?.execute) {
              await toolDef.execute({ query: "test" }, { toolCallId: "call_123" });
            }
            return { text: "done" };
          }
          return { text: "done" };
        }
      }),
      response: {
        emit: (event: unknown) => {
          emittedEvents.push(event as any);
        },
        getItems: () => emittedEvents.filter((e: any) => e.item).map((e: any) => e.item)
      } as any
    });

    await runForTest(block, { value: "x" }, ctx);

    const toolOutputEvents = emittedEvents.filter(
      (e) => e.type === "item.added" && e.item?.type === "block_tool_output"
    );
    expect(toolOutputEvents.length).toBe(1);

    const toolOutput = toolOutputEvents[0]!.item!;
    expect(toolOutput.blockName).toBe("lookup-tool");
    expect(toolOutput.output).toEqual({ answer: "result for test" });
    expect((toolOutput.toolCall as any).callId).toBe("call_123");
    expect((toolOutput.toolCall as any).name).toBe("lookup-tool");
    expect((toolOutput.toolCall as any).generatorBlock).toBe("tool-generator");
  });
});

it("supports manually adding unified resource content tools", async () => {
  const calls: Array<{ name: string; args: any }> = [];

  const readableResource = {
    name: "soul",
    scope: "session",
    config: { llmReadable: true, llmWritable: false },
    state: {},
    patchState: async () => undefined,
    setState: async () => undefined,
    updateState: async () => undefined,
    readContent: async () => "rendered",
    readContentRaw: async () => "raw",
    writeContent: async () => undefined
  } as any;

  const writableResource = {
    ...readableResource,
    name: "notes",
    config: { llmReadable: true, llmWritable: true },
    writeContent: async (content: string) => {
      calls.push({ name: "write", args: content });
    }
  } as any;

  const block = generator({
    name: "resource-tools",
    model: "m",
    prompt: "p",
    tools: [readResourceContentTool(), writeResourceContentTool()]
  });

  const ctx = createMockContext({
    session: {
      identity: { type: "session", id: "s1", userId: "u1" },
      state: {},
      patchState: async () => undefined,
      setState: async () => undefined,
      incState: async () => undefined,
      pushState: async () => undefined,
      setStateRecord: async () => undefined,
      deleteStateRecord: async () => undefined,
      atomicState: async () => undefined,
      appendJournal: async () => undefined,
      getJournal: async () => []
    } as any,
    resources: {
      get: () => readableResource,
      list: () => [readableResource, writableResource]
    } as any,
    resolveModel: () => ({
      modelId: "m",
      async generate(options: any) {
        const readTool = options.tools.find((tool: any) => tool.name === "readResourceContent");
        const writeTool = options.tools.find((tool: any) => tool.name === "writeResourceContent");
        expect(readTool).toBeDefined();
        expect(writeTool).toBeDefined();
        expect(options.tools).toHaveLength(2);

        const listed = await readTool.execute({});
        calls.push({ name: "list", args: listed.paths });

        const readResult = await readTool.execute({ path: "session/soul" });
        calls.push({ name: "read", args: readResult.content });

        await writeTool.execute({ path: "session/notes", content: "updated" });

        return { text: "done" };
      }
    })
  });

  await expect(runForTest(block, { value: "x" }, ctx)).resolves.toBe("done");
  expect(calls).toEqual([
    { name: "list", args: ["session/notes", "session/soul"] },
    { name: "read", args: "rendered" },
    { name: "write", args: "updated" }
  ]);
});

describe("generator streaming", () => {
  it("does not pass outputSchema to model.stream() for text generators", async () => {
    let receivedOutputSchema: unknown = "NOT_CALLED";
    const block = generator({
      name: "stream-schema",
      agentType: "primary",
      model: "mock-model",
      prompt: "Return text"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "mock-model",
        async generate() {
          return { text: "fallback" };
        },
        async *stream(options: any) {
          receivedOutputSchema = options.outputSchema;
          yield { type: "text_delta" as const, textDelta: "hello" };
          yield {
            type: "finish" as const,
            fullResult: { text: "hello" }
          };
        }
      })
    });

    await runForTest(block, { value: "x" }, ctx);
    // Text generators (z.string()) should NOT pass outputSchema to the model —
    // it would trigger structured output mode (Output.object) which prevents
    // normal text delta streaming.
    expect(receivedOutputSchema).toBeUndefined();
  });

  it("emits tool_call_progress items for tool_call_delta chunks", async () => {
    const emitted: Array<{ type: string; item?: any }> = [];
    const block = generator({
      name: "stream-tool-delta",
      agentType: "primary",
      model: "mock-model",
      prompt: "Use tools"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "mock-model",
        async generate() {
          return { text: "fallback" };
        },
        async *stream() {
          yield {
            type: "tool_call_delta" as const,
            toolCallDelta: { toolCallId: "tc_1", toolName: "search", argsDelta: '{"q":"test"}' }
          };
          yield { type: "text_delta" as const, textDelta: "result" };
          yield {
            type: "finish" as const,
            fullResult: { text: "result" }
          };
        }
      }),
      response: {
        emit: (event: any) => {
          emitted.push(event);
        }
      }
    });

    await runForTest(block, { value: "x" }, ctx);

    const toolCallItems = emitted.filter(
      e => e.type === "item.added" && e.item?.type === "tool_call_progress"
    );
    expect(toolCallItems.length).toBe(1);
    expect(toolCallItems[0].item.toolCallId).toBe("tc_1");
    expect(toolCallItems[0].item.toolName).toBe("search");
    expect(toolCallItems[0].item.argsDelta).toBe('{"q":"test"}');
  });

  it("emits completed tool_call_progress items for tool_result chunks", async () => {
    const emitted: Array<{ type: string; item?: any }> = [];
    const block = generator({
      name: "stream-tool-result",
      agentType: "primary",
      model: "mock-model",
      prompt: "Use tools"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "mock-model",
        async generate() {
          return { text: "fallback" };
        },
        async *stream() {
          yield {
            type: "tool_result" as const,
            toolResult: { toolCallId: "tc_1", toolName: "search", result: { found: true } }
          };
          yield { type: "text_delta" as const, textDelta: "done" };
          yield {
            type: "finish" as const,
            fullResult: { text: "done" }
          };
        }
      }),
      response: {
        emit: (event: any) => {
          emitted.push(event);
        }
      }
    });

    await runForTest(block, { value: "x" }, ctx);

    const toolResultItems = emitted.filter(
      e => e.type === "item.added" && e.item?.type === "tool_call_progress" && e.item?.status === "completed"
    );
    expect(toolResultItems.length).toBe(1);
    expect(toolResultItems[0].item.toolCallId).toBe("tc_1");
    expect(toolResultItems[0].item.result).toEqual({ found: true });
  });

  it("does not emit any items when agentType is unset", async () => {
    const emitted: Array<{ type: string; item?: any }> = [];
    const block = generator({
      name: "no-identity",
      model: "mock-model",
      prompt: "Use tools"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "mock-model",
        async generate() {
          return { text: "result" };
        },
        async *stream() {
          yield { type: "text_delta" as const, textDelta: "result" };
          yield {
            type: "finish" as const,
            fullResult: { text: "result" }
          };
        }
      }),
      response: {
        emit: (event: any) => {
          emitted.push(event);
        }
      }
    });

    await runForTest(block, { value: "x" }, ctx);

    const convItems = emitted.filter(
      e => e.type === "item.added" &&
           ["message", "reasoning", "tool_call_progress", "status", "source"].includes(e.item?.type)
    );
    expect(convItems.length).toBe(0);
  });

  it("still streams text through to schema validation when agentType is set", async () => {
    const emitted: Array<{ type: string; item?: any; delta?: string }> = [];
    const block = generator({
      name: "text-still-flows",
      agentType: "primary",
      model: "mock-model",
      prompt: "Use tools"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "mock-model",
        async generate() {
          return { text: "fallback" };
        },
        async *stream() {
          yield {
            type: "tool_call_delta" as const,
            toolCallDelta: { toolCallId: "tc_1", toolName: "search", argsDelta: '{"q":"test"}' }
          };
          yield {
            type: "tool_result" as const,
            toolResult: { toolCallId: "tc_1", toolName: "search", result: { found: true } }
          };
          yield { type: "text_delta" as const, textDelta: "hello world" };
          yield {
            type: "finish" as const,
            fullResult: { text: "hello world" }
          };
        }
      }),
      response: {
        emit: (event: any) => {
          emitted.push(event);
        }
      }
    });

    await runForTest(block, { value: "x" }, ctx);

    // Tool call events and text content both emit under agentType: "primary".
    const toolItems = emitted.filter(
      e => e.type === "item.added" && e.item?.type === "tool_call_progress"
    );
    expect(toolItems.length).toBeGreaterThan(0);

    const contentDeltas = emitted.filter(e => e.type === "content.delta");
    expect(contentDeltas.length).toBeGreaterThan(0);
  });
});
