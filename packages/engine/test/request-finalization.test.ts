/**
 * A request's record says when its run has finished writing: `finalizedAtMs`
 * is `null` from creation, and the run stamps it as its very last write, after
 * `onFinished`. Retention frees a request's id only once it is stamped, so
 * whoever takes the id next cannot receive the old run's late writes.
 *
 * A run that dies before stamping is stamped by the stale-request sweep, the
 * same place the engine already declares a run dead. To make that safe, a
 * finishing run keeps its heartbeat going until it stamps, so a slow
 * `onFinished` is never mistaken for a dead run.
 */
import { DEFAULT_ORG_ID, defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createInMemoryStores, runAction } from "../src";
import { detectInterruptedRequests } from "../src/execution/request-recovery";
import type { RequestRecord, StoreRegistry } from "../src/stores/types";

type Observed = { finalizedAtMs: RequestRecord["finalizedAtMs"] | "no record" };

function makeFlow(
  onFinished: (input: { requestId: string }) => Promise<void>,
  heartbeatIntervalMs?: number
) {
  return defineFlow({
    kind: "finalization-flow",
    actions: {
      run: {
        inputSchema: z.object({ value: z.number() }),
        block: handler({
          name: "echo",
          inputSchema: z.object({ value: z.number() }),
          outputSchema: z.object({ value: z.number() }),
          execute: (input) => input
        })
      }
    },
    request: {
      ...(heartbeatIntervalMs !== undefined ? { heartbeatIntervalMs } : {}),
      onFinished: handler({
        name: "finished-observer",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: async (input: { requestId: string }) => {
          await onFinished(input);
          return null;
        }
      })
    }
  })();
}

function run(stores: StoreRegistry, flow: ReturnType<typeof makeFlow>, requestId: string) {
  return runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: { value: 1 },
    requestId,
    userId: "user1",
    sessionId: "sess_finalization",
    stores,
    runtimeConfig: {}
  });
}

