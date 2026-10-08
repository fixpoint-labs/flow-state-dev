/**
 * The ask gate and its server-side resume, end to end through `runAction`.
 *
 * A turn's tool parks on an ask gate. A later request in the SAME conversation
 * resumes it through `ctx.requestHost.resumeAsk`, and the parked request
 * continues under its own id, with the answer as the tool's result. Nothing
 * here files a task: the board and the row arrive with the hand-off itself;
 * this proves the park, the resume and the fence they stand on.
 *
 * The asking turn is a generator inside a plain (non-durable) sequencer — the
 * shape a Workforce turn has — so this also pins that `ctx.suspend()` needs a
 * durability provider, not a durable sequencer.
 */
import {
  AskEndedError,
  defineFlow,
  generator,
  handler,
  parkOnAsk,
  requireRequestHost,
  sequencer
} from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type {
  AskOutcome,
  FlowInstance,
  GeneratorModel,
  GeneratorModelCallOptions,
  GeneratorModelResult,
  ResumeAskResult
} from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  continueRequest,
  createFlowRegistry,
  createFlowState,
  createInMemoryStores,
  inMemoryStores,
  runAction
} from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { createAskResumeOperation, resumeAskGate } from "../src/context/ask-resume-operation";
import { handleResumeSuspension } from "../src/routes/resume-routes";
import type { ExecutionResult } from "../src/execution/types";
import type { RuntimeConfig } from "../src/runtime-config";

type StepFn = (options: GeneratorModelCallOptions) => GeneratorModelResult;

/** A step-capable model that follows a script and records what it was sent. */
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
      if (entry === undefined) throw new Error(`no script entry for step ${seen.length - 1}`);
      return entry(options);
    }
  };
  return { model, seen };
}

/** The tool results the model was sent on one step. */
function toolResults(messages: unknown[]): string[] {
  const out: string[] = [];
  for (const m of messages as Array<Record<string, unknown>>) {
    if (m.role !== "tool" || !Array.isArray(m.content)) continue;
    for (const part of m.content as Array<Record<string, unknown>>) {
      if (part.type === "tool-result") out.push(JSON.stringify(part.output));
    }
  }
  return out;
}

const GATE_ID = "gate_ask_1";

/**
 * A flow with an asking turn and a `touch` action that resumes an ask gate,
 * standing in for the board touch that will call the verb.
 */
function askFlow(model: GeneratorModel, sideEffects: { count: number }) {
  const ask = handler({
    name: "ask_colleague",
    inputSchema: z.object({ question: z.string() }),
    outputSchema: z.object({ answer: z.unknown() }),
    execute: async (_input, ctx) => {
      const answer = await parkOnAsk(ctx, {
        gateId: GATE_ID,
        binding: { board: "conversation", taskId: "task_1" }
      });
      sideEffects.count += 1;
      return { answer };
    }
  });
  const agent = generator({ name: "agent", model, prompt: "p", tools: [ask] });
  const turn = sequencer({ name: "turn" }).step(agent);

  const touch = handler({
    name: "touch",
    inputSchema: z.object({ gateId: z.string(), outcome: z.any() }),
    outputSchema: z.any(),
    execute: async (input, ctx) => {
      const host = requireRequestHost(ctx);
      if (host.resumeAsk === undefined) return { absent: true };
      return host.resumeAsk({ gateId: input.gateId, outcome: input.outcome as AskOutcome });
    }
  });

  return defineFlow({
    kind: "ask-resume",
    actions: {
      run: { block: turn, inputSchema: z.object({}).passthrough() },
      touch: { block: touch }
    },
    internal: { actions: { work: { block: turn } } }
  })({ id: "ask-resume" });
}

