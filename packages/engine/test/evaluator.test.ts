/**
 * The `evaluator` kind in the runtime: dispatch, the block_trace row it
 * leaves (top-level and nested, on success and failure), model strings on an
 * app-supplied resolver, and cancellation mid-call.
 */
import {
  boolean,
  choice,
  createModelResolver,
  defineFlow,
  evaluator,
  generator,
  handler,
  sequencer,
  DEFAULT_ORG_ID
} from "@flow-state-dev/core";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import type { EvaluationModel, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { createMockModelResolver, mockEvaluationModel } from "@flow-state-dev/testing";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryStores, createResponseEmitter, runAction } from "../src";

const questions = {
  team: choice("Which team should handle this?", {
    billing: "Payments and refunds",
    technical: "Bugs and outages",
  }),
  urgent: boolean("Does this need someone now?"),
};

const answers = {
  team: { type: "choice" as const, choice: "billing", confidence: 0.94 },
  urgent: { type: "boolean" as const, probability: 0.2 },
};

type RunOptions = {
  requestId: string;
  modelResolver?: ModelResolver;
  signal?: AbortSignal;
};

async function run(block: Parameters<typeof defineFlow>[0]["actions"][string]["block"], options: RunOptions) {
  const flow = defineFlow({
    kind: `evaluator-${options.requestId}`,
    actions: { run: { inputSchema: z.object({ message: z.string() }), block } },
  })();
  const stores = createInMemoryStores();
  const response = createResponseEmitter({ requestId: options.requestId, now: () => Date.now() });
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: { message: "I was charged twice" },
    requestId: options.requestId,
    userId: "user_1",
    sessionId: "sess_1",
    stores,
    responseEmitter: response,
    signal: options.signal,
    runtimeConfig: options.modelResolver ? { modelResolver: options.modelResolver } : {},
  });
  const traces = response.getItems().filter((i) => i.type === "block_trace") as BlockTraceItem[];
  return { result, traces, stores };
}

function triage(model: string | EvaluationModel, name = "triage") {
  return evaluator({
    name,
    model,
    inputSchema: z.object({ message: z.string() }),
    state: (input) => input.message,
    questions,
  });
}

