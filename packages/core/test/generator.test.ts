import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  generator,
  handler,
  resolveGeneratorClientOutput,
  resolveGeneratorLlmOutput,
  type GeneratorLoopState
} from "../src";
import { createMockContext } from "./helpers";

describe("generator builder", () => {
  it("defaults output schema to string when omitted", async () => {
    const block = generator<{ value: string }, string>({
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
    await expect(block.run({ value: "x" }, ctx)).resolves.toBe("hello");
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

    const block = generator<{ value: string }, string>({
      name: "direct-model",
      model,
      prompt: "Return text"
    });

    const ctx = createMockContext();
    await expect(block.run({ value: "x" }, ctx)).resolves.toBe("from-direct-model");
  });

  it("resolves model and prompt from functions", async () => {
    const seen: Array<{ modelId: string; prompt: unknown }> = [];
    const block = generator<{ count: number }, string>({
      name: "dynamic-model-prompt",
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
    await expect(block.run({ count: 2 }, ctx)).resolves.toBe("ok");
    expect(seen[0]).toEqual({
      modelId: "model-2",
      prompt: "prompt-2"
    });
  });

  it("supports repair mode auto with custom repairOutput", async () => {
    const repairOutput = vi.fn().mockReturnValue({ done: true });
    const block = generator<{ value: number }, { done: boolean }>({
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
    await expect(block.run({ value: 1 }, ctx)).resolves.toEqual({ done: true });
    expect(repairOutput).toHaveBeenCalledTimes(1);
  });

  it("fails immediately in repair fail/rescue modes", async () => {
    const blockFail = generator<{ value: number }, { done: boolean }>({
      name: "repair-fail",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ done: z.boolean() }),
      repair: { mode: "fail", maxAttempts: 4 }
    });

    const blockRescue = generator<{ value: number }, { done: boolean }>({
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
    await expect(blockFail.run({ value: 1 }, ctx)).rejects.toThrow("validation failed");
    await expect(blockRescue.run({ value: 1 }, ctx)).rejects.toThrow("validation failed");
  });

  it("runs model-requested tools inside the loop", async () => {
    const toolCalls: string[] = [];
    let modelCalls = 0;
    const succeedTool = handler<{ text: string }, { text: string; ok: boolean }>({
      name: "succeeds",
      execute: (input) => {
        toolCalls.push("ok");
        return {
          text: input.text,
          ok: true
        };
      }
    });

    const block = generator<{ text: string }, { text: string; ok: boolean }>({
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
        async generate() {
          if (modelCalls === 0) {
            modelCalls += 1;
            return {
              toolCalls: [
                {
                  toolCallId: "call-1",
                  toolName: "succeeds",
                  args: { text: "hello" }
                }
              ]
            };
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
    await expect(block.run({ text: "hello" }, ctx)).resolves.toEqual({
      text: "hello",
      ok: true
    });
    expect(toolCalls).toEqual(["ok"]);
  });

  it("supports loop stopWhen and maxIterations", async () => {
    const states: GeneratorLoopState<{ n: number }>[] = [];
    const block = generator<{ n: number }, { done: true }>({
      name: "loop-stop",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ done: z.literal(true) }),
      maxIterations: 4,
      loop: {
        stopWhen: (state) => {
          states.push(state);
          return state.iteration >= 1;
        }
      },
      repair: {
        mode: "fail"
      }
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: { done: false as unknown as true }
          };
        }
      })
    });
    await expect(block.run({ n: 1 }, ctx)).rejects.toThrow("validation failed");
    expect(states.length).toBe(2);
  });

  it("skips tool invocation when loop.runTools is false", async () => {
    const toolCall = vi.fn();
    const tool = handler<{ value: number }, { ok: boolean }>({
      name: "unused-tool",
      execute: () => {
        toolCall();
        return { ok: false };
      }
    });
    const block = generator<{ value: number }, { ok: boolean }>({
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
    await expect(block.run({ value: 1 }, ctx)).resolves.toEqual({ ok: true });
    expect(toolCall).not.toHaveBeenCalled();
  });
});

describe("generator helpers", () => {
  it("resolves llmOutput option variants", async () => {
    const ctx = createMockContext();

    await expect(resolveGeneratorLlmOutput(false, { value: 1 }, ctx)).resolves.toBeNull();
    await expect(resolveGeneratorLlmOutput(true, { value: 1 }, ctx)).resolves.toEqual({ value: 1 });
    await expect(resolveGeneratorLlmOutput("fixed", { value: 1 }, ctx)).resolves.toBe("fixed");
    await expect(
      resolveGeneratorLlmOutput((output) => ({ wrapped: output }), { value: 1 }, ctx)
    ).resolves.toEqual({ wrapped: { value: 1 } });
  });

  it("resolves clientOutput option variants", async () => {
    await expect(resolveGeneratorClientOutput(false, { value: 1 })).resolves.toBeNull();
    await expect(resolveGeneratorClientOutput(true, { value: 1 })).resolves.toEqual({ value: 1 });
    await expect(
      resolveGeneratorClientOutput((output) => ({ wrapped: output }), { value: 1 })
    ).resolves.toEqual({ wrapped: { value: 1 } });
  });
});
