/**
 * A session's concurrency policy on a BullMQ host, end to end against a real
 * Redis: `createFlowState` with `bullmqWorker`, the real enqueue → worker →
 * `runAction` path, and nothing stubbed.
 *
 * Each "process" is its own `createFlowState` over one shared store: its own
 * hosts, its own arbiter, its own Redis connections. Nothing they share can
 * serialize a key except the lease backend on Redis.
 *
 * The first two suites graduate the spec's POC (`poc/queue-path/`): P1, that
 * no run on a queue host was arbitrated, turned around; and P2, that the
 * incarnation guard crosses the queue, now through a real `dispatcher()`
 * delivery by session id rather than the POC's shortcut past the refusal.
 */
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, FlowError, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import {
  createFlowState,
  inMemoryStores,
  runAction,
  type StoreRegistry,
  type WorkerMode
} from "@flow-state-dev/engine";
import { bullmqWorker, type BullmqWorkerOptions } from "../src/flowstate-adapter";
import { createRedisLeaseBackend, type RedisLeaseBackend } from "../src/lease-backend";
import { REDIS_URL, describeWithRedis, isolatedPrefix, until } from "./redis-helpers";

const USER_ID = "u_owner";

type Span = { tag: string; start: number; end: number };

type Store = StoreRegistry;

/**
 * A recipient session's flow under `queue`, with a sender action that
 * delivers into a session by id. `work` records its run window; a tag
 * starting `fail-once` fails its first attempt retryably, and `holdMs` in the
 * input sets how long it runs (it stops early if its run is stopped).
 */
function sessionFlow(kind: string, spans: Span[]) {
  const attempts = new Map<string, number>();
  const work = handler({
    name: "work",
    inputSchema: z.object({ tag: z.string(), holdMs: z.number().optional() }),
    outputSchema: z.object({}),
    execute: async (input, ctx) => {
      const start = Date.now();
      const attempt = (attempts.get(input.tag) ?? 0) + 1;
      attempts.set(input.tag, attempt);
      if (input.tag.startsWith("fail-once") && attempt === 1) {
        throw new FlowError("transient", { retryable: true });
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, input.holdMs ?? 250);
        ctx.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            spans.push({ tag: `${input.tag}:stopped`, start, end: Date.now() });
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true }
        );
      });
      spans.push({ tag: input.tag, start, end: Date.now() });
      return {};
    }
  });
  const deliver = dispatcher({
    name: "deliver-work",
    type: "internal",
    action: "work",
    inputSchema: z.object({ to: z.string(), tag: z.string() }),
    session: { id: (input) => input.to },
    payload: (input) => ({ tag: input.tag })
  });
  return defineFlow({
    kind,
    actions: {
      work: { block: work, inputSchema: z.object({ tag: z.string(), holdMs: z.number().optional() }) },
      deliver: { block: deliver }
    },
    internal: { actions: { work: { block: work } } },
    request: { concurrency: { policy: "queue", key: "session" } }
  })({ id: kind });
}

/**
 * A conversation (FIX-1836): `reply` is a person's turn (`hold`), `notice` is
 * a follow-up the app wants after it (`defer`). Both record their run window
 * like `sessionFlow`'s `work`. `ignoreAbort` models a run on a worker that
 * crashed: nothing stops it, and nothing gives its place back.
 */
function conversationFlow(kind: string, spans: Span[]) {
  const input = z.object({
    tag: z.string(),
    holdMs: z.number().optional(),
    ignoreAbort: z.boolean().optional()
  });
  const turn = handler({
    name: "turn",
    inputSchema: input,
    outputSchema: z.object({}),
    execute: async (input, ctx) => {
      const start = Date.now();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, input.holdMs ?? 250);
        if (input.ignoreAbort === true) return;
        ctx.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            spans.push({ tag: `${input.tag}:stopped`, start, end: Date.now() });
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true }
        );
      });
      spans.push({ tag: input.tag, start, end: Date.now() });
      return {};
    }
  });
  return defineFlow({
    kind,
    actions: {
      reply: { block: turn, inputSchema: input, concurrency: "hold" },
      notice: { block: turn, inputSchema: input, concurrency: "defer" }
    }
  })({ id: kind });
}

