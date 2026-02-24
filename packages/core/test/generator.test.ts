import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  generator,
  handler
} from "../src";
import { createMockContext } from "./helpers";

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

    const block = generator({
      name: "direct-model",
      model,
      prompt: "Return text"
    });

    const ctx = createMockContext();
    await expect(block.run({ value: "x" }, ctx)).resolves.toBe("from-direct-model");
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
    await expect(block.run({ count: 2 }, ctx)).resolves.toBe("ok");
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
    await expect(block.run({ value: 1 }, ctx)).resolves.toEqual({ done: true });
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
    await expect(blockFail.run({ value: 1 }, ctx)).rejects.toThrow("validation failed");
    await expect(blockRescue.run({ value: 1 }, ctx)).rejects.toThrow("validation failed");
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
    await expect(block.run({ text: "hello" }, ctx)).resolves.toEqual({
      text: "hello",
      ok: true
    });
    expect(toolCalls).toEqual(["ok"]);
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
    await expect(block.run({ n: 1 }, ctx)).resolves.toEqual({ done: true });
    expect(receivedMaxSteps).toBe(4);
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
    await expect(block.run({ value: 1 }, ctx)).resolves.toEqual({ ok: true });
    expect(toolCall).not.toHaveBeenCalled();
  });
});
