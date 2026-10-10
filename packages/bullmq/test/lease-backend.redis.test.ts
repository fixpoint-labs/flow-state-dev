/**
 * The Redis lease backend, and the job processor's wait on it, against a real
 * Redis. Every process of a deployment reaches the same lines through these
 * calls, so each assertion here is about what another process would see.
 */
import { afterEach, expect, it, vi } from "vitest";
import { Queue, DelayedError } from "bullmq";
import type { Job } from "bullmq";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createInMemoryStores, type LeasePlace } from "@flow-state-dev/engine";
import { createRedisLeaseBackend, leaseJobId, type RedisLeaseBackend } from "../src/lease-backend";
import { createFlowJobProcessor } from "../src/worker";
import { resolveProducerConnection } from "../src/connection";
import type { FlowJobData } from "../src/types";
import { REDIS_URL, describeWithRedis, isolatedPrefix } from "./redis-helpers";

// Real Redis, real queues and timers: allow for a slow CI host.
vi.setConfig({ testTimeout: 45_000, hookTimeout: 20_000 });

let cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanup.reverse()) await c().catch(() => undefined);
  cleanup = [];
});

function setup(leaseMs?: number): { backend: RedisLeaseBackend; queue: Queue } {
  const prefix = isolatedPrefix();
  const queue = new Queue("flows", {
    connection: resolveProducerConnection({ connection: REDIS_URL! }).connection,
    prefix
  });
  const backend = createRedisLeaseBackend({ connection: REDIS_URL!, prefix, queue, leaseMs });
  cleanup.push(async () => {
    await backend.close();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
  });
  return { backend, queue };
}

async function place(
  backend: RedisLeaseBackend,
  requestId: string,
  key = "tenant_a:s_1",
  jobId?: string
): Promise<LeasePlace> {
  const taken = await backend.take({ key, requestId, ...(jobId !== undefined ? { jobId } : {}) });
  if (!("place" in taken)) throw new Error(`expected a place for ${requestId}`);
  return taken.place;
}

describeWithRedis("the Redis lease backend", () => {
  it("orders places, names the holder to an ifEmpty take, and moves the turn on give-back", async () => {
    const { backend } = setup();
    const first = await place(backend, "r1");
    const second = await place(backend, "r2");
    expect(await backend.take({ key: first.key, requestId: "r3", ifEmpty: true })).toEqual({
      heldBy: "r1"
    });
    expect(await backend.isMyTurn(first)).toBe(true);
    expect(await backend.isMyTurn(second)).toBe(false);

    await backend.giveBack(first);
    await backend.giveBack(first); // idempotent
    expect(await backend.isMyTurn(second)).toBe(true);
    expect(await backend.isMyTurn(first)).toBe("missing");
    expect(await backend.renew(first)).toBe(false);
    expect(await backend.renew(second)).toBe(true);
  });

  it("keeps the same session id in two tenants on two keys (BR-15)", async () => {
    const { backend } = setup();
    const a = await place(backend, "r1", "tenant_a:s_1");
    const b = await place(backend, "r2", "tenant_b:s_1");
    expect(await backend.isMyTurn(a)).toBe(true);
    expect(await backend.isMyTurn(b)).toBe(true);
  });

  it("keeps an expired place whose job is still coming back, and drops one whose job is gone (BR-21)", async () => {
    // A place lives only while something renews it. One whose job sits in
    // the queue (delayed, waiting, in retry backoff) is still owed its turn;
    // one whose job never arrived or already finished is not.
    const { backend, queue } = setup(300);
    const coming = await place(backend, "r_coming");
    await queue.add("flow-run", {}, { jobId: leaseJobId(coming), delay: 60_000 });
    const gone = await place(backend, "r_gone");
    const later = await place(backend, "r_later");
    await new Promise((r) => setTimeout(r, 450));
    // Nobody renewed any of them. The later place asks for its turn: the
    // gone one is dropped, the coming one keeps its turn and position.
    await backend.renew(later);
    expect(await backend.isMyTurn(later)).toBe(false);
    expect(await backend.isMyTurn(coming)).toBe(true);
    expect(await backend.isMyTurn(gone)).toBe("missing");
    await backend.giveBack(coming);
    expect(await backend.isMyTurn(later)).toBe(true);
  });

  it("wakes the next place's delayed job when the first is given back", async () => {
    // Without the wake, the next run starts only when its requeue delay ends.
    const { backend, queue } = setup();
    const first = await place(backend, "r1");
    const next = await place(backend, "r2");
    await queue.add("flow-run", {}, { jobId: leaseJobId(next), delay: 60_000 });
    expect(await queue.getJobState(leaseJobId(next))).toBe("delayed");
    await backend.giveBack(first);
    expect(await queue.getJobState(leaseJobId(next))).toBe("waiting");
  });
});

