/**
 * The built-in `agent` flow takes a coordinator's routed task (S9, FIX-2083)
 * on its `work` entry, like any task: one turn of the agent's own sequence on
 * the message, and the answer ends the task, landing in the routing
 * conversation under the delegate's name. The turn is a task turn, so it may
 * park on a question. On a message whose answer can go back out (`rounds:`
 * above 0), a turn that fails, or a task its user cancels, ends that
 * delegate's part at once, and the round closes on it.
 *
 * The agent copy is registered under its `kind`, the shape FIX-1788's switch
 * gives every worker flow; the agent's turn is scripted by its generator's
 * block name (`agent-answer`).
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import {
  createMockModelResolver,
  mockEvaluationModel,
  mockGenerator,
  type MockGeneratorInstance
} from "@flow-state-dev/testing";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { defineCoordinatorFlow } from "../src/coordinator/coordinator-flow";
import { WORKER_TASK_ENTRY } from "../src/worker-task-entry";
import { hireWorkforce } from "../src/workers/register";
import { createWorkerInstallation } from "../src/workers/installation";

/** A catalog tool that waits until its run is cancelled. */
const wait = handler({
  name: "wait",
  description: "Waits.",
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  execute: (_input, ctx) =>
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("never cancelled")), 10_000);
      ctx.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("cancelled"));
      });
    })
});

/**
 * A best-fit desk whose one delegate, `otto`, is an `agent` worker; Alice
 * posts `message` to it. Otto may call the `wait` tool.
 */
async function postToOtto(answer: MockGeneratorInstance, message: string, desk: Record<string, unknown> = {}) {
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: [
      { id: "desk", declared: { flow: "coordinator", routing: "best-fit", delegates: ["otto"], ...desk }, body: "" },
      {
        id: "otto",
        declared: { flow: "agent", description: "Answers questions.", tools: ["wait"] },
        body: "You answer questions."
      }
    ],
    workerFlows: () => flows as never
  });
  // The agent copy every agent worker shares, built on the installation.
  const agentFlow = defineAgentWorkerFlow({ installation, catalog: { wait } });
  const coordinator = defineCoordinatorFlow({ installation, routeModel: "typesafe-ai/jev" });
  flows = { agent: agentFlow, coordinator };
  const copies = hireWorkforce(installation);
  const state = createFlowState({
    flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({
      generators: { "agent-answer": answer },
      evaluators: {
        "coordinator-route": mockEvaluationModel({ answers: { worker: { type: "choice", choice: "otto" } } })
      }
    }),
    resolvePrincipal: (context: any) => ({ userId: context.request.headers.get("x-user"), orgId: "acme" })
  } as never);
  const router = (await state.getRouter()) as any;
  const res: Response = await router.POST(
    new Request("http://localhost/api/flows/coordinator/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": "alice" },
      body: JSON.stringify({ userId: "alice", state: { workerId: "desk" } })
    }),
    { params: { path: ["coordinator", "sessions"] } }
  );
  expect(res.status).toBe(201);
  const sessionId = ((await res.json()) as { session: { id: string } }).session.id;
  const runtime = await state.getRuntime();
  const posted = await runAction({
    flow: copies.find((copy) => copy.id === "coordinator")!,
    actionName: "respond",
    input: { message },
    userId: "alice",
    orgId: "acme",
    sessionId,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  });
  expect((posted as { error?: unknown }).error).toBeUndefined();

  /** Poll the conversation until `done` holds of it, or five seconds pass. */
  const until = async <T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> => {
    const deadline = Date.now() + 5_000;
    let value = await read();
    while (!done(value) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      value = await read();
    }
    return value;
  };
  const lines = async () =>
    (await runtime.stores.request.list({ sessionId, withItems: true }))
      .flatMap((request) => ((request as unknown as { items?: any[] }).items ?? []))
      .filter((item) => item.type === "message" && item.agentName !== undefined)
      .map((item) => ({ agentName: item.agentName, text: (item.content ?? []).map((p: any) => p.text ?? "").join("") }));
  /** The conversation's routed tasks, read from the store. */
  const postRows = async (): Promise<any[]> =>
    Object.values(await runtime.stores.resourceState.getByPrefix("user", "alice:~org:acme", "tasks/"))
      .map((value) => value.state as any)
      .filter((row) => typeof row?.sealed?.messageRequestId === "string");
  /** The rounds still open in the conversation. */
  const rounds = async (): Promise<any[]> =>
    (((await runtime.stores.session.get(sessionId))?.state ?? {}) as { openRounds?: any[] }).openRounds ?? [];
  /** Cancel otto's routed task from the board, as Alice, through the public task action. */
  const cancelOtto = async () => {
    const [row] = await until(postRows, (found) => found.some((r) => r.status === "in_progress"));
    const cancelled = await runAction({
      flow: copies.find((copy) => copy.id === "coordinator")!,
      actionName: "updateTask_tasks",
      input: { id: row!.id, status: "cancelled" },
      userId: "alice",
      orgId: "acme",
      sessionId,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    });
    return (cancelled as { output?: unknown }).output;
  };
  return { until, lines, postRows, rounds, cancelOtto };
}

