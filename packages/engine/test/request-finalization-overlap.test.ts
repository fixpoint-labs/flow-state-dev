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
 *
 * Abort reaches every live run, and a run that ends removes only its own
 * controller. A second process does not count the first process's run, so
 * that case stays `it.fails`.
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

type Worker = 0 | 1;

type OverlapIds = {
  kind: string;
  requestId: string;
  sessionId: string;
  userId: string;
};

/** Two parked runs of `kind`. The second `onFinished` waits until `releaseHeld`. */
function parkedFlow(kind: string) {
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

async function parkOriginal(ids: OverlapIds) {
  const stores = createInMemoryStores();
  const park = parkedFlow(ids.kind);
  const original = runAction({
    orgId: DEFAULT_ORG_ID,
    flow: park.flow,
    actionName: "run",
    requestId: ids.requestId,
    sessionId: ids.sessionId,
    userId: ids.userId,
    input: {},
    stores,
    runtimeConfig: {}
  });
  await park.parked[0];
  await detectInterruptedRequests({ stores, staleThresholdMs: 0 });
  return { stores, park, original, requestId: ids.requestId };
}

async function startOverlap(ids: OverlapIds) {
  const started = await parkOriginal(ids);
  const flowRegistry = createFlowRegistry();
  flowRegistry.register(started.park.flow as never);
  const { finished } = await continueRequest({
    requestId: started.requestId,
    stores: started.stores,
    flowRegistry,
    runtimeConfig: {}
  });
  await started.park.parked[1];
  return { ...started, finished };
}

async function overlap(firstToFinish: Worker) {
  const requestId = `req_overlap_${firstToFinish}`;
  const run = await startOverlap({
    kind: "overlap-flow",
    requestId,
    sessionId: "sess_overlap",
    userId: "user_overlap"
  });

  const other: Worker = firstToFinish === 0 ? 1 : 0;
  const runs = [run.original, run.finished];
  run.park.release[firstToFinish]();
  await runs[firstToFinish].catch(() => {});
  run.park.release[other]();
  await run.park.heldEntered;

  // One run has ended; the other is still in onFinished.
  const midway = {
    finalizedAtMs: (await run.stores.request.get(requestId))?.finalizedAtMs,
    registered: (await run.stores.activeRequests.get(requestId)) !== undefined
  };

  run.park.releaseHeld();
  await Promise.allSettled(runs);
  // The continuation's own cleanup runs just after its run settles.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const after = {
    finalizedAtMs: (await run.stores.request.get(requestId))?.finalizedAtMs,
    registered: (await run.stores.activeRequests.get(requestId)) !== undefined
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

describe("overlapping run attempts in one process", () => {
  it("aborting the request still reaches the attempt left running after the other ends", async () => {
    const requestId = "req_attempt_abort";
    const run = await startOverlap({
      kind: "attempt-abort-flow",
      requestId,
      sessionId: "sess_attempt_abort",
      userId: "user_attempt_abort"
    });
    run.park.releaseHeld();

    run.park.release[1]();
    await run.finished.catch(() => {});

    expect(hasActiveAbortController(requestId)).toBe(true);
    expect(abortRequest(requestId)).toBe(true);
    expect(run.park.signals[0]?.aborted).toBe(true);

    await run.original.catch(() => {});
    expect(hasActiveAbortController(requestId)).toBe(false);
  });

  it("one abort reaches every live attempt", async () => {
    const requestId = "req_attempt_abort_both";
    const run = await startOverlap({
      kind: "attempt-abort-both-flow",
      requestId,
      sessionId: "sess_attempt_abort_both",
      userId: "user_attempt_abort_both"
    });
    run.park.releaseHeld();

    expect(abortRequest(requestId)).toBe(true);
    expect(run.park.signals[0]?.aborted).toBe(true);
    expect(run.park.signals[1]?.aborted).toBe(true);

    await Promise.allSettled([run.original, run.finished]);
    expect(hasActiveAbortController(requestId)).toBe(false);
  });
});

// The run that ends last is the one left to stamp. When it ends by throwing
// (here its onStarted observer fails after the other run has already ended
// and left the stamp to it), the id must still be stamped and deregistered,
// or retention would keep the finished request forever.
describe("the last overlapping run ending by throwing", () => {
  it("still stamps the finished record and deregisters it", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_overlap_throws";

    let releaseOriginal!: () => void;
    const originalGate = new Promise<void>((resolve) => (releaseOriginal = resolve));
    let originalParked!: () => void;
    const originalEntered = new Promise<void>((resolve) => (originalParked = resolve));
    let continuationStarting!: () => void;
    const continuationEntered = new Promise<void>((resolve) => (continuationStarting = resolve));
    let failContinuation!: () => void;
    const continuationGate = new Promise<void>((resolve) => (failContinuation = resolve));
    let starts = 0;

    const flow = defineFlow({
      kind: "overlap-throw-flow",
      actions: {
        run: {
          inputSchema: z.any(),
          block: handler({
            name: "parked",
            inputSchema: z.any(),
            outputSchema: z.object({ ok: z.boolean() }),
            execute: async () => {
              originalParked();
              await originalGate;
              return { ok: true };
            }
          })
        }
      },
      request: {
        heartbeatIntervalMs: 50,
        onStarted: handler({
          name: "start",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: async () => {
            starts += 1;
            if (starts === 2) {
              continuationStarting();
              await continuationGate;
              throw new Error("continuation failed to start");
            }
            return null;
          }
        })
      }
    })({ id: "overlap-throw-flow" });
    const flowRegistry = createFlowRegistry();
    flowRegistry.register(flow as never);

    const original = runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      requestId,
      sessionId: "sess_overlap_throw",
      userId: "user_overlap_throw",
      input: {},
      stores,
      runtimeConfig: {}
    });
    await originalEntered;
    await detectInterruptedRequests({ stores, staleThresholdMs: 0 });
    const { finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry,
      runtimeConfig: {}
    });
    await continuationEntered;

    // The original ends first and leaves the stamp to the continuation.
    releaseOriginal();
    await original.catch(() => {});
    expect((await stores.request.get(requestId))?.finalizedAtMs).toBeNull();

    // The continuation then ends by throwing.
    failContinuation();
    await finished.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    const record = await stores.request.get(requestId);
    expect(typeof record?.finalizedAtMs).toBe("number");
    expect(await stores.activeRequests.get(requestId)).toBeUndefined();
  });
});