function setup(flow: FlowInstance, options: { durable?: boolean } = {}) {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider(stores);
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const continued: Promise<ExecutionResult>[] = [];
  const runtimeConfig: RuntimeConfig = {};
  if (options.durable !== false) {
    runtimeConfig.durabilityProvider = provider;
    runtimeConfig.requestHost = {
      askResume: createAskResumeOperation({
        provider,
        stores,
        continueRequest: async (opts) => {
          const result = await continueRequest({
            ...opts,
            stores,
            flowRegistry: registry,
            runtimeConfig
          });
          continued.push(result.finished);
          return result;
        }
      })
    };
  } else {
    runtimeConfig.requestHost = {};
  }
  return { stores, provider, registry, runtimeConfig, continued };
}

type Harness = ReturnType<typeof setup>;

async function startTurn(
  h: Harness,
  flow: FlowInstance,
  options: { sessionId?: string; actionName?: string; source?: string } = {}
) {
  return runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: options.actionName ?? "run",
    input: {},
    userId: "u_asker",
    sessionId: options.sessionId ?? "s_asker",
    source: options.source,
    stores: h.stores,
    runtimeConfig: h.runtimeConfig
  } as never);
}

async function touch(
  h: Harness,
  flow: FlowInstance,
  outcome: AskOutcome,
  options: { sessionId?: string; userId?: string; gateId?: string } = {}
): Promise<ResumeAskResult & { absent?: true }> {
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "touch",
    input: { gateId: options.gateId ?? GATE_ID, outcome },
    userId: options.userId ?? "u_asker",
    sessionId: options.sessionId ?? "s_asker",
    stores: h.stores,
    runtimeConfig: h.runtimeConfig
  });
  expect(result.error).toBeUndefined();
  return result.output as ResumeAskResult & { absent?: true };
}

function askingModel() {
  return stepModel([
    () => ({
      toolCalls: [{ toolCallId: "c1", toolName: "ask_colleague", args: { question: "SOC 2?" } }],
      finishReason: "tool-calls"
    }),
    (opts) => ({ text: `done: ${toolResults(opts.messages).join(" | ")}`, finishReason: "stop" })
  ]);
}

