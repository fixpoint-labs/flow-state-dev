/**
 * FIX-814 PR3: generator turn-boundary suspension + log-based resume,
 * end-to-end through `runAction` / `continueRequest`.
 *
 * A generator drives its OWNED tool loop (the model implements `generateStep`).
 * A framework tool calls `ctx.suspend()` mid-loop; the request suspends. On
 * `continueRequest` the generator rebuilds its conversation from the durable
 * item-log (no model re-call for recorded steps), re-enters the gated tool
 * (which produces its REAL result, not the resume payload), and continues to
 * the final step.
 *
 * These mirror `suspension-resume.test.ts`'s `resolve(...)` continuation
 * pattern with a generator flow whose tool suspends.
 */
import { collapseToCanonicalLog, defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import type {
  GeneratorModel,
  GeneratorModelCallOptions,
  GeneratorModelResult,
} from "@flow-state-dev/core/types";
import type { FlowInstance, SuspensionRecord } from "@flow-state-dev/core/types";
import type { OutputItem } from "@flow-state-dev/core/items";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import type { DurabilityProvider } from "../src/durability/types";
import type { StoreRegistry } from "../src/stores/types";

function createDurableStores() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases,
  });
  return { stores, provider };
}

type StepFn = (options: GeneratorModelCallOptions) => GeneratorModelResult;

/**
 * Step-capable mock model. `seen` accumulates ACROSS runs (initial + every
 * resume), because the flow — and thus the model instance — is reused, so
 * call-count assertions prove a recorded step is never re-issued on resume.
 */
function stepModel(script: StepFn[], modelId = "step-model") {
  const seen: GeneratorModelCallOptions[] = [];
  const model: GeneratorModel = {
    modelId,
    async generate() {
      throw new Error("legacy generate must not be called on a step-capable model");
    },
    async generateStep(options) {
      seen.push(options);
      const entry = script[seen.length - 1];
      if (entry === undefined) {
        throw new Error(`no script entry for generateStep #${seen.length - 1}`);
      }
      return entry(options);
    },
  };
  return { model, seen };
}

function registryFor(flow: FlowInstance) {
  const registry = createFlowRegistry();
  registry.register(flow as never);
  return registry;
}

/** Resolve a pending suspension via same-request continuation, like the
 *  sequencer suspension-resume suite. Returns the finished ExecutionResult. */
async function resolve(
  flow: FlowInstance,
  stores: StoreRegistry,
  provider: DurabilityProvider,
  requestId: string,
  suspension: SuspensionRecord,
  action: "approve" | "reject",
  data?: unknown
) {
  await provider.suspend({
    ...suspension,
    status: action === "approve" ? "approved" : "rejected",
    resolvedAt: Date.now(),
    resumeData: data,
  });
  const { finished } = await continueRequest({
    requestId,
    stores,
    flowRegistry: registryFor(flow),
    resumeContext: { suspensionId: suspension.suspensionId, action, data, resumedBy: "reviewer" },
    runtimeConfig: { durabilityProvider: provider },
  });
  return finished;
}

const anyInput = z.object({}).passthrough();

/** Extract the tool-result parts (v7 role:"tool" messages) from a step's
 *  request messages, in order. */
function toolResultParts(
  messages: unknown[]
): Array<{ toolCallId: string; toolName: string; output: unknown }> {
  const out: Array<{ toolCallId: string; toolName: string; output: unknown }> = [];
  for (const m of messages as Array<Record<string, unknown>>) {
    if (m.role !== "tool" || !Array.isArray(m.content)) continue;
    for (const part of m.content as Array<Record<string, unknown>>) {
      if (part.type === "tool-result") {
        out.push({
          toolCallId: part.toolCallId as string,
          toolName: part.toolName as string,
          output: part.output,
        });
      }
    }
  }
  return out;
}

function completedToolOutputs(items: readonly OutputItem[]) {
  return items.filter(
    (i) => i.type === "tool_output" && (i as { status?: string }).status === "completed"
  ) as Array<{ output?: unknown; modelOutput?: unknown; toolCall: { callId: string; name: string } }>;
}

