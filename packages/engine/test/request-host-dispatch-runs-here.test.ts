/**
 * `RequestHost.dispatchRunsHere` (FIX-2078): whether what a request dispatches
 * runs in this process. A block that keeps process-local bookkeeping about
 * what it dispatched (the conversation board's pass coalescing) relies on it
 * only when true, so a queue-backed host must not say so.
 */
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFlowState, inMemoryStores, runAction } from "../src";

const read = handler({
  name: "read-runs-here",
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: (_input, ctx) => ({ runsHere: ctx.requestHost?.dispatchRunsHere === true })
});
const flow = defineFlow({ kind: "runs-here", actions: { read: { block: read } } })({ id: "runs-here" });

async function readOn(state: ReturnType<typeof createFlowState>) {
  const runtime = await state.getRuntime();
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "read",
    input: {},
    userId: "u1",
    sessionId: "s1",
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig
  });
  return result.output as { runsHere: boolean };
}

describe("RequestHost.dispatchRunsHere", () => {
  it("is true on a host that dispatches in process", async () => {
    const state = createFlowState({ flows: { [flow.id]: flow }, stores: { default: { primary: inMemoryStores() } } });
    try {
      expect(await readOn(state)).toEqual({ runsHere: true });
    } finally {
      await state.dispose();
    }
  });

  it("is not on a host whose dispatcher hands the work to another process", async () => {
    const state = createFlowState({
      flows: { [flow.id]: flow },
      stores: { default: { primary: inMemoryStores() } },
      // A queue's shape: it takes a serializable envelope, and runs nothing here.
      runner: { dispatch: async () => ({ accepted: Promise.resolve(), finished: new Promise(() => {}) }) } as never
    });
    try {
      expect(await readOn(state)).toEqual({ runsHere: false });
    } finally {
      await state.dispose();
    }
  });
});