describe("ask gate: park, and resume from the asker's own conversation", () => {
  for (const source of ["http", "internal"] as const) {
    it(`a ${source}-source turn parks on the gate and resumes with the answer as the tool's result`, async () => {
      const { model, seen } = askingModel();
      const sideEffects = { count: 0 };
      const flow = askFlow(model, sideEffects);
      const h = setup(flow);

      const parked = await startTurn(h, flow, {
        source,
        actionName: source === "internal" ? "work" : "run"
      });
      const requestId = parked.requestId!;
      expect((await h.stores.request.get(requestId))?.status).toBe("suspended");

      // The gate carries the wait binding and the id the caller chose.
      const gate = await h.provider.loadSuspension(requestId, GATE_ID);
      expect(gate).toMatchObject({
        reason: "ask",
        status: "pending",
        data: { board: "conversation", taskId: "task_1" }
      });
      expect(sideEffects.count).toBe(0);

      const answer = { verdict: "Yes, renewed 2026-08" };
      const resumed = await touch(h, flow, { answered: true, answer });
      expect(resumed).toEqual({ ok: true });

      expect(h.continued).toHaveLength(1);
      const finished = await h.continued[0]!;
      expect(finished.requestId).toBe(requestId);
      const record = await h.stores.request.get(requestId);
      expect(record?.status).toBe("completed");
      // The same request, continued: the model saw the answer as the tool's
      // result, and only the step after the park was a new model call.
      expect(seen).toHaveLength(2);
      expect(toolResults(seen[1]!.messages).join("")).toContain("Yes, renewed 2026-08");
      expect(finished.output).toContain("Yes, renewed 2026-08");
      expect(sideEffects.count).toBe(1);
    });
  }

  it("an ask that ended without an answer reaches the model as the tool's error", async () => {
    const { model, seen } = askingModel();
    const flow = askFlow(model, { count: 0 });
    const h = setup(flow);
    const parked = await startTurn(h, flow);

    const resumed = await touch(h, flow, {
      answered: false,
      error: { code: "wait_task_failed", message: "The colleague's task failed." }
    });
    expect(resumed).toEqual({ ok: true });
    await h.continued[0];

    expect((await h.stores.request.get(parked.requestId!))?.status).toBe("completed");
    const sent = toolResults(seen[1]!.messages).join("");
    expect(sent).toContain("The colleague's task failed.");
    // Read as a failed tool, not handed over as an answer.
    expect(sent).not.toContain('"answer"');
    expect(new AskEndedError("wait_task_failed", "x").code).toBe("wait_task_failed");
  });

  it("resumes once: a second resume of the same gate is refused and changes nothing", async () => {
    const { model, seen } = askingModel();
    const sideEffects = { count: 0 };
    const flow = askFlow(model, sideEffects);
    const h = setup(flow);
    const parked = await startTurn(h, flow);

    expect(await touch(h, flow, { answered: true, answer: "first" })).toEqual({ ok: true });
    const finished = await h.continued[0]!;

    // The turn finished, and its gates were cleaned up with it, so the late
    // resume finds nothing to resume.
    const second = await touch(h, flow, { answered: true, answer: "second" });
    expect(second).toMatchObject({ ok: false, refused: "gate-not-found" });
    expect(h.continued).toHaveLength(1);
    expect(sideEffects.count).toBe(1);
    expect(seen).toHaveLength(2);
    expect((await h.stores.request.get(parked.requestId!))?.status).toBe("completed");
    expect(finished.output).toContain("first");
    expect(finished.output).not.toContain("second");
  });

  it("a gate resolved before the turn finished refuses a second resume as already-resolved", async () => {
    const { model } = askingModel();
    const flow = askFlow(model, { count: 0 });
    const h = setup(flow);
    const parked = await startTurn(h, flow);
    const requestId = parked.requestId!;

    // A continuation that has started but not finished: the gate is resolved
    // and the request is no longer parked.
    let continuations = 0;
    const deps = {
      provider: h.provider,
      stores: h.stores,
      continueRequest: async () => {
        continuations += 1;
        return { requestId, liveStream: null, finished: new Promise<never>(() => {}) };
      }
    };
    const gate = { requestId, suspensionId: GATE_ID };

    expect(await resumeAskGate(deps, gate, { answered: true, answer: "first" }, "test")).toEqual({
      ok: true
    });
    // While the continuation runs it holds the turn's lease, and a second
    // resume is refused `busy`. Once the lease is gone (the turn parked again
    // elsewhere, or the lease ran out) the gate itself refuses.
    expect(await resumeAskGate(deps, gate, { answered: true, answer: "x" }, "test")).toMatchObject({
      ok: false,
      refused: "busy"
    });
    const lease = await h.stores.leases.get(requestId);
    await h.provider.releaseLease(requestId, lease!.leaseId);
    const second = await resumeAskGate(deps, gate, { answered: true, answer: "second" }, "test");
    expect(second).toMatchObject({ ok: false, refused: "already-resolved" });
    expect(continuations).toBe(1);
    expect((await h.provider.loadSuspension(requestId, GATE_ID))?.resumeData).toEqual({
      answered: true,
      answer: "first"
    });
  });

  it("a resume racing another for the same turn is refused busy and leaves the gate pending", async () => {
    const { model } = askingModel();
    const flow = askFlow(model, { count: 0 });
    const h = setup(flow);
    const parked = await startTurn(h, flow);
    const requestId = parked.requestId!;
    await h.provider.acquireLease(requestId, { holder: "other-resume", durationMs: 60_000 });

    const result = await resumeAskGate(
      {
        provider: h.provider,
        stores: h.stores,
        continueRequest: async () => {
          throw new Error("must not continue");
        }
      },
      { requestId, suspensionId: GATE_ID },
      { answered: true, answer: "x" },
      "test"
    );
    expect(result).toMatchObject({ ok: false, refused: "busy" });
    expect((await h.provider.loadSuspension(requestId, GATE_ID))?.status).toBe("pending");
  });

  it("two turns in one conversation parked on the same gate id: refused as ambiguous, neither resumed", async () => {
    // Gate ids are unique per request, not per session. Guessing which turn
    // an answer belongs to would hand one ask's answer to the other.
    const askStep: StepFn = () => ({
      toolCalls: [{ toolCallId: "c1", toolName: "ask_colleague", args: { question: "SOC 2?" } }],
      finishReason: "tool-calls"
    });
    const { model } = stepModel([askStep, askStep]);
    const flow = askFlow(model, { count: 0 });
    const h = setup(flow);
    const first = await startTurn(h, flow);
    const second = await startTurn(h, flow);
    expect(first.requestId).not.toBe(second.requestId);
    for (const parked of [first, second]) {
      expect((await h.stores.request.get(parked.requestId!))?.status).toBe("suspended");
    }

    const result = await touch(h, flow, { answered: true, answer: "whose?" });
    expect(result).toMatchObject({ ok: false, refused: "ambiguous" });
    expect(h.continued).toHaveLength(0);
    for (const parked of [first, second]) {
      expect((await h.stores.request.get(parked.requestId!))?.status).toBe("suspended");
      expect((await h.provider.loadSuspension(parked.requestId!, GATE_ID))?.status).toBe("pending");
    }
  });

  it("a newer gate with the same id that this conversation does not own does not mask the real one", async () => {
    const { model, seen } = askingModel();
    const flow = askFlow(model, { count: 0 });
    const h = setup(flow);
    const parked = await startTurn(h, flow);
    const real = await h.provider.loadSuspension(parked.requestId!, GATE_ID);

    // Same session id and principal, but the request it parks is another
    // organization's. Newer, so a session-wide listing returns it first.
    const foreignRequest = { ...(await h.stores.request.get(parked.requestId!))! };
    await h.stores.request.set(
      "req_foreign",
      { ...foreignRequest, id: "req_foreign", orgId: "org_foreign" },
      "any"
    );
    await h.provider.suspend({
      ...real!,
      requestId: "req_foreign",
      createdAt: real!.createdAt + 60_000
    });

    const result = await touch(h, flow, { answered: true, answer: "the real one" });
    expect(result).toEqual({ ok: true });
    await h.continued[0];
    expect((await h.stores.request.get(parked.requestId!))?.status).toBe("completed");
    expect(toolResults(seen[1]!.messages).join("")).toContain("the real one");
    expect((await h.provider.loadSuspension("req_foreign", GATE_ID))?.status).toBe("pending");
  });

  it("another conversation cannot resume the turn, even holding the gate's id", async () => {
    const { model } = askingModel();
    const flow = askFlow(model, { count: 0 });
    const h = setup(flow);
    const parked = await startTurn(h, flow);

    // Same principal, another session.
    const otherSession = await touch(h, flow, { answered: true, answer: "x" }, { sessionId: "s_other" });
    expect(otherSession).toMatchObject({ ok: false, refused: "gate-not-found" });
    // Another principal, same session id.
    const otherUser = await touch(
      h,
      flow,
      { answered: true, answer: "x" },
      { userId: "u_other", sessionId: "s_other_user" }
    );
    expect(otherUser).toMatchObject({ ok: false, refused: "gate-not-found" });

    expect(h.continued).toHaveLength(0);
    expect((await h.stores.request.get(parked.requestId!))?.status).toBe("suspended");
    expect((await h.provider.loadSuspension(parked.requestId!, GATE_ID))?.status).toBe("pending");
  });

  it("does not resume a gate that is not an ask: a person's approval answers not-found", async () => {
    const approve = handler({
      name: "approve",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.any(),
      execute: async (_input, ctx) =>
        ctx.suspend!({ reason: "human_approval", suspensionId: GATE_ID })
    });
    const touchBlock = handler({
      name: "touch",
      inputSchema: z.object({ gateId: z.string(), outcome: z.any() }),
      outputSchema: z.any(),
      execute: async (input, ctx) =>
        requireRequestHost(ctx).resumeAsk!({ gateId: input.gateId, outcome: input.outcome })
    });
    const flow = defineFlow({
      kind: "ask-resume",
      actions: { run: { block: approve }, touch: { block: touchBlock } }
    })({ id: "ask-resume" });
    const h = setup(flow);
    const parked = await startTurn(h, flow);
    expect((await h.stores.request.get(parked.requestId!))?.status).toBe("suspended");

    const result = await touch(h, flow, { answered: true, answer: "approve it" });
    expect(result).toMatchObject({ ok: false, refused: "gate-not-found" });
    expect((await h.provider.loadSuspension(parked.requestId!, GATE_ID))?.status).toBe("pending");
  });

  it("the public resume route answers not-found for an ask gate, whatever the source", async () => {
    const { model } = askingModel();
    const flow = askFlow(model, { count: 0 });
    const h = setup(flow);
    const parked = await startTurn(h, flow); // an http-source turn
    const requestId = parked.requestId!;

    const response = await handleResumeSuspension(
      new Request(`https://x/api/flows/ask-resume/requests/${requestId}/resume`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          suspensionId: GATE_ID,
          action: "submit",
          data: { answered: true, answer: "forged" }
        })
      }),
      { kind: "resume_suspension", flowKind: "ask-resume", requestId },
      {
        host: {} as never,
        registry: h.registry,
        stores: h.stores,
        durabilityProvider: h.provider,
        seams: {} as never,
        requestContext: {} as never
      }
    );

    expect(response.status).toBe(404);
    expect((await h.provider.loadSuspension(requestId, GATE_ID))?.status).toBe("pending");
    expect((await h.stores.request.get(requestId))?.status).toBe("suspended");
  });

  it("OFF STATE: without durable execution the verb is absent", async () => {
    const { model } = askingModel();
    const flow = askFlow(model, { count: 0 });
    const h = setup(flow, { durable: false });
    expect(await touch(h, flow, { answered: true, answer: "x" })).toEqual({ absent: true });
  });
});

