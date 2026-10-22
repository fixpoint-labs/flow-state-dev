/**
 * Shutdown waits for request-end hooks (FIX-2077), inside the host's drain
 * budget (`shutdownDrainMs`).
 *
 * Why it matters: the claim gate settles a dispatched task in a request-end
 * hook, and that settle writes to the stores. A host that closed its stores
 * while a hook still ran would leave the task running with nobody on it, and
 * log "database connection is not open" on an ordinary shutdown. A request
 * that registered a hook and has not ended yet is waited for too: its hook is
 * still owed.
 */
import { defineFlow, handler, sequencer, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { onRequestEnded } from "@flow-state-dev/core/types";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createFlowState, disposeFlowApiRouter, inMemoryStores, runAction } from "../src";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let workMs = 0;
let hookMs = 0;
let hookStarted = false;
let hookEnded = false;

const flow = defineFlow({
  kind: "request-end-shutdown",
  actions: {
    run: {
      inputSchema: z.any(),
      block: sequencer({ name: "run" })
        .tap(
          handler({
            name: "register",
            inputSchema: z.any(),
            execute: (_input, ctx) => {
              onRequestEnded(ctx, async () => {
                hookStarted = true;
                await sleep(hookMs);
                hookEnded = true;
              });
            }
          })
        )
        .step(handler({ name: "work", inputSchema: z.any(), execute: async () => void (await sleep(workMs)) }))
    }
  }
})({ id: "request-end-shutdown" });

const states: Array<{ dispose(): Promise<void> }> = [];
afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose();
  workMs = 0;
  hookMs = 0;
  hookStarted = false;
  hookEnded = false;
});

async function host() {
  const state = createFlowState({ flows: { "request-end-shutdown": flow }, stores: { default: { primary: inMemoryStores() } } });
  states.push(state);
  await state.getRouter();
  const runtime = await state.getRuntime();
  // Not awaited, as a request the transport started runs on after its response.
  const started = runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: {},
    userId: "u1",
    sessionId: "s1",
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig
  });
  return { state, started };
}

describe("shutdown and request-end hooks", () => {
  it("waits for a hook that is running", async () => {
    hookMs = 500;
    const { state, started } = await host();
    for (let i = 0; i < 100 && !hookStarted; i += 1) await sleep(10);
    expect(hookStarted).toBe(true);

    await states.splice(0)[0]!.dispose();

    expect(hookEnded).toBe(true);
    await started;
    void state;
  });

  it("waits for a request that registered a hook and has not ended yet", async () => {
    workMs = 400;
    const { started } = await host();
    await sleep(50);
    expect(hookStarted).toBe(false);

    await states.splice(0)[0]!.dispose();

    expect(hookEnded).toBe(true);
    await started;
  });

  it("waits only so long: past the drain budget, shutdown goes on", async () => {
    hookMs = 3_000;
    const { state } = await host();
    for (let i = 0; i < 100 && !hookStarted; i += 1) await sleep(10);
    const begun = Date.now();

    await disposeFlowApiRouter((await state.getRouter()) as never, { drainMs: 200 });

    expect(Date.now() - begun).toBeLessThan(5_000);
    expect(hookEnded).toBe(false);
  }, 20_000);
});
