/**
 * A turn on the shared `agent` copy that waits for a person runs as its
 * worker again when the answer arrives.
 *
 * Every setting a turn reads comes from the worker the turn loaded. A resumed
 * request injects a completed step's recorded output instead of running it
 * again, so a worker loaded by a step of the turn would be loaded on the
 * first run only: on resume the turn would read the copy's empty settings,
 * and the tool that asked would be gone from the worker's tool set. The
 * worker is loaded as the flow's request `onStarted`, which runs on every
 * run of a request, the resumed one included.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, handler } from "@flow-state-dev/core";
import type { FlowInstance, GeneratorModel, ModelResolver, SuspensionRecord } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { z } from "zod";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { createWorkerInstallation } from "../src/workers/installation";

/** A tool that waits for a person's approval, then says what it did. */
const approveRefund = handler({
  name: "approveRefund",
  description: "Refund an order, once a person approves it.",
  inputSchema: z.object({ order: z.string() }),
  outputSchema: z.object({ refunded: z.string() }),
  execute: async (input, ctx) => {
    await ctx.suspend!({ reason: "human_approval", message: `Refund ${input.order}?`, allow: ["approve", "reject"] });
    return { refunded: input.order };
  }
});

/** A model that calls `approveRefund` once, then answers. */
function scripted(): ModelResolver {
  let called = false;
  const model: GeneratorModel = {
    modelId: "test/step",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep() {
      if (called) return { text: "refunded", finishReason: "stop" };
      called = true;
      return {
        toolCalls: [{ toolCallId: "t1", toolName: "approveRefund", args: { order: "o-1" } }],
        finishReason: "tool-calls"
      };
    }
  } as unknown as GeneratorModel;
  return Object.assign(() => model, { resolveId: (id: string) => id }) as unknown as ModelResolver;
}

describe("a resumed turn on the shared agent copy", () => {
  it("runs as its worker again, so the tool that waited is still the worker's when the answer arrives", async () => {
    let flows: Record<string, unknown> = {};
    const installation = createWorkerInstallation({
      standardWorkers: [{ id: "desk.amy", declared: { tools: ["approveRefund"] }, body: "You are Amy." }],
      workerFlows: () => flows as never
    });
    const agent = defineAgentWorkerFlow({ installation, catalog: { approveRefund } });
    flows = { agent };
    const copy = agent({ id: "agent" }) as unknown as FlowInstance;
    const state = createFlowState({
      flows: { agent: copy },
      stores: { default: { primary: inMemoryStores() } },
      durable: true,
      modelResolver: scripted()
    } as never);
    try {
      const runtime = await state.getRuntime();
      const router = await state.getRouter();
      const call = (method: "POST", path: string[], body: unknown) =>
        router[method](
          new Request(`http://localhost/api/flows/${path.join("/")}`, {
            method,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
          }),
          { params: { path } }
        );

      const sessionId = "conversation-amy";
      expect((await call("POST", ["agent", "sessions"], { userId: "alice", sessionId, state: { workerId: "desk.amy" } })).status).toBe(201);
      const started = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: copy,
        actionName: "run",
        input: { message: "refund o-1" },
        userId: "alice",
        sessionId,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });
      const requestId = started.requestId!;
      expect((await runtime.stores.request.get(requestId))?.status).toBe("suspended");
      const [pending] = (await runtime.stores.suspensions.list({ status: "pending" })) as SuspensionRecord[];

      const resumed = await call("POST", ["agent", "requests", requestId, "resume"], {
        suspensionId: pending!.suspensionId,
        action: "approve",
        resumedBy: "alice"
      });
      expect(resumed.status).toBe(202);
      let status = "suspended";
      for (let i = 0; i < 200 && (status === "suspended" || status === "in_progress"); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        status = String((await runtime.stores.request.get(requestId))?.status);
      }
      const record = (await runtime.stores.request.get(requestId)) as { items?: Array<Record<string, unknown>> };
      const failures = (record.items ?? []).filter((item) => item.type === "error").map((item) => item.message);
      expect(failures).toEqual([]);
      expect(status).toBe("completed");
      // The tool ran on Approve, as the worker's own.
      const outputs = (record.items ?? []).filter((item) => item.type === "tool_output" && item.status === "completed");
      expect(outputs.map((item) => item.output)).toContainEqual({ refunded: "o-1" });
    } finally {
      await state.dispose();
    }
  });
});