/** A job as the processor sees it, recording what it asks BullMQ to do. */
function fakeJob(
  data: FlowJobData,
  id: string,
  options: { attempts?: number; failUpdates?: number } = {}
) {
  const calls: { updateData: FlowJobData[]; moveToDelayed: number[] } = {
    updateData: [],
    moveToDelayed: []
  };
  let failUpdates = options.failUpdates ?? 0;
  const job = {
    id,
    data,
    attemptsMade: 0,
    opts: { attempts: options.attempts ?? 1 },
    // Like BullMQ's: the local copy changes before the Redis write, which
    // can still fail.
    async updateData(next: FlowJobData) {
      job.data = next;
      if (failUpdates > 0) {
        failUpdates -= 1;
        throw new Error("Redis blip while saving job data");
      }
      calls.updateData.push(next);
    },
    async moveToDelayed(timestamp: number) {
      calls.moveToDelayed.push(timestamp);
    }
  };
  return { job: job as unknown as Job<FlowJobData>, calls };
}

describeWithRedis("the job processor's wait for its turn", () => {
  const registry = { get: () => ({ kind: "chat" }) } as never;

  it("re-admits a job whose place was dropped at the back of the line, behind later arrivals", async () => {
    // The place of a job that could not renew it (its worker stalled) was
    // dropped. The request is still coming, so it lines up again, behind
    // whoever arrived meanwhile, rather than jumping back to the front.
    const { backend } = setup();
    const holder = await place(backend, "r_holder");
    const dropped = await place(backend, "r_waiter");
    await backend.giveBack(dropped);
    const arrivedSince = await place(backend, "r_since");

    const processor = createFlowJobProcessor({
      registry,
      stores: createInMemoryStores(),
      runtimeConfig: {},
      leaseBackend: backend
    });
    const { job, calls } = fakeJob(
      {
        flowKind: "chat",
        actionName: "respond",
        input: {},
        userId: "u_1",
        requestId: "r_waiter",
        leasePlace: dropped
      },
      leaseJobId(dropped)
    );
    await expect(processor(job, "token")).rejects.toBeInstanceOf(DelayedError);
    expect(calls.moveToDelayed).toHaveLength(1);
    const retaken = calls.updateData.at(-1)!.leasePlace!;
    expect(retaken.ticket).not.toBe(dropped.ticket);

    await backend.giveBack(holder);
    expect(await backend.isMyTurn(arrivedSince)).toBe(true);
    expect(await backend.isMyTurn(retaken)).toBe(false);
    await backend.giveBack(arrivedSince);
    expect(await backend.isMyTurn(retaken)).toBe(true);
  });

  it("requeues a job that is not yet its turn, and counts its wait from the first check", async () => {
    const { backend } = setup();
    await place(backend, "r_holder");
    const waiter = await place(backend, "r_waiter");
    const processor = createFlowJobProcessor({
      registry,
      stores: createInMemoryStores(),
      runtimeConfig: {},
      leaseBackend: backend
    });
    const { job, calls } = fakeJob(
      {
        flowKind: "chat",
        actionName: "respond",
        input: {},
        userId: "u_1",
        requestId: "r_waiter",
        leasePlace: waiter
      },
      leaseJobId(waiter)
    );
    const before = Date.now();
    await expect(processor(job, "token")).rejects.toBeInstanceOf(DelayedError);
    await expect(processor(job, "token")).rejects.toBeInstanceOf(DelayedError);
    const [first, second] = calls.updateData;
    expect(first!.leaseWait!.attempt).toBe(1);
    expect(second!.leaseWait!.attempt).toBe(2);
    expect(second!.leaseWait!.firstCheckAt).toBe(first!.leaseWait!.firstCheckAt);
    expect(first!.leaseWait!.firstCheckAt).toBeGreaterThanOrEqual(before);
    // Each requeue is delayed, bounded by the engine's cap.
    for (const at of calls.moveToDelayed) {
      expect(at).toBeGreaterThan(before);
      expect(at).toBeLessThanOrEqual(Date.now() + 2_000);
    }
  });

  it("never starts a waiter cancelled while it waited, ends it aborted, and moves the line (BR-13)", async () => {
    const { backend } = setup();
    const holder = await place(backend, "r_holder");
    const waiter = await place(backend, "r_waiter");
    const next = await place(backend, "r_next");
    const stores = createInMemoryStores();
    const ts = Date.now();
    await stores.request.set(
      "r_waiter",
      {
        id: "r_waiter",
        status: "in_progress",
        actionName: "respond",
        sessionId: "s_1",
        userId: "u_1",
        items: [],
        startedAt: ts,
        updatedAt: ts
      } as never,
      "any"
    );
    // Cancelled the way the abort route records it.
    await stores.request.setFieldsIfStatus("r_waiter", { abortRequested: true }, ["in_progress"], ts);
    // A registry with no runnable flow: reaching `runAction` would fail the job.
    const processor = createFlowJobProcessor({
      registry,
      stores,
      runtimeConfig: {},
      leaseBackend: backend
    });
    const { job, calls } = fakeJob(
      {
        flowKind: "chat",
        actionName: "respond",
        input: {},
        userId: "u_1",
        requestId: "r_waiter",
        leasePlace: waiter
      },
      leaseJobId(waiter)
    );
    await expect(processor(job, "token")).resolves.toBeUndefined();
    expect(calls.moveToDelayed).toEqual([]);
    expect((await stores.request.get("r_waiter"))?.status).toBe("aborted");
    expect(await backend.isMyTurn(waiter)).toBe("missing");
    await backend.giveBack(holder);
    expect(await backend.isMyTurn(next)).toBe(true);
  });

  it("times a waiter out at the wait budget, settles its request failed, and gives its place back (BR-10)", async () => {
    const { backend } = setup();
    const holder = await place(backend, "r_holder");
    const waiter = await place(backend, "r_waiter");
    const stores = createInMemoryStores();
    const ts = Date.now();
    await stores.request.set(
      "r_waiter",
      {
        id: "r_waiter",
        status: "in_progress",
        actionName: "respond",
        sessionId: "s_1",
        userId: "u_1",
        items: [],
        startedAt: ts,
        updatedAt: ts
      } as never,
      "any"
    );
    const processor = createFlowJobProcessor({
      registry,
      stores,
      runtimeConfig: {},
      leaseBackend: backend
    });
    const { job } = fakeJob(
      {
        flowKind: "chat",
        actionName: "respond",
        input: {},
        userId: "u_1",
        requestId: "r_waiter",
        leasePlace: waiter,
        leaseWait: { firstCheckAt: Date.now() - 31_000, attempt: 12 }
      },
      leaseJobId(waiter)
    );
    await expect(processor(job, "token")).rejects.toMatchObject({ name: "UnrecoverableError" });
    expect((await stores.request.get("r_waiter"))?.status).toBe("failed");
    expect(await backend.isMyTurn(waiter)).toBe("missing");
    expect(await backend.isMyTurn(holder)).toBe(true);
  });
});

