/**
 * A request suspended inside a model tool resumes after the tool is renamed
 * (FIX-2317). The model's stop for a person was renamed `suspendForUser`, and
 * such a stop can wait days, so a deploy lands while some are open. The
 * generator's persisted step names the tool it called by its old name; the
 * resumed build has only the new one.
 *
 * The former name is a fallback, never a rewrite: an app whose own tool still
 * has that name resumes its own tool.
 */
import { DEFAULT_ORG_ID, defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import type { GeneratorModel, GeneratorModelCallOptions, GeneratorModelResult } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";

const FORMER = "waitForUser"; // retired-name-refusal: a stop suspended before FIX-2317
const RENAMED = "suspendForUser";

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

/** The flow as one build has it: a generator with a stop tool under each of `toolNames`, each noting when it finishes. */
function build(model: GeneratorModel, toolNames: readonly string[], finished: string[]) {
  const tools = toolNames.map((name) =>
    handler({
      name,
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ approved: z.boolean() }),
      execute: async (input, ctx) => {
        await ctx.suspend!({ reason: "user_approval", message: input.prompt });
        finished.push(name);
        return { approved: true };
      },
    })
  );
  const gen = generator({ name: "agent", model, prompt: "p", tools });
  return defineFlow({
    kind: "renamed-tool",
    actions: { run: { block: sequencer({ name: "seq", durable: true }).step(gen), inputSchema: z.object({}).passthrough() } },
  })({ id: "renamed-tool" });
}

/** The model calls `FORMER` on the build with `before`'s tools; the user approves; the build with `after`'s tools resumes. */
async function suspendThenResume(before: readonly string[], after: readonly string[]) {
  const { model } = stepModel([
    () => ({ toolCalls: [{ toolCallId: "c1", toolName: FORMER, args: { prompt: "Ship it?" } }], finishReason: "tool-calls" }),
    () => ({ text: "shipped", finishReason: "stop" }),
  ]);
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({ checkpoints: stores.checkpoints, suspensions: stores.suspensions, leases: stores.leases });
  const finished: string[] = [];

  const initial = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow: build(model, before, finished),
    actionName: "run",
    input: {},
    userId: "u1",
    stores,
    runtimeConfig: { durabilityProvider: provider },
  });
  const requestId = initial.requestId!;
  expect((await stores.request.get(requestId))?.status).toBe("suspended");

  const [suspension] = await provider.listSuspended({ status: "pending" });
  await provider.suspend({ ...suspension!, status: "approved", resolvedAt: Date.now(), resumeData: { ok: true } });
  const registry = createFlowRegistry();
  registry.register(build(model, after, finished) as never);
  const continued = await continueRequest({
    requestId,
    stores,
    flowRegistry: registry,
    resumeContext: { suspensionId: suspension!.suspensionId, action: "approve", data: { ok: true }, resumedBy: "u1" },
    runtimeConfig: { durabilityProvider: provider },
  });
  const done = await continued.finished;
  return {
    status: (await stores.request.get(requestId))?.status,
    output: done.output,
    finished,
    pending: (await provider.listSuspended({ status: "pending" })).length,
  };
}

describe("a stop suspended under a model tool's old name (FIX-2317)", () => {
  it("resumes on a build that names the tool suspendForUser, and the turn completes", async () => {
    const result = await suspendThenResume([FORMER], [RENAMED]);
    expect(result).toMatchObject({ status: "completed", output: "shipped", pending: 0 });
    expect(result.finished).toEqual([RENAMED]);
  });

  it("resumes an app's own tool that still has the old name, untouched by the fallback", async () => {
    const result = await suspendThenResume([FORMER], [FORMER]);
    expect(result).toMatchObject({ status: "completed", output: "shipped", pending: 0 });
    expect(result.finished).toEqual([FORMER]);
  });

  it("resumes the tool it recorded when the build has both names", async () => {
    const result = await suspendThenResume([FORMER, RENAMED], [FORMER, RENAMED]);
    expect(result).toMatchObject({ status: "completed", output: "shipped", pending: 0 });
    expect(result.finished).toEqual([FORMER]);
  });
});