describe("evaluator in the runtime — trace (BR-23, BR-24, BR-27)", () => {
  it("runs as the action's root block and records kind, model, questions, answers, usage and identity", async () => {
    const model = mockEvaluationModel({ answers, usage: { inputTokens: 30, outputTokens: 2 }, modelId: "jev-latest" });
    const { result, traces } = await run(triage(model), { requestId: "req_eval_root" });

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({
      answers: {
        team: { type: "choice", choice: "billing", confidence: 0.94 },
        urgent: { type: "boolean", probability: 0.2 },
      },
    });
    const row = traces.find((t) => t.blockName === "triage")!;
    expect(row.blockKind).toBe("evaluator");
    expect(row.status).toBe("completed");
    expect(row.evaluator).toEqual({ model: "mock.evaluation/jev-latest", questions });
    expect(row.output).toEqual({ kind: "inline", value: result.output });
    expect(row.modelUsage).toEqual({
      model: "mock.evaluation/jev-latest",
      promptTokens: 30,
      completionTokens: 2,
      totalTokens: 32,
    });
    expect(row.model).toEqual({ actual: "jev-latest", requested: "mock.evaluation/jev-latest" });
    expect(model.calls).toHaveLength(1);
  });

  it("records the same fields when nested in a sequencer", async () => {
    const model = mockEvaluationModel({ answers, usage: { inputTokens: 7, outputTokens: 1 } });
    const pipeline = sequencer({ name: "pipeline", inputSchema: z.object({ message: z.string() }) })
      .step(triage(model))
      .step(
        handler({
          name: "route",
          execute: (output: { answers: { team: { choice: string } } }) => output.answers.team.choice,
        })
      );
    const { result, traces } = await run(pipeline, { requestId: "req_eval_nested" });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe("billing");
    const row = traces.find((t) => t.blockName === "triage")!;
    expect(row.blockKind).toBe("evaluator");
    expect(row.evaluator?.model).toBe("mock.evaluation/mock-evaluation");
    expect(row.modelUsage?.totalTokens).toBe(8);
    expect(row.model?.actual).toBe("mock-evaluation");
  });

  it("records a failed row with the model and questions asked, and no answers, when the call fails (BR-21)", async () => {
    const model = mockEvaluationModel({ error: new Error("evaluation provider returned 503") });
    const pipeline = sequencer({ name: "pipeline", inputSchema: z.object({ message: z.string() }) }).step(
      triage(model)
    );
    const { result, traces } = await run(pipeline, { requestId: "req_eval_fail" });

    expect(result.error?.message).toMatch(/evaluation provider returned 503/);
    const row = traces.find((t) => t.blockName === "triage")!;
    expect(row.status).toBe("failed");
    expect(row.evaluator?.model).toBe("mock.evaluation/mock-evaluation");
    expect(row.output).toEqual({ kind: "inline", value: undefined });
    expect(model.calls).toHaveLength(1);
  });

  it("fails without partial answers in the output or the trace when the result is malformed (BR-20)", async () => {
    const model = mockEvaluationModel({ answers: { team: answers.team } });
    const { result, traces } = await run(triage(model), { requestId: "req_eval_malformed" });

    expect(result.error?.message).toMatch(/exactly one answer for every question/);
    expect(result.output).toBeUndefined();
    const row = traces.find((t) => t.blockName === "triage")!;
    expect(row.status).toBe("failed");
    expect(JSON.stringify(row.output ?? null)).not.toContain("billing");
  });

  it("is recovered by .rescue with a substitute block, which runs once in its place (BR-21)", async () => {
    const model = mockEvaluationModel({ error: new Error("evaluation provider returned 503") });
    const fallback = handler({ name: "ask-a-person", execute: () => ({ answers: "escalated" }) });
    const { result } = await run(triage(model).rescue([{ block: fallback }]), { requestId: "req_eval_rescue" });

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ answers: "escalated" });
    expect(model.calls).toHaveLength(1);
  });

  it("leaves a stored four-kind trace readable: the four kinds still trace as before (BR-27)", async () => {
    const pipeline = sequencer({ name: "legacy", inputSchema: z.object({ message: z.string() }) }).step(
      handler({ name: "echo", execute: (input: { message: string }) => input.message })
    );
    const { traces } = await run(pipeline, { requestId: "req_eval_legacy" });
    expect(traces.map((t) => t.blockKind).sort()).toEqual(["handler", "sequencer"]);
    expect(traces.every((t) => t.evaluator === undefined)).toBe(true);
  });

  it("names the gateway that routed the call on the row's model identity, as a generator's row does", async () => {
    // A gateway serving Jev: every evaluation model it hands out answers the
    // same way. The row must say the call went through "vercel", for both the
    // bare string (gateway fallback) and the explicit gateway string.
    const gateway = {
      languageModel: vi.fn(),
      evaluationModel: (id: string) => mockEvaluationModel({ answers, modelId: id, provider: "gateway" }),
    };
    const modelResolver = createModelResolver({ gateways: { vercel: gateway } });

    const bare = await run(triage("typesafe-ai/jev"), { requestId: "req_eval_gw_bare", modelResolver });
    expect(bare.result.error).toBeUndefined();
    expect(bare.traces.find((t) => t.blockName === "triage")!.model).toEqual({
      actual: "typesafe-ai/jev",
      gateway: "vercel",
    });

    const explicit = await run(triage("vercel/typesafe-ai/jev"), { requestId: "req_eval_gw_explicit", modelResolver });
    expect(explicit.result.error).toBeUndefined();
    expect(explicit.traces.find((t) => t.blockName === "triage")!.model).toEqual({
      actual: "typesafe-ai/jev",
      requested: "vercel/typesafe-ai/jev",
      gateway: "vercel",
    });
  });

  it("records usage and identity on its own row when a generator calls it as a tool, leaving the generator's row its own", async () => {
    const evalModel = mockEvaluationModel({ answers, usage: { inputTokens: 12, outputTokens: 3 }, modelId: "jev-latest" });
    let steps = 0;
    const agentModel: GeneratorModel = {
      modelId: "agent-model",
      async generate() {
        throw new Error("legacy generate must not be called on a step-capable model");
      },
      async generateStep() {
        steps += 1;
        return steps === 1
          ? {
              toolCalls: [{ toolCallId: "c1", toolName: "triage", args: { message: "I was charged twice" } }],
              finishReason: "tool-calls",
              usage: { promptTokens: 100, completionTokens: 5, totalTokens: 105 },
            }
          : { text: "routed", finishReason: "stop", usage: { promptTokens: 120, completionTokens: 2, totalTokens: 122 } };
      },
    } as GeneratorModel;
    const agent = generator({
      name: "agent",
      model: agentModel,
      prompt: "route the ticket",
      tools: [triage(evalModel)],
    });

    const { result, traces } = await run(agent, { requestId: "req_eval_tool" });

    expect(result.error).toBeUndefined();
    expect(evalModel.calls).toHaveLength(1);
    const toolRow = traces.find((t) => t.blockName === "triage")!;
    expect(toolRow.blockKind).toBe("evaluator");
    expect(toolRow.modelUsage).toMatchObject({
      model: "mock.evaluation/jev-latest",
      promptTokens: 12,
      completionTokens: 3,
      totalTokens: 15,
    });
    expect(toolRow.model).toEqual({ actual: "jev-latest", requested: "mock.evaluation/jev-latest" });
    // The generator's row keeps its own model.
    const agentRow = traces.find((t) => t.blockName === "agent")!;
    expect(agentRow.model?.actual).not.toBe("jev-latest");
    expect(agentRow.modelUsage?.model).not.toBe("mock.evaluation/jev-latest");
  });
});

