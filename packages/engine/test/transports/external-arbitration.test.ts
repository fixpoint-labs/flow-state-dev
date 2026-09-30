/**
 * Work handed to an external queue, arbitrated over a lease backend the worker
 * processes share.
 *
 * Each "process" here is its own `createFlowState` — its own hosts, its own
 * arbiter — over one store and, where the case needs it, one backend. The
 * worker is a test adapter whose dispatcher runs each job in this process the
 * way a queue worker would: it waits for the job's place to come round, runs
 * `runAction`, and gives the place back. Nothing shares a lock except the
 * backend, so only the backend can make two processes agree about a key.
 *
 * The backend is adapter-shaped — only its four public calls, answered
 * asynchronously — so the arbiter takes the path a Redis backend would.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import type { ConcurrencyConfig } from "@flow-state-dev/core";
import {
  ConcurrencyRejectedError,
  createFlowRegistry,
  createFlowState,
  createInboundTransportHost,
  createInMemoryLeaseBackend,
  createInMemoryStores,
  defaultBodyUserIdPrincipalResolver,
  inMemoryStores,
  planQueueWait,
  runAction,
  type ConcurrencyLeaseBackend,
  type DispatchEnvelope,
  type FlowDispatcher,
  type WorkerAdapter
} from "../../src";
import type { FlowStateRuntime } from "../../src/flowstate/types";
import type { ExecutionResult } from "../../src/execution/types";
import type { StoreAdapter } from "../../src/stores";
import { createConcurrencyArbiter } from "../../src/transports/concurrency/arbiter";
import { abortRequest } from "../../src/execution/abort-registry";

const USER = "u_alice";

type Observed = { runs: { action: string; sessionId: string; note: string }[] };

/** A flow whose `hold` parks until released, with a `deliver` into an existing session. */
function queueFlow(kind: string, observed: Observed, concurrency: ConcurrencyConfig) {
  const gates: Array<() => void> = [];
  const hold = handler({
    name: "hold",
    inputSchema: z.object({ note: z.string() }),
    outputSchema: z.object({}),
    execute: async (input, ctx) => {
      observed.runs.push({ action: "hold", sessionId: ctx.session.identity.id, note: input.note });
      await new Promise<void>((resolve) => gates.push(resolve));
      return {};
    }
  });
  const work = handler({
    name: "work",
    inputSchema: z.object({ note: z.string() }),
    outputSchema: z.object({}),
    execute: async (input, ctx) => {
      observed.runs.push({ action: "work", sessionId: ctx.session.identity.id, note: input.note });
      return {};
    }
  });
  const deliver = dispatcher({
    name: "deliver-work",
    type: "internal",
    action: "work",
    inputSchema: z.object({ to: z.string(), note: z.string() }),
    session: { id: (input) => input.to },
    payload: (input) => ({ note: input.note })
  });
  const flow = defineFlow({
    kind,
    actions: {
      hold: { block: hold, inputSchema: z.object({ note: z.string() }) },
      deliver: { block: deliver }
    },
    internal: { actions: { work: { block: work } } },
    request: { concurrency }
  })({ id: kind });
  return { flow, releaseOne: () => gates.shift()?.(), releaseAll: () => gates.splice(0).forEach((g) => g()) };
}

/**
 * The adapter's four public calls over one shared in-memory line, and nothing
 * else — no synchronous admission, no in-process wake.
 */
function adapterShaped(inner = createInMemoryLeaseBackend()): ConcurrencyLeaseBackend {
  return {
    take: (input) => inner.take(input),
    isMyTurn: (place) => inner.isMyTurn(place),
    giveBack: (place) => inner.giveBack(place),
    renew: (place) => inner.renew(place)
  };
}

/**
 * A queue worker's job loop, in miniature: wait for the place's turn on the
 * engine's schedule, run, give the place back. A job with no place runs as it
 * always did.
 */
