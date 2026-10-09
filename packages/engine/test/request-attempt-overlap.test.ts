/**
 * Two run attempts of one request id can be live at once: the stale-request
 * sweep marks a slow but live run `interrupted`, and `/continue` starts a
 * second run under the same id while the first is still going.
 *
 * - In one process, aborting the request must reach every live attempt, and
 *   one attempt ending must not drop the other's abort controller.
 * - Across processes, the attempt that ends first must not finalize the id
 *   while the other is still writing. That is not fenced yet: each process
 *   counts only its own attempts, so the second test is marked `it.fails`
 *   and documents the gap until the request store records live attempts.
 */
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  continueRequest,
  createFlowRegistry,
  createInMemoryStores,
  detectInterruptedRequests,
  runAction
} from "../src";
import { abortRequest, hasActiveAbortController } from "../src/execution/abort-registry";

type Engine = {
  runAction: typeof runAction;
  continueRequest: typeof continueRequest;
  createFlowRegistry: typeof createFlowRegistry;
};

/**
 * A flow whose action parks each run until the test releases it, and whose
 * `onFinished` can hold the second run to reach it.
 */
function makeParkedFlow(kind: string) {
  const release: Array<() => void> = [];
  const gates = [0, 1].map((i) => new Promise<void>((resolve) => (release[i] = resolve)));
  const entered: Array<() => void> = [];
  const parked = [0, 1].map((i) => new Promise<void>((resolve) => (entered[i] = resolve)));
  const signals: AbortSignal[] = [];
  let started = 0;
  let finishing = 0;
  let enteredHeld!: () => void;
  const heldEntered = new Promise<void>((resolve) => (enteredHeld = resolve));
  let releaseHeld!: () => void;
  const held = new Promise<void>((resolve) => (releaseHeld = resolve));

  const flow = defineFlow({
    kind,
    actions: {
      run: {
        inputSchema: z.any(),
        block: handler({
          name: "parked",
          inputSchema: z.any(),
          outputSchema: z.object({ ok: z.boolean() }),
          execute: async (_input, ctx) => {
            const me = started;
            started += 1;
            signals[me] = ctx.signal;
            entered[me]?.();
            await Promise.race([
              gates[me],
              new Promise<void>((resolve) =>
                ctx.signal.addEventListener("abort", () => resolve(), { once: true })
              )
            ]);
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
  })({ id: kind });

  return { flow, release, parked, signals, heldEntered, releaseHeld };
}

describe("overlapping run attempts in one process", () => {
  it("aborting the request still reaches the attempt left running after the other ends", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_attempt_abort";
    const { flow, release, parked, signals, releaseHeld } = makeParkedFlow("attempt-abort-flow");
    releaseHeld();
    const flowRegistry = createFlowRegistry();
    flowRegistry.register(flow as never);

    const original = runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      requestId,
      sessionId: "sess_attempt_abort",
      userId: "user_attempt_abort",
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

    // The continuation ends first; the original is still running.
    release[1]();
    await finished.catch(() => {});

    expect(hasActiveAbortController(requestId)).toBe(true);
    expect(abortRequest(requestId)).toBe(true);
    expect(signals[0]?.aborted).toBe(true);

    await original.catch(() => {});
    expect(hasActiveAbortController(requestId)).toBe(false);
  });

  it("one abort reaches every live attempt", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_attempt_abort_both";
    const { flow, parked, signals, releaseHeld } = makeParkedFlow("attempt-abort-both-flow");
    releaseHeld();
    const flowRegistry = createFlowRegistry();
    flowRegistry.register(flow as never);

    const original = runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      requestId,
      sessionId: "sess_attempt_abort_both",
      userId: "user_attempt_abort_both",
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

    expect(abortRequest(requestId)).toBe(true);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(true);

    await Promise.allSettled([original, finished]);
    expect(hasActiveAbortController(requestId)).toBe(false);
  });
});

describe("overlapping run attempts in two processes", () => {
  it.fails(
    "the attempt that ends first does not finalize or deregister the id while the other still runs",
    async () => {
      const stores = createInMemoryStores();
      const requestId = "req_attempt_xproc";
      const { flow, release, parked, heldEntered, releaseHeld } =
        makeParkedFlow("attempt-xproc-flow");

      const original = runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "run",
        requestId,
        sessionId: "sess_attempt_xproc",
        userId: "user_attempt_xproc",
        input: {},
        stores,
        runtimeConfig: {}
      });
      await parked[0];
      await detectInterruptedRequests({ stores, staleThresholdMs: 0 });

      // A fresh copy of the engine is a second process sharing the stores:
      // its attempt count has never seen the original run.
      vi.resetModules();
      const other = (await import("../src")) as Engine;
      expect(other.runAction).not.toBe(runAction);
      const otherRegistry = other.createFlowRegistry();
      otherRegistry.register(flow as never);
      const { finished } = await other.continueRequest({
        requestId,
        stores,
        flowRegistry: otherRegistry,
        runtimeConfig: {}
      });
      await parked[1];

      // The continuation (other process) ends first; the original is held in
      // onFinished, still writing under the id.
      release[1]();
      await finished.catch(() => {});
      release[0]();
      await heldEntered;

      const midway = {
        finalizedAtMs: (await stores.request.get(requestId))?.finalizedAtMs,
        registered: (await stores.activeRequests.get(requestId)) !== undefined
      };
      releaseHeld();
      await original.catch(() => {});

      expect(midway).toEqual({ finalizedAtMs: null, registered: true });
    }
  );
});
