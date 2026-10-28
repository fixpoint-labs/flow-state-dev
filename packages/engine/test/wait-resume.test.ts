/**
 * The wait gate and its server-side resume, end to end through `runAction`.
 *
 * A turn's tool parks on a wait gate. A later request in the SAME conversation
 * resumes it through `ctx.requestHost.resumeWait`, and the parked request
 * continues under its own id, with the answer as the tool's result. Nothing
 * here files a task: the board and the row arrive with the dispatch itself;
 * this proves the park, the resume and the fence they stand on.
 *
 * The waiting turn is a generator inside a plain (non-durable) sequencer — the
 * shape a Workforce turn has — so this also pins that `ctx.suspend()` needs a
 * durability provider, not a durable sequencer.
 */
import {
  WAIT_DEADLINE_ENTRY,
  defineFlow,
  generator,
  handler,
  parkOnWait,
  requireRequestHost,
  sequencer
} from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { onRequestEnded } from "@flow-state-dev/core/types";
import type {
  BlockContext,
  WaitOutcome,
  FlowInstance,
  GeneratorModel,
  GeneratorModelCallOptions,
  GeneratorModelResult,
  ResumeWaitResult
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
import { createWaitResumeOperation } from "../src/context/wait-resume-operation";
import { resumeWaitGate } from "../src/durability/resume-wait-gate";
import { handleResumeSuspension } from "../src/routes/resume-routes";
import { runTick } from "../src/durability/durability-sweeper";
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

const GATE_ID = "gate_wait_1";

/** The answer, or a tool error naming how the wait ended, as a waiting tool turns one into its result. */
function answerOrThrow(outcome: WaitOutcome): unknown {
  if (outcome.answered) return outcome.answer;
  if ("error" in outcome) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
  throw new Error("deadline" in outcome ? "wait_deadline: the work is still running" : "wait_stopped");
}

/**
 * A flow with a waiting turn and a `touch` action that resumes a wait gate,
 * standing in for the board touch that will call the verb.
 */
function waitFlow(
  model: GeneratorModel,
  sideEffects: { count: number },
  options: { deadline?: () => number; beforePark?: (ctx: BlockContext) => void } = {}
) {
  const wait = handler({
    name: "wait_on_colleague",
    inputSchema: z.object({ question: z.string() }),
    outputSchema: z.object({ answer: z.unknown() }),
    execute: async (_input, ctx) => {
      options.beforePark?.(ctx as BlockContext);
      const outcome = await parkOnWait(ctx, {
        gateId: GATE_ID,
        binding: { board: "conversation", taskId: "task_1" },
        deadline: options.deadline !== undefined ? options.deadline() : Date.now() + 3_600_000
      });
      sideEffects.count += 1;
      return { answer: answerOrThrow(outcome) };
    }
  });
  const agent = generator({ name: "agent", model, prompt: "p", tools: [wait] });
  const turn = sequencer({ name: "turn" }).step(agent);

  const touch = handler({
    name: "touch",
    inputSchema: z.object({ gateId: z.string(), outcome: z.any() }),
    outputSchema: z.any(),
    execute: async (input, ctx) => {
      const host = requireRequestHost(ctx);
      if (host.resumeWait === undefined) return { absent: true };
      return host.resumeWait({ gateId: input.gateId, outcome: input.outcome as WaitOutcome });
    }
  });

  return defineFlow({
    kind: "wait-resume",
    actions: {
      run: { block: turn, inputSchema: z.object({}).passthrough() },
      touch: { block: touch }
    },
    internal: { actions: { work: { block: turn } } }
  })({ id: "wait-resume" });
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
      waitResume: createWaitResumeOperation({
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
  outcome: WaitOutcome,
  options: { sessionId?: string; userId?: string; gateId?: string } = {}
): Promise<ResumeWaitResult & { absent?: true }> {
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
  return result.output as ResumeWaitResult & { absent?: true };
}

function waitingModel() {
  return stepModel([
    () => ({
      toolCalls: [{ toolCallId: "c1", toolName: "wait_on_colleague", args: { question: "SOC 2?" } }],
      finishReason: "tool-calls"
    }),
    (opts) => ({ text: `done: ${toolResults(opts.messages).join(" | ")}`, finishReason: "stop" })
  ]);
}

/** Store the parked gate under the reason the build before the rename wrote (WR-9). */
async function storeUnderOldReason(h: Harness, requestId: string): Promise<void> {
  const gate = await h.provider.loadSuspension(requestId, GATE_ID);
  expect(gate?.reason).toBe("wait");
  await h.stores.suspensions.set({ ...gate!, reason: "ask" }); // retired-name-refusal: WR-9, a gate parked before the rename
}

describe("wait gate: park, and resume from the waiting turn's own conversation", () => {
  for (const source of ["http", "internal"] as const) {
    it(`a ${source}-source turn parks on the gate and resumes with the answer as the tool's result`, async () => {
      const { model, seen } = waitingModel();
      const sideEffects = { count: 0 };
      const flow = waitFlow(model, sideEffects);
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
        reason: "wait",
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

  it("a wait that ended without an answer reaches the model as the tool's error", async () => {
    const { model, seen } = waitingModel();
    const flow = waitFlow(model, { count: 0 });
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
  });

  it("resumes once: a second resume of the same gate is refused and changes nothing", async () => {
    const { model, seen } = waitingModel();
    const sideEffects = { count: 0 };
    const flow = waitFlow(model, sideEffects);
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
    const { model } = waitingModel();
    const flow = waitFlow(model, { count: 0 });
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

    expect(await resumeWaitGate(deps, gate, { answered: true, answer: "first" }, "test")).toEqual({
      ok: true
    });
    // While the continuation runs it holds the turn's lease, and a second
    // resume is refused `busy`. Once the lease is gone (the turn parked again
    // elsewhere, or the lease ran out) the gate itself refuses.
    expect(await resumeWaitGate(deps, gate, { answered: true, answer: "x" }, "test")).toMatchObject({
      ok: false,
      refused: "busy"
    });
    const lease = await h.stores.leases.get(requestId);
    await h.provider.releaseLease(requestId, lease!.leaseId);
    const second = await resumeWaitGate(deps, gate, { answered: true, answer: "second" }, "test");
    expect(second).toMatchObject({ ok: false, refused: "already-resolved" });
    // The continuation runs the turn again, so the request reads
    // `in_progress`, as a turn still parking does (FIX-2135). The resolved
    // gate decides first: a late resume is `already-resolved`, never the
    // retryable `busy`, or its sender would retry an answered wait forever.
    const running = await h.stores.request.get(requestId);
    await h.stores.request.set(requestId, { ...running!, status: "in_progress" }, "any");
    const late = await resumeWaitGate(deps, gate, { answered: true, answer: "late" }, "test");
    expect(late).toMatchObject({ ok: false, refused: "already-resolved" });
    expect(continuations).toBe(1);
    expect((await h.provider.loadSuspension(requestId, GATE_ID))?.resumeData).toEqual({
      answered: true,
      answer: "first"
    });
  });

  it("a resume that lands while the turn is still parking is refused busy, and lands once it has parked (FIX-2135)", async () => {
    // The park writes the gate, runs the request-end hooks, and only then
    // records the request `suspended`. A waited-on task that ends inside that
    // window resumes the gate while the request still reads `in_progress`.
    // That resume must be retryable: the waker keeps it owed only on `busy`,
    // and the turn would otherwise sit parked until its deadline.
    const { model, seen } = waitingModel();
    const sideEffects = { count: 0 };
    let h: Harness | undefined;
    const duringPark: Array<{ status: string | undefined; result: ResumeWaitResult }> = [];
    const flow: FlowInstance = waitFlow(model, sideEffects, {
      beforePark: (ctx) => {
        onRequestEnded(ctx, async () => {
          const status = (await h!.stores.request.get(ctx.request.identity.id))?.status;
          duringPark.push({ status, result: await touch(h!, flow, { answered: true, answer: "ended" }) });
        });
      }
    });
    h = setup(flow);
    const parked = await startTurn(h, flow);
    const requestId = parked.requestId!;

    expect(duringPark).toHaveLength(1);
    expect(duringPark[0]!.status).toBe("in_progress");
    expect(duringPark[0]!.result).toMatchObject({ ok: false, refused: "busy" });
    // Nothing was resumed: the gate is still pending, the turn parked.
    expect(h.continued).toHaveLength(0);
    expect((await h.provider.loadSuspension(requestId, GATE_ID))?.status).toBe("pending");
    expect((await h.stores.request.get(requestId))?.status).toBe("suspended");

    // The waker's retry, once the turn has parked, resumes it with the ending.
    expect(await touch(h, flow, { answered: true, answer: "ended" })).toEqual({ ok: true });
    const finished = await h.continued[0]!;
    expect((await h.stores.request.get(requestId))?.status).toBe("completed");
    expect(toolResults(seen[1]!.messages).join("")).toContain("ended");
    expect(finished.output).toContain("ended");
    expect(sideEffects.count).toBe(1);
  });

  it("a resume racing another for the same turn is refused busy and leaves the gate pending", async () => {
    const { model } = waitingModel();
    const flow = waitFlow(model, { count: 0 });
    const h = setup(flow);
    const parked = await startTurn(h, flow);
    const requestId = parked.requestId!;
    await h.provider.acquireLease(requestId, { holder: "other-resume", durationMs: 60_000 });

    const result = await resumeWaitGate(
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
    // an answer belongs to would hand one wait's answer to the other.
    const waitStep: StepFn = () => ({
      toolCalls: [{ toolCallId: "c1", toolName: "wait_on_colleague", args: { question: "SOC 2?" } }],
      finishReason: "tool-calls"
    });
    const { model } = stepModel([waitStep, waitStep]);
    const flow = waitFlow(model, { count: 0 });
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
    const { model, seen } = waitingModel();
    const flow = waitFlow(model, { count: 0 });
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
    const { model } = waitingModel();
    const flow = waitFlow(model, { count: 0 });
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

  it("does not resume a gate that is not a wait gate: a person's approval answers not-found", async () => {
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
        requireRequestHost(ctx).resumeWait!({ gateId: input.gateId, outcome: input.outcome })
    });
    const flow = defineFlow({
      kind: "wait-resume",
      actions: { run: { block: approve }, touch: { block: touchBlock } }
    })({ id: "wait-resume" });
    const h = setup(flow);
    const parked = await startTurn(h, flow);
    expect((await h.stores.request.get(parked.requestId!))?.status).toBe("suspended");

    const result = await touch(h, flow, { answered: true, answer: "approve it" });
    expect(result).toMatchObject({ ok: false, refused: "gate-not-found" });
    expect((await h.provider.loadSuspension(parked.requestId!, GATE_ID))?.status).toBe("pending");
  });

  for (const legacy of [false, true]) {
    it(
      legacy
        ? "the public resume route answers not-found for a gate stored under its old reason too (WR-10)"
        : "the public resume route answers not-found for a wait gate, whatever the source",
      async () => {
        const { model } = waitingModel();
        const flow = waitFlow(model, { count: 0 });
        const h = setup(flow);
        const parked = await startTurn(h, flow); // an http-source turn
        const requestId = parked.requestId!;
        if (legacy) await storeUnderOldReason(h, requestId);

        const response = await handleResumeSuspension(
          new Request(`https://x/api/flows/wait-resume/requests/${requestId}/resume`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              suspensionId: GATE_ID,
              action: "submit",
              data: { answered: true, answer: "forged" }
            })
          }),
          { kind: "resume_suspension", flowKind: "wait-resume", requestId },
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
      }
    );
  }

  it("resumes a gate stored under its old reason, parked before the rename, with the answer (WR-9)", async () => {
    const { model, seen } = waitingModel();
    const flow = waitFlow(model, { count: 0 });
    const h = setup(flow);
    const parked = await startTurn(h, flow);
    await storeUnderOldReason(h, parked.requestId!);

    expect(await touch(h, flow, { answered: true, answer: "Yes, renewed 2026-08" })).toEqual({ ok: true });
    await h.continued[0];
    expect((await h.stores.request.get(parked.requestId!))?.status).toBe("completed");
    expect(toolResults(seen[1]!.messages).join("")).toContain("Yes, renewed 2026-08");
  });

  it("OFF STATE: without durable execution the verb is absent", async () => {
    const { model } = waitingModel();
    const flow = waitFlow(model, { count: 0 });
    const h = setup(flow, { durable: false });
    expect(await touch(h, flow, { answered: true, answer: "x" })).toEqual({ absent: true });
  });
});

describe("wait gate on the shipped runtime, with no router (the colocated-worker shape)", () => {
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
    const { model, seen } = waitingModel();
    const flow = waitFlow(model, { count: 0 });
    const state = createFlowState({
      flows: { "wait-resume": flow },
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
    const { model } = waitingModel();
    const flow = waitFlow(model, { count: 0 });
    const state = createFlowState({
      flows: { "wait-resume": flow },
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

/**
 * Store the parked gate as one parked before FIX-2082 left it: its deadline
 * was its expiry, already past, and its data held no deadline.
 */
async function storeAsParkedBeforeWakes(h: Harness, requestId: string): Promise<void> {
  const gate = await h.provider.loadSuspension(requestId, GATE_ID);
  const { deadline: _deadline, ...data } = (gate!.data ?? {}) as Record<string, unknown>;
  await h.stores.suspensions.set({ ...gate!, data, expiresAt: Date.now() - 1 });
}

describe("wait gate parked before FIX-2082, past its expiry: the durability sweep resumes it with wait_timed_out", () => {
  function tick(h: Harness, withContinue = true, logs: Array<[string, string, unknown]> = []) {
    const record = (level: string) => (message: string, context: Record<string, unknown>) =>
      logs.push([level, message, context]);
    return runTick({
      logger: { info: record("info"), warn: record("warn"), error: record("error") },
      provider: h.provider,
      stores: h.stores,
      holder: "sweeper-test",
      sweepIntervalMs: 600_000,
      checkpointMaxAgeMs: 86_400_000,
      suspensionTerminalMaxAgeMs: 604_800_000,
      orphanCheckpointThresholdMs: 86_400_000,
      batchLimit: 1000,
      ...(withContinue
        ? {
            continueRequest: async (opts: Parameters<typeof continueRequest>[0]) => {
              const result = await continueRequest({
                ...opts,
                stores: h.stores,
                flowRegistry: h.registry,
                runtimeConfig: h.runtimeConfig
              });
              h.continued.push(result.finished);
              return result;
            }
          }
        : {})
    } as never);
  }

  for (const legacy of [false, true]) {
    it(
      legacy
        ? "times out a gate stored under its old reason the same way, never marking it expired (WR-9)"
        : "a real sweep tick resumes the overdue turn with the timeout error, never marking the gate expired",
      async () => {
        const { model, seen } = waitingModel();
        const flow = waitFlow(model, { count: 0 }, { deadline: () => Date.now() + 5 });
        const h = setup(flow);
        const parked = await startTurn(h, flow);
        const requestId = parked.requestId!;
        await storeAsParkedBeforeWakes(h, requestId);
        if (legacy) await storeUnderOldReason(h, requestId);

        await tick(h);

        expect(h.continued).toHaveLength(1);
        await h.continued[0];
        expect((await h.stores.request.get(requestId))?.status).toBe("completed");
        expect((await h.provider.loadSuspension(requestId, GATE_ID))?.status).not.toBe("expired");
        expect(toolResults(seen[1]!.messages).join("")).toContain("wait_timed_out");
      }
    );
  }

  it("a wait gate not yet past its expiry is left alone", async () => {
    const { model } = waitingModel();
    const flow = waitFlow(model, { count: 0 }, { deadline: () => Date.now() + 600_000 });
    const h = setup(flow);
    const parked = await startTurn(h, flow);
    const gate = await h.provider.loadSuspension(parked.requestId!, GATE_ID);
    await h.stores.suspensions.set({ ...gate!, expiresAt: Date.now() + 600_000 });

    await tick(h);

    expect(h.continued).toHaveLength(0);
    expect((await h.provider.loadSuspension(parked.requestId!, GATE_ID))?.status).toBe("pending");
  });

  it("a sweep with no way to continue a request leaves an overdue wait pending rather than stranding it", async () => {
    const { model } = waitingModel();
    const flow = waitFlow(model, { count: 0 }, { deadline: () => Date.now() + 5 });
    const h = setup(flow);
    const parked = await startTurn(h, flow);
    await storeAsParkedBeforeWakes(h, parked.requestId!);

    const logs: Array<[string, string, unknown]> = [];
    await tick(h, false, logs);

    expect((await h.provider.loadSuspension(parked.requestId!, GATE_ID))?.status).toBe("pending");
    expect((await h.stores.request.get(parked.requestId!))?.status).toBe("suspended");
    // Said once per tick, with how many were left.
    const skipped = logs.filter(([, m]) => m.includes("overdue wait gates left pending"));
    expect(skipped).toEqual([["warn", expect.any(String), { count: 1 }]]);
  });

  it("an overdue gate whose turn is still parking is left pending, and a later tick resumes it once parked (FIX-2135)", async () => {
    const { model, seen } = waitingModel();
    const flow = waitFlow(model, { count: 0 }, { deadline: () => Date.now() + 5 });
    const h = setup(flow);
    const parked = await startTurn(h, flow);
    const requestId = parked.requestId!;
    await storeAsParkedBeforeWakes(h, requestId);
    // The gate is written but the request is not yet recorded `suspended`:
    // the park's request-end hooks are still running.
    const request = await h.stores.request.get(requestId);
    await h.stores.request.set(requestId, { ...request!, status: "in_progress" }, "any");

    const logs: Array<[string, string, unknown]> = [];
    await tick(h, true, logs);

    // Not resumed, and not written off as already resolved: retried.
    expect(h.continued).toHaveLength(0);
    expect((await h.provider.loadSuspension(requestId, GATE_ID))?.status).toBe("pending");
    expect(logs.filter(([, m]) => m.includes("already resolved"))).toHaveLength(0);
    expect(logs.filter(([, m]) => m.includes("overdue wait not resumed"))).toEqual([
      ["info", expect.any(String), expect.objectContaining({ refused: "busy" })]
    ]);

    // The park finishes; the next tick resumes the turn with its deadline outcome.
    await h.stores.request.set(requestId, { ...request!, status: "suspended" }, "any");
    await tick(h);
    expect(h.continued).toHaveLength(1);
    await h.continued[0];
    expect((await h.stores.request.get(requestId))?.status).toBe("completed");
    expect(toolResults(seen[1]!.messages).join("")).toContain("wait_timed_out");
  });
});

describe("a wait's deadline is a wake on its session (FIX-2082 D1)", () => {
  const KEY = { sessionId: "s_asker", entry: WAIT_DEADLINE_ENTRY };

  /** The harness with wakes kept: the host owes a parked wait's deadline as one. */
  function withWakes(flow: FlowInstance): Harness {
    const h = setup(flow);
    h.runtimeConfig.requestHost!.wakes = { maxDebtAgeMs: 86_400_000 };
    return h;
  }

  function sweep(h: Harness) {
    return runTick({
      provider: h.provider,
      stores: h.stores,
      holder: "sweeper-test",
      sweepIntervalMs: 600_000,
      checkpointMaxAgeMs: 86_400_000,
      suspensionTerminalMaxAgeMs: 604_800_000,
      orphanCheckpointThresholdMs: 86_400_000,
      batchLimit: 1000,
      continueRequest: async (opts: Parameters<typeof continueRequest>[0]) => {
        const result = await continueRequest({ ...opts, stores: h.stores, flowRegistry: h.registry, runtimeConfig: h.runtimeConfig });
        h.continued.push(result.finished);
        return result;
      }
    } as never);
  }

  it("parking owes the session's waitDeadline wake at the deadline, and the gate carries no expiry", async () => {
    const { model } = waitingModel();
    const deadline = Date.now() + 600_000;
    const flow = waitFlow(model, { count: 0 }, { deadline: () => deadline });
    const h = withWakes(flow);
    const parked = await startTurn(h, flow);

    const gate = await h.provider.loadSuspension(parked.requestId!, GATE_ID);
    expect(gate?.status).toBe("pending");
    expect(gate?.expiresAt).toBeUndefined();
    expect(gate?.data).toMatchObject({ deadline });
    expect((await h.stores.wakes!.get(KEY))?.dueAt).toBe(deadline);
  });

  it("a sweep past the deadline resumes the turn with the work still running, expires nothing, and lets the wake go", async () => {
    const { model, seen } = waitingModel();
    const flow = waitFlow(model, { count: 0 }, { deadline: () => Date.now() + 5 });
    const h = withWakes(flow);
    const parked = await startTurn(h, flow);
    await new Promise((r) => setTimeout(r, 20));

    await sweep(h);

    expect(h.continued).toHaveLength(1);
    await h.continued[0];
    expect((await h.stores.request.get(parked.requestId!))?.status).toBe("completed");
    expect((await h.provider.loadSuspension(parked.requestId!, GATE_ID))?.status).not.toBe("expired");
    const sent = toolResults(seen[1]!.messages).join("");
    expect(sent).toContain("wait_deadline");
    expect(sent).not.toContain("wait_timed_out");
    // Nothing else is parked in the session: the wake is cleared, or held at
    // its landBy (the parking request's lease) while that has not passed.
    const wake = await h.stores.wakes!.get(KEY);
    expect(wake === null || wake.dueAt === wake.landBy).toBe(true);
  });

  it("a deadline that passes while the turn is still parking is delivered by the first sweep after the park, not a retry interval later (FIX-2150)", async () => {
    const { model, seen } = waitingModel();
    let busySweeps = 0;
    const flow = waitFlow(model, { count: 0 }, {
      deadline: () => Date.now() + 5,
      // A slow park: its request-end hook runs past the deadline, and a sweep
      // lands inside it, while the request still reads `in_progress`.
      beforePark: (ctx) => {
        onRequestEnded(ctx, async (ending) => {
          if (ending.status !== "suspended") return;
          await new Promise((r) => setTimeout(r, 20));
          await sweep(h);
          busySweeps += 1;
        });
      }
    });
    const h = withWakes(flow);
    const parked = await startTurn(h, flow);
    expect(busySweeps).toBe(1);
    expect(h.continued).toHaveLength(0);
    expect((await h.stores.request.get(parked.requestId!))?.status).toBe("suspended");

    // Once parked, the deadline is due again now: the next sweep delivers it.
    expect((await h.stores.wakes!.get(KEY))!.dueAt).toBeLessThanOrEqual(Date.now());
    await sweep(h);
    expect(h.continued).toHaveLength(1);
    await h.continued[0];
    expect((await h.stores.request.get(parked.requestId!))?.status).toBe("completed");
    expect(toolResults(seen[1]!.messages).join("")).toContain("wait_deadline");
  });

  it("a sweep before the deadline leaves the turn parked and the wake at the deadline", async () => {
    const { model } = waitingModel();
    const deadline = Date.now() + 600_000;
    const flow = waitFlow(model, { count: 0 }, { deadline: () => deadline });
    const h = withWakes(flow);
    const parked = await startTurn(h, flow);
    // The wake read as due now, as a sweep that came early would find it.
    const wake = await h.stores.wakes!.get(KEY);
    await h.stores.wakes!.move(KEY, wake!.version, Date.now() - 1);

    await sweep(h);

    expect(h.continued).toHaveLength(0);
    expect((await h.stores.request.get(parked.requestId!))?.status).toBe("suspended");
    expect((await h.stores.wakes!.get(KEY))?.dueAt).toBe(deadline);
  });
});
