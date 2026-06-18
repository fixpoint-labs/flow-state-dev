/**
 * Spec-stage durable cycle tests, driven through the real runtime (runAction +
 * in-memory stores + checkpoint durability provider), mirroring
 * packages/server/test/suspension-resume.test.ts.
 *
 * The load-bearing behavior is the three-phase cycle of a sequencer with two
 * single-suspend steps:
 *   1. initial run dispatches (once) and suspends on external_event (park);
 *   2. resuming the park proceeds to and suspends on human_approval (gate);
 *   3. approving the gate runs the transition tap and returns the GateResult.
 * Plus the reject path, which bounces the issue back to In Spec Dev.
 */
import { describe, expect, it, vi } from "vitest";
import {
  continueRequest,
  createFlowRegistry,
  createInMemoryStores,
  runAction,
} from "@flow-state-dev/server";
import { createCheckpointDurabilityProvider } from "@flow-state-dev/server";
import type { DurabilityProvider } from "@flow-state-dev/server";
import type { FlowInstance, SuspensionRecord } from "@flow-state-dev/core/types";
import type { StoreRegistry } from "@flow-state-dev/server";
import type { ResolveClaudeCli } from "@flow-state-dev/claude-code/cli";
import { buildDevOrchestratorFlow } from "../../src/flow/flow";
import { orchestratorRuntimeConfig } from "../../src/flow/runtime-config";
import { LinearStatusClient, type LinearTransport } from "../../src/signals/linear";
import type { CompletionSignal } from "../../src/types";

function durableStores() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases,
  });
  return { stores, provider };
}

/** Fake Linear client recording transitions + comments. */
function fakeLinear(initial: string) {
  let state = initial;
  const comments: string[] = [];
  const transitions: string[] = [];
  const transport: LinearTransport = {
    getIssueState: async () => state,
    setIssueState: async (_id, s) => {
      transitions.push(s);
      state = s;
    },
    comment: async (_id, body) => {
      comments.push(body);
    },
  };
  return { client: new LinearStatusClient(transport), comments, transitions, getState: () => state };
}

/** A `claude` resolver stub that records each dispatch and returns canned output. */
function fakeResolveClaudeCli() {
  const exec = vi.fn(async () => ({
    stdout: "Dispatched: https://claude.ai/code/session_test",
    stderr: "",
    code: 0,
  }));
  const resolve: ResolveClaudeCli = () => ({ bin: "claude", exec });
  return { resolve, exec };
}

const signal: CompletionSignal = {
  kind: "linear-state",
  observedState: "In Spec Review",
  detail: "reached In Spec Review",
};

/** Mark a suspension resolved and re-enter the same request (continueRequest). */
async function resolve(
  flow: FlowInstance,
  stores: StoreRegistry,
  provider: DurabilityProvider,
  requestId: string,
  suspension: SuspensionRecord,
  action: "approve" | "reject",
  data?: unknown,
) {
  await provider.suspend({
    ...suspension,
    status: action === "approve" ? "approved" : "rejected",
    resolvedAt: Date.now(),
    resumeData: data,
  });
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const { finished } = await continueRequest({
    requestId,
    stores,
    flowRegistry: registry,
    resumeContext: { suspensionId: suspension.suspensionId, action, data, resumedBy: "orchestrator" },
    runtimeConfig: orchestratorRuntimeConfig(provider),
  });
  return finished;
}

