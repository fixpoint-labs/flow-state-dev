/**
 * A request's action result, read the way a remote client reads it: from the
 * session's request list over the flow router (FIX-1661).
 *
 * The two cases a trace reading got wrong, end to end:
 *
 * - A completion hook fails the request after the action answered. The list
 *   says `failed`, with the hook's error AND the action's answer.
 * - The action suspends. While suspended the list carries no result; the
 *   same request's resume writes it, once, under the same id.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { FlowInstance, SuspensionRecord } from "@flow-state-dev/core/types";
import {
  continueRequest,
  createCheckpointDurabilityProvider,
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  runAction,
  type StoreRegistry
} from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import { z } from "zod";

const refusal = { ok: false, error: "task is cancelled, which is terminal" };
const taskInput = z.object({ taskId: z.string() });

const gate = handler({
  name: "gate",
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  execute: async (_input, ctx) => {
    const decision = (await ctx.suspend!({ reason: "human_input", message: "Answer?" })) as { answer?: string };
    return { ok: true, answer: decision?.answer ?? null };
  }
});

const flow = defineFlow({
  kind: "result-scenario",
  actions: {
    refuseThenHookFails: {
      inputSchema: taskInput,
      block: handler({ name: "refuse", inputSchema: taskInput, execute: () => refusal }),
      onCompleted: handler({
        name: "notify",
        execute: () => {
          throw new Error("notification hook failed");
        }
      })
    },
    ask: {
      inputSchema: taskInput,
      durable: true,
      block: sequencer({ name: "ask-seq", durable: true, inputSchema: taskInput }).step(gate)
    }
  }
})() as FlowInstance;

/** The session's requests as `GET /sessions/:id/requests` lists them. */
async function listed(stores: StoreRegistry, sessionId: string, query = "?include_result_output=true") {
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const router = createFlowApiRouter({ registry, stores });
  const response = await router.GET(
    new Request(`http://localhost/api/flows/sessions/${sessionId}/requests${query}`),
    { params: { path: ["sessions", sessionId, "requests"] } }
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    requests: Array<{ id: string; status: string; result?: Record<string, unknown> }>;
  };
  return new Map(body.requests.map((request) => [request.id, request]));
}

describe("request action result, read from the session's request list", () => {
  it("lists a request a completion hook failed with the hook's error and the action's answer", async () => {
    const stores = createInMemoryStores();
    const run = await testFlow({
      flow,
      action: "refuseThenHookFails",
      userId: "u_scenario",
      sessionId: "s_hook",
      stores,
      input: { taskId: "t1" }
    });
    expect(run.status).toBe("failed");

    const entry = (await listed(stores, "s_hook")).get(run.requestId);
    expect(entry?.status).toBe("failed");
    expect(entry?.result).toEqual({
      output: refusal,
      error: { code: expect.any(String), message: expect.stringContaining("notification hook failed") },
      hasOutput: true
    });

    // Without the flag the list still says it failed and why, not what it returned.
    const summary = (await listed(stores, "s_hook", "")).get(run.requestId);
    expect(summary?.result).toEqual({
      error: { code: expect.any(String), message: expect.stringContaining("notification hook failed") },
      hasOutput: true
    });
  });

  it("lists no result while suspended, and the answer once the same request resumes", async () => {
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({
      checkpoints: stores.checkpoints,
      suspensions: stores.suspensions,
      leases: stores.leases
    });
    const first = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "ask",
      input: { taskId: "t1" },
      userId: "u_scenario",
      sessionId: "s_suspend",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    } as never);
    const requestId = first.requestId!;

    const whileSuspended = (await listed(stores, "s_suspend")).get(requestId);
    expect(whileSuspended?.status).toBe("suspended");
    expect(whileSuspended?.result).toBeUndefined();

    const [suspension] = (await provider.listSuspended({ status: "pending" })) as SuspensionRecord[];
    const data = { answer: "ship it" };
    await provider.suspend({ ...suspension!, status: "approved", resolvedAt: Date.now(), resumeData: data });
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const { finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registry,
      resumeContext: { suspensionId: suspension!.suspensionId, action: "approve", data, resumedBy: "reviewer" },
      runtimeConfig: { durabilityProvider: provider }
    });
    await finished;

    const requests = await listed(stores, "s_suspend");
    expect(requests.size).toBe(1);
    expect(requests.get(requestId)?.status).toBe("completed");
    expect(requests.get(requestId)?.result).toEqual({ output: { ok: true, answer: "ship it" }, hasOutput: true });
  });
});
