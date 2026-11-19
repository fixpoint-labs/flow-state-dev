/**
 * A request whose start fails ends `failed` (FIX-2849).
 *
 * Why it matters: a request left `in_progress` after its `onStarted` threw is
 * found by the stale sweep, marked interrupted, and brings its session's wakes
 * forward. A session whose every turn is refused at start (a fired worker's)
 * then starts a new request each time a wake fires, forever. A refused start is
 * terminal: nothing is left open for the sweep to pull a wake forward for.
 */
import { DEFAULT_ORG_ID, defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { SuspensionRecord } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { continueRequest, createFlowRegistry, runAction } from "../src";
import { createInMemoryStores } from "../src/host";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";

describe("a request whose start fails", () => {
  it("is recorded failed, with the startup error, never left in_progress", async () => {
    const refuse = handler({
      name: "refuse",
      inputSchema: z.any(),
      execute: async () => {
        throw new Error("this turn can't run");
      }
    });
    const flow = defineFlow({
      kind: "startup-refused",
      request: { onStarted: refuse },
      actions: { run: { inputSchema: z.object({}), block: handler({ name: "noop", inputSchema: z.any(), execute: async () => ({}) }) } }
    })({ id: "startup-refused" });
    const stores = createInMemoryStores();

    await expect(
      runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: {}, userId: "u1", sessionId: "s1", stores, runtimeConfig: {} })
    ).rejects.toThrow("this turn can't run");

    const records = await stores.request.list();
    expect(records.map((record) => record.status)).toEqual(["failed"]);
    expect(JSON.stringify(records[0]!.result)).toContain("this turn can't run");
    // Nothing left registered for the stale sweep to find.
    expect(await stores.activeRequests.listAll()).toEqual([]);
  });
});

describe("a resumed request whose start fails", () => {
  /**
   * Park a request on an approval, approve it, and resume it with an
   * `onStarted` that throws `error` on the resumed run only. The record's
   * status once the resume has ended.
   */
  async function resumeFailingWith(error: Error): Promise<string | undefined> {
    let runs = 0;
    const start = handler({
      name: "start",
      inputSchema: z.any(),
      execute: async () => {
        runs += 1;
        if (runs > 1) throw error;
        return {};
      }
    });
    const gate = handler({
      name: "approve",
      inputSchema: z.any(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (_input, ctx) => {
        await ctx.suspend!({ reason: "approval", message: "Go?" });
        return { ok: true };
      }
    });
    const flow = defineFlow({
      kind: "startup-refused-replay",
      request: { onStarted: start },
      actions: { run: { inputSchema: z.object({}), block: sequencer({ name: "seq", durable: true }).step(gate) } }
    })({ id: "startup-refused-replay" });
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({ checkpoints: stores.checkpoints, suspensions: stores.suspensions, leases: stores.leases });
    const initial = await runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: {}, userId: "u1", sessionId: "s1", stores, runtimeConfig: { durabilityProvider: provider } });
    const [suspension] = (await provider.listSuspended({ status: "pending" })) as SuspensionRecord[];
    await provider.suspend({ ...suspension!, status: "approved", resolvedAt: Date.now(), resumeData: {} });
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const { finished } = await continueRequest({
      requestId: initial.requestId!,
      stores,
      flowRegistry: registry,
      resumeContext: { suspensionId: suspension!.suspensionId, action: "approve", data: {}, resumedBy: "reviewer" },
      runtimeConfig: { durabilityProvider: provider }
    });
    await finished.catch(() => undefined);
    expect(runs).toBe(2);
    return (await stores.request.get(initial.requestId!))?.status;
  }

  it("is left for the stale sweep to re-drive when the failure may pass", async () => {
    // A transient failure at a resumed run's start is retried, as before.
    expect(await resumeFailingWith(new Error("store unavailable"))).not.toBe("failed");
  });

  it("ends failed when its session refuses every run: re-driven, it would be refused forever", async () => {
    // Why: the sweep re-drives an interrupted request whose gate is resolved.
    // A fired worker's session refuses every start, so a resumed turn left
    // open would be refused, swept, and re-driven without end.
    const refused = Object.assign(new Error('Worker "my.desk" was fired.'), { code: "worker-turn-refused" });
    expect(await resumeFailingWith(refused)).toBe("failed");
  });
});