function testWorker(options: {
  backend?: ConcurrencyLeaseBackend;
  enqueued: DispatchEnvelope[];
  failEnqueue?: () => boolean;
  /** Hold every enqueue until this settles: a slow queue acknowledgement. */
  enqueueAck?: Promise<void>;
}): WorkerAdapter {
  return {
    mode: "dispatch-only",
    ...(options.backend !== undefined ? { leaseBackend: options.backend } : {}),
    createDispatcher(runtime: FlowStateRuntime): FlowDispatcher {
      return {
        async dispatch(envelope) {
          if (options.failEnqueue?.() === true) throw new Error("queue unavailable");
          await options.enqueueAck;
          options.enqueued.push(envelope);
          const finished = runJob(runtime, options.backend, envelope);
          finished.catch(() => undefined);
          return { requestId: envelope.requestId, finished, abort: () => {} };
        },
        close: async () => {}
      } as FlowDispatcher;
    },
    startWorker: () => ({ close: async () => {} })
  };
}

async function runJob(
  runtime: FlowStateRuntime,
  backend: ConcurrencyLeaseBackend | undefined,
  envelope: DispatchEnvelope
): Promise<ExecutionResult> {
  const place = envelope.leasePlace;
  if (place != null && backend !== undefined) {
    const since = Date.now();
    for (let attempt = 0; !(await backend.isMyTurn(place)); attempt += 1) {
      const step = planQueueWait({ key: place.key, waitedMs: Date.now() - since, attempt });
      if (step.kind === "timeout") throw step.error;
      await backend.renew(place);
      await new Promise((r) => setTimeout(r, step.delayMs));
    }
  }
  try {
    const flow = runtime.registry.get(envelope.flowKind)!;
    return await runAction({
      flow,
      actionName: envelope.actionName,
      input: envelope.input,
      userId: envelope.userId,
      sessionId: envelope.sessionId,
      requestId: envelope.requestId,
      orgId: envelope.orgId,
      tenantId: envelope.tenantId,
      source: envelope.source,
      metadata: envelope.metadata,
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig
    });
  } finally {
    if (place != null && backend !== undefined) await backend.giveBack(place);
  }
}

/** One process of the deployment: its own FlowState over the shared store. */
async function processOf(
  flow: ReturnType<typeof queueFlow>["flow"],
  store: StoreAdapter,
  worker: WorkerAdapter
) {
  const state = createFlowState({
    flows: { [flow.kind]: flow },
    stores: { default: { primary: store } },
    worker
  });
  return { state, runtime: await state.getRuntime(), router: await state.getRouter() };
}

async function seedSession(runtime: FlowStateRuntime, id: string, flowKind: string, userId = USER) {
  const ts = Date.now();
  await runtime.stores.session.set(
    id,
    {
      id,
      state: {},
      version: 0,
      createdAt: ts,
      updatedAt: ts,
      flowKind,
      userId,
      orgId: DEFAULT_ORG_ID,
      lineageId: `lin_${id}`,
      journal: []
    },
    "any"
  );
}