describe("request finalization", () => {
  it("stamps the record only after onFinished has returned", async () => {
    const stores = createInMemoryStores();
    const duringOnFinished: Observed[] = [];
    const flow = makeFlow(async ({ requestId }) => {
      const record = await stores.request.get(requestId);
      duringOnFinished.push({
        finalizedAtMs: record === undefined ? "no record" : record.finalizedAtMs
      });
    });

    await run(stores, flow, "req_stamp");

    expect(duringOnFinished).toEqual([{ finalizedAtMs: null }]);
    const after = await stores.request.get("req_stamp");
    expect(after?.status).toBe("completed");
    expect(typeof after?.finalizedAtMs).toBe("number");
  });

  it("does not bring back a record deleted while onFinished was running", async () => {
    // The stamp is the run's last write. If the record is gone by then, the
    // write must find nothing to update rather than recreate it under an id
    // someone else may already hold.
    const stores = createInMemoryStores();
    const flow = makeFlow(async ({ requestId }) => {
      await stores.request.delete(requestId);
    });

    await run(stores, flow, "req_deleted_in_tail");

    expect(await stores.request.get("req_deleted_in_tail")).toBeUndefined();
  });

  it("does not stamp another request that took the id while onFinished was running, even in the same millisecond", async () => {
    // Stamping the newcomer would tell retention its run had finished while
    // it may still be writing. Two requests can be created in one
    // millisecond, so only the incarnation tells them apart.
    const stores = createInMemoryStores();
    const flow = makeFlow(async ({ requestId }) => {
      const mine = await stores.request.get(requestId);
      await stores.request.delete(requestId);
      if (mine === undefined) return;
      await stores.request.set(
        requestId,
        {
          ...mine,
          userId: "someone-else",
          createdAt: mine.createdAt,
          incarnation: "inc_newcomer",
          finalizedAtMs: null
        },
        "any"
      );
    });

    await run(stores, flow, "req_taken_in_tail");

    const newcomer = await stores.request.get("req_taken_in_tail");
    expect(newcomer?.userId).toBe("someone-else");
    expect(newcomer?.finalizedAtMs).toBeNull();
  });

  it("stamps only after .sideChain() work queued by onFinished has settled", async () => {
    // Work an `onFinished` sequencer fans out is still this run writing under
    // the id. Stamping before it settles would let retention free the id while
    // that work can still write into whoever takes it next.
    const stores = createInMemoryStores();
    const seenBySideChain: Observed[] = [];
    const flow = defineFlow({
      kind: "finalization-sidechain-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler({
            name: "echo",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.object({ value: z.number() }),
            execute: (input) => input
          })
        }
      },
      request: {
        onFinished: sequencer({ name: "finished-seq" })
          .sideChain(handler({
            name: "finished-background",
            inputSchema: z.any(),
            outputSchema: z.any(),
            execute: async (input: { requestId: string }) => {
              await new Promise((resolve) => setTimeout(resolve, 60));
              const record = await stores.request.get(input.requestId);
              seenBySideChain.push({
                finalizedAtMs: record === undefined ? "no record" : record.finalizedAtMs
              });
              return null;
            }
          }))
          .step(handler({
            name: "finished-body",
            inputSchema: z.any(),
            outputSchema: z.any(),
            execute: () => null
          }))
      }
    })();

    await run(stores, flow as unknown as ReturnType<typeof makeFlow>, "req_finish_sidechain");

    expect(seenBySideChain).toEqual([{ finalizedAtMs: null }]);
    expect(typeof (await stores.request.get("req_finish_sidechain"))?.finalizedAtMs).toBe("number");
  });

  it("stamps a run that stopped on its token budget (incomplete)", async () => {
    // `incomplete` is terminal: nothing resumes it. Left unstamped, retention
    // would keep it forever.
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "finalization-budget-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: generator({
            name: "budget-generator",
            model: "openai/gpt-5-mini",
            prompt: () => "prompt",
            user: () => "hello"
          }),
          tokenBudget: { maxTotalTokens: 5, onExceeded: "stop" }
        }
      }
    })();

    await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: { value: 1 },
      requestId: "req_budget_stamp",
      userId: "user1",
      sessionId: "sess_finalization",
      stores,
      runtimeConfig: {
        modelResolver: () => ({
          modelId: "openai/gpt-5-mini",
          async generate() {
            return { text: "ok", usage: { promptTokens: 4, completionTokens: 4, totalTokens: 8 } };
          }
        })
      }
    });

    const after = await stores.request.get("req_budget_stamp");
    expect(after?.status).toBe("incomplete");
    expect(typeof after?.finalizedAtMs).toBe("number");
  });

  it("retries a stamp the store failed to write", async () => {
    const stores = createInMemoryStores();
    const conditional = stores.request.setFieldsIfStatus.bind(stores.request);
    let stampAttempts = 0;
    stores.request.setFieldsIfStatus = async (...args) => {
      if (args[1].finalizedAtMs !== undefined && ++stampAttempts === 1) {
        throw new Error("store briefly unavailable");
      }
      return conditional(...args);
    };

    await run(stores, makeFlow(async () => {}), "req_stamp_retry");

    expect(stampAttempts).toBe(2);
    expect(typeof (await stores.request.get("req_stamp_retry"))?.finalizedAtMs).toBe("number");
  });

  it("leaves a run whose stamp kept failing for the stale-request sweep to stamp", async () => {
    // The record must not stay unstamped forever. The run stays registered,
    // heartbeat stopped, which is exactly what the sweep looks for.
    const stores = createInMemoryStores();
    const conditional = stores.request.setFieldsIfStatus.bind(stores.request);
    let storeDown = true;
    stores.request.setFieldsIfStatus = async (...args) => {
      if (storeDown && args[1].finalizedAtMs !== undefined) {
        throw new Error("store unavailable");
      }
      return conditional(...args);
    };

    await run(stores, makeFlow(async () => {}), "req_stamp_down");

    expect((await stores.request.get("req_stamp_down"))?.finalizedAtMs).toBeNull();
    expect(await stores.activeRequests.get("req_stamp_down")).toBeDefined();

    storeDown = false;
    await detectInterruptedRequests({ stores, staleThresholdMs: 0 });

    const after = await stores.request.get("req_stamp_down");
    expect(after?.status).toBe("completed");
    expect(typeof after?.finalizedAtMs).toBe("number");
    expect(await stores.activeRequests.get("req_stamp_down")).toBeUndefined();
  });

  it("with heartbeats off, a sweep during onFinished does not take the run for finished", async () => {
    // `heartbeatIntervalMs: 0` means the entry never beats, so it looks stale
    // throughout a slow `onFinished`. Staleness proves nothing about such a
    // run, so the sweep must not stamp it while it is still writing.
    const stores = createInMemoryStores();
    const duringOnFinished: Observed[] = [];
    const flow = makeFlow(async ({ requestId }) => {
      await detectInterruptedRequests({ stores, staleThresholdMs: 0 });
      const record = await stores.request.get(requestId);
      duringOnFinished.push({
        finalizedAtMs: record === undefined ? "no record" : record.finalizedAtMs
      });
    }, 0);

    await run(stores, flow, "req_no_heartbeat");

    expect(duringOnFinished).toEqual([{ finalizedAtMs: null }]);
    // The run itself still stamps when it is done.
    expect(typeof (await stores.request.get("req_no_heartbeat"))?.finalizedAtMs).toBe("number");
  });

  it("does not stamp over a late write that failed to flush, and flushes the other queue anyway", async () => {
    // A failed flush is the same as a failed stamp: the run cannot vouch that
    // nothing is left in flight, so it leaves the record for the sweep.
    const stores = createInMemoryStores();
    let inTail = false;
    let eventFlushesInTail = 0;
    const flushItems = stores.request.flushItems.bind(stores.request);
    const flushEvents = stores.request.flushEvents.bind(stores.request);
    stores.request.flushItems = async (id) => {
      if (inTail) throw new Error("item write failed");
      return flushItems(id);
    };
    stores.request.flushEvents = async (id) => {
      if (inTail) eventFlushesInTail += 1;
      return flushEvents(id);
    };
    const flow = makeFlow(async () => {
      inTail = true;
    });

    await run(stores, flow, "req_flush_failed");

    expect(eventFlushesInTail).toBeGreaterThan(0);
    expect((await stores.request.get("req_flush_failed"))?.finalizedAtMs).toBeNull();
    expect(await stores.activeRequests.get("req_flush_failed")).toBeDefined();

    inTail = false;
    await detectInterruptedRequests({ stores, staleThresholdMs: 0 });
    expect(typeof (await stores.request.get("req_flush_failed"))?.finalizedAtMs).toBe("number");
  });

  it("keeps heartbeating while onFinished runs, so a slow finish is not taken for a dead run", async () => {
    const stores = createInMemoryStores();
    let beatDuringOnFinished: number | undefined;
    let beatAtOnFinishedStart: number | undefined;
    const flow = makeFlow(async ({ requestId }) => {
      beatAtOnFinishedStart = (await stores.activeRequests.get(requestId))?.lastHeartbeatAt;
      await new Promise((resolve) => setTimeout(resolve, 60));
      beatDuringOnFinished = (await stores.activeRequests.get(requestId))?.lastHeartbeatAt;
    }, 10);

    await run(stores, flow, "req_slow_finish");

    expect(beatAtOnFinishedStart).toBeDefined();
    expect(beatDuringOnFinished).toBeGreaterThan(beatAtOnFinishedStart ?? Infinity);
  });
});