describe("the agent flow as a delegate (S9)", () => {
  it("takes work on its one task entry, and declares no post entry", () => {
    const agent = defineAgentWorkerFlow();
    expect(Object.keys((agent as any).task.actions)).toEqual([WORKER_TASK_ENTRY]);
    expect(Object.keys((agent as any).internal?.actions ?? {})).not.toContain("onDelegatedPost");
  });

  it("answers a routed message into the routing conversation, once, under the delegate's name", async () => {
    const answer = mockGenerator({ name: "agent-answer", script: [{ when: () => true, then: { text: "Otto's answer." } }] });
    const conversation = await postToOtto(answer, "what's our refund policy?");
    const lines = await conversation.until(conversation.lines, (found) => found.length > 0);
    expect(lines).toEqual([{ agentName: "otto", text: "Otto's answer." }]);
    const heard = JSON.stringify(answer.calls[0]!.input);
    expect(heard).toContain("alice, through desk: what's our refund policy?");
  });

  it("holds a routed task on its question, and tells the conversation that filed it the question, once (FIX-2131, FIX-2241)", async () => {
    // A routed turn is a task turn (FIX-2083): it may ask a question, which holds its task. Its filer is
    // the conversation, which hears the question as a message from otto; no notice lands, since nothing ended.
    const answer = mockGenerator({
      name: "agent-answer",
      script: [
        { toolCalls: [{ toolCallId: "q1", toolName: "askQuestion", args: { question: "Which policy?" } }] },
        { text: "Waiting on your answer." }
      ]
    });
    const conversation = await postToOtto(answer, "what's our refund policy?");
    const [row] = await conversation.until(conversation.postRows, (found) => (found[0]?.questions ?? []).length > 0);
    expect(row).toMatchObject({ status: "in_progress", questions: [expect.objectContaining({ ask: expect.objectContaining({ kind: "question", prompt: "Which policy?" }) })] });
    const question = row!.questions![0]!.id;
    expect(await conversation.until(conversation.lines, (found) => found.length > 0)).toEqual([
      { agentName: "otto", text: expect.stringMatching(new RegExp(`^From otto: Your task .* asks: "Which policy\\?"\n.*answers: "${question}"`)) }
    ]);
  });

  it("reports a failed turn back at once when its answer could go back out (BR-24b)", async () => {
    // No script: the agent's turn fails.
    const answer = mockGenerator({ name: "agent-answer", script: [] });
    const conversation = await postToOtto(answer, "what's our refund policy?", { rounds: 1 });
    const rows = await conversation.until(conversation.postRows, (found) => found.some((row) => row.status === "errored"));
    expect(rows).toEqual([
      expect.objectContaining({ assignee: "otto", status: "errored", sealed: expect.objectContaining({ round: 0, delegate: { worker: "otto" } }) })
    ]);
    // The round closed on it rather than waiting out its deadline.
    expect(await conversation.until(conversation.rounds, (open) => open.length === 0)).toEqual([]);
    // Alice is told it couldn't answer, once, under its name (FIX-1872 BR-9 as amended).
    expect(await conversation.until(conversation.lines, (found) => found.length > 0)).toEqual([
      expect.objectContaining({ agentName: "otto", text: expect.stringMatching(/^otto couldn't answer: /) })
    ]);
  });

  it("closes the round at once when Alice cancels its routed task while it works (BR-24b)", async () => {
    // Otto's turn calls `wait`, which holds until the run is cancelled.
    const answer = mockGenerator({
      name: "agent-answer",
      script: [{ toolCalls: [{ toolCallId: "w1", toolName: "wait", args: {} }] }]
    });
    const conversation = await postToOtto(answer, "what's our refund policy?", { rounds: 1 });
    await conversation.until(async () => answer.calls.length, (calls) => calls > 0);
    // Its round is open while otto works, so its closing below is the cancel's doing.
    expect(await conversation.rounds()).toEqual([expect.objectContaining({ round: 0 })]);
    expect(await conversation.cancelOtto()).toEqual({ ok: true });
    const rows = await conversation.until(conversation.postRows, (found) => found.some((row) => row.status === "cancelled"));
    expect(rows).toEqual([expect.objectContaining({ assignee: "otto", status: "cancelled" })]);
    expect(await conversation.until(conversation.rounds, (open) => open.length === 0)).toEqual([]);
    expect(await conversation.lines()).toEqual([]);
  });
});
