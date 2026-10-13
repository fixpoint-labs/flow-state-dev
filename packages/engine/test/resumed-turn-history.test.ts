/**
 * A turn that waited on an approval, read back as history by the next turn.
 *
 * A gated tool records its wait as a failed `tool_output` (code
 * `SUSPENSION`), then its real result once the answer resumes the request.
 * Both rows stay on the request. The next turn's history must hold the call
 * once, with its result: a model shown the wait as a failure thinks its first
 * attempt failed and says it retried.
 */
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { GeneratorModel, GeneratorModelCallOptions, GeneratorModelResult } from "@flow-state-dev/core/types";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { expandRequestToMessages } from "../src/context/history";
import type { OutputItem } from "@flow-state-dev/core/items";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";

type StepFn = (options: GeneratorModelCallOptions) => GeneratorModelResult;

function stepModel(script: StepFn[]) {
  const seen: GeneratorModelCallOptions[] = [];
  const model: GeneratorModel = {
    modelId: "step-model",
    async generate() {
      throw new Error("legacy generate must not be called on a step-capable model");
    },
    async generateStep(options) {
      seen.push(options);
      const entry = script[seen.length - 1];
      if (entry === undefined) throw new Error(`no script entry for generateStep #${seen.length - 1}`);
      return entry(options);
    },
  };
  return { model, seen };
}

/** Every tool-call and tool-result part in `messages`, in order. */
function toolParts(messages: unknown[]) {
  const calls: string[] = [];
  const results: string[] = [];
  for (const m of messages as Array<Record<string, unknown>>) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content as Array<Record<string, unknown>>) {
      if (part.type === "tool-call") calls.push(part.toolCallId as string);
      if (part.type === "tool-result") results.push(JSON.stringify(part.output));
    }
  }
  return { calls, results };
}

describe("history after an approved turn", () => {
  it("replays the approved call once, with its result, never the wait as a failure", async () => {
    const gate = handler({
      name: "set_repository",
      inputSchema: z.object({ repository: z.string() }),
      outputSchema: z.object({ repository: z.string() }),
      execute: async (input, ctx) => {
        await ctx.suspend!({ reason: "human_approval", message: `Set the repository to ${input.repository}?` });
        return { repository: input.repository };
      },
    });
    const { model, seen } = stepModel([
      () => ({ toolCalls: [{ toolCallId: "c1", toolName: "set_repository", args: { repository: "acme/web" } }], finishReason: "tool-calls" }),
      () => ({ text: "repository set", finishReason: "stop" }),
      () => ({ text: "anything else?", finishReason: "stop" }),
    ]);
    const gen = generator({ name: "agent", model, prompt: "p", tools: [gate], history: true });
    const flow = defineFlow({
      kind: "gen-history-after-approval",
      actions: { run: { block: sequencer({ name: "seq", durable: true }).step(gen), inputSchema: z.object({}).passthrough() } },
    })({ id: "gen-history-after-approval" }) as FlowInstance;

    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({ checkpoints: stores.checkpoints, suspensions: stores.suspensions, leases: stores.leases });
    const runtimeConfig = { durabilityProvider: provider };
    const sessionId = "s-history";

    const first = await runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: {}, userId: "u1", sessionId, stores, runtimeConfig });
    const [suspension] = await provider.listSuspended({ status: "pending" });
    await provider.suspend({ ...suspension!, status: "approved", resolvedAt: Date.now() });
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const { finished } = await continueRequest({
      requestId: first.requestId!,
      stores,
      flowRegistry: registry,
      resumeContext: { suspensionId: suspension!.suspensionId, action: "approve", resumedBy: "u1" },
      runtimeConfig,
    });
    await finished;
    expect((await stores.request.get(first.requestId!))?.status).toBe("completed");

    await runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: {}, userId: "u1", sessionId, stores, runtimeConfig });
    const next = toolParts(seen[2]!.messages);
    expect(next.calls).toEqual(["c1"]);
    expect(next.results).toHaveLength(1);
    expect(next.results[0]).toContain("acme/web");
    expect(next.results[0]).not.toContain("failed");
  });

  it("leaves a request that never waited as it was", () => {
    const base = { requestId: "r1", provenance: { blockInstanceId: "agent#0" } };
    const items = [
      { ...base, id: "m1", type: "message", role: "user", status: "completed", ts: 1, itemIndex: 0, content: [{ type: "output_text", text: "hi" }] },
      {
        ...base,
        id: "t1",
        type: "tool_output",
        status: "completed",
        ts: 2,
        itemIndex: 1,
        toolCall: { callId: "c1", name: "lookup", arguments: "{}" },
        output: "found",
      },
      { ...base, id: "m2", type: "message", role: "assistant", status: "completed", ts: 3, itemIndex: 2, content: [{ type: "output_text", text: "done" }] },
    ] as unknown as OutputItem[];
    const messages = expandRequestToMessages(items, new Set(["message", "tool_output"]), undefined);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(toolParts(messages).calls).toEqual(["c1"]);
    expect(toolParts(messages).results).toEqual([JSON.stringify({ type: "text", value: "found" })]);
  });
});
