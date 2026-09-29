/**
 * A request's incarnation: which request a record is, among every request that
 * has held its id.
 *
 * A request id is the caller's to choose, and once retention deletes a record
 * the same id can name a new request. Anything keyed on the id that outlives
 * the record (a run workspace directory) needs to tell the two apart, and
 * every part of ONE request needs to agree on the answer. So the token is
 * stamped once, when a record is first created, and every context built for
 * that request (a retry, a queued run adopting its host's stub, a resume in a
 * fresh context, the loser of a same-owner creation race) reads it back from
 * the store instead of stamping its own. A context that stamped its own would
 * open a new, empty workspace in the middle of a request.
 */
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createExecutionContext,
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver
} from "../src";
import { createInitialRequestRecord } from "../src/context/initial-request-record";
import { claimRequestRecord } from "../src/context/request-principal";
import { isSameRequest, resolveRequestIncarnation } from "../src/stores/scope-keys";
import type { RequestRecord, StoreRegistry } from "../src/stores/types";

const FLOW = "incarnation";
const REQUEST_ID = "req_client_chosen";

/** What each run's block saw on `ctx.request.incarnation`, in run order. */
function flowCapturing(seen: string[]) {
  const input = z.object({ text: z.string() });
  const run = {
    inputSchema: input,
    block: handler({
      name: "incarnation-capture",
      inputSchema: input,
      execute: (_value, ctx) => {
        seen.push(ctx.request.incarnation);
        return {};
      }
    })
  };
  return defineFlow({
    kind: FLOW,
    actions: { run, runQueued: { ...run, concurrency: { policy: "queue", key: "session" } } }
  })({ id: FLOW });
}

function hostFor(stores: StoreRegistry, seen: string[]) {
  const registry = createFlowRegistry();
  registry.register(flowCapturing(seen));
  return createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: {}
  });
}

async function dispatch(
  host: ReturnType<typeof hostFor>,
  action: "run" | "runQueued" = "run"
): Promise<void> {
  const handle = host.dispatch({
    source: "http",
    flowKind: FLOW,
    action,
    input: { text: "hi" },
    sessionId: "s_alice",
    requestId: REQUEST_ID,
    orgId: DEFAULT_ORG_ID,
    principal: { userId: "alice", orgId: DEFAULT_ORG_ID }
  });
  await handle.finished;
}

async function storedIncarnation(stores: StoreRegistry): Promise<string | undefined> {
  return (await stores.request.get(REQUEST_ID))?.incarnation;
}

describe("the request handle's incarnation is the stored record's", () => {
  it.each([
    ["an in-process run", "run"],
    ["a queued run adopting its host's enqueue-time record", "runQueued"]
  ] as const)("on %s", async (_label, action) => {
    const stores = createInMemoryStores();
    const seen: string[] = [];
    await dispatch(hostFor(stores, seen), action);

    const stored = await storedIncarnation(stores);
    expect(stored).toBeDefined();
    expect(seen).toEqual([stored]);
  });

  it("on a retry of a record still on file: the same request, never stamped again", async () => {
    const stores = createInMemoryStores();
    const seen: string[] = [];
    const host = hostFor(stores, seen);
    await dispatch(host);
    const first = await storedIncarnation(stores);

    await dispatch(host);

    expect(await storedIncarnation(stores)).toBe(first);
    expect(seen).toEqual([first, first]);
  });

  it("on a fresh context for a request already recorded, as a resume builds one", async () => {
    const stores = createInMemoryStores();
    const flow = flowCapturing([]);
    const contextFor = () =>
      createExecutionContext({
        flow,
        actionName: "run",
        requestId: REQUEST_ID,
        sessionId: "s_alice",
        userId: "alice",
        orgId: DEFAULT_ORG_ID,
        stores
      });

    const first = await contextFor();
    const stored = await storedIncarnation(stores);
    const second = await contextFor();

    expect(first.request.incarnation).toBe(stored);
    expect(second.request.incarnation).toBe(stored);
  });

  it("differs for a new request under an id whose record was deleted in between", async () => {
    const stores = createInMemoryStores();
    const seen: string[] = [];
    const host = hostFor(stores, seen);
    await dispatch(host);
    await stores.request.delete(REQUEST_ID);
    await dispatch(host);

    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(seen[0]);
    expect(await storedIncarnation(stores)).toBe(seen[1]);
  });
});