// Real Redis, real queues and timers: allow for a slow CI host.
vi.setConfig({ testTimeout: 45_000, hookTimeout: 20_000 });

let disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const d of disposers.reverse()) await d().catch(() => undefined);
  disposers = [];
});

type Deployment = {
  kind: string;
  prefix: string;
  queueName: string;
  spans: Span[];
  /** The one store adapter every process is built over. */
  primary: ReturnType<typeof inMemoryStores>;
  /** Its registry, as the first process resolved it. */
  store: Store;
};

function deployment(): Deployment {
  const prefix = isolatedPrefix();
  return {
    kind: `flow-${prefix}`,
    prefix,
    queueName: "flows",
    spans: [],
    primary: inMemoryStores(),
    store: undefined as unknown as Store
  };
}

/** One process of the deployment. */
async function processOf(
  d: Deployment,
  flow: ReturnType<typeof sessionFlow> | ReturnType<typeof conversationFlow>,
  mode: WorkerMode,
  options: Partial<BullmqWorkerOptions> = {},
  replaceLeaseBackend?: (adapter: ReturnType<typeof bullmqWorker>) => RedisLeaseBackend
) {
  const adapter = bullmqWorker({
    connection: REDIS_URL!,
    prefix: d.prefix,
    queueName: d.queueName,
    mode,
    concurrency: 2,
    ...options
  });
  const base =
    replaceLeaseBackend === undefined
      ? adapter
      : { ...adapter, leaseBackend: replaceLeaseBackend(adapter) };
  // The BullMQ worker this process starts, so a case can stop it taking jobs.
  let consumer: { close(): Promise<void> } | undefined;
  const worker =
    base.startWorker === undefined
      ? base
      : {
          ...base,
          startWorker: (rt: Parameters<NonNullable<typeof base.startWorker>>[0]) =>
            (consumer = base.startWorker!(rt) as { close(): Promise<void> })
        };
  const state = createFlowState({
    flows: { [d.kind]: flow },
    stores: { default: { primary: d.primary } },
    worker
  });
  disposers.push(() => state.dispose());
  const runtime = await state.getRuntime();
  const router = await state.getRouter();
  d.store ??= runtime.stores;
  return { state, runtime, router, adapter, consumer: () => consumer };
}

async function seedSession(store: Store, id: string, kind: string, lineageId: string) {
  const ts = Date.now();
  await store.session.set(
    id,
    {
      id,
      state: {},
      version: 0,
      createdAt: ts,
      updatedAt: ts,
      flowKind: kind,
      flowId: kind,
      userId: USER_ID,
      orgId: DEFAULT_ORG_ID,
      lineageId,
      journal: []
    },
    "any"
  );
}

type Router = Awaited<ReturnType<typeof processOf>>["router"];

type WorkInput = { tag: string; holdMs?: number; ignoreAbort?: boolean };

