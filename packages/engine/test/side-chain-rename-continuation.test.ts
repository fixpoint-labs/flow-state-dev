/**
 * Cross-version continuation across the `work` → `sideChain` rename (FIX-766).
 *
 * ## Read the assertion direction before changing anything here
 *
 * This test asserts that a side-chain child which had already **completed**
 * before the rename **executes a second time** after it. That is not a bug
 * being pinned as correct-by-accident — it is a *characterization test of an
 * accepted cost*, and the assertion is deliberately this way round.
 *
 * The tier's name is a segment of a block's structural path
 * (`childBlockPath(ctx, runtime, "sideChain", i)` → `…/sideChain[3]`), and the
 * path is the key the **replay log** memoizes completed children under
 * (`replayLog.getCompletedOutput(`${requestId}:${path}`)`). A request that was
 * in flight across the deploy carrying this rename has its completed child
 * filed under the old segment `…/work[3]`. The new code looks under
 * `…/sideChain[3]`, misses, and re-runs the child — duplicating whatever side
 * effects it had.
 *
 * FIX-766 decision 2 accepted that, with no compatibility shim, on one premise:
 * nothing is published yet, so the only records spelled the old way are replay
 * entries for requests in flight across this one deploy, in local dev stores.
 *
 * **Do not invert this assertion.** A test demanding the child does *not*
 * re-run can only be made to pass by adding the block-path alias decision 2
 * rejects — dual-reading a structural identifier that is compared and never
 * decoded, in every prefix and equality check in the path grammar. Inverting it
 * would quietly convert a characterization test into a mandate for that shim.
 * If the premise ever changes (i.e. we publish first), the decision flips and
 * this test should be *replaced*, not edited.
 *
 * The second test is the control: with the same flow and the same crash, but
 * records written by the CURRENT code, the child is replayed and does NOT
 * re-run. Without it, the first test cannot distinguish "re-ran because the
 * path moved" from "re-runs on every recovery", which would make it green for
 * the wrong reason.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import type { FlowInstance } from "@flow-state-dev/core/types";

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

/** A durable sequencer whose side chain completes before a gate suspends. */
function buildFlow(kind: string, onRun: () => void) {
  const sideChainBlock = handler({
    name: "sideChainBlock",
    inputSchema: z.any(),
    outputSchema: z.object({ done: z.boolean() }),
    execute: async () => {
      onRun();
      return { done: true };
    }
  });
  const gate = handler({
    name: "gate",
    inputSchema: z.any(),
    outputSchema: z.unknown(),
    execute: async (_i, ctx) => ctx.suspend!({ reason: "human_approval", message: "Approve?" })
  });

  return defineFlow({
    kind,
    actions: {
      run: {
        block: sequencer({ name: "seq", durable: true })
          .sideChain(sideChainBlock)
          .waitForSideChain()
          .step(gate),
        inputSchema: z.any()
      }
    }
  })({ id: kind });
}

/**
 * Rewrite the persisted log the way the PRE-rename code would have written it:
 * the side-chain op contributed the segment `work[n]`, not `sideChain[n]`.
 *
 * This is the whole cross-version mechanism. Everything else in the request is
 * identical — only the spelling of one path segment differs, which is exactly
 * the delta a deploy of this rename introduces.
 */
function spellPathsTheOldWay(items: readonly unknown[]): unknown[] {
  const rewrite = (value: string): string => value.replace(/sideChain\[/g, "work[");
  return items.map((item) => {
    const next = { ...(item as Record<string, unknown>) };
    if (typeof next.blockInstanceId === "string") {
      next.blockInstanceId = rewrite(next.blockInstanceId);
    }
    if (typeof next.parentBlockInstanceId === "string") {
      next.parentBlockInstanceId = rewrite(next.parentBlockInstanceId);
    }
    const provenance = next.provenance as Record<string, unknown> | undefined;
    if (provenance !== undefined) {
      const p = { ...provenance };
      if (typeof p.blockInstanceId === "string") p.blockInstanceId = rewrite(p.blockInstanceId);
      if (typeof p.parentBlockInstanceId === "string") {
        p.parentBlockInstanceId = rewrite(p.parentBlockInstanceId);
      }
      next.provenance = p;
    }
    return next;
  });
}

/** Run to the gate's suspension, then flip the record to `interrupted`. */
async function runToInterrupted(flow: FlowInstance, stores: ReturnType<typeof createDurableStores>["stores"], provider: ReturnType<typeof createDurableStores>["provider"]) {
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
  return requestId;
}

describe("continuing a request that was in flight across the side-chain rename", () => {
  it("RE-EXECUTES a completed side-chain child — the accepted cost of no path alias", async () => {
    let runs = 0;
    const flow = buildFlow("side-chain-rename-crossver", () => {
      runs += 1;
    });
    const { stores, provider } = createDurableStores();
    const requestId = await runToInterrupted(flow, stores, provider);

    // The side chain drained before the gate suspended.
    expect(runs).toBe(1);

    // Simulate the deploy boundary: the durable log was written by the
    // pre-rename code, so the completed child is filed under `…/work[n]`.
    const suspended = (await stores.request.get(requestId))!;
    await stores.request.set(
      requestId,
      {
        ...suspended,
        items: spellPathsTheOldWay(suspended.items ?? []) as typeof suspended.items,
        status: "interrupted",
        interruptedAt: Date.now()
      },
      "any"
    );

    const { finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registryFor(flow),
      runtimeConfig: { durabilityProvider: provider }
    });
    await finished;

    // The replay log has no entry under `…/sideChain[n]`, so the child runs
    // again. Accepted per FIX-766 decision 2, and bounded to requests in flight
    // across the single deploy that introduces the rename.
    expect(runs).toBe(2);
  });

  it("does NOT re-execute when the log was written by the current code", async () => {
    let runs = 0;
    const flow = buildFlow("side-chain-rename-samever", () => {
      runs += 1;
    });
    const { stores, provider } = createDurableStores();
    const requestId = await runToInterrupted(flow, stores, provider);

    expect(runs).toBe(1);

    // Identical crash, identical continuation — the ONLY difference from the
    // test above is that the path segments are left as the current code wrote
    // them. This is what makes the re-execution above attributable to the
    // renamed path rather than to recovery re-running everything.
    const suspended = (await stores.request.get(requestId))!;
    await stores.request.set(
      requestId,
      { ...suspended, status: "interrupted", interruptedAt: Date.now() },
      "any"
    );

    const { finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registryFor(flow),
      runtimeConfig: { durabilityProvider: provider }
    });
    await finished;

    expect(runs).toBe(1);
  });
});
