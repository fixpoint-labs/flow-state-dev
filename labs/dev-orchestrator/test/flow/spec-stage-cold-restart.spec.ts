/**
 * Spec-stage durable cycle across a COLD RESTART.
 *
 * Reproduces the dev-orchestrator infinite-loop incident: the spec stage parks
 * at gate 1 (external_event, "wait for In Spec Review"), advances to gate 2
 * (human_approval), the babysit process dies (a transient `fetch failed`), and a
 * fresh process resumes gate 2. With the real SQLite store and a brand-new store
 * registry on the same file — no in-memory continuation state — resuming gate 2
 * must complete the stage, not re-suspend back at gate 1.
 *
 * Mirrors spec-stage.spec.ts but swaps the single warm in-memory registry for a
 * close-then-reopen on a temp SQLite file between the two resumes.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  continueRequest,
  createCheckpointDurabilityProvider,
  createFlowRegistry,
  runAction,
} from "@flow-state-dev/server";
import type { DurabilityProvider, StoreRegistry } from "@flow-state-dev/server";
import type { FlowInstance, SuspensionRecord } from "@flow-state-dev/core/types";
import type { ResolveClaudeCli } from "@flow-state-dev/claude-code/cli";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { buildDevOrchestratorFlow } from "../../src/flow/flow";
import { orchestratorRuntimeConfig } from "../../src/flow/runtime-config";
import { LinearStatusClient, type LinearTransport } from "../../src/signals/linear";
import type { CompletionSignal } from "../../src/types";

function providerFor(stores: StoreRegistry): DurabilityProvider {
  return createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases,
  });
}

function fakeLinear(initial: string) {
  let state = initial;
  const transport: LinearTransport = {
    getIssueState: async () => state,
    setIssueState: async (_id, s) => {
      state = s;
    },
    comment: async () => {},
  };
  return { client: new LinearStatusClient(transport), set: (s: string) => (state = s) };
}

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

describe("spec stage — cold restart between the park and the gate", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
      dir = undefined;
    }
  });

  it("completes when the human-approval gate is resumed under a fresh registry", async () => {
    dir = mkdtempSync(join(tmpdir(), "fsd-spec-restart-"));
    const filename = join(dir, "FIX-X.db");
    const sessionId = "orchestrator:FIX-X";

    // --- Process 1: dispatch → park, then resume the park → human gate. ---
    const storesA = createSQLiteStores({ filename });
    const providerA = providerFor(storesA);
    const linearA = fakeLinear("Ready to Spec");
    const claudeA = fakeResolveClaudeCli();
    const flowA = buildDevOrchestratorFlow({
      linear: linearA.client,
      repoRoot: "/repo",
      resolveClaudeCli: claudeA.resolve,
    });

    const initial = await runAction({
      flow: flowA,
      actionName: "spec",
      input: { issueId: "FIX-X", skipDispatch: false },
      userId: "orchestrator",
      sessionId,
      stores: storesA,
      runtimeConfig: orchestratorRuntimeConfig(providerA),
    });
    const requestId = initial.requestId!;
    const parked = (await providerA.listSuspended({ status: "pending" }))[0];
    expect(parked.reason).toBe("external_event");

    await (await resolve(flowA, storesA, providerA, requestId, parked, "approve", signal));
    const gate = (await providerA.listSuspended({ status: "pending" }))[0];
    expect(gate.reason).toBe("human_approval");
    const gateId = gate.suspensionId;

    // Simulate the process crash — drop every handle to the db.
    storesA.close();

    // --- Process 2 (cold restart): fresh registry + flow on the same file. ---
    const storesB = createSQLiteStores({ filename });
    const providerB = providerFor(storesB);
    const linearB = fakeLinear("Spec Approved"); // the human advanced the board
    const claudeB = fakeResolveClaudeCli();
    const flowB = buildDevOrchestratorFlow({
      linear: linearB.client,
      repoRoot: "/repo",
      resolveClaudeCli: claudeB.resolve,
    });

    const [reloadedGate] = await providerB.listSuspended({ status: "pending" });
    expect(reloadedGate?.suspensionId).toBe(gateId);
    expect(reloadedGate?.reason).toBe("human_approval");

    // Approving the gate must replay gate 1 as resolved and COMPLETE — not
    // re-suspend at the external_event park.
    const final = await (await resolve(flowB, storesB, providerB, requestId, reloadedGate, "approve", {
      note: "ok",
    }));
    expect(final.output).toMatchObject({ gate: "approved", note: "ok" });
    expect((await storesB.request.get(requestId))?.status).toBe("completed");
    // The dispatch never re-ran in the second process (no extra cloud task).
    expect(claudeB.exec).not.toHaveBeenCalled();

    storesB.close();
  });
});