function postAction(
  router: Awaited<ReturnType<typeof processOf>>["router"],
  kind: string,
  action: string,
  body: Record<string, unknown>
): Promise<Response> {
  return router.POST(
    new Request(`http://localhost/api/flows/${kind}/actions/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    { params: { path: [kind, "actions", action] } }
  );
}

function deliverFrom(
  runtime: FlowStateRuntime,
  flow: ReturnType<typeof queueFlow>["flow"],
  to: string,
  note: string,
  userId = USER
) {
  return runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "deliver",
    input: { to, note },
    userId,
    sessionId: `s_sender_${userId}`,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  });
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const settle = () => new Promise((r) => setTimeout(r, 60));

describe("a delivery into an existing session, on a queue host whose adapter supplies a lease backend", () => {
  it("is accepted, carries its place on the job, and runs after the run that holds the session", async () => {
    const observed: Observed = { runs: [] };
    const { flow, releaseAll } = queueFlow("ext-deliver", observed, "queue");
    const store = inMemoryStores();
    const backend = adapterShaped();
    const enqueued: DispatchEnvelope[] = [];
    // The web process that takes the HTTP action, and a second process that
    // sends the delivery. They share the store and the backend, nothing else.
    const web = await processOf(flow, store, testWorker({ backend, enqueued }));
    const other = await processOf(flow, store, testWorker({ backend, enqueued }));
    try {
      await seedSession(web.runtime, "s_alice", "ext-deliver");
      const held = await postAction(web.router, "ext-deliver", "hold", {
        userId: USER,
        sessionId: "s_alice",
        input: { note: "first" }
      });
      expect(held.status).toBe(202);
      await until(() => observed.runs.length === 1, "the hold to start");

      const sent = await deliverFrom(other.runtime, flow, "s_alice", "second");
      expect(sent.error).toBeUndefined();
      const delivery = enqueued.find((e) => e.actionName === "work");
      expect(delivery?.leasePlace).toMatchObject({ key: "s_alice" });

      // Accepted, but behind the hold: another process's run holds the key.
      await settle();
      expect(observed.runs.map((r) => r.note)).toEqual(["first"]);

      releaseAll();
      await until(() => observed.runs.length === 2, "the delivery to run");
      expect(observed.runs[1]).toEqual({ action: "work", sessionId: "s_alice", note: "second" });
    } finally {
      releaseAll();
      await web.state.dispose();
      await other.state.dispose();
    }
  });

  it("control: two processes each with a backend of its own overlap, so the case above can fail", async () => {
    const observed: Observed = { runs: [] };
    const { flow, releaseAll } = queueFlow("ext-control", observed, "queue");
    const store = inMemoryStores();
    const enqueued: DispatchEnvelope[] = [];
    const web = await processOf(flow, store, testWorker({ backend: adapterShaped(), enqueued }));
    const other = await processOf(flow, store, testWorker({ backend: adapterShaped(), enqueued }));
    try {
      await seedSession(web.runtime, "s_alice", "ext-control");
      await postAction(web.router, "ext-control", "hold", {
        userId: USER,
        sessionId: "s_alice",
        input: { note: "first" }
      });
      await until(() => observed.runs.length === 1, "the hold to start");
      const sent = await deliverFrom(other.runtime, flow, "s_alice", "second");
      expect(sent.error).toBeUndefined();
      await until(() => observed.runs.length === 2, "the delivery to overlap the hold");
    } finally {
      releaseAll();
      await web.state.dispose();
      await other.state.dispose();
    }
  });

  it("is refused `session-not-found` for another user, and leaves the owner's key free", async () => {
    const observed: Observed = { runs: [] };
    const { flow } = queueFlow("ext-other-user", observed, "queue");
    const inner = createInMemoryLeaseBackend();
    const enqueued: DispatchEnvelope[] = [];
    const web = await processOf(flow, inMemoryStores(), testWorker({ backend: adapterShaped(inner), enqueued }));
    try {
      await seedSession(web.runtime, "s_alice", "ext-other-user");
      const sent = await deliverFrom(web.runtime, flow, "s_alice", "from bob", "u_bob");
      expect(sent.error?.message).toMatch(/session-not-found/);
      expect(enqueued).toEqual([]);
      expect(observed.runs).toEqual([]);
      expect("place" in (await inner.take({ key: "s_alice", requestId: "probe", ifEmpty: true }))).toBe(true);
    } finally {
      await web.state.dispose();
    }
  });

  it("is still refused `external-dispatcher` when the adapter supplies no lease backend", async () => {
    const observed: Observed = { runs: [] };
    const { flow } = queueFlow("ext-no-backend", observed, "queue");
    const enqueued: DispatchEnvelope[] = [];
    const web = await processOf(flow, inMemoryStores(), testWorker({ enqueued }));
    try {
      await seedSession(web.runtime, "s_alice", "ext-no-backend");
      const sent = await deliverFrom(web.runtime, flow, "s_alice", "hi");
      expect(sent.error?.message).toMatch(/external-dispatcher/);
      expect(sent.error?.message).toMatch(/lease backend/);
      expect(enqueued).toEqual([]);
    } finally {
      await web.state.dispose();
    }
  });
});

describe("the place a dispatch takes before the queue", () => {
  it("is given back when the enqueue fails, so the session is not blocked", async () => {
    const observed: Observed = { runs: [] };
    const { flow } = queueFlow("ext-enqueue-fail", observed, "queue");
    const inner = createInMemoryLeaseBackend();
    const enqueued: DispatchEnvelope[] = [];
    let failNext = true;
    const web = await processOf(
      flow,
      inMemoryStores(),
      testWorker({
        backend: adapterShaped(inner),
        enqueued,
        failEnqueue: () => {
          const fail = failNext;
          failNext = false;
          return fail;
        }
      })
    );
    try {
      const failed = await postAction(web.router, "ext-enqueue-fail", "hold", {
        userId: USER,
        sessionId: "s_alice",
        requestId: "req_failed",
        input: { note: "lost" }
      });
      expect(failed.status).toBe(500);
      expect(enqueued).toEqual([]);
      expect("place" in (await inner.take({ key: "s_alice", requestId: "probe", ifEmpty: true }))).toBe(true);
    } finally {
      await web.state.dispose();
    }
  });

  it("is renewed while the enqueue is pending, and left to the job once it is enqueued", async () => {
    // A slow queue acknowledgement holds the place in this process. Nobody
    // else renews it then; once the job is enqueued its worker does.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const observed: Observed = { runs: [] };
    const { flow, releaseAll } = queueFlow("ext-slow-enqueue", observed, "queue");
    const renewed: string[] = [];
    const shaped = adapterShaped();
    const backend: ConcurrencyLeaseBackend = {
      ...shaped,
      renew: async (place) => {
        renewed.push(place.ticket);
      }
    };
    let ack!: () => void;
    const enqueueAck = new Promise<void>((r) => (ack = r));
    const enqueued: DispatchEnvelope[] = [];
    const web = await processOf(flow, inMemoryStores(), testWorker({ backend, enqueued, enqueueAck }));
    try {
      const posted = postAction(web.router, "ext-slow-enqueue", "hold", {
        userId: USER,
        sessionId: "s_alice",
        input: { note: "a" }
      });
      await settle();
      vi.advanceTimersByTime(10_000);
      expect(renewed.length).toBeGreaterThanOrEqual(3);

      ack();
      expect((await posted).status).toBe(202);
      const atEnqueue = renewed.length;
      vi.advanceTimersByTime(10_000);
      expect(renewed.length).toBe(atEnqueue);
    } finally {
      vi.useRealTimers();
      releaseAll();
      await web.state.dispose();
    }
  });

  it("is not taken for `allow`: the job carries no place", async () => {
    const observed: Observed = { runs: [] };
    const { flow, releaseAll } = queueFlow("ext-allow", observed, "allow");
    const enqueued: DispatchEnvelope[] = [];
    const web = await processOf(flow, inMemoryStores(), testWorker({ backend: adapterShaped(), enqueued }));
    try {
      const res = await postAction(web.router, "ext-allow", "hold", {
        userId: USER,
        sessionId: "s_alice",
        input: { note: "a" }
      });
      expect(res.status).toBe(202);
      expect(enqueued).toHaveLength(1);
      expect(enqueued[0]!.leasePlace).toBeUndefined();
    } finally {
      releaseAll();
      await web.state.dispose();
    }
  });

  it("fails closed: an unreachable backend starts nothing and writes nothing", async () => {
    const observed: Observed = { runs: [] };
    const { flow } = queueFlow("ext-down", observed, "queue");
    const down: ConcurrencyLeaseBackend = {
      take: async () => {
        throw new Error("lease backend unreachable");
      },
      isMyTurn: async () => true,
      giveBack: async () => {},
      renew: async () => {}
    };
    const enqueued: DispatchEnvelope[] = [];
    const web = await processOf(flow, inMemoryStores(), testWorker({ backend: down, enqueued }));
    try {
      const res = await postAction(web.router, "ext-down", "hold", {
        userId: USER,
        sessionId: "s_alice",
        requestId: "req_down",
        input: { note: "a" }
      });
      expect(res.status).toBe(500);
      expect(await res.text()).toMatch(/lease backend unreachable/);
      expect(enqueued).toEqual([]);
      expect(await web.runtime.stores.request.get("req_down")).toBeUndefined();
    } finally {
      await web.state.dispose();
    }
  });
});

describe("`reject` on a queue host, refused through acceptance", () => {
  it("answers a second HTTP action 409 naming the first, and leaves no record for it", async () => {
    const observed: Observed = { runs: [] };
    const { flow, releaseAll } = queueFlow("ext-reject", observed, "reject");
    const store = inMemoryStores();
    const backend = adapterShaped();
    const enqueued: DispatchEnvelope[] = [];
    const web = await processOf(flow, store, testWorker({ backend, enqueued }));
    const other = await processOf(flow, store, testWorker({ backend, enqueued }));
    try {
      const first = await postAction(web.router, "ext-reject", "hold", {
        userId: USER,
        sessionId: "s_alice",
        requestId: "req_first",
        input: { note: "first" }
      });
      expect(first.status).toBe(202);

      const second = await postAction(other.router, "ext-reject", "hold", {
        userId: USER,
        sessionId: "s_alice",
        requestId: "req_second",
        input: { note: "second" }
      });
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({
        error: "ConcurrencyRejected",
        requestId: "req_first"
      });
      expect(await web.runtime.stores.request.get("req_second")).toBeUndefined();
      expect(enqueued.map((e) => e.requestId)).toEqual(["req_first"]);
    } finally {
      releaseAll();
      await web.state.dispose();
      await other.state.dispose();
    }
  });
});

describe("a run a process starts in process, over the deployment's backend", () => {
  // A `worker-only` process runs its own deliveries in process. Over the
  // adapter's backend those runs line up on the same keys as every other
  // process's, with an admission that is asynchronous.
  function inProcessHosts(
    concurrency: ConcurrencyConfig,
    wrap: (backend: ConcurrencyLeaseBackend) => ConcurrencyLeaseBackend = (b) => b
  ) {
    const observed: Observed = { runs: [] };
    const { flow, releaseOne, releaseAll } = queueFlow("in-proc", observed, concurrency);
    const registry = createFlowRegistry();
    registry.register(flow);
    const stores = createInMemoryStores();
    const takes: string[] = [];
    const shaped = adapterShaped();
    const backend = wrap({
      ...shaped,
      take: (input) => {
        takes.push(input.requestId);
        return shaped.take(input);
      }
    });
    const host = () =>
      createInboundTransportHost({
        registry,
        stores,
        resolvePrincipal: defaultBodyUserIdPrincipalResolver,
        runtimeConfig: {},
        arbiter: createConcurrencyArbiter({ backend })
      });
    return { observed, stores, takes, releaseOne, releaseAll, a: host(), b: host() };
  }

  const envelope = (note: string, requestId: string) => ({
    source: "http" as const,
    flowKind: "in-proc",
    action: "hold",
    input: { note },
    requestId,
    sessionId: "s_alice",
    principal: { userId: USER, orgId: DEFAULT_ORG_ID }
  });

  it("serializes `queue` runs started by two processes, in the order they were admitted", async () => {
    const h = inProcessHosts("queue");
    const first = h.a.dispatch(envelope("first", "req_1"));
    await first.accepted;
    const second = h.b.dispatch(envelope("second", "req_2"));
    await second.accepted;
    await until(() => h.observed.runs.length === 1, "the first run");
    await settle();
    expect(h.observed.runs.map((r) => r.note)).toEqual(["first"]);
    h.releaseOne();
    await first.finished;
    await until(() => h.observed.runs.length === 2, "the second run");
    h.releaseAll();
    await second.finished;
    expect(h.observed.runs.map((r) => r.note)).toEqual(["first", "second"]);
  });

  it("refuses a `reject` through acceptance and writes no record for it", async () => {
    const h = inProcessHosts("reject");
    const first = h.a.dispatch(envelope("first", "req_1"));
    await first.accepted;
    const second = h.b.dispatch(envelope("second", "req_2"));
    await expect(second.accepted).rejects.toBeInstanceOf(ConcurrencyRejectedError);
    await expect(second.finished).rejects.toMatchObject({ inFlightRequestId: "req_1" });
    expect(await h.stores.request.get("req_2")).toBeUndefined();
    await until(() => h.observed.runs.length === 1, "the first run");
    h.releaseAll();
    await first.finished;
  });

  it.each(["queue", "reject"] as const)(
    "takes no place for a caller who does not own the session (%s)",
    async (policy) => {
      // Every process honours a place on the shared backend. One taken before
      // the ownership read would let another user stand in line on (or, for
      // `reject`, hold) the owner's session key while that read runs.
      const h = inProcessHosts(policy);
      const ts = Date.now();
      await h.stores.session.set(
        "s_alice",
        {
          id: "s_alice",
          state: {},
          version: 0,
          createdAt: ts,
          updatedAt: ts,
          flowKind: "in-proc",
          userId: USER,
          orgId: DEFAULT_ORG_ID,
          lineageId: "lin_s_alice",
          journal: []
        },
        "any"
      );
      const bob = h.a.dispatch({
        ...envelope("from bob", "req_bob"),
        principal: { userId: "u_bob", orgId: DEFAULT_ORG_ID }
      });
      await expect(bob.finished).rejects.toThrow();
      expect(h.takes).not.toContain("req_bob");
      expect(h.observed.runs).toEqual([]);
    }
  );

  it.each(["queue", "reject"] as const)(
    "takes no place for the owner's request from another organization (%s)",
    async (policy) => {
      // Same user, same tenant, a session bound to another org: the run is
      // refused at execution, and must not hold or queue on the key first.
      const h = inProcessHosts(policy);
      const ts = Date.now();
      await h.stores.session.set(
        "s_alice",
        {
          id: "s_alice",
          state: {},
          version: 0,
          createdAt: ts,
          updatedAt: ts,
          flowKind: "in-proc",
          userId: USER,
          orgId: "org_other",
          lineageId: "lin_s_alice",
          journal: []
        },
        "any"
      );
      const crossOrg = h.a.dispatch(envelope("from another org", "req_cross_org"));
      await expect(crossOrg.finished).rejects.toThrow();
      expect(h.takes).not.toContain("req_cross_org");
      expect(h.observed.runs).toEqual([]);
    }
  );

  it("settles the record of a queued run whose wait fails before its turn", async () => {
    // The backend becomes unreachable while the second run waits. The run
    // never starts, so nothing else will settle its `in_progress` record.
    let unreachable = false;
    const h = inProcessHosts("queue", (b) => ({
      ...b,
      isMyTurn: async (place) => {
        if (unreachable) throw new Error("lease backend unreachable");
        return b.isMyTurn(place);
      }
    }));
    const first = h.a.dispatch(envelope("first", "req_1"));
    await first.accepted;
    await until(() => h.observed.runs.length === 1, "the first run");
    unreachable = true;
    const second = h.b.dispatch(envelope("second", "req_2"));
    await second.accepted;
    await expect(second.finished).rejects.toThrow("lease backend unreachable");
    expect((await h.stores.request.get("req_2"))?.status).toBe("failed");
    h.releaseAll();
    await first.finished;
  });

  it("gives a cancelled queued run's place back at once, not when its turn comes", async () => {
    // Cancel is the requester withdrawing. A place still in line on the shared
    // backend is renewed for as long as this process waits on it, so a cancel
    // honoured only at the turn keeps the session's line, and the stub, open
    // for as long as the run ahead of it takes.
    const ticketOf = new Map<string, string>();
    const givenBack: string[] = [];
    const h = inProcessHosts("queue", (b) => ({
      ...b,
      take: async (input) => {
        const result = await b.take(input);
        if ("place" in result) ticketOf.set(input.requestId, result.place.ticket);
        return result;
      },
      giveBack: async (place) => {
        givenBack.push(place.ticket);
        return b.giveBack(place);
      }
    }));
    const first = h.a.dispatch(envelope("first", "req_1"));
    await first.accepted;
    await until(() => h.observed.runs.length === 1, "the first run");
    const second = h.b.dispatch(envelope("second", "req_2"));
    await second.accepted;

    expect(abortRequest("req_2")).toBe(true);

    // All of this lands while the first run still holds the session.
    await expect(second.finished).rejects.toThrow(/cancelled before it left the concurrency queue/);
    expect(givenBack).toContain(ticketOf.get("req_2"));
    expect((await h.stores.request.get("req_2"))?.status).toBe("aborted");
    expect(h.observed.runs.map((r) => r.note)).toEqual(["first"]);

    // The line behind it is not held up by the cancelled place.
    const third = h.a.dispatch(envelope("third", "req_3"));
    await third.accepted;
    h.releaseOne();
    await first.finished;
    await until(() => h.observed.runs.length === 2, "the third run");
    h.releaseAll();
    await third.finished;
    expect(h.observed.runs.map((r) => r.note)).toEqual(["first", "third"]);
  });
});
