import { DEFAULT_ORG_ID, defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { FlowInstance, ResumeContext, SuspensionRecord } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import type { DurabilityProvider } from "../src/durability/types";
import type { StoreRegistry } from "../src/stores/types";

const produce = handler({
  name: "produce",
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: () => ({ files: ["a.ts", "b.ts"] })
});

const approve = handler({
  name: "approve",
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: async (input, ctx) => {
    await ctx.suspend!({ reason: "human_approval", message: "Approve?" });
    return input;
  }
});

async function suspendThenApprove(flow: FlowInstance) {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases
  });
  const runtimeConfig = { durabilityProvider: provider };
  const initial = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: {},
    userId: "u1",
    stores,
    runtimeConfig
  });
  const [suspension] = (await provider.listSuspended({ status: "pending" })) as SuspensionRecord[];
  expect(suspension).toBeDefined();
  await (provider as DurabilityProvider).suspend({ ...suspension!, status: "approved", resolvedAt: Date.now() });
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const resumeContext: ResumeContext = { suspensionId: suspension!.suspensionId, action: "approve" };
  const { finished } = await continueRequest({
    requestId: initial.requestId!,
    stores: stores as StoreRegistry,
    flowRegistry: registry,
    resumeContext,
    runtimeConfig
  });
  return finished;
}

describe("resuming after an .asTool() step", () => {
  it("hands the step's recorded value to the step after the pause", async () => {
    const received: unknown[] = [];
    const consume = handler({
      name: "consume",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (input: unknown) => {
        received.push(input);
        return { count: (input as { files: string[] }).files.length };
      }
    });
    const flow = defineFlow({
      kind: "as-tool-resume",
      actions: {
        run: {
          block: sequencer({ name: "seq", durable: true }).step(produce.asTool()).step(approve).step(consume),
          inputSchema: z.any()
        }
      }
    })({ id: "as-tool-resume" });

    const resumed = await suspendThenApprove(flow);

    expect(resumed.error).toBeUndefined();
    expect(received).toEqual([{ files: ["a.ts", "b.ts"] }]);
    expect(resumed.output).toEqual({ count: 2 });
  });
});