describe("spec stage — three-phase durable cycle", () => {
  it("dispatches once, parks, resumes to the gate, then completes on approve", async () => {
    const linear = fakeLinear("Ready to Spec");
    const claude = fakeResolveClaudeCli();
    const flow = buildDevOrchestratorFlow({
      linear: linear.client,
      repoRoot: "/repo",
      resolveClaudeCli: claude.resolve,
    });
    const { stores, provider } = durableStores();

    // Phase 1: initial run → dispatches and suspends on the park (external_event).
    const initial = await runAction({
      flow,
      actionName: "spec",
      input: { issueId: "FIX-1", skipDispatch: false },
      userId: "orchestrator",
      sessionId: "orchestrator:FIX-1",
      stores,
      runtimeConfig: orchestratorRuntimeConfig(provider),
    });
    expect(initial.output).toBeUndefined();
    expect(claude.exec).toHaveBeenCalledTimes(1);
    const dispatchItem = initial.items.find((i) => i.type === "status");
    expect(dispatchItem).toBeDefined();

    const parked = (await provider.listSuspended({ status: "pending" }))[0];
    expect(parked.reason).toBe("external_event");
    expect((parked.data as { watch?: { target?: string } }).watch?.target).toBe("In Spec Review");

    // Phase 2: resume the park with the observed signal → suspends on the gate.
    const afterPark = await resolve(flow, stores, provider, initial.requestId!, parked, "approve", signal);
    const parkResult = await afterPark;
    expect(parkResult.output).toBeUndefined();
    const gate = (await provider.listSuspended({ status: "pending" }))[0];
    expect(gate.reason).toBe("human_approval");
    expect(gate.suspensionId).not.toBe(parked.suspensionId);

    // Phase 3: approve the gate → transition tap runs → returns the GateResult.
    const afterGate = await resolve(flow, stores, provider, initial.requestId!, gate, "approve", {
      note: "looks good",
    });
    const final = await afterGate;
    expect(final.output).toMatchObject({ gate: "approved", note: "looks good" });
    // Q4: approve only records (comments); it does not write Spec Approved itself.
    expect(linear.transitions).toEqual([]);
    expect(linear.comments.some((c) => c.includes("Spec approved"))).toBe(true);
    // Dispatch was never re-run across the two resumes (checkpoint replay).
    expect(claude.exec).toHaveBeenCalledTimes(1);
  });

  it("bounces the issue to In Spec Dev when the spec gate is rejected", async () => {
    const linear = fakeLinear("In Spec Review");
    const claude = fakeResolveClaudeCli();
    const flow = buildDevOrchestratorFlow({
      linear: linear.client,
      repoRoot: "/repo",
      resolveClaudeCli: claude.resolve,
    });
    const { stores, provider } = durableStores();

    const initial = await runAction({
      flow,
      actionName: "spec",
      input: { issueId: "FIX-2", skipDispatch: false },
      userId: "orchestrator",
      sessionId: "orchestrator:FIX-2",
      stores,
      runtimeConfig: orchestratorRuntimeConfig(provider),
    });
    const parked = (await provider.listSuspended({ status: "pending" }))[0];
    await (await resolve(flow, stores, provider, initial.requestId!, parked, "approve", signal));
    const gate = (await provider.listSuspended({ status: "pending" }))[0];

    const final = await (await resolve(flow, stores, provider, initial.requestId!, gate, "reject", {
      note: "needs more detail",
    }));
    expect(final.output).toMatchObject({ gate: "rejected" });
    expect(linear.transitions).toEqual(["In Spec Dev"]);
    expect(linear.comments.some((c) => c.includes("Spec rejected"))).toBe(true);
  });
});

describe("spec stage — skipDispatch", () => {
  it("skips the dispatch entirely when entering with the agent already running", async () => {
    const linear = fakeLinear("In Spec Dev");
    const claude = fakeResolveClaudeCli();
    const flow = buildDevOrchestratorFlow({
      linear: linear.client,
      repoRoot: "/repo",
      resolveClaudeCli: claude.resolve,
    });
    const { stores, provider } = durableStores();

    const initial = await runAction({
      flow,
      actionName: "spec",
      input: { issueId: "FIX-3", skipDispatch: true },
      userId: "orchestrator",
      sessionId: "orchestrator:FIX-3",
      stores,
      runtimeConfig: orchestratorRuntimeConfig(provider),
    });
    // No dispatch; suspended directly on the park step.
    expect(claude.exec).not.toHaveBeenCalled();
    const parked = (await provider.listSuspended({ status: "pending" }))[0];
    expect(parked.reason).toBe("external_event");
  });
});