describeWithRedis("the job processor's wait for a free key (defer, FIX-1836)", () => {
  const registry = { get: () => ({ kind: "chat" }) } as never;
  const KEY = "tenant_a:s_1";
  const deferJob = (leaseWait?: FlowJobData["leaseWait"]) =>
    fakeJob(
      {
        flowKind: "chat",
        actionName: "notify",
        input: {},
        userId: "u_1",
        requestId: "r_notice",
        leaseTurn: { kind: "when-free", key: KEY },
        ...(leaseWait !== undefined ? { leaseWait } : {}),
      },
      "job_notice"
    );

  it("takes no place while the key is held, and requeues to try again", async () => {
    const { backend } = setup();
    const reply = await place(backend, "r_reply", KEY);
    const processor = createFlowJobProcessor({
      registry,
      stores: createInMemoryStores(),
      runtimeConfig: {},
      leaseBackend: backend,
    });
    const { job, calls } = deferJob();
    await expect(processor(job, "token")).rejects.toBeInstanceOf(DelayedError);
    expect(calls.moveToDelayed).toHaveLength(1);
    expect(job.data.leasePlace ?? undefined).toBeUndefined();
    // Nothing of the notice's is on the key: the reply alone holds it.
    await backend.giveBack(reply);
    expect(await backend.take({ key: KEY, requestId: "r_probe", ifEmpty: true })).toHaveProperty("place");
  });

  it("out of patience, lines up behind the runs on the key, ahead of newer replies, and then waits with no budget", async () => {
    const { backend } = setup();
    const reply = await place(backend, "r_reply", KEY);
    const processor = createFlowJobProcessor({
      registry,
      stores: createInMemoryStores(),
      runtimeConfig: {},
      leaseBackend: backend,
      deferPatienceMs: 1_000,
    });
    const { job } = deferJob({ firstCheckAt: Date.now() - 1_500, attempt: 7 });
    await expect(processor(job, "token")).rejects.toBeInstanceOf(DelayedError);
    const lined = job.data.leasePlace!;
    expect(lined).toMatchObject({ key: KEY });

    // A reply that starts now joins behind the notice, so it no longer delays it.
    const newer = await place(backend, "r_newer", KEY);

    // Waiting behind a long reply is not a timeout, however long it takes.
    const { job: later } = fakeJob(
      { ...job.data, leaseWait: { firstCheckAt: Date.now() - 120_000, attempt: 40 } },
      "job_notice"
    );
    await expect(processor(later, "token")).rejects.toBeInstanceOf(DelayedError);

    await backend.giveBack(reply);
    expect(await backend.isMyTurn(lined)).toBe(true);
    expect(await backend.isMyTurn(newer)).toBe(false);
  });

  it("never starts a notice cancelled while it waited for the key, and ends it aborted", async () => {
    const { backend } = setup();
    const reply = await place(backend, "r_reply", KEY);
    const stores = createInMemoryStores();
    const ts = Date.now();
    await stores.request.set(
      "r_notice",
      {
        id: "r_notice",
        status: "in_progress",
        actionName: "notify",
        sessionId: "s_1",
        userId: "u_1",
        items: [],
        startedAt: ts,
        updatedAt: ts,
      } as never,
      "any"
    );
    await stores.request.setFieldsIfStatus("r_notice", { abortRequested: true }, ["in_progress"], ts);
    const processor = createFlowJobProcessor({ registry, stores, runtimeConfig: {}, leaseBackend: backend });
    const { job, calls } = deferJob();
    await expect(processor(job, "token")).resolves.toBeUndefined();
    expect(calls.moveToDelayed).toEqual([]);
    expect((await stores.request.get("r_notice"))?.status).toBe("aborted");
    await backend.giveBack(reply);
    expect(await backend.take({ key: KEY, requestId: "r_probe", ifEmpty: true })).toHaveProperty("place");
  });

  it("waits for the key again when a crash cost it the place it claimed, rather than running beside the run that took it", async () => {
    // The notice claims the free key, and its first attempt fails in a way
    // BullMQ retries. Its worker then crashes: the place expires, and
    // another run takes the key before the retry. The retry must not run
    // beside that run.
    const { backend } = setup(300);
    const processor = createFlowJobProcessor({
      registry,
      stores: createInMemoryStores(),
      runtimeConfig: {},
      leaseBackend: backend,
    });
    const { job, calls } = fakeJob(
      {
        flowKind: "chat",
        actionName: "notify",
        input: {},
        userId: "u_1",
        orgId: DEFAULT_ORG_ID,
        requestId: "r_notice",
        leaseTurn: { kind: "when-free", key: KEY },
      },
      "job_notice",
      { attempts: 3 }
    );
    await expect(processor(job, "token")).rejects.not.toBeInstanceOf(DelayedError);
    const claimed = job.data.leasePlace!;
    expect(await backend.isMyTurn(claimed)).toBe(true);

    await new Promise((r) => setTimeout(r, 450));
    const other = await place(backend, "r_other", KEY);
    expect(await backend.isMyTurn(other)).toBe(true);

    (job as { attemptsMade: number }).attemptsMade = 1;
    await expect(processor(job, "token")).rejects.toBeInstanceOf(DelayedError);
    expect(calls.moveToDelayed).toHaveLength(1);
    // It took no place while it waits for the key: once the other run ends,
    // the key is free.
    await backend.giveBack(other);
    expect(await backend.take({ key: KEY, requestId: "r_probe", ifEmpty: true })).toHaveProperty("place");
  });

  it("still runs a hold at once on retry after a crash cost it its place", async () => {
    const { backend } = setup();
    const holder = await place(backend, "r_holder", KEY);
    const dropped = await place(backend, "r_reply", KEY);
    await backend.giveBack(dropped);
    const processor = createFlowJobProcessor({
      registry,
      stores: createInMemoryStores(),
      runtimeConfig: {},
      leaseBackend: backend,
    });
    const { job, calls } = fakeJob(
      {
        flowKind: "chat",
        actionName: "reply",
        input: {},
        userId: "u_1",
        requestId: "r_reply",
        leasePlace: dropped,
        leaseTurn: { kind: "now" },
      },
      "job_reply"
    );
    // It gets past its turn and fails at the run (this registry has no
    // runnable flow), rather than being requeued behind the holder.
    await expect(processor(job, "token")).rejects.not.toBeInstanceOf(DelayedError);
    expect(calls.moveToDelayed).toEqual([]);
    expect(await backend.isMyTurn(holder)).toBe(true);
  });
});

