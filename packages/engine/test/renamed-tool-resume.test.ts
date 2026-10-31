/**
 * A request suspended inside a model tool resumes after the tool is renamed
 * (FIX-2317). The model's stop for a person was renamed `suspendForUser`, and
 * such a stop can wait days, so a deploy lands while some are open. The
 * generator's persisted step names the tool it called by its old name; the
 * resumed build has only the new one.
 */
import { DEFAULT_ORG_ID, defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import type { GeneratorModel, GeneratorModelCallOptions, GeneratorModelResult } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";

type StepFn = (options: GeneratorModelCallOptions) => GeneratorModelResult;

/** One model shared by both builds: its script continues across the deploy. */
function stepModel(script: StepFn[]) {
  const seen: GeneratorModelCallOptions[] = [];
  const model: GeneratorModel = {
    modelId: "step-model",
    async generate() {
      throw new Error("legacy generate must not be called");
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

/** The flow as one build has it: a generator whose stop tool is named `toolName`. */
function build(model: GeneratorModel, toolName: string) {
  const stop = handler({
    name: toolName,
    inputSchema: z.object({ prompt: z.string() }),
    outputSchema: z.object({ approved: z.boolean() }),
    execute: async (input, ctx) => {
      await ctx.suspend!({ reason: "user_approval", message: input.prompt });
      return { approved: true };
    },
  });
  const gen = generator({ name: "agent", model, prompt: "p", tools: [stop] });
  return defineFlow({
    kind: "renamed-tool",
    actions: { run: { block: sequencer({ name: "seq", durable: true }).step(gen), inputSchema: z.object({}).passthrough() } },
  })({ id: "renamed-tool" });
}

describe("a stop suspended under a model tool's old name (FIX-2317)", () => {
  it("resumes on a build that names the tool suspendForUser, and the turn completes", async () => {
    const { model } = stepModel([
      () => ({ toolCalls: [{ toolCallId: "c1", toolName: "waitForUser", args: { prompt: "Ship it?" } }], finishReason: "tool-calls" }), // retired-name-refusal: a stop the old build suspended
      () => ({ text: "shipped", finishReason: "stop" }),
    ]);
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({ checkpoints: stores.checkpoints, suspensions: stores.suspensions, leases: stores.leases });

    // The old build suspends.
    const before = build(model, "waitForUser"); // retired-name-refusal: a stop the old build suspended
    const initial = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: before,
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider },
    });
    const requestId = initial.requestId!;
    expect((await stores.request.get(requestId))?.status).toBe("suspended");

    // The new build answers it.
    const after = build(model, "suspendForUser");
    const [suspension] = await provider.listSuspended({ status: "pending" });
    await provider.suspend({ ...suspension!, status: "approved", resolvedAt: Date.now(), resumeData: { ok: true } });
    const registry = createFlowRegistry();
    registry.register(after as never);
    const continued = await continueRequest({
      requestId,
      stores,
      flowRegistry: registry,
      resumeContext: { suspensionId: suspension!.suspensionId, action: "approve", data: { ok: true }, resumedBy: "u1" },
      runtimeConfig: { durabilityProvider: provider },
    });
    const finished = await continued.finished;

    expect((await stores.request.get(requestId))?.status).toBe("completed");
    expect(finished.output).toBe("shipped");
  });
});
