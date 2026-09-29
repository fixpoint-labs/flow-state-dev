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
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
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

  it("does not stamp another request that took the id while onFinished was running", async () => {
    // Stamping the newcomer would tell retention its run had finished while
    // it may still be writing.
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
          createdAt: mine.createdAt + 1,
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
