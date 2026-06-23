/**
 * FIX-141 PR 2: durable-completion cleanup wire.
 *
 * Verifies that a non-resumed durable request, on successful completion,
 * cleans up its OWN durability artifacts (suspension records + lease) via
 * `durabilityProvider.cleanup(requestId)` — closing the gap where only the
 * resumed path cleaned up before.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import type { SuspensionRecord } from "@flow-state-dev/core/types";

function createDurableStores() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider(stores);
  return { stores, provider };
}

function seededSuspension(requestId: string): SuspensionRecord {
  return {
    suspensionId: "susp_1",
    requestId,
    flowKind: "cleanup-test",
    actionName: "run",
    userId: "u1",
    reason: "human_approval",
    message: "stale gate",
    status: "approved",
    blockInstanceId: "seq",
    stepIndex: 0,
    createdAt: Date.now(),
    resolvedAt: Date.now()
  };
}

describe("durable completion cleans its own artifacts", () => {
  it("removes leftover suspension + lease on a non-resumed durable completion", async () => {
    const { stores, provider } = createDurableStores();

    const requestId = "req_cleanup_1";

    // Pre-seed a leftover suspension and a lease for this request id, as a
    // mid-flight suspend/resume cycle would have left behind.
    await stores.suspensions.set(seededSuspension(requestId));
    const lease = await stores.leases.acquire(requestId, {
      holder: "worker_1",
      durationMs: 600_000
    });
    expect(lease).not.toBeNull();

    const step = handler({
      name: "noop",
      inputSchema: z.any(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true })
    });

    const flow = defineFlow({
      kind: "cleanup-test",
      actions: {
        run: {
          block: sequencer({ name: "seq", durable: true }).step(step),
          inputSchema: z.any(),
          durable: true
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      requestId,
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });

    const request = await stores.request.get(result.requestId!);
    expect(request?.status).toBe("completed");

    // Cleanup wire fired: suspension and lease are gone.
    expect(await stores.suspensions.get(requestId, "susp_1")).toBeNull();
    expect(await stores.leases.get(requestId)).toBeNull();
  });

  it("does NOT clean up when no durability provider is configured", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_no_provider";

    await stores.suspensions.set(seededSuspension(requestId));

    const step = handler({
      name: "noop",
      inputSchema: z.any(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true })
    });

    const flow = defineFlow({
      kind: "cleanup-test",
      actions: {
        run: {
          block: sequencer({ name: "seq", durable: true }).step(step),
          inputSchema: z.any(),
          durable: true
        }
      }
    })();

    await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      requestId,
      stores,
      runtimeConfig: {} // no durabilityProvider
    });

    // Without a provider, the wire is skipped — the seeded record survives.
    expect(await stores.suspensions.get(requestId, "susp_1")).not.toBeNull();
  });
});
