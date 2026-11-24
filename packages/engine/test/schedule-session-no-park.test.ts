// FIX-2886.
/**
 * A fire in its schedule's own session never parks.
 *
 * A parked request leaves the active registry, so the schedule's overlap check
 * lets the next fire start in the same session. Anything that later continued
 * the parked fire (an answer, a stop, a waited-on child ending, the sweep's
 * re-drive) would run it beside that fire. So the stop is refused when it is
 * asked for, before any gate is written, and the fire gets no waits, so a wait
 * refuses before it starts any work. The same flow in any other session parks
 * as usual: that is the control.
 */
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { requestHostOf } from "@flow-state-dev/core/internal";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFlowRegistry, runAction } from "../src";
import { createInMemoryStores } from "../src/host";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { createWaitResumeOperation } from "../src/context/wait-resume-operation";
import { scheduleSessionId } from "../src/transports/scheduled/schedule-session-id";
import type { RuntimeConfig } from "../src/runtime-config";

const USER = "u1";

/** A flow whose action notes whether it was given waits, then stops for the user. */
function askingFlow(seen: { waits?: boolean }): FlowInstance {
  const ask = handler({
    name: "ask",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) => {
      seen.waits = requestHostOf(ctx)?.waits !== undefined;
      return ctx.suspendForUser({ kind: "review", prompt: "Look at this." } as never);
    }
  });
  return defineFlow({ kind: "asking", actions: { run: { block: ask, inputSchema: z.object({}).passthrough() } } })({ id: "asking" });
}

async function fire(sessionId: string) {
  const seen: { waits?: boolean } = {};
  const flow = askingFlow(seen);
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider(stores);
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const runtimeConfig: RuntimeConfig = {
    durabilityProvider: provider,
    requestHost: {
      waitResume: createWaitResumeOperation({ provider, stores, continueRequest: (() => undefined) as never }),
      wakes: { maxDebtAgeMs: 86_400_000 },
      waits: { provider, deadlines: { defaultMs: 300_000, minMs: 1_000, maxMs: 86_400_000 } }
    } as never
  };
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: {},
    userId: USER,
    sessionId,
    stores,
    runtimeConfig
  });
  const record = await stores.request.get(result.requestId!);
  const gates = (await provider.listSuspended({ status: "pending" })).filter((s) => s.requestId === result.requestId);
  return { seen, record, gates };
}

describe("a fire in its schedule's own session", () => {
  it("is refused a stop before any gate is written, and is given no waits", async () => {
    const session = scheduleSessionId({ orgId: DEFAULT_ORG_ID, userId: USER, flowId: "asking", scheduleId: "nightly" });
    const { seen, record, gates } = await fire(session);
    expect(seen.waits).toBe(false);
    expect(record?.status).toBe("failed");
    expect(record?.result?.error?.message).toMatch(/schedule's own session can't stop or wait.*per-fire/);
    expect(gates).toHaveLength(0);
  });

  it("control: the same flow in an ordinary session is given waits and parks", async () => {
    const { seen, record, gates } = await fire("s1");
    expect(seen.waits).toBe(true);
    expect(record?.status).toBe("suspended");
    expect(gates).toHaveLength(1);
  });
});