// A run that fails during setup still writes a terminal record (`failed`),
// and nothing runs after it. It must stamp that record and deregister, or
// retention would keep the failed request forever.
describe("a single run that fails during setup", () => {
  it("stamps its failed record and deregisters it", async () => {
    const previous = process.env.FSDEV_DEFAULT_MODEL;
    // Rejected when the execution context builds its model resolver: a setup
    // failure that lands after the request record is written.
    process.env.FSDEV_DEFAULT_MODEL = "intent/chat";
    try {
      const stores = createInMemoryStores();
      const requestId = "req_setup_failure";
      const flow = defineFlow({
        kind: "setup-failure-flow",
        actions: {
          run: {
            inputSchema: z.any(),
            block: handler({
              name: "never",
              inputSchema: z.any(),
              outputSchema: z.any(),
              execute: () => null
            })
          }
        }
      })({ id: "setup-failure-flow" });

      await expect(
        runAction({
          orgId: DEFAULT_ORG_ID,
          flow,
          actionName: "run",
          requestId,
          sessionId: "sess_setup_failure",
          userId: "user_setup_failure",
          input: {},
          stores,
          runtimeConfig: {}
        })
      ).rejects.toThrow();

      const record = await stores.request.get(requestId);
      expect(record?.status).toBe("failed");
      expect(typeof record?.finalizedAtMs).toBe("number");
      expect(await stores.activeRequests.get(requestId)).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.FSDEV_DEFAULT_MODEL;
      else process.env.FSDEV_DEFAULT_MODEL = previous;
    }
  });
});

type Engine = {
  runAction: typeof runAction;
  continueRequest: typeof continueRequest;
  createFlowRegistry: typeof createFlowRegistry;
};

describe("overlapping run attempts in two processes", () => {
  it.fails(
    "the attempt that ends first does not finalize or deregister the id while the other still runs",
    async () => {
      const requestId = "req_attempt_xproc";
      const started = await parkOriginal({
        kind: "attempt-xproc-flow",
        requestId,
        sessionId: "sess_attempt_xproc",
        userId: "user_attempt_xproc"
      });

      // A fresh copy of the engine is a second process sharing the stores.
      vi.resetModules();
      const other = (await import("../src")) as Engine;
      expect(other.runAction).not.toBe(runAction);
      const otherRegistry = other.createFlowRegistry();
      otherRegistry.register(started.park.flow as never);
      const { finished } = await other.continueRequest({
        requestId,
        stores: started.stores,
        flowRegistry: otherRegistry,
        runtimeConfig: {}
      });
      await started.park.parked[1];

      started.park.release[1]();
      await finished.catch(() => {});
      started.park.release[0]();
      await started.park.heldEntered;

      const midway = {
        finalizedAtMs: (await started.stores.request.get(requestId))?.finalizedAtMs,
        registered: (await started.stores.activeRequests.get(requestId)) !== undefined
      };
      started.park.releaseHeld();
      await started.original.catch(() => {});

      expect(midway).toEqual({ finalizedAtMs: null, registered: true });
    }
  );
});