describe("stale-request sweep and unfinished records", () => {
  const entry = (requestId: string) => ({
    requestId,
    flowKind: "finalization-flow",
    actionName: "run",
    sessionId: "sess_finalization",
    userId: "user1",
    source: "http",
    startedAt: 1,
    lastHeartbeatAt: 1
  });
  const record = (
    id: string,
    status: RequestRecord["status"]
  ): RequestRecord => ({
    id,
    flowKind: "finalization-flow",
    actionName: "run",
    userId: "user1",
    orgId: DEFAULT_ORG_ID,
    sessionId: "sess_finalization",
    source: "http",
    status,
    startedAtMs: 1,
    ...(status === "completed" ? { completedAtMs: 2 } : {}),
    finalizedAtMs: null,
    heartbeatsUntilFinalized: status === "completed",
    state: {},
    version: 0,
    createdAt: 1,
    updatedAt: 2
  });

  it("stamps a finished record whose run died before stamping it", async () => {
    const stores = createInMemoryStores();
    await stores.request.set("req_died_in_tail", record("req_died_in_tail", "completed"), "any");
    await stores.activeRequests.register(entry("req_died_in_tail"));

    await detectInterruptedRequests({ stores, staleThresholdMs: 0 });

    const after = await stores.request.get("req_died_in_tail");
    expect(after?.status).toBe("completed");
    expect(typeof after?.finalizedAtMs).toBe("number");
  });

  it("does not stamp a finished record whose run was not heartbeating through its tail", async () => {
    // Heartbeats off, or a failure path (which stops beating before
    // `onFinished`): a stale entry says nothing about whether the run is
    // still writing, so the record stays unfinalized and is never evicted.
    const stores = createInMemoryStores();
    await stores.request.set(
      "req_silent_tail",
      { ...record("req_silent_tail", "completed"), heartbeatsUntilFinalized: false },
      "any"
    );
    await stores.activeRequests.register(entry("req_silent_tail"));

    await detectInterruptedRequests({ stores, staleThresholdMs: 0 });

    expect((await stores.request.get("req_silent_tail"))?.finalizedAtMs).toBeNull();
  });

  it("leaves a run that died mid-flight unstamped: it is interrupted, not finished", async () => {
    const stores = createInMemoryStores();
    await stores.request.set("req_died_running", record("req_died_running", "in_progress"), "any");
    await stores.activeRequests.register(entry("req_died_running"));

    await detectInterruptedRequests({ stores, staleThresholdMs: 0 });

    const after = await stores.request.get("req_died_running");
    expect(after?.status).toBe("interrupted");
    expect(after?.finalizedAtMs).toBeNull();
  });
});