describe("two same-owner contexts racing to create one absent id", () => {
  it("both end holding the one incarnation the store kept, which the hand-off never rewrites", async () => {
    const stores = createInMemoryStores();
    const flow = flowCapturing([]);
    const contextFor = () =>
      createExecutionContext({
        flow,
        actionName: "run",
        requestId: REQUEST_ID,
        sessionId: "s_alice",
        userId: "alice",
        orgId: DEFAULT_ORG_ID,
        stores
      });

    // Both read "no record" before either writes, so both take the create
    // path: one creates, the other loses the race and hands off.
    const [a, b] = await Promise.all([contextFor(), contextFor()]);
    const kept = await storedIncarnation(stores);

    expect(kept).toBeDefined();
    expect(a.request.incarnation).toBe(kept);
    expect(b.request.incarnation).toBe(kept);
  });

  it("the losing claim hands back the stored token, not the one it built", async () => {
    const stores = createInMemoryStores();
    const flow = flowCapturing([]);
    const build = () =>
      createInitialRequestRecord(
        { requestId: REQUEST_ID, flowKind: FLOW, flowId: FLOW, actionName: "run", userId: "alice" },
        1_000
      );
    const winner = build();
    const loser = build();
    expect(loser.incarnation).not.toBe(winner.incarnation);

    await claimRequestRecord(stores, flow, winner);
    const handedOff = await claimRequestRecord(stores, flow, loser);

    expect(handedOff.incarnation).toBe(winner.incarnation);
    expect(await storedIncarnation(stores)).toBe(winner.incarnation);
  });

  it("keeps a legacy holder's derived identity through the hand-off", async () => {
    const stores = createInMemoryStores();
    const flow = flowCapturing([]);
    const legacy = createInitialRequestRecord(
      { requestId: REQUEST_ID, flowKind: FLOW, flowId: FLOW, actionName: "run", userId: "alice" },
      1_000
    );
    delete legacy.incarnation;
    await stores.request.set(REQUEST_ID, legacy, "absent");
    const before = resolveRequestIncarnation(legacy);

    const handedOff = await claimRequestRecord(
      stores,
      flow,
      createInitialRequestRecord(
        { requestId: REQUEST_ID, flowKind: FLOW, flowId: FLOW, actionName: "run", userId: "alice" },
        2_000
      )
    );

    expect(resolveRequestIncarnation(handedOff)).toBe(before);
    expect(resolveRequestIncarnation((await stores.request.get(REQUEST_ID))!)).toBe(before);
  });
});

describe("an incarnation tells two requests under one id apart where no clock can", () => {
  const record = (at: number): RequestRecord =>
    createInitialRequestRecord(
      { requestId: REQUEST_ID, flowKind: FLOW, flowId: FLOW, actionName: "run", userId: "alice" },
      at
    );

  it("gives two records created in the same millisecond different incarnations", () => {
    const first = record(1_000);
    const second = record(1_000);
    expect(first.createdAt).toBe(second.createdAt);
    expect(first.incarnation).not.toBe(second.incarnation);
    expect(isSameRequest(first, second)).toBe(false);
  });

  it("is the same request when the incarnation matches, whatever else it changed over its life", () => {
    const first = record(1_000);
    expect(isSameRequest(first, { ...first, status: "completed", updatedAt: 9_000 })).toBe(true);
  });

  it("derives one stable incarnation for a legacy record, never equal to a stamped one", () => {
    const legacy = record(1_000);
    delete legacy.incarnation;
    const stamped = record(1_000);

    expect(resolveRequestIncarnation(legacy)).toBe(resolveRequestIncarnation({ ...legacy }));
    expect(resolveRequestIncarnation(legacy)).not.toBe(resolveRequestIncarnation(stamped));
    // Legacy records compare as they always did, by birth.
    expect(isSameRequest(legacy, { ...legacy })).toBe(true);
    expect(isSameRequest(legacy, { ...legacy, createdAt: 1_001 })).toBe(false);
    // A legacy record and a stamped one under the same id are two requests,
    // even born in the same millisecond.
    expect(isSameRequest(legacy, stamped)).toBe(false);
  });

  it("reads a legacy record stored with a null incarnation as one without", () => {
    const legacy = record(1_000);
    delete legacy.incarnation;
    const nulled = { ...legacy, incarnation: null } as unknown as RequestRecord;
    expect(resolveRequestIncarnation(nulled)).toBe(resolveRequestIncarnation(legacy));
  });
});
