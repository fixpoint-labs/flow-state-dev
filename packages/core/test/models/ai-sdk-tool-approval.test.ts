/**
 * Drives the real Vercel AI SDK tool-approval machinery through the framework
 * resolver (FIX-275). Proves the load-bearing assumptions the generator
 * tool-approval gate depends on:
 *   1. A tool stamped with `needsApproval` ends the turn with a
 *      tool-approval-request instead of executing.
 *   2. The resolver surfaces `approvalRequests` + the serialized turn
 *      (`responseMessages` / `requestMessages`).
 *   3. Replaying that turn via `continuation` (with approval responses) lets
 *      the SDK execute the approved tool and finish — without the resolver
 *      re-invoking the original model call.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MockLanguageModelV3 } from "ai/test";
import { createAiSdkModelResolver, wrapAiSdkModel } from "../../src/models";
import type { GeneratorModelResult, GeneratorModelTool } from "../../src/types";

function streamOf(parts: unknown[]) {
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(p);
      c.close();
    }
  });
}
const STREAM_USAGE = { inputTokens: { total: 10 }, outputTokens: { total: 2 } };

function toolCallContent(toolCallId: string, toolName: string, input: unknown) {
  return {
    // The AI SDK expects a provider tool-call `input` as a JSON string.
    content: [{ type: "tool-call" as const, toolCallId, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: "tool-calls", raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 2, text: 2, reasoning: undefined }
    },
    warnings: []
  };
}

function textContent(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 3, text: 3, reasoning: undefined }
    },
    warnings: []
  };
}

describe("createAiSdkModelResolver — tool approval (FIX-275)", () => {
  it("a needsApproval tool ends the turn awaiting approval without executing", async () => {
    const execute = vi.fn(async () => ({ sent: true }));
    const gated: GeneratorModelTool = {
      name: "send_email",
      description: "Send an email",
      parameters: z.object({ to: z.string() }),
      execute,
      needsApproval: true
    };

    const model = new MockLanguageModelV3({
      doGenerate: async () => toolCallContent("tc_1", "send_email", { to: "a@b.com" })
    });

    const resolver = createAiSdkModelResolver(() => model);
    const result = await resolver("anthropic/claude-sonnet-4-6", "gen").generate({
      messages: [{ role: "user", content: "email a@b.com" }],
      tools: [gated],
      maxSteps: 5
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.approvalRequests).toBeDefined();
    expect(result.approvalRequests).toHaveLength(1);
    const req = result.approvalRequests![0]!;
    expect(req.toolName).toBe("send_email");
    expect(req.toolCallId).toBe("tc_1");
    expect(req.args).toEqual({ to: "a@b.com" });
    expect(typeof req.approvalId).toBe("string");
    // The turn is persisted for resume.
    expect(Array.isArray(result.responseMessages)).toBe(true);
    expect(Array.isArray(result.requestMessages)).toBe(true);
  });

  it("resuming via continuation with an approval executes the tool and finishes", async () => {
    const execute = vi.fn(async () => ({ sent: true }));
    const gated: GeneratorModelTool = {
      name: "send_email",
      description: "Send an email",
      parameters: z.object({ to: z.string() }),
      execute,
      needsApproval: true
    };

    let call = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        call += 1;
        // First call: request the gated tool. After approval + execution the
        // SDK calls the model again, which now produces the final answer.
        return call === 1
          ? toolCallContent("tc_1", "send_email", { to: "a@b.com" })
          : textContent("Email sent.");
      }
    });

    const generator = createAiSdkModelResolver(() => model)("anthropic/claude-sonnet-4-6", "gen");

    const first = await generator.generate({
      messages: [{ role: "user", content: "email a@b.com" }],
      tools: [gated],
      maxSteps: 5
    });
    expect(execute).not.toHaveBeenCalled();
    const approvalId = first.approvalRequests![0]!.approvalId;

    const resumed = await generator.generate({
      messages: [],
      tools: [gated],
      maxSteps: 5,
      continuation: {
        messages: [...(first.requestMessages ?? []), ...(first.responseMessages ?? [])],
        approvalResponses: [{ approvalId, approved: true }]
      }
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(resumed.approvalRequests).toBeUndefined();
    expect(resumed.text).toBe("Email sent.");
  });

  it("resuming with a rejection materializes a denial and lets the model adapt", async () => {
    const execute = vi.fn(async () => ({ sent: true }));
    const gated: GeneratorModelTool = {
      name: "send_email",
      description: "Send an email",
      parameters: z.object({ to: z.string() }),
      execute,
      needsApproval: true
    };

    let call = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        call += 1;
        return call === 1
          ? toolCallContent("tc_1", "send_email", { to: "a@b.com" })
          : textContent("Understood, I won't send it.");
      }
    });

    const generator = createAiSdkModelResolver(() => model)("anthropic/claude-sonnet-4-6", "gen");

    const first = await generator.generate({
      messages: [{ role: "user", content: "email a@b.com" }],
      tools: [gated],
      maxSteps: 5
    });
    const approvalId = first.approvalRequests![0]!.approvalId;

    const resumed = await generator.generate({
      messages: [],
      tools: [gated],
      maxSteps: 5,
      continuation: {
        messages: [...(first.requestMessages ?? []), ...(first.responseMessages ?? [])],
        approvalResponses: [
          { approvalId, approved: false, reason: "User declined" }
        ]
      }
    });

    // Rejected: the tool never runs; the model produces an adapted answer.
    expect(execute).not.toHaveBeenCalled();
    expect(resumed.text).toBe("Understood, I won't send it.");
  });

  it("streaming: a needsApproval tool surfaces the approval request on the finish chunk", async () => {
    // The initial gated turn may stream; the generator reads approval requests
    // off the finish chunk's fullResult (the resumed turn itself completes via
    // the non-streaming `generate` path, covered above).
    const execute = vi.fn(async () => ({ sent: true }));
    const gated: GeneratorModelTool = {
      name: "send_email",
      description: "Send an email",
      parameters: z.object({ to: z.string() }),
      execute,
      needsApproval: true
    };

    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: streamOf([
          { type: "stream-start", warnings: [] },
          { type: "tool-call", toolCallId: "tc_1", toolName: "send_email", input: JSON.stringify({ to: "a@b.com" }) },
          { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage: STREAM_USAGE }
        ])
      })
    });

    const generator = wrapAiSdkModel(model, "anthropic/claude-sonnet-4-6");
    let final: GeneratorModelResult | undefined;
    for await (const chunk of generator.stream!({
      messages: [{ role: "user", content: "email a@b.com" }],
      tools: [gated],
      maxSteps: 5
    })) {
      if (chunk.type === "finish") final = chunk.fullResult;
    }

    expect(execute).not.toHaveBeenCalled();
    expect(final?.approvalRequests).toHaveLength(1);
    expect(final!.approvalRequests![0]!.toolName).toBe("send_email");
    expect(Array.isArray(final?.responseMessages)).toBe(true);
    expect(Array.isArray(final?.requestMessages)).toBe(true);
  });
});
