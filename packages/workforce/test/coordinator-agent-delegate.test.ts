/**
 * The built-in `agent` flow takes a delegated post (S9): a coordinator's
 * delivery runs one turn of the agent's own sequence on the post, and the
 * reply comes back into the delivering conversation with the delivery's
 * token, landing under the delegate's name.
 *
 * The agent copy is registered under its kind, the shape FIX-1788's switch
 * gives every worker flow; the agent's turn is scripted by its generator's
 * block name (`agent-answer`).
 */
import { describe, expect, it } from "vitest";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver, mockEvaluationModel, mockGenerator } from "@flow-state-dev/testing";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { defineCoordinatorFlow } from "../src/coordinator/coordinator-flow";
import { DELEGATED_POST_ENTRY } from "../src/coordinator/coordinator-keys";
import { hireWorkforce } from "../src/workers/register";
import { createWorkerInstallation } from "../src/workers/installation";

describe("the agent flow as a delegate (S9)", () => {
  it("declares the delegated-post entry", () => {
    const agent = defineAgentWorkerFlow();
    expect(Object.keys((agent as any).internal.actions)).toContain(DELEGATED_POST_ENTRY);
  });

  it("answers a delegated post into the delivering conversation, once, under the delegate's name", async () => {
    let flows: Record<string, unknown> = {};
    const installation = createWorkerInstallation({
      standardWorkers: [
        { id: "desk", declared: { flow: "coordinator", routing: "best-fit", delegates: ["otto"] }, body: "" },
        { id: "otto", declared: { flow: "agent", description: "Answers questions." }, body: "You answer questions." }
      ],
      workerFlows: () => flows as never
    });
    // The agent copy every agent worker shares, built on the installation.
    const agentFlow = defineAgentWorkerFlow({ installation });
    const coordinator = defineCoordinatorFlow({ installation, delegateFlows: [agentFlow], routeModel: "typesafe-ai/jev" });
    flows = { agent: agentFlow, coordinator };
    const copies = hireWorkforce(installation);
    const answer = mockGenerator({ name: "agent-answer", script: [{ when: () => true, then: { text: "Otto's answer." } }] });
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
      input: { message: "what's our refund policy?" },
      userId: "alice",
      orgId: "acme",
      sessionId,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    });
    expect((posted as { error?: unknown }).error).toBeUndefined();

    const deadline = Date.now() + 5_000;
    let lines: Array<{ agentName?: string; text: string }> = [];
    while (Date.now() < deadline) {
      const requests = await runtime.stores.request.list({ sessionId, withItems: true });
      lines = requests
        .flatMap((request) => ((request as unknown as { items?: any[] }).items ?? []))
        .filter((item) => item.type === "message" && item.agentName !== undefined)
        .map((item) => ({ agentName: item.agentName, text: (item.content ?? []).map((p: any) => p.text ?? "").join("") }));
      if (lines.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(lines).toEqual([{ agentName: "otto", text: "Otto's answer." }]);
    const heard = JSON.stringify(answer.calls[0]!.input);
    expect(heard).toContain("alice, through desk: what's our refund policy?");
  });
});