async function post(
  router: Router,
  kind: string,
  sessionId: string,
  input: WorkInput,
  action = "work"
): Promise<Response> {
  return router.POST(
    new Request(`http://localhost/api/flows/${kind}/actions/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: USER_ID, sessionId, input })
    }),
    { params: { path: [kind, "actions", action] } }
  );
}

async function postWork(
  router: Router,
  kind: string,
  sessionId: string,
  input: WorkInput,
  action = "work"
): Promise<string> {
  const res = await post(router, kind, sessionId, input, action);
  const body = (await res.json()) as { request?: { id?: string } };
  const requestId = body.request?.id;
  if (requestId === undefined) throw new Error(`no request id (status ${res.status})`);
  return requestId;
}

async function statusesOf(store: Store, ids: string[]): Promise<(string | undefined)[]> {
  return Promise.all(ids.map(async (id) => (await store.request.get(id))?.status));
}

async function untilSettled(store: Store, ids: string[], timeoutMs = 20_000): Promise<void> {
  await until(
    async () => (await statusesOf(store, ids)).every((s) => s !== undefined && s !== "in_progress"),
    `requests ${ids.join(", ")} to settle`,
    timeoutMs
  );
}

const overlapping = (spans: Span[]): Array<[string, string]> => {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      const a = spans[i]!;
      const b = spans[j]!;
      if (a.start < b.end && b.start < a.end) pairs.push([a.tag, b.tag]);
    }
  }
  return pairs;
};

const byStart = (spans: Span[]) => [...spans].sort((a, b) => a.start - b.start).map((s) => s.tag);

describeWithRedis("P1 graduated · runs into one session on BullMQ, across worker processes", () => {
  it("run one at a time, in the order they were accepted (BR-6, V6)", async () => {
    const d = deployment();
    const flow = sessionFlow(d.kind, d.spans);
    const web = await processOf(d, flow, "dispatch-only");
    await processOf(d, flow, "worker-only");
    await processOf(d, flow, "worker-only");
    await seedSession(d.store, "s_r", d.kind, "lin_1");

    const ids: string[] = [];
    for (const tag of ["a", "b", "c", "d"]) ids.push(await postWork(web.router, d.kind, "s_r", { tag }));
    await untilSettled(d.store, ids);

    expect(await statusesOf(d.store, ids)).toEqual(["completed", "completed", "completed", "completed"]);
    expect(overlapping(d.spans)).toEqual([]);
    expect(byStart(d.spans)).toEqual(["a", "b", "c", "d"]);
  });
});

describeWithRedis("P2 graduated · a delivery by session id, through the queue", () => {
  async function colocated() {
    const d = deployment();
    const flow = sessionFlow(d.kind, d.spans);
    const host = await processOf(d, flow, "colocated", { concurrency: 4 });
    const deliver = (to: string, tag: string) =>
      runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "deliver",
        input: { to, tag },
        userId: USER_ID,
        sessionId: "s_sender",
        stores: host.runtime.stores,
        runtimeConfig: { ...host.runtime.runtimeConfig }
      });
    return { d, host, deliver };
  }

  it("is accepted and runs when the recipient is the one the sender saw", async () => {
    const { d, deliver } = await colocated();
    await seedSession(d.store, "s_r", d.kind, "lin_current");
    const sent = await deliver("s_r", "ok");
    expect(sent.error).toBeUndefined();
    const id = (sent.output as { requestId: string }).requestId;
    await untilSettled(d.store, [id]);
    expect(await statusesOf(d.store, [id])).toEqual(["completed"]);
    expect(d.spans.map((s) => s.tag)).toEqual(["ok"]);
  });

  it("is dropped in the worker when the recipient was replaced while it waited, and frees the key (BR-18)", async () => {
    const { d, host, deliver } = await colocated();
    await seedSession(d.store, "s_r", d.kind, "lin_original");
    // Something holds the session, so the delivery waits in line.
    const holding = await postWork(host.router, d.kind, "s_r", { tag: "holding", holdMs: 800 });
    const sent = await deliver("s_r", "stale");
    expect(sent.error).toBeUndefined();
    const id = (sent.output as { requestId: string }).requestId;

    // The recipient is deleted and recreated before the delivery's turn.
    await d.store.session.delete("s_r");
    await seedSession(d.store, "s_r", d.kind, "lin_replacement");

    await untilSettled(d.store, [holding]);
    await until(async () => (await d.store.request.get(id)) === undefined, "the stale delivery to be dropped");
    expect(d.spans.map((s) => s.tag)).not.toContain("stale");

    // Its place was given up: the next run into the session is not blocked.
    const after = await postWork(host.router, d.kind, "s_r", { tag: "after" });
    await untilSettled(d.store, [after], 8_000);
    expect(await statusesOf(d.store, [after])).toEqual(["completed"]);
  });
});

describeWithRedis("waiting for a turn on a BullMQ worker", () => {
  it("never holds a slot: more waiters than slots, and a holder in retry backoff, all run in order (BR-9, BR-12)", async () => {
    // Two slots, a holder whose first attempt fails and sits in retry backoff,
    // and three runs behind it. A waiter that held its slot would fill both
    // and the holder could never come back. A requeue counted as an attempt
    // would fail the waiters, which requeue many times on an attempt budget of 2.
    const d = deployment();
    const flow = sessionFlow(d.kind, d.spans);
    const host = await processOf(d, flow, "colocated", {
      concurrency: 2,
      retry: { attempts: 2, backoff: { type: "fixed", delay: 1_000 } }
    });
    await seedSession(d.store, "s_r", d.kind, "lin_1");

    const ids: string[] = [];
    for (const tag of ["fail-once-holder", "w1", "w2", "w3"]) {
      ids.push(await postWork(host.router, d.kind, "s_r", { tag, holdMs: 150 }));
    }
    await untilSettled(d.store, ids, 30_000);

    expect(await statusesOf(d.store, ids)).toEqual(["completed", "completed", "completed", "completed"]);
    expect(overlapping(d.spans)).toEqual([]);
    expect(byStart(d.spans)).toEqual(["fail-once-holder", "w1", "w2", "w3"]);
  });

  it("stops a holder that can no longer renew its place before another worker takes the key, and the key frees (BR-11)", async () => {
    // A worker that loses Redis cannot renew the place its run holds. It stops
    // the run at half the lease; the place runs out at the full lease; only
    // then may another worker's run start. A worker that died outright frees
    // the key the same way, within the lease.
    const d = deployment();
    const flow = sessionFlow(d.kind, d.spans);
    const leaseMs = 1_000;
    const web = await processOf(d, flow, "dispatch-only", { leaseMs });
    const workerA = await processOf(d, flow, "worker-only", { leaseMs, concurrency: 1 });
    await seedSession(d.store, "s_r", d.kind, "lin_1");

    const holder = await postWork(web.router, d.kind, "s_r", { tag: "holder", holdMs: 20_000 });
    await until(async () => (await d.store.request.get(holder))?.status === "in_progress" && d.spans.length === 0, "the holder to start");
    await new Promise((r) => setTimeout(r, 300));

    // Only now can the next run land anywhere but in worker A's one slot.
    await processOf(d, flow, "worker-only", { leaseMs });
    const next = await postWork(web.router, d.kind, "s_r", { tag: "next" });
    await new Promise((r) => setTimeout(r, 300));
    expect(d.spans).toEqual([]);

    const severedAt = Date.now();
    await (workerA.adapter.leaseBackend as RedisLeaseBackend).close();
    // A worker cut off from Redis takes no more work: its slot, freed when
    // the holder stops, must not pick up `next` (a turn check there fails,
    // which the processor's own tests cover). Closing lets the holder drain.
    const drainingA = workerA.consumer()!.close();

    await untilSettled(d.store, [holder, next], 15_000);
    const stopped = d.spans.find((s) => s.tag === "holder:stopped");
    const ran = d.spans.find((s) => s.tag === "next");
    expect(stopped, "the holder was stopped").toBeDefined();
    expect(ran, "the next run ran").toBeDefined();
    expect(stopped!.end).toBeLessThan(ran!.start);
    expect(stopped!.end - severedAt).toBeLessThan(leaseMs);
    expect(ran!.start - severedAt).toBeLessThan(leaseMs + 3_000);
    expect(await statusesOf(d.store, [holder, next])).toEqual(["interrupted", "completed"]);
    await drainingA;
  });

  it("starts nothing and enqueues nothing when the lease backend cannot be reached (BR-16)", async () => {
    const d = deployment();
    const flow = sessionFlow(d.kind, d.spans);
    const web = await processOf(d, flow, "dispatch-only", {}, (adapter) =>
      createRedisLeaseBackend({
        connection: {
          host: "127.0.0.1",
          port: 1,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 0,
          retryStrategy: () => null
        },
        queue: adapter.queue
      })
    );
    await seedSession(d.store, "s_r", d.kind, "lin_1");

    const res = await post(web.router, d.kind, "s_r", { tag: "unarbitrated" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const counts = await web.adapter.queue.getJobCounts();
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(0);
    expect(d.spans).toEqual([]);
  });
});

describeWithRedis("a reply and its notice on BullMQ workers (FIX-1836)", () => {
  it("runs the notice after the reply, waits for a reply that starts while it waits, and runs notices one at a time", async () => {
    const d = deployment();
    const flow = conversationFlow(d.kind, d.spans);
    const web = await processOf(d, flow, "dispatch-only");
    await processOf(d, flow, "worker-only", { concurrency: 2 });
    await processOf(d, flow, "worker-only", { concurrency: 2 });
    await seedSession(d.store, "s_c", d.kind, "lin_1");

    const reply1 = await postWork(web.router, d.kind, "s_c", { tag: "reply-1", holdMs: 1_000 }, "reply");
    const n1 = await postWork(web.router, d.kind, "s_c", { tag: "notice-1", holdMs: 300 }, "notice");
    const n2 = await postWork(web.router, d.kind, "s_c", { tag: "notice-2", holdMs: 300 }, "notice");
    await new Promise((r) => setTimeout(r, 400));
    // A person's next message starts at once, mid-reply.
    const reply2 = await postWork(web.router, d.kind, "s_c", { tag: "reply-2", holdMs: 1_000 }, "reply");
    const ids = [reply1, n1, n2, reply2];
    await untilSettled(d.store, ids, 30_000);

    expect(await statusesOf(d.store, ids)).toEqual(["completed", "completed", "completed", "completed"]);
    const span = (tag: string) => d.spans.find((s) => s.tag === tag)!;
    // The replies overlap: `hold` never waits.
    expect(overlapping(d.spans).map((pair) => [...pair].sort())).toContainEqual(["reply-1", "reply-2"]);
    // Every notice starts after every reply has ended, and notices never
    // overlap each other.
    const lastReplyEnd = Math.max(span("reply-1").end, span("reply-2").end);
    expect(span("notice-1").start).toBeGreaterThanOrEqual(lastReplyEnd);
    expect(span("notice-2").start).toBeGreaterThanOrEqual(lastReplyEnd);
    expect(overlapping(d.spans.filter((s) => s.tag.startsWith("notice")))).toEqual([]);
  });

  it("runs the notice once the lease of a crashed reply's worker runs out", async () => {
    // Worker A takes the reply, then is cut off from Redis: it never renews
    // the reply's place or gives it back, and its run goes on regardless, as
    // a crashed container's would from the rest of the deployment's view.
    const d = deployment();
    const flow = conversationFlow(d.kind, d.spans);
    const leaseMs = 1_000;
    const web = await processOf(d, flow, "dispatch-only", { leaseMs });
    const workerA = await processOf(d, flow, "worker-only", { leaseMs, concurrency: 1 });
    await seedSession(d.store, "s_c", d.kind, "lin_1");

    await postWork(web.router, d.kind, "s_c", { tag: "reply", holdMs: 8_000, ignoreAbort: true }, "reply");
    await until(async () => (await web.adapter.queue.getActiveCount()) === 1, "the reply to start on worker A");

    await processOf(d, flow, "worker-only", { leaseMs });
    const notice = await postWork(web.router, d.kind, "s_c", { tag: "notice", holdMs: 100 }, "notice");
    await new Promise((r) => setTimeout(r, 500));
    expect(d.spans).toEqual([]);

    const crashedAt = Date.now();
    await (workerA.adapter.leaseBackend as RedisLeaseBackend).close();

    await untilSettled(d.store, [notice], 15_000);
    expect(await statusesOf(d.store, [notice])).toEqual(["completed"]);
    const ran = d.spans.find((s) => s.tag === "notice")!;
    // It waited out the lease, and not much longer.
    expect(ran.start - crashedAt).toBeGreaterThanOrEqual(leaseMs);
    expect(ran.start - crashedAt).toBeLessThan(leaseMs + 3_000);
    // The reply is still running on the crashed worker: nothing it did let
    // the notice go.
    expect(d.spans.map((s) => s.tag)).not.toContain("reply");
  });
});