describe("generator turn-boundary suspension + resume (FIX-814 PR3)", () => {
  // 1. APPROVAL --------------------------------------------------------------
  it("approval: gated tool re-enters, emits its REAL result, loop continues, step 0 not re-called", async () => {
    let sideEffects = 0;
    const gate = handler({
      name: "approve_transfer",
      inputSchema: z.object({ amount: z.number() }),
      outputSchema: z.object({ confirmed: z.boolean(), amount: z.number() }),
      execute: async (input, ctx) => {
        // Gate FIRST, side effect AFTER approval → runs exactly once total.
        const decision = await ctx.suspend!({
          reason: "approval",
          message: `Approve transfer of $${input.amount}?`,
        });
        sideEffects += 1;
        return { confirmed: true, amount: input.amount, decision } as never;
      },
    });

    const { model, seen } = stepModel([
      () => ({
        toolCalls: [{ toolCallId: "c1", toolName: "approve_transfer", args: { amount: 100 } }],
        finishReason: "tool-calls",
      }),
      () => ({ text: "transfer complete", finishReason: "stop" }),
    ]);

    const gen = generator({ name: "agent", model, prompt: "p", tools: [gate] });
    const flow = defineFlow({
      kind: "gen-approval",
      actions: {
        run: { block: sequencer({ name: "seq", durable: true }).step(gen), inputSchema: anyInput },
      },
    })({ id: "gen-approval" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow, actionName: "run", input: {}, userId: "u1", stores,
      runtimeConfig: { durabilityProvider: provider },
    });
    const requestId = initial.requestId!;

    expect((await stores.request.get(requestId))?.status).toBe("suspended");
    expect(initial.items.some((i) => i.type === "suspension")).toBe(true);
    expect(seen.length).toBe(1);
    expect(sideEffects).toBe(0);

    const [suspension] = await provider.listSuspended({ status: "pending" });
    const resumed = await resolve(flow, stores, provider, requestId, suspension, "approve", { approvedBy: "boss" });

    expect((await stores.request.get(requestId))?.status).toBe("completed");
    expect(resumed.output).toBe("transfer complete");
    expect(seen.length).toBe(2); // step 0 replayed from log, only step 1 re-called
    expect(sideEffects).toBe(1); // post-gate body ran exactly once

    const record = await stores.request.get(requestId);
    const real = completedToolOutputs(record!.items ?? []);
    expect(real.length).toBe(1);
    expect(real[0]!.output).toMatchObject({ confirmed: true, amount: 100 });
    // The model saw the tool's REAL result on step 1, not the resume payload.
    const step1Results = toolResultParts(seen[1]!.messages);
    expect(step1Results).toHaveLength(1);
    expect(JSON.stringify(step1Results[0]!.output)).toContain("confirmed");
  });

  // 2. REJECTION -------------------------------------------------------------
  it("rejection: ctx.suspend() throws, resume emits a COMPLETED denial tool_output, model adapts, completes", async () => {
    let postGate = 0;
    const gate = handler({
      name: "risky_op",
      inputSchema: z.object({}),
      outputSchema: z.object({ ran: z.boolean() }),
      execute: async (_input, ctx) => {
        await ctx.suspend!({ reason: "approval", message: "Run risky op?" });
        postGate += 1; // never reached on rejection
        return { ran: true };
      },
    });

    const { model, seen } = stepModel([
      () => ({
        toolCalls: [{ toolCallId: "c1", toolName: "risky_op", args: {} }],
        finishReason: "tool-calls",
      }),
      () => ({ text: "understood, cancelled", finishReason: "stop" }),
    ]);

    const gen = generator({ name: "agent", model, prompt: "p", tools: [gate] });
    const flow = defineFlow({
      kind: "gen-reject",
      actions: { run: { block: sequencer({ name: "seq", durable: true }).step(gen), inputSchema: anyInput } },
    })({ id: "gen-reject" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow, actionName: "run", input: {}, userId: "u1", stores,
      runtimeConfig: { durabilityProvider: provider },
    });
    const requestId = initial.requestId!;

    const [suspension] = await provider.listSuspended({ status: "pending" });
    const resumed = await resolve(flow, stores, provider, requestId, suspension, "reject");

    expect((await stores.request.get(requestId))?.status).toBe("completed");
    expect(resumed.output).toBe("understood, cancelled");
    expect(postGate).toBe(0); // rejected body never ran past the gate
    expect(seen.length).toBe(2);

    // The denial is a COMPLETED tool_output (so a later cycle sees it resolved),
    // and the model saw a denial result on step 1.
    const record = await stores.request.get(requestId);
    const completed = completedToolOutputs(record!.items ?? []);
    expect(completed.length).toBe(1);
    expect(completed[0]!.output).toMatchObject({ denied: true });
    // The denial carries its step index (like every tool_output) so a later
    // turn reusing this call id can't be satisfied by it.
    expect((completed[0] as any).toolCall.stepNumber).toBe(0);
    const step1 = toolResultParts(seen[1]!.messages);
    expect(step1).toHaveLength(1);
    expect(JSON.stringify(step1[0]!.output)).toContain("denied");
  });

  // 2a. REJECTION visibility — denial inherits the generator's itemVisibility --
  it("rejection denial tool_output inherits a history:false generator's visibility (no leak)", async () => {
    const gate = handler({
      name: "risky_op",
      inputSchema: z.object({}),
      outputSchema: z.object({ ran: z.boolean() }),
      execute: async (_input, ctx) => {
        await ctx.suspend!({ reason: "approval", message: "Run risky op?" });
        return { ran: true };
      },
    });

    const { model } = stepModel([
      () => ({
        toolCalls: [{ toolCallId: "c1", toolName: "risky_op", args: {} }],
        finishReason: "tool-calls",
      }),
      () => ({ text: "cancelled", finishReason: "stop" }),
    ]);

    // A client-hidden, history-excluded generator: its denial must not be more
    // visible than its ordinary tool outputs.
    const gen = generator({
      name: "agent",
      model,
      prompt: "p",
      tools: [gate],
      itemVisibility: { client: false, history: false },
    });
    const flow = defineFlow({
      kind: "gen-reject-vis",
      actions: { run: { block: sequencer({ name: "seq", durable: true }).step(gen), inputSchema: anyInput } },
    })({ id: "gen-reject-vis" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow, actionName: "run", input: {}, userId: "u1", stores,
      runtimeConfig: { durabilityProvider: provider },
    });
    const requestId = initial.requestId!;
    const [suspension] = await provider.listSuspended({ status: "pending" });
    await resolve(flow, stores, provider, requestId, suspension, "reject");

    const record = await stores.request.get(requestId);
    const denial = completedToolOutputs(record!.items ?? []).find(
      (i: any) => (i.output as any)?.denied === true,
    ) as any;
    expect(denial).toBeDefined();
    // The bug: the denial fell back to the conversational default
    // { client: true, history: true } and leaked. It must carry the
    // generator's visibility instead.
    expect(denial.itemVisibility).toMatchObject({ client: false, history: false });
  });

  // 2b. REJECTION then a LATER gate — denied call not re-entered (round-8) ----
  it("a rejected gate is not re-entered when a LATER gate suspends and resumes", async () => {
    let gateAEnters = 0;
    const gateA = handler({
      name: "gate_a",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (_input, ctx) => {
        gateAEnters += 1;
        await ctx.suspend!({ reason: "approval", message: "Gate A?" });
        return { ok: true };
      },
    });
    const gateB = handler({
      name: "gate_b",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (_input, ctx) => {
        await ctx.suspend!({ reason: "approval", message: "Gate B?" });
        return { ok: true };
      },
    });

    const { model } = stepModel([
      () => ({ toolCalls: [{ toolCallId: "a1", toolName: "gate_a", args: {} }], finishReason: "tool-calls" }),
      () => ({ toolCalls: [{ toolCallId: "b1", toolName: "gate_b", args: {} }], finishReason: "tool-calls" }),
      () => ({ text: "both settled", finishReason: "stop" }),
    ]);

    const gen = generator({ name: "agent", model, prompt: "p", tools: [gateA, gateB] });
    const flow = defineFlow({
      kind: "gen-reject-then-gate",
      actions: { run: { block: sequencer({ name: "seq", durable: true }).step(gen), inputSchema: anyInput } },
    })({ id: "gen-reject-then-gate" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow, actionName: "run", input: {}, userId: "u1", stores,
      runtimeConfig: { durabilityProvider: provider },
    });
    const requestId = initial.requestId!;
    expect(gateAEnters).toBe(1);

    // Reject A → denial; loop continues to step 1 which calls gate B (suspends).
    const [suspA] = await provider.listSuspended({ status: "pending" });
    await resolve(flow, stores, provider, requestId, suspA, "reject");
    expect((await stores.request.get(requestId))?.status).toBe("suspended");
    // Gate A re-entered exactly once (on the reject resume) to produce the denial.
    expect(gateAEnters).toBe(2);

    // Approve B → completes. Gate A must NOT be re-entered again (it's resolved).
    const [suspB] = await provider.listSuspended({ status: "pending" });
    const resumed = await resolve(flow, stores, provider, requestId, suspB, "approve");
    expect((await stores.request.get(requestId))?.status).toBe("completed");
    expect(resumed.output).toBe("both settled");
    expect(gateAEnters).toBe(2); // not re-surfaced/re-entered
  });

  // 3. MULTI-GATE / N-CYCLE --------------------------------------------------
  it("multi-gate: two sequential suspending tools suspend/resume twice, in order, then complete", async () => {
    const gateA = handler({
      name: "gate_a",
      inputSchema: z.object({}),
      outputSchema: z.object({ from: z.string() }),
      execute: async (_input, ctx) => {
        await ctx.suspend!({ reason: "approval", message: "A?" });
        return { from: "A" };
      },
    });
    const gateB = handler({
      name: "gate_b",
      inputSchema: z.object({}),
      outputSchema: z.object({ from: z.string() }),
      execute: async (_input, ctx) => {
        await ctx.suspend!({ reason: "approval", message: "B?" });
        return { from: "B" };
      },
    });

    const { model, seen } = stepModel([
      () => ({ toolCalls: [{ toolCallId: "a1", toolName: "gate_a", args: {} }], finishReason: "tool-calls" }),
      () => ({ toolCalls: [{ toolCallId: "b1", toolName: "gate_b", args: {} }], finishReason: "tool-calls" }),
      () => ({ text: "done", finishReason: "stop" }),
    ]);

    const gen = generator({ name: "agent", model, prompt: "p", tools: [gateA, gateB] });
    const flow = defineFlow({
      kind: "gen-multigate",
      actions: { run: { block: sequencer({ name: "seq", durable: true }).step(gen), inputSchema: anyInput } },
    })({ id: "gen-multigate" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow, actionName: "run", input: {}, userId: "u1", stores,
      runtimeConfig: { durabilityProvider: provider },
    });
    const requestId = initial.requestId!;

    const [suspA] = await provider.listSuspended({ status: "pending" });
    await resolve(flow, stores, provider, requestId, suspA, "approve");
    expect((await stores.request.get(requestId))?.status).toBe("suspended");
    expect(seen.length).toBe(2); // step 1 re-called after A resolves

    const [suspB] = await provider.listSuspended({ status: "pending" });
    const resumed = await resolve(flow, stores, provider, requestId, suspB, "approve");
    expect((await stores.request.get(requestId))?.status).toBe("completed");
    expect(resumed.output).toBe("done");
    expect(seen.length).toBe(3);

    // Two resume audit items, and both gates' real results reached the model in
    // order (A on step 1's request, B on step 2's request).
    const record = await stores.request.get(requestId);
    expect((record!.items ?? []).filter((i) => i.type === "suspension_resume").length).toBe(2);
    expect(JSON.stringify(toolResultParts(seen[1]!.messages)[0]!.output)).toContain('"A"');
    expect(JSON.stringify(toolResultParts(seen[2]!.messages).at(-1)!.output)).toContain('"B"');
  });

  // 4. MULTI-TOOL CONCURRENT SIBLINGS ---------------------------------------
  it("concurrent siblings: completed sibling settles once and is injected on resume; only the gate re-enters", async () => {
    let siblingRuns = 0;
    const sibling = handler({
      name: "compute",
      inputSchema: z.object({}),
      outputSchema: z.object({ v: z.number() }),
      execute: async () => {
        siblingRuns += 1;
        return { v: 42 };
      },
    });
    let gateRuns = 0;
    const gate = handler({
      name: "gate",
      inputSchema: z.object({}),
      outputSchema: z.object({ approved: z.boolean() }),
      execute: async (_input, ctx) => {
        gateRuns += 1;
        await ctx.suspend!({ reason: "approval", message: "gate?" });
        return { approved: true };
      },
    });

    const { model, seen } = stepModel([
      () => ({
        toolCalls: [
          { toolCallId: "s1", toolName: "compute", args: {} },
          { toolCallId: "g1", toolName: "gate", args: {} },
        ],
        finishReason: "tool-calls",
      }),
      () => ({ text: "ok", finishReason: "stop" }),
    ]);

    const gen = generator({ name: "agent", model, prompt: "p", tools: [sibling, gate] });
    const flow = defineFlow({
      kind: "gen-siblings",
      actions: { run: { block: sequencer({ name: "seq", durable: true }).step(gen), inputSchema: anyInput } },
    })({ id: "gen-siblings" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow, actionName: "run", input: {}, userId: "u1", stores,
      runtimeConfig: { durabilityProvider: provider },
    });
    const requestId = initial.requestId!;
    expect(siblingRuns).toBe(1); // sibling settled before the suspension surfaced
    expect(gateRuns).toBe(1);

    const [suspension] = await provider.listSuspended({ status: "pending" });
    const resumed = await resolve(flow, stores, provider, requestId, suspension, "approve");
    expect((await stores.request.get(requestId))?.status).toBe("completed");
    expect(resumed.output).toBe("ok");

    // Sibling body did NOT re-run on resume (injected from the log); only the
    // gate re-entered.
    expect(siblingRuns).toBe(1);
    expect(gateRuns).toBe(2);

    // Step 1's request carries BOTH siblings' results (sibling injected + gate real).
    const results = toolResultParts(seen[1]!.messages);
    const byId = Object.fromEntries(results.map((r) => [r.toolCallId, r.output]));
    expect(JSON.stringify(byId["s1"])).toContain("42");
    expect(JSON.stringify(byId["g1"])).toContain("approved");
  });

  // 5. CONCURRENT DOUBLE-SUSPENSION (arbitration) ---------------------------
  it("double-suspension: first-wins; the loser re-attempts its own gate on resume and is never a model failure", async () => {
    const gateA = handler({
      name: "gate_a",
      inputSchema: z.object({}),
      outputSchema: z.object({ from: z.string() }),
      execute: async (_input, ctx) => {
        await ctx.suspend!({ reason: "approval", message: "A?" });
        return { from: "A" };
      },
    });
    const gateB = handler({
      name: "gate_b",
      inputSchema: z.object({}),
      outputSchema: z.object({ from: z.string() }),
      execute: async (_input, ctx) => {
        await ctx.suspend!({ reason: "approval", message: "B?" });
        return { from: "B" };
      },
    });

    const { model, seen } = stepModel([
      () => ({
        toolCalls: [
          { toolCallId: "a1", toolName: "gate_a", args: {} },
          { toolCallId: "b1", toolName: "gate_b", args: {} },
        ],
        finishReason: "tool-calls",
      }),
      () => ({ text: "both approved", finishReason: "stop" }),
    ]);

    const gen = generator({ name: "agent", model, prompt: "p", tools: [gateA, gateB] });
    const flow = defineFlow({
      kind: "gen-double-suspend",
      actions: { run: { block: sequencer({ name: "seq", durable: true }).step(gen), inputSchema: anyInput } },
    })({ id: "gen-double-suspend" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow, actionName: "run", input: {}, userId: "u1", stores,
      runtimeConfig: { durabilityProvider: provider },
    });
    const requestId = initial.requestId!;

    // Exactly ONE gate surfaced (first-wins), model not called for step 1 yet.
    const pending0 = await provider.listSuspended({ status: "pending" });
    expect(pending0.length).toBe(1);
    expect(seen.length).toBe(1);

    // Approve the winner → the LOSER re-attempts its own gate (re-suspends).
    await resolve(flow, stores, provider, requestId, pending0[0]!, "approve");
    expect((await stores.request.get(requestId))?.status).toBe("suspended");
    // Still no step-1 model call — the loser gated again before the loop advanced.
    expect(seen.length).toBe(1);
    const pending1 = await provider.listSuspended({ status: "pending" });
    expect(pending1.length).toBe(1);
    expect(pending1[0]!.suspensionId).not.toBe(pending0[0]!.suspensionId);

    // Approve the loser → completes; both gates produced real results, neither a failure.
    const resumed2 = await resolve(flow, stores, provider, requestId, pending1[0]!, "approve");
    expect((await stores.request.get(requestId))?.status).toBe("completed");
    expect(resumed2.output).toBe("both approved");
    expect(seen.length).toBe(2);
    const results = toolResultParts(seen[1]!.messages);
    for (const r of results) {
      expect(JSON.stringify(r.output)).not.toContain("error-text");
    }
    const joined = JSON.stringify(results.map((r) => r.output));
    expect(joined).toContain('"A"');
    expect(joined).toContain('"B"');
  });

  // 6. history:false GENERATOR ----------------------------------------------
  it("history:false generator resumes with its prior turns reconstructed (visibility-agnostic)", async () => {
    const gate = handler({
      name: "gate",
      inputSchema: z.object({}),
      outputSchema: z.object({ token: z.string() }),
      execute: async (_input, ctx) => {
        await ctx.suspend!({ reason: "approval", message: "gate?" });
        return { token: "SECRET42" };
      },
    });

    const { model, seen } = stepModel([
      () => ({ toolCalls: [{ toolCallId: "c1", toolName: "gate", args: {} }], finishReason: "tool-calls" }),
      () => ({ text: "resumed", finishReason: "stop" }),
    ]);

    const gen = generator({
      name: "agent",
      model,
      prompt: "p",
      tools: [gate],
      itemVisibility: { history: false },
    });
    const flow = defineFlow({
      kind: "gen-history-false",
      actions: { run: { block: sequencer({ name: "seq", durable: true }).step(gen), inputSchema: anyInput } },
    })({ id: "gen-history-false" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow, actionName: "run", input: {}, userId: "u1", stores,
      runtimeConfig: { durabilityProvider: provider },
    });
    const requestId = initial.requestId!;

    const [suspension] = await provider.listSuspended({ status: "pending" });
    const resumed = await resolve(flow, stores, provider, requestId, suspension, "approve");
    expect((await stores.request.get(requestId))?.status).toBe("completed");
    expect(resumed.output).toBe("resumed");

    // The prior turn was reconstructed despite history:false: step 1's request
    // carries the assistant tool-call turn + the gate's tool result.
    const step1 = seen[1]!.messages as Array<Record<string, unknown>>;
    const hasToolCall = step1.some(
      (m) =>
        m.role === "assistant" &&
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>).some((p) => p.type === "tool-call")
    );
    expect(hasToolCall).toBe(true);
    const results = toolResultParts(step1);
    expect(results).toHaveLength(1);
    expect(JSON.stringify(results[0]!.output)).toContain("SECRET42");
  });

  // 7. PRE-GATE SIDE-EFFECT IDEMPOTENCY -------------------------------------
  it("pre-gate side effect: unguarded re-runs on resume, but a runOnce-guarded effect fires once", async () => {
    let unguarded = 0;
    let guarded = 0;
    const gate = handler({
      name: "gate",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (_input, ctx) => {
        unguarded += 1; // runs before the gate → re-runs on resume
        await ctx.runOnce!("charge", async () => {
          guarded += 1; // durable dedup keyed by request id → fires once
          return { charged: true };
        });
        await ctx.suspend!({ reason: "approval", message: "gate?" });
        return { ok: true };
      },
    });

    const { model } = stepModel([
      () => ({ toolCalls: [{ toolCallId: "c1", toolName: "gate", args: {} }], finishReason: "tool-calls" }),
      () => ({ text: "done", finishReason: "stop" }),
    ]);

    const gen = generator({ name: "agent", model, prompt: "p", tools: [gate] });
    const flow = defineFlow({
      kind: "gen-pregate",
      actions: { run: { block: sequencer({ name: "seq", durable: true }).step(gen), inputSchema: anyInput } },
    })({ id: "gen-pregate" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow, actionName: "run", input: {}, userId: "u1", stores,
      runtimeConfig: { durabilityProvider: provider },
    });
    const requestId = initial.requestId!;
    expect(unguarded).toBe(1);
    expect(guarded).toBe(1);

    const [suspension] = await provider.listSuspended({ status: "pending" });
    await resolve(flow, stores, provider, requestId, suspension, "approve");
    expect((await stores.request.get(requestId))?.status).toBe("completed");

    // Unguarded pre-gate effect ran again on resume (documented contract); the
    // runOnce-guarded effect did NOT.
    expect(unguarded).toBe(2);
    expect(guarded).toBe(1);
  });

  // 8. GET/HISTORY AFTER RESUME RETAINS PRE-SUSPENSION TURNS (Gap A / D10) ---
  it("GET after resume retains the completed sibling tool_output from the pre-suspension turn", async () => {
    const sibling = handler({
      name: "lookup",
      inputSchema: z.object({}),
      outputSchema: z.object({ hit: z.string() }),
      execute: async () => ({ hit: "sibling-result" }),
    });
    const gate = handler({
      name: "gate",
      inputSchema: z.object({}),
      outputSchema: z.object({ approved: z.boolean() }),
      execute: async (_input, ctx) => {
        await ctx.suspend!({ reason: "approval", message: "gate?" });
        return { approved: true };
      },
    });

    const { model } = stepModel([
      () => ({
        toolCalls: [
          { toolCallId: "s1", toolName: "lookup", args: {} },
          { toolCallId: "g1", toolName: "gate", args: {} },
        ],
        finishReason: "tool-calls",
      }),
      () => ({ text: "done", finishReason: "stop" }),
    ]);

    const gen = generator({
      name: "agent",
      model,
      prompt: "p",
      tools: [sibling, gate],
      itemVisibility: { client: true, history: true },
    });
    const flow = defineFlow({
      kind: "gen-gapA",
      actions: { run: { block: sequencer({ name: "seq", durable: true }).step(gen), inputSchema: anyInput } },
    })({ id: "gen-gapA" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow, actionName: "run", input: {}, userId: "u1", stores,
      runtimeConfig: { durabilityProvider: provider },
    });
    const requestId = initial.requestId!;

    const [suspension] = await provider.listSuspended({ status: "pending" });
    await resolve(flow, stores, provider, requestId, suspension, "approve");
    expect((await stores.request.get(requestId))?.status).toBe("completed");

    // The canonical (GET / useSession) view must retain the completed sibling
    // tool_output from run 1 — it was injected from the log on resume, never
    // re-emitted, so a naive collapse would drop it below the generator's
    // re-run boundary.
    const record = await stores.request.get(requestId);
    const canonical = collapseToCanonicalLog(record!.items ?? []);
    const siblingOut = canonical.filter(
      (i) => i.type === "tool_output" && (i as { blockName?: string }).blockName === "lookup"
    );
    expect(siblingOut.length).toBe(1);
    expect((siblingOut[0] as { output?: unknown }).output).toMatchObject({ hit: "sibling-result" });

    // The gate's superseded run-1 failed(SUSPENSION) tool_output does NOT
    // survive — only its completed run-2 result does (one per callId).
    const gateOuts = canonical.filter(
      (i) => i.type === "tool_output" && (i as { blockName?: string }).blockName === "gate"
    ) as Array<{ status?: string; output?: unknown }>;
    expect(gateOuts.length).toBe(1);
    expect(gateOuts[0]!.status).toBe("completed");
    expect(gateOuts[0]!.output).toMatchObject({ approved: true });
  });

  // 9a. OBJECT-SCHEMA (structured output) generator --------------------------
  it("object-schema generator suspends mid-loop then resumes and the final-step parse fires", async () => {
    const gate = handler({
      name: "gate",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (_input, ctx) => {
        await ctx.suspend!({ reason: "approval", message: "gate?" });
        return { ok: true };
      },
    });

    const { model } = stepModel([
      () => ({ toolCalls: [{ toolCallId: "c1", toolName: "gate", args: {} }], finishReason: "tool-calls" }),
      () => ({ structuredOutput: { answer: "forty-two" }, finishReason: "stop" }),
    ]);

    const gen = generator({
      name: "agent",
      model,
      prompt: "p",
      outputSchema: z.object({ answer: z.string() }),
      tools: [gate],
    });
    const flow = defineFlow({
      kind: "gen-object",
      actions: { run: { block: sequencer({ name: "seq", durable: true }).step(gen), inputSchema: anyInput } },
    })({ id: "gen-object" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow, actionName: "run", input: {}, userId: "u1", stores,
      runtimeConfig: { durabilityProvider: provider },
    });
    const requestId = initial.requestId!;

    const [suspension] = await provider.listSuspended({ status: "pending" });
    const resumed = await resolve(flow, stores, provider, requestId, suspension, "approve");
    expect((await stores.request.get(requestId))?.status).toBe("completed");
    expect(resumed.output).toEqual({ answer: "forty-two" });
  });

  // 9b. mapModelOutput persisted + read back on resume (Gap B) ---------------
  it("mapModelOutput: persisted modelOutput round-trips through the store and is used verbatim on resume", async () => {
    const gate = handler({
      name: "gate",
      inputSchema: z.object({}),
      outputSchema: z.object({ secret: z.string(), summary: z.string() }),
      execute: async (_input, ctx) => {
        await ctx.suspend!({ reason: "approval", message: "gate?" });
        return { secret: "s3cr3t", summary: "the gist" };
      },
    }).mapModelOutput((output) => `summary: ${output.summary}`);

    const { model, seen } = stepModel([
      () => ({ toolCalls: [{ toolCallId: "c1", toolName: "gate", args: {} }], finishReason: "tool-calls" }),
      () => ({ text: "done", finishReason: "stop" }),
    ]);

    const gen = generator({ name: "agent", model, prompt: "p", tools: [gate] });
    const flow = defineFlow({
      kind: "gen-mapoutput",
      actions: { run: { block: sequencer({ name: "seq", durable: true }).step(gen), inputSchema: anyInput } },
    })({ id: "gen-mapoutput" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow, actionName: "run", input: {}, userId: "u1", stores,
      runtimeConfig: { durabilityProvider: provider },
    });
    const requestId = initial.requestId!;

    const [suspension] = await provider.listSuspended({ status: "pending" });
    await resolve(flow, stores, provider, requestId, suspension, "approve");
    expect((await stores.request.get(requestId))?.status).toBe("completed");

    // The persisted completed tool_output round-trips both the raw output and
    // the mapped modelOutput (Gap B: the merge/persistence layer tolerates the
    // new key end-to-end).
    const record = await stores.request.get(requestId);
    const completed = completedToolOutputs(record!.items ?? []);
    expect(completed.length).toBe(1);
    expect(completed[0]!.output).toMatchObject({ secret: "s3cr3t", summary: "the gist" });
    expect(completed[0]!.modelOutput).toBe("summary: the gist");

    // The model saw the mapped string on step 1, never the raw secret.
    const step1 = toolResultParts(seen[1]!.messages);
    expect(JSON.stringify(step1[0]!.output)).toContain("the gist");
    expect(JSON.stringify(seen[1]!.messages)).not.toContain("s3cr3t");
  });
});