describeWithRedis("the job processor gives back a place it could not record on the job", () => {
  const registry = { get: () => ({ kind: "chat" }) } as never;
  const KEY = "tenant_a:s_1";
  const keyIsFree = async (backend: RedisLeaseBackend) =>
    "place" in (await backend.take({ key: KEY, requestId: "r_probe", ifEmpty: true }));

  // Each job may be retried (3 attempts), so the processor keeps whatever
  // place the job's data names. A place taken but never recorded would block
  // the key until its lease ran out.
  it("when claiming a free key", async () => {
    const { backend } = setup();
    const processor = createFlowJobProcessor({
      registry,
      stores: createInMemoryStores(),
      runtimeConfig: {},
      leaseBackend: backend,
    });
    const { job } = fakeJob(
      {
        flowKind: "chat",
        actionName: "notify",
        input: {},
        userId: "u_1",
        requestId: "r_notice",
        leaseTurn: { kind: "when-free", key: KEY },
      },
      "job_notice",
      { attempts: 3, failUpdates: 1 }
    );
    await expect(processor(job, "token")).rejects.toThrow(/Redis blip/);
    expect(await keyIsFree(backend)).toBe(true);
  });

  it("when lining up after its patience", async () => {
    const { backend } = setup();
    const holder = await place(backend, "r_holder", KEY);
    const processor = createFlowJobProcessor({
      registry,
      stores: createInMemoryStores(),
      runtimeConfig: {},
      leaseBackend: backend,
      deferPatienceMs: 1_000,
    });
    const { job } = fakeJob(
      {
        flowKind: "chat",
        actionName: "notify",
        input: {},
        userId: "u_1",
        requestId: "r_notice",
        leaseTurn: { kind: "when-free", key: KEY },
        leaseWait: { firstCheckAt: Date.now() - 1_500, attempt: 7 },
      },
      "job_notice",
      { attempts: 3, failUpdates: 1 }
    );
    await expect(processor(job, "token")).rejects.toThrow(/Redis blip/);
    await backend.giveBack(holder);
    expect(await keyIsFree(backend)).toBe(true);
  });

  it("when lining up again after its place was dropped", async () => {
    const { backend } = setup();
    const holder = await place(backend, "r_holder", KEY);
    const dropped = await place(backend, "r_waiter", KEY);
    await backend.giveBack(dropped);
    const processor = createFlowJobProcessor({
      registry,
      stores: createInMemoryStores(),
      runtimeConfig: {},
      leaseBackend: backend,
    });
    const { job } = fakeJob(
      {
        flowKind: "chat",
        actionName: "respond",
        input: {},
        userId: "u_1",
        requestId: "r_waiter",
        leasePlace: dropped,
      },
      leaseJobId(dropped),
      { attempts: 3, failUpdates: 1 }
    );
    await expect(processor(job, "token")).rejects.toThrow(/Redis blip/);
    await backend.giveBack(holder);
    expect(await keyIsFree(backend)).toBe(true);
  });
});
