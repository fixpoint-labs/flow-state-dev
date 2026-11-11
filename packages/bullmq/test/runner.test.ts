/**
 * The worker runner's enqueue, without Redis: a place-bearing job goes
 * under the id its place names, and an id BullMQ already had is refused
 * loudly rather than dropped.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Queue } from "bullmq";
import type { DispatchEnvelope, StreamBridge } from "@flow-state-dev/engine/host";
import { createWorkerRunner } from "../src/runner";
import { DEFAULT_LEASE_MS, leaseJobId } from "../src/lease-backend";

function makeBridge() {
  const subscriber = {
    completed: new Promise<unknown>(() => {}),
    close: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
  };
  const bridge = {
    createSubscriber: vi.fn(() => subscriber),
    createPublisher: vi.fn(),
  } as unknown as StreamBridge;
  return { bridge, subscriber };
}

const place = { key: "session:s_1", ticket: "t_1" };
const envelope: DispatchEnvelope = {
  requestId: "req_new",
  flowKind: "chat",
  actionName: "send",
  input: {},
  userId: "u_1",
  orgId: "org_1",
  sessionId: "s_1",
  leasePlace: place,
} as DispatchEnvelope;

describe("createWorkerRunner", () => {
  it("enqueues a place-bearing job under the id its place names", async () => {
    const { bridge } = makeBridge();
    const add = vi.fn(async (_name: string, data: unknown) => ({ data }));
    const runner = createWorkerRunner({ queue: { add } as unknown as Queue, bridge });

    await runner.dispatch(envelope);

    expect(add).toHaveBeenCalledWith(
      "flow-run",
      expect.objectContaining({ requestId: "req_new", leasePlace: place }),
      expect.objectContaining({ jobId: leaseJobId(place) })
    );
  });

  it("carries how the job reaches its turn, so its worker applies hold and defer", async () => {
    const { bridge } = makeBridge();
    const add = vi.fn(async (_name: string, data: unknown) => ({ data }));
    const runner = createWorkerRunner({ queue: { add } as unknown as Queue, bridge });

    await runner.dispatch({ ...envelope, leaseTurn: { kind: "now" } });
    await runner.dispatch({
      ...envelope,
      leasePlace: undefined,
      leaseTurn: { kind: "when-free", key: "s_1" },
    });

    expect(add.mock.calls[0]![1]).toMatchObject({ leasePlace: place, leaseTurn: { kind: "now" } });
    expect(add.mock.calls[1]![1]).toMatchObject({ leaseTurn: { kind: "when-free", key: "s_1" } });
    expect(add.mock.calls[1]![1]).not.toHaveProperty("leasePlace");
  });

  it("refuses a dispatch whose job id BullMQ already had, rather than losing the request", async () => {
    // BullMQ answers an `add` under an existing id with the existing job and
    // writes nothing. A backend that reused a ticket would otherwise drop the
    // new request without a word.
    const { bridge, subscriber } = makeBridge();
    const add = vi.fn(async () => ({ data: { requestId: "req_old" } }));
    const runner = createWorkerRunner({ queue: { add } as unknown as Queue, bridge });

    await expect(runner.dispatch(envelope)).rejects.toThrow(/req_old/);
    expect(subscriber.close).toHaveBeenCalled();
  });
});

describe("createWorkerRunner — a dispatch whose terminal never arrives", () => {
  // The terminal can be lost: its publish fails (swallowed), the pub/sub
  // message drops, or the worker dies before publishing. The dispatch's
  // subscriber holds two Redis connections, and its `finished` holds the
  // engine's dispatch bookkeeping; both must end once the job has.
  function queueWith(states: string[], job: Record<string, unknown> = {}) {
    const getJobState = vi.fn(async () => (states.length > 1 ? states.shift()! : states[0]!));
    const getJob = vi.fn(async () => job);
    const add = vi.fn(async (_name: string, data: unknown) => ({ id: "job_1", data }));
    return { queue: { add, getJobState, getJob } as unknown as Queue, getJobState, getJob };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("settles and closes the subscriber once the job has failed for good", async () => {
    vi.useFakeTimers();
    const { bridge, subscriber } = makeBridge();
    const { queue } = queueWith(["active", "failed"], { failedReason: "worker crashed" });
    const runner = createWorkerRunner({ queue, bridge });

    const handle = await runner.dispatch(envelope);
    let settled: unknown;
    void handle.finished.then((r) => (settled = r));

    await vi.advanceTimersByTimeAsync(DEFAULT_LEASE_MS);
    expect(settled).toBeUndefined();
    expect(subscriber.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEFAULT_LEASE_MS);
    expect(settled).toEqual({ error: { message: "worker crashed" } });
    expect(subscriber.close).toHaveBeenCalledTimes(1);
  });

  it("settles with the job's own result when it completed but its terminal was lost", async () => {
    vi.useFakeTimers();
    const { bridge, subscriber } = makeBridge();
    const { queue } = queueWith(["completed"], { returnvalue: { output: "ok", items: [] } });
    const runner = createWorkerRunner({ queue, bridge });

    const handle = await runner.dispatch(envelope);
    await vi.advanceTimersByTimeAsync(DEFAULT_LEASE_MS);

    await expect(handle.finished).resolves.toEqual({ output: "ok", items: [] });
    expect(subscriber.close).toHaveBeenCalledTimes(1);
  });

  it("settles with an error when the job is gone without a result", async () => {
    // Completed with nothing to return (a turn cancelled while it waited), or
    // already removed from the queue by its retention settings.
    vi.useFakeTimers();
    const { bridge, subscriber } = makeBridge();
    const { queue } = queueWith(["unknown"]);
    const runner = createWorkerRunner({ queue, bridge });

    const handle = await runner.dispatch(envelope);
    await vi.advanceTimersByTimeAsync(DEFAULT_LEASE_MS);

    await expect(handle.finished).resolves.toMatchObject({ error: { message: expect.stringMatching(/job_1/) } });
    expect(subscriber.close).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting while the job is still coming back to a worker", async () => {
    // Waiting, delayed for a retry's backoff, or running: the terminal may
    // still come, so the dispatch must not be cut short.
    vi.useFakeTimers();
    const { bridge, subscriber } = makeBridge();
    const { queue, getJobState } = queueWith(["waiting", "active", "delayed", "active"]);
    const runner = createWorkerRunner({ queue, bridge });

    const handle = await runner.dispatch(envelope);
    let settled = false;
    void handle.finished.finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(DEFAULT_LEASE_MS * 6);

    expect(getJobState).toHaveBeenCalledTimes(6);
    expect(settled).toBe(false);
    expect(subscriber.close).not.toHaveBeenCalled();
  });

  it("stops checking the job once the terminal arrives", async () => {
    vi.useFakeTimers();
    let deliver!: (result: unknown) => void;
    const { bridge, subscriber } = makeBridge();
    subscriber.completed = new Promise((res) => (deliver = res));
    const { queue, getJobState } = queueWith(["active"]);
    const runner = createWorkerRunner({ queue, bridge });

    const handle = await runner.dispatch(envelope);
    deliver({ output: "ok" });
    await expect(handle.finished).resolves.toEqual({ output: "ok" });
    await vi.advanceTimersByTimeAsync(DEFAULT_LEASE_MS * 3);

    expect(getJobState).not.toHaveBeenCalled();
    expect(subscriber.close).toHaveBeenCalledTimes(1);
  });
});