describe("evaluator on an app-supplied model resolver (D4, BR-29, BR-30)", () => {
  /** A custom resolver with no evaluation hook; every generator resolution is counted. */
  function customResolver() {
    const generateModel: GeneratorModel = {
      modelId: "custom/gen",
      generate: async () => ({ text: "generated" }),
    };
    const resolve = vi.fn(() => generateModel);
    const resolver = resolve as unknown as ModelResolver;
    resolver.resolveId = (id: string) => id;
    return { resolver, resolve };
  }

  it("refuses an evaluator model string before any call, naming the hook, and never falls back (BR-29)", async () => {
    const { resolver, resolve } = customResolver();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const defaultProvider = { evaluationModel: vi.fn() };
    (globalThis as { AI_SDK_DEFAULT_PROVIDER?: unknown }).AI_SDK_DEFAULT_PROVIDER = defaultProvider;
    try {
      const { result } = await run(triage("typesafe-ai/jev"), { requestId: "req_eval_custom", modelResolver: resolver });

      expect(result.error?.message).toMatch(/Evaluator "triage".*resolveEvaluationModel/);
      expect(resolve).not.toHaveBeenCalled();
      expect(defaultProvider.evaluationModel).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      delete (globalThis as { AI_SDK_DEFAULT_PROVIDER?: unknown }).AI_SDK_DEFAULT_PROVIDER;
    }
  });

  it("still runs generators on the same resolver", async () => {
    const { resolver, resolve } = customResolver();
    const { generator } = await import("@flow-state-dev/core");
    const { result } = await run(generator({ name: "writer", model: "custom/gen", prompt: "Write" }), {
      requestId: "req_eval_custom_gen",
      modelResolver: resolver,
    });
    expect(result.error).toBeUndefined();
    expect(resolve).toHaveBeenCalled();
  });

  it("answers with an evaluation model instance on the same resolver (BR-30)", async () => {
    const { resolver } = customResolver();
    const model = mockEvaluationModel({ answers });
    const { result } = await run(triage(model), { requestId: "req_eval_custom_instance", modelResolver: resolver });
    expect(result.error).toBeUndefined();
    expect(model.calls).toHaveLength(1);
  });

  it("control: with the hook added, the string resolves through it, once (D4)", async () => {
    const { resolver } = customResolver();
    const model = mockEvaluationModel({ answers });
    const hook = vi.fn(() => model);
    resolver.resolveEvaluationModel = hook;
    const { result } = await run(triage("typesafe-ai/jev"), { requestId: "req_eval_custom_hook", modelResolver: resolver });
    expect(result.error).toBeUndefined();
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith("typesafe-ai/jev", "triage");
    expect(model.calls).toHaveLength(1);
  });

  it("with the test harness's mock resolver (no hook), a string is refused the same way", async () => {
    const { result } = await run(triage("openai/gpt-5.4-mini"), {
      requestId: "req_eval_mock_resolver",
      modelResolver: createMockModelResolver({}),
    });
    expect(result.error?.message).toMatch(/resolveEvaluationModel/);
  });
});

describe("evaluator — cancellation mid-call (BR-22)", () => {
  it("passes the abort to the pending call, and the request ends aborted, not failed", async () => {
    const model = mockEvaluationModel({ answers, hold: true });
    const controller = new AbortController();
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "evaluator-abort",
      actions: { run: { inputSchema: z.object({ message: z.string() }), block: triage(model) } },
    })();
    const pending = runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: { message: "hello" },
      requestId: "req_eval_abort",
      userId: "user_1",
      sessionId: "sess_1",
      signal: controller.signal,
      stores,
      runtimeConfig: {},
    });

    await vi.waitFor(() => expect(model.calls).toHaveLength(1));
    await stores.request.setFieldsIfStatus("req_eval_abort", { abortRequested: true }, ["in_progress"], Date.now());
    controller.abort();
    const result = await pending;

    expect(model.calls[0]!.abortSignal?.aborted).toBe(true);
    expect(result.error).toBeUndefined();
    expect((await stores.request.get("req_eval_abort"))?.status).toBe("aborted");
  });

  it("control: the same mock rejecting with an ordinary error ends the request failed", async () => {
    const model = mockEvaluationModel({ error: new Error("evaluation provider returned 500") });
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "evaluator-abort-control",
      actions: { run: { inputSchema: z.object({ message: z.string() }), block: triage(model) } },
    })();
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: { message: "hello" },
      requestId: "req_eval_abort_control",
      userId: "user_1",
      sessionId: "sess_1",
      stores,
      runtimeConfig: {},
    });
    expect(result.error).toBeDefined();
    expect((await stores.request.get("req_eval_abort_control"))?.status).toBe("failed");
  });
});
