/**
 * A wake end to end (FIX-2078 D1): a block owes a wake for its session's
 * internal entry, nothing else runs, and the host's sweeper fires the entry in
 * that session, as its owner, at the due time. The entry's pass settles it.
 *
 * Also the host's check, once at start: a durable host whose store keeps wakes
 * offers the verb; a host that isn't durable offers none.
 */
import { defineFlow, handler, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createFlowState, inMemoryStores, runAction } from "../src";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ran: Array<{ sessionId: string; userId: string | undefined }> = [];

const owe = handler({
  name: "owe",
  inputSchema: z.object({ inMs: z.number() }),
  outputSchema: z.any(),
  execute: async (input, ctx) => ({
    offered: ctx.requestHost?.wakes !== undefined,
    owed: (await ctx.requestHost?.wakes?.owe({ entry: "pass", dueAt: Date.now() + input.inMs })) ?? false
  })
});

const pass = handler({
  name: "pass",
  inputSchema: z.object({}).passthrough(),
  outputSchema: z.any(),
  execute: async (_input, ctx) => {
    ran.push({ sessionId: ctx.session.identity.id, userId: ctx.session.identity.userId });
    const wakes = ctx.requestHost?.wakes;
    const read = await wakes?.read("pass");
    if (wakes !== undefined && read !== undefined) await wakes.settle("pass", { ...read, landBy: 0 }, null);
    return {};
  }
});

const flow = defineFlow({
  kind: "wakes",
  actions: { owe: { block: owe } },
  internal: { actions: { pass: { block: pass } } }
})({ id: "wakes" });

const states: Array<{ dispose(): Promise<void> }> = [];
afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose();
  ran.length = 0;
});

async function host(durable: boolean) {
  const state = createFlowState({
    flows: { wakes: flow },
    stores: { default: { primary: inMemoryStores() } },
    durable
  });
  states.push(state);
  await state.getRouter();
  const runtime = await state.getRuntime();
  const call = async (inMs: number) =>
    (
      await runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "owe",
        input: { inMs },
        userId: "u1",
        sessionId: "s1",
        stores: runtime.stores,
        runtimeConfig: runtime.runtimeConfig
      })
    ).output as { offered: boolean; owed: boolean };
  return { runtime, call };
}

describe("a wake fires its entry", () => {
  it("in its session, as its owner, at its due time, and the pass clears it", async () => {
    const { runtime, call } = await host(true);
    expect(await call(300)).toEqual({ offered: true, owed: true });
    await sleep(150);
    expect(ran).toEqual([]);
    await sleep(1_500);
    expect(ran).toHaveLength(1);
    expect(ran[0]).toMatchObject({ sessionId: "s1", userId: "u1" });
    expect(await runtime.stores.wakes!.get({ sessionId: "s1", entry: "pass" })).toBeNull();
  });

  it("is not offered on a host without durable execution", async () => {
    const { call } = await host(false);
    expect(await call(300)).toEqual({ offered: false, owed: false });
  });
});
