/**
 * An ask gate survives a cold restart on SQLite.
 *
 * A chat turn's tool parks on an ask gate, served by one runtime over HTTP.
 * That runtime is thrown away. A second runtime opens a fresh store registry on
 * the same SQLite file, and a later request in the same conversation resumes
 * the parked turn through `ctx.requestHost.resumeAsk`, which the shipped
 * `createFlowState` install wires. The turn ends `completed` with the answer as
 * its tool's result, under its own request id.
 *
 * Nothing here files a task; the board and the row come with the hand-off.
 * The real process kill is the goal check's, run against the whole hand-off.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  generator,
  handler,
  parkOnAsk,
  requireRequestHost,
  sequencer,
  type FlowInstance
} from "@flow-state-dev/core";
import type {
  AskOutcome,
  GeneratorModel,
  GeneratorModelCallOptions,
  GeneratorModelResult
} from "@flow-state-dev/core/types";
import { createFlowState, type FlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";

const USER = "u_asker";
const SESSION = "s_conversation";
const GATE_ID = "gate_ask_restart";

type StepFn = (options: GeneratorModelCallOptions) => GeneratorModelResult;

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

function toolResults(messages: unknown[]): string {
  const out: string[] = [];
  for (const m of messages as Array<Record<string, unknown>>) {
    if (m.role !== "tool" || !Array.isArray(m.content)) continue;
    for (const part of m.content as Array<Record<string, unknown>>) {
      if (part.type === "tool-result") out.push(JSON.stringify(part.output));
    }
  }
  return out.join(" | ");
}

/** The same flow definition each runtime registers, with that runtime's model. */
function askFlow(model: GeneratorModel): FlowInstance {
  const ask = handler({
    name: "ask_colleague",
    inputSchema: z.object({ question: z.string() }),
    outputSchema: z.object({ answer: z.unknown() }),
    execute: async (_input, ctx) => ({
      answer: await parkOnAsk(ctx, {
        gateId: GATE_ID,
        binding: { board: "conversation", taskId: "task_restart" }
      })
    })
  });
  const touch = handler({
    name: "touch",
    inputSchema: z.object({ gateId: z.string(), outcome: z.any() }),
    outputSchema: z.any(),
    execute: async (input, ctx) =>
      requireRequestHost(ctx).resumeAsk!({
        gateId: input.gateId,
        outcome: input.outcome as AskOutcome
      })
  });
  return defineFlow({
    kind: "ask-restart",
    actions: {
      chat: {
        block: sequencer({ name: "turn" }).step(
          generator({ name: "agent", model, prompt: "p", tools: [ask] })
        ),
        inputSchema: z.object({}).passthrough()
      },
      touch: { block: touch }
    }
  })({ id: "ask-restart" });
}

async function post(state: FlowState, action: string, input: unknown): Promise<string> {
  const router = await state.getRouter();
  const res = await router.POST(
    new Request(`http://localhost/api/flows/ask-restart/actions/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ userId: USER, sessionId: SESSION, input })
    }),
    { params: { path: ["ask-restart", "actions", action] } }
  );
  expect(res.status).toBeLessThan(300);
  const body = await res.text();
  return body;
}

async function waitForStatus(state: FlowState, requestId: string, status: string) {
  const { stores } = await state.getRuntime();
  const deadline = Date.now() + 10_000;
  for (;;) {
    const record = await stores.request.get(requestId);
    // Wait for the run to finish writing too, so disposal cannot cut its tail.
    if (record?.status === status && (status !== "completed" || record.finalizedAtMs != null)) {
      return record;
    }
    if (Date.now() > deadline) {
      throw new Error(`request ${requestId} is "${record?.status}", never reached "${status}"`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

let dir: string | undefined;
const states: FlowState[] = [];

afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose();
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

function runtimeOn(filename: string, model: GeneratorModel): FlowState {
  const state = createFlowState({
    flows: { "ask-restart": askFlow(model) },
    stores: { default: { primary: sqliteStores({ filename }) } },
    durable: true
  });
  states.push(state);
  return state;
}

describe("ask gate across a SQLite cold restart", () => {
  it("a parked turn resumes with the answer after the runtime that parked it is gone", async () => {
    dir = await mkdtemp(join(tmpdir(), "fsd-ask-restart-"));
    const filename = join(dir, "store.db");

    // Runtime 1: the turn asks and parks.
    const first = stepModel([
      () => ({
        toolCalls: [{ toolCallId: "c1", toolName: "ask_colleague", args: { question: "SOC 2?" } }],
        finishReason: "tool-calls"
      })
    ]);
    const before = runtimeOn(filename, first.model);
    await post(before, "chat", {});

    const [gate] = await (await before.getRuntime()).stores.suspensions.list({ sessionId: SESSION });
    expect(gate).toMatchObject({ suspensionId: GATE_ID, reason: "ask", status: "pending" });
    const parkedRequestId = gate!.requestId;
    await waitForStatus(before, parkedRequestId, "suspended");
    await before.dispose();
    states.splice(states.indexOf(before), 1);

    // Runtime 2: a fresh store registry on the same file, and a fresh model
    // that only ever sees the step after the park.
    const second = stepModel([
      (opts) => ({ text: `answer received: ${toolResults(opts.messages)}`, finishReason: "stop" })
    ]);
    const after = runtimeOn(filename, second.model);
    const touched = await post(after, "touch", {
      gateId: GATE_ID,
      outcome: { answered: true, answer: "Yes, renewed 2026-08" }
    });
    expect(touched).toContain("request.completed");

    const record = await waitForStatus(after, parkedRequestId, "completed");
    expect(record.id).toBe(parkedRequestId);
    expect(first.seen).toHaveLength(1);
    expect(second.seen).toHaveLength(1);
    expect(toolResults(second.seen[0]!.messages)).toContain("Yes, renewed 2026-08");
  });
});
