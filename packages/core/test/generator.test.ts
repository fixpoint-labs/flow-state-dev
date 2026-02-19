import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  generator,
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
      prompt: "Return a string",
      generate: () => "hello"
    });

    const ctx = createMockContext();
    await expect(block.config.execute?.({ value: "x" }, ctx)).resolves.toBe("hello");
  });

  it("resolves model and prompt from functions", async () => {
    const seen: Array<{ input: number; model: string; prompt: string }> = [];
    const block = generator<{ count: number }, string>({
      name: "dynamic-model-prompt",
      model: (input) => `model-${input.count}`,
      prompt: (input) => `prompt-${input.count}`,
      generate: (state) => {
        seen.push({
          input: state.input.count,
          model: state.model,
          prompt: state.prompt
        });
        return "ok";
      }
    });

    const ctx = createMockContext();
    await expect(block.config.execute?.({ count: 2 }, ctx)).resolves.toBe("ok");
    expect(seen[0]).toEqual({
      input: 2,
      model: "model-2",
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
      repairOutput,
      generate: () => ({ done: "nope" })
    });

    const ctx = createMockContext();
    await expect(block.config.execute?.({ value: 1 }, ctx)).resolves.toEqual({ done: true });
    expect(repairOutput).toHaveBeenCalledTimes(1);
  });

  it("fails immediately in repair fail/rescue modes", async () => {
    const blockFail = generator<{ value: number }, { done: boolean }>({
      name: "repair-fail",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ done: z.boolean() }),
      repair: { mode: "fail", maxAttempts: 4 },
      generate: () => ({ done: "bad" })
    });

    const blockRescue = generator<{ value: number }, { done: boolean }>({
      name: "repair-rescue",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ done: z.boolean() }),
      repair: { mode: "rescue", maxAttempts: 4 },
      generate: () => ({ done: "bad" })
    });

    const ctx = createMockContext();
    await expect(blockFail.config.execute?.({ value: 1 }, ctx)).rejects.toThrow("validation failed");
    await expect(blockRescue.config.execute?.({ value: 1 }, ctx)).rejects.toThrow("validation failed");
  });

  it("runs tools inside the loop and can continue on tool errors", async () => {
    const toolCalls: string[] = [];

    const block = generator<{ text: string }, { text: string; ok: boolean }>({
      name: "tool-loop",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ text: z.string(), ok: z.boolean() }),
      maxIterations: 2,
      tools: [
        {
          name: "fails-but-continues",
          continueOnError: true,
          execute: () => {
            toolCalls.push("fail");
            throw new Error("tool failed");
          }
        },
        {
          name: "succeeds",
          execute: (input) => {
            toolCalls.push("ok");
            return { text: (input as { text: string }).text, ok: true };
          }
        }
      ],
      generate: (state) => {
        const success = state.toolResults.find((result) => result.error === undefined);
        return success?.output ?? { text: "missing", ok: false };
      }
    });

    const ctx = createMockContext();
    await expect(block.config.execute?.({ text: "hello" }, ctx)).resolves.toEqual({
      text: "hello",
      ok: true
    });
    expect(toolCalls).toEqual(["fail", "ok"]);
  });

  it("supports loop stopWhen and maxIterations", async () => {
    const states: GeneratorLoopState<{ n: number }>[] = [];
    const block = generator<{ n: number }, { done: true }>({
      name: "loop-stop",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ done: z.literal(true) }),
      maxIterations: 4,
      generate: (state) => {
        states.push(state);
        return { done: false as unknown as true };
      },
      loop: {
        stopWhen: (state) => state.iteration >= 1
      },
      repair: {
        mode: "fail"
      }
    });

    const ctx = createMockContext();
    await expect(block.config.execute?.({ n: 1 }, ctx)).rejects.toThrow("validation failed");
    expect(states.length).toBe(2);
  });

  it("skips tool invocation when loop.runTools is false", async () => {
    const toolCall = vi.fn();
    const block = generator<{ value: number }, { ok: boolean }>({
      name: "no-tools",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ ok: z.boolean() }),
      tools: [
        {
          name: "unused-tool",
          execute: () => {
            toolCall();
            return { ok: false };
          }
        }
      ],
      loop: {
        runTools: false
      },
      generate: () => ({ ok: true })
    });

    const ctx = createMockContext();
    await expect(block.config.execute?.({ value: 1 }, ctx)).resolves.toEqual({ ok: true });
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
