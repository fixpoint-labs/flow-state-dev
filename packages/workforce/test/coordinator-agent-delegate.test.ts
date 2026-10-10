/**
 * The built-in `agent` flow takes a delegated post (S9): a coordinator's
 * delivery runs one turn of the agent's own sequence on the post, and the
 * reply comes back into the delivering conversation with the delivery's
 * token, landing under the delegate's name. On a post whose answer can go
 * back out (`rounds:` above 0), a turn that fails is reported back at once.
 *
 * The agent copy is registered under its kind, the shape FIX-1788's switch
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
import { DELEGATED_POST_ENTRY } from "../src/worker-task-entry";
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
  const coordinator = defineCoordinatorFlow({ installation, delegateFlows: [agentFlow], routeModel: "typesafe-ai/jev" });
  flows = { agent: agentFlow, coordinator };
  const copies = hireWorkforce(installation);
  const state = createFlowState({
    flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({
      generators: { "agent-answer": answer },
      evaluators: {
        "coordinator-route": mockEvaluationModel({ answers: { member: { type: "choice", choice: "otto" } } })
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
    actionName: "run",
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
  const deliveries = async () =>
    (((await runtime.stores.session.get(sessionId))?.state ?? {}) as { deliveries?: any[] }).deliveries ?? [];
  /** Cancel otto's running delegated post through the abort route, as Alice. Returns the route's status. */
  const cancelOtto = async () => {
    const running = await until(
      async () =>
        (await runtime.stores.request.list({})).find(
          (request) => request.status === "in_progress" && request.actionName === "onDelegatedPost"
        ),
      (found) => found !== undefined
    );
    const aborted: Response = await router.POST(
      new Request(`http://localhost/api/flows/agent/requests/${running!.id}/abort`, {
        method: "POST",
        headers: { "x-user": "alice" }
      }),
      { params: { path: ["agent", "requests", running!.id, "abort"] } }
    );
    return aborted.status;
  };
  return { until, lines, deliveries, cancelOtto };
}

describe("the agent flow as a delegate (S9)", () => {
  it("declares the delegated-post entry", () => {
    const agent = defineAgentWorkerFlow();
    expect(Object.keys((agent as any).internal.actions)).toContain(DELEGATED_POST_ENTRY);
  });

  it("answers a delegated post into the delivering conversation, once, under the delegate's name", async () => {
    const answer = mockGenerator({ name: "agent-answer", script: [{ when: () => true, then: { text: "Otto's answer." } }] });
    const conversation = await postToOtto(answer, "what's our refund policy?");
    const lines = await conversation.until(conversation.lines, (found) => found.length > 0);
    expect(lines).toEqual([{ agentName: "otto", text: "Otto's answer." }]);
    const heard = JSON.stringify(answer.calls[0]!.input);
    expect(heard).toContain("alice, through desk: what's our refund policy?");
  });

  it("reports a failed turn back at once when its answer could go back out (BR-24b)", async () => {
    // No script: the agent's turn fails.
    const answer = mockGenerator({ name: "agent-answer", script: [] });
    const conversation = await postToOtto(answer, "what's our refund policy?", { rounds: 1 });
    const deliveries = await conversation.until(conversation.deliveries, (found) =>
      found.some((delivery) => delivery.missed !== undefined)
    );
    expect(deliveries).toEqual([
      expect.objectContaining({
        round: 0,
        delegate: { worker: "otto" },
        answered: false,
        missed: expect.stringMatching(/^its turn failed: /)
      })
    ]);
    expect(await conversation.lines()).toEqual([]);
  });

  it("reports a cancelled run back from its request's onFinished, when its answer could go back out (BR-24b)", async () => {
    // Otto's turn calls `wait`, which holds until the run is cancelled.
    const answer = mockGenerator({
      name: "agent-answer",
      script: [{ toolCalls: [{ toolCallId: "w1", toolName: "wait", args: {} }] }]
    });
    const conversation = await postToOtto(answer, "what's our refund policy?", { rounds: 1 });
    // Once otto's turn is running: a run cancelled before its entry starts has
    // no delivery noted to report, and the next wake's sweep closes its round.
    await conversation.until(async () => answer.calls.length, (calls) => calls > 0);
    expect(await conversation.cancelOtto()).toBe(204);
    const deliveries = await conversation.until(conversation.deliveries, (found) =>
      found.some((delivery) => delivery.missed !== undefined)
    );
    expect(deliveries).toEqual([
      expect.objectContaining({ round: 0, answered: false, missed: "its turn failed: its run was cancelled" })
    ]);
  });
});