describe("ask gate on the shipped runtime, with no router (the colocated-worker shape)", () => {
  async function runOn(
    state: ReturnType<typeof createFlowState>,
    flow: FlowInstance,
    actionName: string,
    input: unknown
  ) {
    const runtime = await state.getRuntime();
    return runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName,
      input,
      userId: "u_asker",
      sessionId: "s_asker",
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig
    });
  }

  it("createFlowState wires the verb for a durable runtime, and a turn resumes through it", async () => {
    const { model, seen } = askingModel();
    const flow = askFlow(model, { count: 0 });
    const state = createFlowState({
      flows: { "ask-resume": flow },
      stores: { default: { primary: inMemoryStores() } },
      durable: true
    });
    try {
      const parked = await runOn(state, flow, "run", {});
      const { stores } = await state.getRuntime();
      expect((await stores.request.get(parked.requestId!))?.status).toBe("suspended");

      const touched = await runOn(state, flow, "touch", {
        gateId: GATE_ID,
        outcome: { answered: true, answer: "from the worker" }
      });
      expect(touched.output).toEqual({ ok: true });

      const deadline = Date.now() + 5_000;
      while ((await stores.request.get(parked.requestId!))?.status !== "completed") {
        if (Date.now() > deadline) throw new Error("the parked turn never completed");
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(toolResults(seen[1]!.messages).join("")).toContain("from the worker");
    } finally {
      await state.dispose();
    }
  });

  it("OFF STATE: a runtime without durable execution has no verb", async () => {
    const { model } = askingModel();
    const flow = askFlow(model, { count: 0 });
    const state = createFlowState({
      flows: { "ask-resume": flow },
      stores: { default: { primary: inMemoryStores() } }
    });
    try {
      const touched = await runOn(state, flow, "touch", {
        gateId: GATE_ID,
        outcome: { answered: true, answer: "x" }
      });
      expect(touched.output).toEqual({ absent: true });
    } finally {
      await state.dispose();
    }
  });
});
