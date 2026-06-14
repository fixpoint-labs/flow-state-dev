/**
 * FIX-275: end-to-end tool-approval suspend/resume for generators.
 *
 * Drives a real generator (over the real Vercel AI SDK loop, with a mock
 * language model) inside a durable action: a gated tool call suspends the
 * request; the resume endpoint's ResumeContext carries the human decision;
 * the resumed generator continues without replaying the model call, executing
 * approved tools or letting the model adapt to a rejection.
 */
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { wrapAiSdkModel } from "@flow-state-dev/core";
import { z } from "zod";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import type { ResumeContext, SuspensionRecord } from "@flow-state-dev/core/types";

function createDurableStores() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases
  });
  return { stores, provider };
}

const USAGE = { inputTokens: { total: 10 }, outputTokens: { total: 2 } };

function streamOf(parts: unknown[]) {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    }
  });
}

function toolCallStream(toolCallId: string, toolName: string, input: unknown) {
  return streamOf([
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) },
    { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage: USAGE }
  ]);
}


/**
 * Build a durable single-generator flow whose generator calls a gated tool on
 * its first model turn and produces final text on the next. `executed` records
 * whether the gated tool actually ran.
 */
function buildFlow(finalText: string) {
  const executed = vi.fn(async (input: { to: string }) => ({ sent: true, to: input.to }));

  const sendEmail = handler({
    name: "send_email",
    inputSchema: z.object({ to: z.string() }),
    outputSchema: z.object({ sent: z.boolean(), to: z.string() }),
    requiresApproval: true,
    execute: async (input) => executed(input)
  });

  const model = new MockLanguageModelV3({
    // The initial gated turn streams a tool call (→ suspend).
    doStream: async () => ({ stream: toolCallStream("tc_1", "send_email", { to: "a@b.com" }) }),
    // The resumed turn completes via the non-streaming path: after the approved
    // tool runs (or a denial is materialized), the model produces final text.
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: finalText }],
      finishReason: { unified: "stop", raw: undefined },
      usage: USAGE,
      warnings: []
    })
  });

  const agent = generator({
    name: "agent",
    model: wrapAiSdkModel(model, "anthropic/claude-sonnet-4-6"),
    prompt: "Email a@b.com.",
    tools: [sendEmail],
    maxIterations: 5
  });

  const flow = defineFlow({
    kind: "tool-approval-test",
    actions: {
      run: {
        block: sequencer({ name: "agentSeq", durable: true }).step(agent),
        inputSchema: z.any()
      }
    }
  })();

  return { flow, executed };
}

async function suspendOnce(flow: ReturnType<typeof buildFlow>["flow"]) {
  const { stores, provider } = createDurableStores();
  const result = await runAction({
    flow,
    actionName: "run",
    input: {},
    userId: "u1",
    sessionId: "s1",
    stores,
    runtimeConfig: { durabilityProvider: provider }
  });
  return { stores, provider, result };
}

describe("tool-approval suspend/resume (FIX-275)", () => {
  it("a gated tool call suspends the request with the call details and turn state", async () => {
    const { flow, executed } = buildFlow("Email sent.");
    const { result, provider } = await suspendOnce(flow);

    // The gated tool did not run.
    expect(executed).not.toHaveBeenCalled();

    const request = result.requestId;
    expect(request).toBeDefined();

    const suspensions = await provider.listSuspended({ status: "pending" });
    expect(suspensions).toHaveLength(1);
    const record = suspensions[0]! as SuspensionRecord;
    expect(record.reason).toBe("tool_approval");
    expect((record.data as any).toolCalls).toHaveLength(1);
    expect((record.data as any).toolCalls[0].toolName).toBe("send_email");
    // The serialized turn is persisted for resume, internal only.
    expect((record.resumeState as any)?.kind).toBe("tool_approval");
    expect(Array.isArray((record.resumeState as any)?.responseMessages)).toBe(true);

    // The client-facing SuspensionItem carries the call details but not resumeState.
    const suspItem = result.items.find((i) => i.type === "suspension") as any;
    expect(suspItem).toBeDefined();
    expect(suspItem.reason).toBe("tool_approval");
    expect(suspItem.data.toolCalls[0].toolName).toBe("send_email");
    expect(suspItem.resumeState).toBeUndefined();
  });

  it("approving resumes and executes the tool, completing without replaying the model call", async () => {
    const { flow, executed } = buildFlow("Email sent.");
    const { stores, provider, result } = await suspendOnce(flow);
    const record = (await provider.listSuspended({ status: "pending" }))[0]!;

    const resumeContext: ResumeContext = {
      suspensionId: record.suspensionId,
      action: "approve",
      data: { decisions: [{ toolCallId: "tc_1", approved: true }] }
    };

    const resumed = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: { durabilityProvider: provider },
      metadata: { resumeOf: result.requestId, resumeContext }
    });

    expect(executed).toHaveBeenCalledTimes(1);
    expect(resumed.error).toBeUndefined();
    expect(resumed.output).toBe("Email sent.");
  });

  it("rejecting resumes and lets the model adapt without executing the tool", async () => {
    const { flow, executed } = buildFlow("Understood, I won't send it.");
    const { stores, provider, result } = await suspendOnce(flow);
    const record = (await provider.listSuspended({ status: "pending" }))[0]!;

    const resumeContext: ResumeContext = {
      suspensionId: record.suspensionId,
      action: "approve",
      data: { decisions: [{ toolCallId: "tc_1", approved: false, reason: "no" }] }
    };

    const resumed = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: { durabilityProvider: provider },
      metadata: { resumeOf: result.requestId, resumeContext }
    });

    expect(executed).not.toHaveBeenCalled();
    expect(resumed.error).toBeUndefined();
    expect(resumed.output).toBe("Understood, I won't send it.");
  });
});
