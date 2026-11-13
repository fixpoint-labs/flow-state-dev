// FIX-2536.
/**
 * `serve()`'s schedule tick: a flow whose `schedules.index` is set
 * has its due entries claimed each minute by the server that serves it.
 *
 * Why these matter: a long-lived host has no cron of its own, so this tick is
 * what fires the flow's schedules (subscription polls, clock routines). And a
 * server that failed to bind (a port already in use) must start nothing: a
 * tick left running there has no handle to stop it, and claims schedules another
 * process should fire.
 */
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { serve, type ServeHandle } from "../src/serve";

const handles: ServeHandle[] = [];
const blockers: Server[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
  await Promise.all(blockers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

/** A flow with a schedule index whose claims are counted. */
function scheduledApp() {
  const claims: number[] = [];
  const flow = defineFlow({
    kind: "ticked",
    actions: {
      noop: handler({ name: "ticked-noop", inputSchema: z.object({}), execute: () => ({}) })
    },
    schedules: { index: { claimDue: async (now: number) => (claims.push(now), []) } }
  })();
  return { claims, flowState: createFlowState({ flows: [flow], stores: { default: { primary: inMemoryStores() } } }) };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("serve() ticks a flow's schedule index", () => {
  it("claims due entries each minute once it is listening", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { claims, flowState } = scheduledApp();
    handles.push(await serve(flowState, { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 100 }));
    await flowState.getRuntime();
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(claims).toHaveLength(1);
  });

  it("closes within its shutdown grace while a tick is stalled in its claim", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let claims = 0;
    const flow = defineFlow({
      kind: "stalled",
      actions: { noop: handler({ name: "stalled-noop", inputSchema: z.object({}), execute: () => ({}) }) },
      // A store that stopped answering: the claim never settles.
      schedules: { index: { claimDue: () => ((claims += 1), new Promise<never>(() => undefined)) } }
    })();
    const flowState = createFlowState({ flows: [flow], stores: { default: { primary: inMemoryStores() } } });
    const handle = await serve(flowState, { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 10 });
    await flowState.getRuntime();
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(claims).toBe(1);
    const started = Date.now();
    const closed = await Promise.race([handle.close().then(() => "closed"), new Promise((resolve) => setTimeout(() => resolve("hung"), 2_000))]);
    expect(closed).toBe("closed");
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("starts no tick when the port is already in use", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const blocker = createServer();
    blockers.push(blocker);
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const port = (blocker.address() as { port: number }).port;
    const { claims, flowState } = scheduledApp();
    await expect(serve(flowState, { port, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 100 })).rejects.toThrow();
    await flowState.getRuntime();
    await settle();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(claims).toEqual([]);
    await flowState.dispose();
  });
});
