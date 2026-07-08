/**
 * Generator `prepareStep` regressions against the real AI SDK 7 tool loop.
 *
 * AI SDK 7 changed `prepareStep` semantics: a returned `messages` override
 * carries forward as the input of later steps (v6 recomputed each step's
 * input from the initial messages). The generator's dynamic-slot rebuild
 * slices the system prefix off the current messages before prepending fresh
 * values, so the slice must track the prefix it last wrote — not the
 * assembly-time prefix — or a step whose fresh prefix has a different
 * length duplicates stale context into the conversation.
 *
 * These tests drive the real `streamText` loop through `wrapAiSdkModel` +
 * `MockLanguageModelV3` and assert on the messages the model receives per
 * step (the resolver-level request), not on generator internals.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MockLanguageModelV3 } from "ai/test";
import { generator, handler } from "../src";
import { wrapAiSdkModel } from "../src/models";
import { createMockContext, runForTest } from "./helpers";

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 3, text: 3, reasoning: undefined }
};

/** V3 provider stream that requests one `lookup` tool call. */
function toolCallStep(callId: string) {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: "tool-call",
          toolCallId: callId,
          toolName: "lookup",
          input: '{"q":"x"}'
        } as any);
        controller.enqueue({
          type: "finish",
          finishReason: { unified: "tool-calls", raw: undefined },
          usage
        } as any);
        controller.close();
      }
    })
  };
}

/** V3 provider stream that finishes with plain text. */
function textStep(text: string) {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-start", id: "t1" } as any);
        controller.enqueue({ type: "text-delta", id: "t1", delta: text } as any);
        controller.enqueue({ type: "text-end", id: "t1" } as any);
        controller.enqueue({
          type: "finish",
          finishReason: { unified: "stop", raw: undefined },
          usage
        } as any);
        controller.close();
      }
    })
  };
}

// No `description`: keeps the auto-generated <tools> context block out of
// the system prefix so the assertions below only see prompt + context.
const lookupTool = handler({
  name: "lookup",
  inputSchema: z.object({ q: z.string() }),
  outputSchema: z.object({ answer: z.string() }),
  execute: async () => ({ answer: "42" })
});

function systemContents(prompt: unknown[]): string[] {
  return (prompt as Array<{ role: string; content: unknown }>)
    .filter((m) => m.role === "system")
    .map((m) => String(m.content));
}

describe("generator prepareStep — AI SDK 7 carry-forward", () => {
  it("rebuilds the system prefix idempotently across tool-loop steps (no duplicated or stale context)", async () => {
    // Dynamic context resolves to a different number of entries per step so
    // the system prefix length varies — the case where slicing by the
    // assembly-time prefix length leaks the previous step's context.
    const contextPerResolution = [
      ["ctx-initial"],
      ["ctx-step1-a", "ctx-step1-b"],
      ["ctx-step2"]
    ];
    let contextCall = 0;
    const dynamicContext = () =>
      contextPerResolution[Math.min(contextCall++, contextPerResolution.length - 1)]!;

    const steps = [toolCallStep("call_1"), toolCallStep("call_2"), textStep("done")];
    let streamCall = 0;
    const mockModel = new MockLanguageModelV3({
      doStream: async () => steps[streamCall++]!
    });

    const block = generator({
      name: "dyn-ctx-gen",
      model: wrapAiSdkModel(mockModel),
      prompt: "agent-prompt",
      context: [dynamicContext],
      user: "go",
      tools: [lookupTool],
      maxIterations: 3
    });

    await expect(runForTest(block, {}, createMockContext())).resolves.toBe("done");
    expect(mockModel.doStreamCalls.length).toBe(3);

    // Step 1 (index 0): assembly-time prefix, untouched.
    expect(systemContents(mockModel.doStreamCalls[0]!.prompt as unknown[])).toEqual([
      "agent-prompt",
      "ctx-initial"
    ]);

    // Step 2: fresh prefix replaces the initial one; nothing stale.
    const step2Prompt = mockModel.doStreamCalls[1]!.prompt as unknown[];
    expect(systemContents(step2Prompt)).toEqual([
      "agent-prompt",
      "ctx-step1-a",
      "ctx-step1-b"
    ]);
    expect(JSON.stringify(step2Prompt)).not.toContain("ctx-initial");

    // Step 3: the previous override carried forward as this step's input;
    // the rebuild must slice off the step-2 prefix (3 messages), not the
    // assembly-time prefix (2), or "ctx-step1-b" leaks into the conversation.
    const step3Prompt = mockModel.doStreamCalls[2]!.prompt as unknown[];
    expect(systemContents(step3Prompt)).toEqual(["agent-prompt", "ctx-step2"]);
    expect(JSON.stringify(step3Prompt)).not.toContain("ctx-step1");

    // Conversation survives the rebuild: one user turn, both tool rounds.
    const roles = (step3Prompt as Array<{ role: string }>).map((m) => m.role);
    expect(roles.filter((r) => r === "user")).toHaveLength(1);
    expect(roles.filter((r) => r === "tool")).toHaveLength(2);
  });

  it("leaves single-iteration generation untouched (context resolved once, initial messages sent as-is)", async () => {
    let contextCall = 0;
    const dynamicContext = () => {
      contextCall++;
      return "ctx-once";
    };

    // No tools and no itemVisibility: the generator takes the non-streaming
    // path, so the single call lands on doGenerate.
    const mockModel = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "single" }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: []
      })
    });

    const block = generator({
      name: "single-step-gen",
      model: wrapAiSdkModel(mockModel),
      prompt: "agent-prompt",
      context: [dynamicContext],
      user: "go",
      maxIterations: 1
    });

    await expect(runForTest(block, {}, createMockContext())).resolves.toBe("single");

    // One model call with the assembly-time messages; the dynamic slot was
    // resolved exactly once (at assembly), never re-resolved by prepareStep.
    expect(mockModel.doGenerateCalls.length).toBe(1);
    expect(contextCall).toBe(1);
    expect(systemContents(mockModel.doGenerateCalls[0]!.prompt as unknown[])).toEqual([
      "agent-prompt",
      "ctx-once"
    ]);
  });
});
