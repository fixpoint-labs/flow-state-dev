/**
 * FIX-814 (router half): resume for the router primitive — a suspension inside
 * a router's chosen branch continues the SAME branch on resume, completed work
 * inside that branch is not re-executed, and a decision that can't be honored
 * fails loudly instead of silently re-routing.
 *
 * These tests drive the real runAction → suspend → continueRequest path with
 * in-memory stores, mirroring the FIX-811 suspension-resume suite.
 */
import { defineFlow, handler, router, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import type { DurabilityProvider } from "../src/durability/types";
import type { StoreRegistry } from "../src/stores/types";
import type { FlowInstance, SuspensionRecord } from "@flow-state-dev/core/types";

function createDurableStores() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases
  });
  return { stores, provider };
}

function registryFor(flow: FlowInstance) {
  const registry = createFlowRegistry();
  registry.register(flow as never);
  return registry;
}

/** Approve a pending suspension and continue the request to its next terminal state. */
async function approve(
  flow: FlowInstance,
  stores: StoreRegistry,
  provider: DurabilityProvider,
  requestId: string,
  suspension: SuspensionRecord
) {
  await provider.suspend({
    ...suspension,
    status: "approved",
    resolvedAt: Date.now(),
    resumeData: { approved: true }
  });
  const { finished } = await continueRequest({
    requestId,
    stores,
    flowRegistry: registryFor(flow),
    resumeContext: {
      suspensionId: suspension.suspensionId,
      action: "approve",
      data: { approved: true },
      resumedBy: "reviewer"
    },
    runtimeConfig: { durabilityProvider: provider }
  });
  return finished;
}

/** A branch whose middle step suspends, with side-effect counters on both sides. */
function buildSuspendingBranchFixture() {
  const runs = { stepA: 0, gate: 0, after: 0, decisions: 0 };

  const stepA = handler({
    name: "stepA",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async () => {
      runs.stepA += 1;
      return "A-output";
    }
  });
  const gate = handler({
    name: "gate",
    inputSchema: z.any(),
    outputSchema: z.unknown(),
    execute: async (_input, ctx) => {
      runs.gate += 1;
      return ctx.suspend!({ reason: "human_approval", message: "continue branch A?" });
    }
  });
  const after = handler({
    name: "after",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async () => {
      runs.after += 1;
      return "A-final";
    }
  });

  const branchA = sequencer({ name: "branchA" }).step(stepA).step(gate).step(after);
  const branchB = handler({
    name: "branchB",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async () => "B-final"
  });

  return { runs, branchA, branchB };
}

describe("router branch suspends → resume continues the same branch (FIX-814)", () => {
  it("continues branch A, does not re-execute its completed descendant, and does not re-decide", async () => {
    const { runs, branchA, branchB } = buildSuspendingBranchFixture();

    const decide = router({
      name: "decide",
      routes: [branchA, branchB],
      execute: (input: { which: string }) => {
        runs.decisions += 1;
        return input.which === "a" ? branchA : branchB;
      }
    });

    const flow = defineFlow({
      kind: "fix814-router-resume",
      actions: {
        run: {
          block: sequencer({ name: "root", durable: true }).step(decide),
          inputSchema: z.object({ which: z.string() })
        }
      }
    })();

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "run",
      input: { which: "a" },
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });

    const requestId = initial.requestId!;
    expect((await stores.request.get(requestId))?.status).toBe("suspended");
    expect(runs.stepA).toBe(1);

    // The decision anchor is durable in the suspended record's item log BEFORE
    // the branch suspension — the router awaited the router_decision write.
    const suspendedRecord = await stores.request.get(requestId);
    const decisionItems = (suspendedRecord!.items ?? []).filter((i) => i.type === "router_decision") as any[];
    expect(decisionItems.length).toBe(1);
    expect(decisionItems[0].selectedRoute).toBe("branchA");

    const [suspension] = await provider.listSuspended({ status: "pending" });
    const resumed = await approve(flow, stores, provider, requestId, suspension);

    expect(resumed.error).toBeUndefined();
    expect(resumed.output).toBe("A-final");
    expect(resumed.requestId).toBe(requestId);

    // Same branch continued; completed descendant memoized, not re-executed.
    expect(runs.stepA).toBe(1);
    expect(runs.after).toBe(1);
    // The selector re-ran on resume (pure re-decision, validated against the
    // recorded router_decision).
    expect(runs.decisions).toBe(2);
  });

  it("resumes a branch that suspends immediately after selection (decision-write race)", async () => {
    const gate = handler({
      name: "immediateGate",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) =>
        ctx.suspend!({ reason: "human_approval", message: "proceed?" })
    });
    const other = handler({
      name: "other",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => "other"
    });

    const decide = router({
      name: "decide",
      routes: [gate, other],
      execute: () => gate
    });

    const flow = defineFlow({
      kind: "fix814-router-immediate-suspend",
      actions: {
        run: {
          block: sequencer({ name: "root", durable: true }).step(decide),
          inputSchema: z.any()
        }
      }
    })();

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;

    // The race this pins: the suspension must not persist before its
    // router_decision anchor.
    const record = await stores.request.get(requestId);
    const items = record!.items ?? [];
    const decisionIndex = items.findIndex((i) => i.type === "router_decision");
    const suspensionIndex = items.findIndex((i) => i.type === "suspension");
    expect(decisionIndex).toBeGreaterThanOrEqual(0);
    expect(suspensionIndex).toBeGreaterThanOrEqual(0);
    expect(decisionIndex).toBeLessThan(suspensionIndex);

    const [suspension] = await provider.listSuspended({ status: "pending" });
    const resumed = await approve(flow, stores, provider, requestId, suspension);
    expect(resumed.error).toBeUndefined();
    expect(resumed.output).toEqual({ approved: true });
  });

  it("preserves a per-call connectInput wrapper's mapping across the suspend boundary", async () => {
    const target = handler({
      name: "target",
      inputSchema: z.object({ doubled: z.number() }),
      outputSchema: z.any(),
      execute: async (input, ctx) => {
        const decision = await ctx.suspend!({ reason: "human_approval", message: "ok?" });
        return { seen: input.doubled, decision };
      }
    });
    const other = handler({
      name: "other",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => "other"
    });

    const decide = router({
      name: "decide",
      routes: [target, other],
      // The wrapper (and its input mapping) is constructed per call; resume
      // re-runs `execute` so the mapping is rebuilt, then validates the
      // selection by route name.
      execute: () => target.connectInput((input: { n: number }) => ({ doubled: input.n * 2 }))
    });

    const flow = defineFlow({
      kind: "fix814-router-wrapped-route",
      actions: {
        run: {
          block: sequencer({ name: "root", durable: true }).step(decide),
          inputSchema: z.object({ n: z.number() })
        }
      }
    })();

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "run",
      input: { n: 21 },
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;
    expect((await stores.request.get(requestId))?.status).toBe("suspended");

    const [suspension] = await provider.listSuspended({ status: "pending" });
    const resumed = await approve(flow, stores, provider, requestId, suspension);

    expect(resumed.error).toBeUndefined();
    expect(resumed.output).toEqual({ seen: 42, decision: { approved: true } });
  });
});

