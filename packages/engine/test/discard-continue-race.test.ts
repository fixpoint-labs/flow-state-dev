/**
 * Discard (a stop of an `interrupted` request) and Continue racing: a
 * continuation already admitted, past its first abort-intent read, must not
 * run the turn once a stop has ended it `aborted`.
 */
import { defineFlow, handler, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { recordRequestStop } from "../src/execution/record-request-stop";

describe("a Discard that lands after a Continue was admitted", () => {
  it("ends the turn: the action does not run and the request stays aborted", async () => {
    let runs = 0;
    const flow = defineFlow({
      kind: "race",
      actions: {
        respond: {
          inputSchema: z.any(),
          block: handler({ name: "h", inputSchema: z.any(), outputSchema: z.any(), execute: async () => { runs += 1; return "answered"; } })
        }
      }
    })({ id: "race" });
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const stores = createInMemoryStores();

    const first = await runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "respond", input: {}, userId: "u1", stores, runtimeConfig: {} });
    const requestId = first.requestId!;
    const done = (await stores.request.get(requestId))!;
    await stores.request.set(requestId, { ...done, status: "interrupted", interruptedAt: Date.now(), result: undefined }, "any");
    runs = 0;

    // The stop lands right after the continuation's first abort-intent read.
    const read = stores.request.isAbortRequested.bind(stores.request);
    let stopped: unknown;
    vi.spyOn(stores.request, "isAbortRequested").mockImplementation(async (id) => {
      const answer = await read(id);
      if (stopped === undefined) stopped = await recordRequestStop(stores.request, (await stores.request.get(id))!);
      return answer;
    });

    const { finished } = await continueRequest({ requestId, stores, flowRegistry: registry, runtimeConfig: {} });
    await finished.catch(() => {});

    expect(stopped).toEqual({ kind: "ended" });
    expect(runs).toBe(0);
    expect((await stores.request.get(requestId))?.status).toBe("aborted");
  });
});
