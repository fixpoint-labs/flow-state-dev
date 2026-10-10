/**
 * `RequestHost.hasAskSweeper` (FIX-1816 BR-5): a turn is told an ask is
 * bounded only when this process runs a durability sweeper that times asks
 * out, so `addTask` offers `waitForResponse` only where no ask can wait
 * forever. The resume verb is unaffected by it.
 */
import { defineFlow, handler, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFlowApiRouter, createFlowRegistry, createFlowState, createInMemoryStores, inMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";

const probe = handler({
  name: "probe",
  inputSchema: z.object({}).passthrough(),
  outputSchema: z.any(),
  execute: (_input, ctx) => ({
    hasAskSweeper: ctx.requestHost?.hasAskSweeper === true,
    resumeAsk: typeof ctx.requestHost?.resumeAsk === "function"
  })
});
const flow = defineFlow({ kind: "probe", actions: { probe: { block: probe } } })({ id: "probe" });

async function probeWith(options: { durable: boolean; router: boolean; sweepIntervalMs?: number }) {
  const state = createFlowState({
    flows: { probe: flow },
    stores: { default: { primary: inMemoryStores() } },
    durable: options.durable,
    ...(options.sweepIntervalMs !== undefined ? { durabilityRetention: { sweepIntervalMs: options.sweepIntervalMs } } : {})
  });
  try {
    if (options.router) await state.getRouter();
    const runtime = await state.getRuntime();
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "probe",
      input: {},
      userId: "u1",
      sessionId: "s1",
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig
    });
    return result.output as { hasAskSweeper: boolean; resumeAsk: boolean };
  } finally {
    await state.dispose();
  }
}

describe("RequestHost.hasAskSweeper", () => {
  it("is true on a durable host whose router built the durability sweeper", async () => {
    expect(await probeWith({ durable: true, router: true })).toEqual({ hasAskSweeper: true, resumeAsk: true });
  });

  it("is false on a durable host with no sweeper running, and the resume verb is still there", async () => {
    expect(await probeWith({ durable: true, router: false })).toEqual({ hasAskSweeper: false, resumeAsk: true });
  });

  it("is false when the sweep is turned off", async () => {
    expect(await probeWith({ durable: true, router: true, sweepIntervalMs: 0 })).toEqual({
      hasAskSweeper: false,
      resumeAsk: true
    });
  });

  it("is false without durable execution", async () => {
    expect(await probeWith({ durable: false, router: true })).toEqual({ hasAskSweeper: false, resumeAsk: false });
  });

  it("is true on a router built directly with durable execution, whose sweeper runs: no FlowState in between", async () => {
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({
      checkpoints: stores.checkpoints,
      leases: stores.leases,
      suspensions: stores.suspensions
    } as never);
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const router = createFlowApiRouter({ registry, stores, durabilityProvider: provider } as never);
    try {
      const res = await router.POST(
        new Request("http://localhost/api/flows/probe/s_1/actions/probe", {
          method: "POST",
          body: JSON.stringify({ userId: "u_1", input: {} })
        }),
        { params: { path: ["probe", "s_1", "actions", "probe"] } }
      );
      expect(res.status).toBe(202);
      const { request } = (await res.json()) as { request: { id: string } };
      let output: unknown;
      for (let i = 0; i < 200 && output === undefined; i += 1) {
        const record = await stores.request.get(request.id);
        if (record?.status === "completed") output = (record as { result?: { output?: unknown } }).result?.output;
        else await new Promise((r) => setTimeout(r, 10));
      }
      expect(output).toEqual({ hasAskSweeper: true, resumeAsk: true });
    } finally {
      (router as { dispose?: () => void }).dispose?.();
    }
  });
});
