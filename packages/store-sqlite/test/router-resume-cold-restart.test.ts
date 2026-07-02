/**
 * FIX-814 (router half) on the SQLite adapter: a suspension inside a router's
 * chosen branch resumes across a COLD RESTART (fresh store registry on the
 * same file) — the same branch continues, its completed descendant replays
 * from the durable log instead of re-executing, and the recorded
 * `router_decision` validates the re-run selection.
 *
 * The in-memory-store coverage for these behaviors lives in
 * `packages/engine/test/router-resume.test.ts`; this pins the durable-adapter
 * half of the "holds across store adapters" outcome.
 */
import { defineFlow, handler, router, sequencer } from "@flow-state-dev/core";
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
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const { finished } = await continueRequest({
    requestId,
    stores,
    flowRegistry: registry,
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

describe("router branch resume across a cold restart (SQLite)", () => {
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

  it("continues the same branch under a fresh registry and replays the completed descendant", async () => {
    dir = mkdtempSync(join(tmpdir(), "fsd-router-resume-"));
    const filename = join(dir, "request.db");

    const runs = { stepA: 0, after: 0 };
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
      execute: async (_input, ctx) =>
        ctx.suspend!({ reason: "human_approval", message: "continue branch A?" })
    });
    const after = handler({
      name: "after",
      inputSchema: z.any(),
      outputSchema: z.string(),
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
    const decide = router({
      name: "decide",
      routes: [branchA, branchB],
      execute: (input: { which: string }) => (input.which === "a" ? branchA : branchB)
    });
    const flow = defineFlow({
      kind: "fix814-router-restart",
      actions: {
        run: {
          block: sequencer({ name: "root", durable: true }).step(decide),
          inputSchema: z.object({ which: z.string() })
        }
      }
    })({ id: "fix814-router-restart" });

    // Process 1: run to the suspension inside branch A.
    const storesA = createSQLiteStores({ filename });
    const providerA = providerFor(storesA);
    const initial = await runAction({
      flow,
      actionName: "run",
      input: { which: "a" },
      userId: "u1",
      stores: storesA,
      runtimeConfig: { durabilityProvider: providerA }
    });
    const requestId = initial.requestId!;
    expect((await storesA.request.get(requestId))?.status).toBe("suspended");
    expect(runs.stepA).toBe(1);

    // The decision anchor persisted with the suspended record.
    const suspendedRecord = await storesA.request.get(requestId);
    const decision = (suspendedRecord!.items ?? []).find((i) => i.type === "router_decision") as any;
    expect(decision?.selectedRoute).toBe("branchA");

    // Simulate process exit — drop every in-memory handle to the db.
    storesA.close();

    // Process 2 (cold restart): fresh registry on the SAME file.
    const storesB = createSQLiteStores({ filename });
    const providerB = providerFor(storesB);
    const [suspension] = await providerB.listSuspended({ status: "pending" });
    expect(suspension).toBeDefined();

    const resumed = await approve(flow, storesB, providerB, requestId, suspension);

    expect(resumed.error).toBeUndefined();
    expect(resumed.output).toBe("A-final");
    // Completed descendant replayed from the durable log, not re-executed.
    expect(runs.stepA).toBe(1);
    expect(runs.after).toBe(1);
    expect((await storesB.request.get(requestId))?.status).toBe("completed");
    storesB.close();
  });
});