describe("router decision cannot be honored on resume (FIX-814)", () => {
  it("fails with ROUTE_UNAVAILABLE when a non-deterministic selector re-decides differently", async () => {
    const { branchA, branchB } = buildSuspendingBranchFixture();

    // Deliberately impure selector: reads mutable module state. First run
    // picks branch A (which suspends); the state flips before resume, so the
    // re-run selector picks branch B — a contract violation that must be
    // fatal, never a silent branch switch.
    const selectorState = { which: "a" };
    const decide = router({
      name: "decide",
      routes: [branchA, branchB],
      execute: () => (selectorState.which === "a" ? branchA : branchB)
    });

    const flow = defineFlow({
      kind: "fix814-router-redecide",
      actions: {
        run: {
          block: sequencer({ name: "root", durable: true }).step(decide),
          inputSchema: z.any()
        }
      }
    })();

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;
    expect((await stores.request.get(requestId))?.status).toBe("suspended");

    selectorState.which = "b";

    const [suspension] = await provider.listSuspended({ status: "pending" });
    const resumed = await approve(flow, stores, provider, requestId, suspension);

    expect(resumed.error).toBeDefined();
    expect(resumed.error?.message).toMatch(/cannot resume/);
    expect(resumed.error?.message).toMatch(/branchA/);
    expect((await stores.request.get(requestId))?.status).toBe("failed");
  });

  it("fails the same way when the router is the ROOT action block (no wrapping sequencer)", async () => {
    const runs = { a: 0, b: 0 };
    const branchA = handler({
      name: "branchA",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) => {
        runs.a += 1;
        return ctx.suspend!({ reason: "human_approval", message: "A?" });
      }
    });
    const branchB = handler({
      name: "branchB",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => {
        runs.b += 1;
        return "B";
      }
    });
    const selectorState = { which: "a" };
    const decide = router({
      name: "decide",
      routes: [branchA, branchB],
      execute: () => (selectorState.which === "a" ? branchA : branchB)
    });
    const flow = defineFlow({
      kind: "fix814-root-router-redecide",
      actions: { run: { block: decide, inputSchema: z.any() } }
    })();

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;
    expect((await stores.request.get(requestId))?.status).toBe("suspended");

    selectorState.which = "b";

    const [suspension] = await provider.listSuspended({ status: "pending" });
    const resumed = await approve(flow, stores, provider, requestId, suspension);

    // Never a silent branch switch, in the root-router topology too.
    expect(resumed.error).toBeDefined();
    expect(resumed.error?.message).toMatch(/cannot resume/);
    expect(runs.b).toBe(0);
    expect(runs.a).toBe(1);
  });
});
