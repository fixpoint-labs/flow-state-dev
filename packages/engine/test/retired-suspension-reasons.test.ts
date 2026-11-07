/**
 * The suspension reasons said `human` through core 0.2.0, which stored them
 * durably. An adopter who upgrades with a stop waiting in the store must still
 * have it answered as a user's stop, and resumed; a new `ctx.suspend` with the
 * old reason must throw, naming the new one, rather than run as a custom reason
 * nothing answers as a user's.
 */
import { DEFAULT_ORG_ID, defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { isUserSuspension, suspendForUserKindOf } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { continueRequest, createFlowRegistry, runAction } from "../src";
import { createInMemoryStores } from "../src/host";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";

/** A flow whose one step stops for `reason`, noting when it finishes and what `ctx.suspend` threw. */
function build(reason: string, finished: string[], thrown: unknown[] = []) {
  const gate = handler({
    name: "gate",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.object({ approved: z.boolean() }),
    execute: async (_input, ctx) => {
      try {
        await ctx.suspend!({ reason, message: "Ship it?" });
      } catch (err) {
        thrown.push(err);
        throw err;
      }
      finished.push(reason);
      return { approved: true };
    },
  });
  return defineFlow({
    kind: "retired-reason",
    actions: { run: { block: sequencer({ name: "seq", durable: true }).step(gate), inputSchema: z.object({}).passthrough() } },
  })({ id: "retired-reason" });
}

function setup() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({ checkpoints: stores.checkpoints, suspensions: stores.suspensions, leases: stores.leases });
  return { stores, provider };
}

describe("a suspension under a retired human_* reason", () => {
  it("a stop stored as human_approval reads as a user's approval, and resumes on the upgraded build", async () => {
    const { stores, provider } = setup();
    const finished: string[] = [];
    // The upgraded build writes user_approval; the record is then rewritten as
    // core 0.2.0 stored it, which is the stop an adopter upgrades with.
    const initial = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: build("user_approval", finished),
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider },
    });
    const requestId = initial.requestId!;
    const [written] = await provider.listSuspended({ status: "pending" });
    const stored = JSON.parse(JSON.stringify({ ...written!, reason: "human_approval" }));
    await provider.suspend(stored);

    const [pending] = await provider.listSuspended({ status: "pending" });
    expect(pending!.reason).toBe("human_approval");
    expect(isUserSuspension(pending!)).toBe(true);
    expect(suspendForUserKindOf(pending!)).toBe("approval");

    await provider.suspend({ ...pending!, status: "approved", resolvedAt: Date.now(), resumeData: { ok: true } });
    const registry = createFlowRegistry();
    registry.register(build("user_approval", finished) as never);
    const continued = await continueRequest({
      requestId,
      stores,
      flowRegistry: registry,
      resumeContext: { suspensionId: pending!.suspensionId, action: "approve", data: { ok: true }, resumedBy: "u1" },
      runtimeConfig: { durabilityProvider: provider },
    });
    await continued.finished;
    expect((await stores.request.get(requestId))?.status).toBe("completed");
    expect(finished).toEqual(["user_approval"]);
  });

  it("a stored human_input stop reads as a user's input", () => {
    expect(isUserSuspension({ reason: "human_input" })).toBe(true);
    expect(suspendForUserKindOf({ reason: "human_input" })).toBe("input");
  });

  it.each([
    ["human_approval", "user_approval"],
    ["human_input", "user_input"],
  ])("a new ctx.suspend with %s throws, naming %s and the removal version, and writes no stop", async (old, replacement) => {
    const { stores, provider } = setup();
    const thrown: unknown[] = [];
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: build(old, [], thrown),
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider },
    });
    expect(thrown).toHaveLength(1);
    expect(thrown[0]).toBeInstanceOf(Error);
    expect((thrown[0] as Error).message).toBe(
      `ctx.suspend: reason "${old}" was renamed. Use "${replacement}".`,
    );
    expect((await stores.request.get(result.requestId!))?.status).toBe("failed");
    expect(await provider.listSuspended({ status: "pending" })).toEqual([]);
  });

  it("a custom reason still suspends: only the retired names are refused", async () => {
    const { stores, provider } = setup();
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: build("my_custom_reason", []),
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider },
    });
    expect((await stores.request.get(result.requestId!))?.status).toBe("suspended");
  });
});
