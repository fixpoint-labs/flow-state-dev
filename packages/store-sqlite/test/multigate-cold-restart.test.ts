/**
 * Multi-gate durable sequencer resumed across a COLD RESTART (a fresh store
 * registry on the same SQLite file, with no in-memory continuation state).
 *
 * Positive guard for the property the resolved-gate replay fix guarantees:
 * resuming a LATER gate after a restart replays the earlier (already-resolved)
 * gate from the durable suspension/resume log and completes, instead of bouncing
 * back to it. The end-to-end reproduction that actually FAILS without the fix is
 * the dev-orchestrator spec-stage integration test
 * (`labs/dev-orchestrator/.../spec-stage-cold-restart.spec.ts`); the per-method
 * unit coverage is in core `replay-log.test.ts` (`resolvedResumes`). This simple
 * shape passes with or without the fix (its block traces persist as `completed`,
 * so the older completed-trace short-circuit already covers it), so it is kept
 * only as a regression guard on the common case.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { FlowInstance, SuspensionRecord } from "@flow-state-dev/core/types";
import {
  continueRequest,
  createCheckpointDurabilityProvider,
  createFlowRegistry,
  runAction
} from "@flow-state-dev/engine";
import type { DurabilityProvider, StoreRegistry } from "@flow-state-dev/engine";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createSQLiteStores } from "../src/index";

function providerFor(stores: StoreRegistry): DurabilityProvider {
  return createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases
  });
}

async function resolve(
  flow: FlowInstance,
  stores: StoreRegistry,
  provider: DurabilityProvider,
  requestId: string,
  suspension: SuspensionRecord,
  action: "approve" | "reject"
) {
  await provider.suspend({
    ...suspension,
    status: action === "approve" ? "approved" : "rejected",
    resolvedAt: Date.now()
  });
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const { finished } = await continueRequest({
    requestId,
    stores,
    flowRegistry: registry,
    resumeContext: { suspensionId: suspension.suspensionId, action, data: undefined, resumedBy: "reviewer" },
    runtimeConfig: { durabilityProvider: provider }
  });
  return finished;
}

describe("multi-gate sequencer resume across a cold restart", () => {
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

  it("completes when gate B is resumed under a fresh registry on the same file", async () => {
    dir = mkdtempSync(join(tmpdir(), "fsd-multigate-"));
    const filename = join(dir, "request.db");

    const gateA = handler({
      name: "gateA",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) => ctx.suspend!({ reason: "human_approval", message: "Gate A?" })
    });
    const gateB = handler({
      name: "gateB",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) => ctx.suspend!({ reason: "human_approval", message: "Gate B?" })
    });
    const done = handler({
      name: "done",
      inputSchema: z.any(),
      outputSchema: z.string(),
      execute: async () => "both gates passed"
    });
    const flow = defineFlow({
      kind: "multigate-restart",
      actions: {
        run: {
          block: sequencer({ name: "gatesSeq", durable: true }).step(gateA).step(gateB).step(done),
          inputSchema: z.any()
        }
      }
    })({ id: "multigate-restart" });

    // Process 1: run, park at gate A, resolve A, re-suspend at gate B.
    const storesA = createSQLiteStores({ filename });
    const providerA = providerFor(storesA);
    const initial = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      stores: storesA,
      runtimeConfig: { durabilityProvider: providerA }
    });
    const requestId = initial.requestId!;
    const [suspA] = await providerA.listSuspended({ status: "pending" });
    await (await resolve(flow, storesA, providerA, requestId, suspA, "approve"));
    expect((await storesA.request.get(requestId))?.status).toBe("suspended");
    const [suspB] = await providerA.listSuspended({ status: "pending" });
    expect(suspB.suspensionId).not.toBe(suspA.suspensionId);

    // Simulate process exit — drop every in-memory handle to the db.
    storesA.close();

    // Process 2 (cold restart): fresh registry on the SAME file.
    const storesB = createSQLiteStores({ filename });
    const providerB = providerFor(storesB);
    expect((await storesB.request.get(requestId))?.status).toBe("suspended");
    const [reloadedB] = await providerB.listSuspended({ status: "pending" });
    expect(reloadedB?.suspensionId).toBe(suspB.suspensionId);

    const resumed = await (await resolve(flow, storesB, providerB, requestId, reloadedB, "approve"));
    expect(resumed.output).toBe("both gates passed");
    expect((await storesB.request.get(requestId))?.status).toBe("completed");
    storesB.close();
  });
});
