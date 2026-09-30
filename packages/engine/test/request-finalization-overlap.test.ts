/**
 * Two runs of one request can overlap: the stale-request sweep marks a slow
 * but live run `interrupted`, and `/continue` starts a second run under the
 * same id while the first is still going. They share the record, its
 * incarnation and the active-registry entry.
 *
 * Retention frees an id once its record is stamped finished, so the first of
 * the two runs to end must neither stamp the record nor drop the registry
 * entry while the other is still in `onFinished` or still writing. Only the
 * last one to end does, whichever it is.
 */
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  continueRequest,
  createFlowRegistry,
  createInMemoryStores,
  detectInterruptedRequests,
  runAction
} from "../src";

type Worker = 0 | 1;

async function overlap(firstToFinish: Worker) {
  const stores = createInMemoryStores();
  const requestId = `req_overlap_${firstToFinish}`;

  const release: Array<() => void> = [];
  const gates = [0, 1].map((i) => new Promise<void>((resolve) => (release[i] = resolve)));
  const entered: Array<() => void> = [];
  const parked = [0, 1].map((i) => new Promise<void>((resolve) => (entered[i] = resolve)));
  let started = 0;

  // The second run to reach onFinished is held there until the test lets go.
  let finishing = 0;
  let enteredHeld!: () => void;
  const heldEntered = new Promise<void>((resolve) => (enteredHeld = resolve));
  let releaseHeld!: () => void;
  const held = new Promise<void>((resolve) => (releaseHeld = resolve));

  const flow = defineFlow({
    kind: "overlap-flow",
    actions: {
      run: {
        inputSchema: z.any(),
        block: handler({
          name: "parked",
          inputSchema: z.any(),
          outputSchema: z.object({ ok: z.boolean() }),
          execute: async () => {
            const me = started;
            started += 1;
            entered[me]?.();
            await gates[me];
            return { ok: true };
          }
        })
      }
    },
    request: {
      heartbeatIntervalMs: 50,
      onFinished: handler({
        name: "finish",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: async () => {
          finishing += 1;
          if (finishing === 2) {
            enteredHeld();
            await held;
          }
          return null;
        }
      })
    }
  })({ id: "overlap-flow" });
  const flowRegistry = createFlowRegistry();
  flowRegistry.register(flow as never);

  const original = runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    requestId,
    sessionId: "sess_overlap",
    userId: "user_overlap",
    input: {},
    stores,
    runtimeConfig: {}
  });
  await parked[0];
  await detectInterruptedRequests({ stores, staleThresholdMs: 0 });
  const { finished } = await continueRequest({
    requestId,
    stores,
    flowRegistry,
    runtimeConfig: {}
  });
  await parked[1];

  const other: Worker = firstToFinish === 0 ? 1 : 0;
  const runs = [original, finished];
  release[firstToFinish]();
  await runs[firstToFinish].catch(() => {});
  release[other]();
  await heldEntered;

  // One run has ended; the other is still in onFinished.
  const midway = {
    finalizedAtMs: (await stores.request.get(requestId))?.finalizedAtMs,
    registered: (await stores.activeRequests.get(requestId)) !== undefined
  };

  releaseHeld();
  await Promise.allSettled(runs);
  // The continuation's own cleanup runs just after its run settles.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const after = {
    finalizedAtMs: (await stores.request.get(requestId))?.finalizedAtMs,
    registered: (await stores.activeRequests.get(requestId)) !== undefined
  };
  return { midway, after };
}

describe("overlapping runs of one request", () => {
  it.each([
    ["the continuation", 1 as Worker],
    ["the original run", 0 as Worker]
  ])(
    "when %s ends first, the id is not finalized or deregistered while the other still runs",
    async (_label, firstToFinish) => {
      const { midway, after } = await overlap(firstToFinish);

      expect(midway).toEqual({ finalizedAtMs: null, registered: true });
      // The last run to end stamps and deregisters.
      expect(typeof after.finalizedAtMs).toBe("number");
      expect(after.registered).toBe(false);
    }
  );
});
