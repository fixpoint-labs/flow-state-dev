/**
 * The worker dispatcher's enqueue, without Redis: a place-bearing job goes
 * under the id its place names, and an id BullMQ already had is refused
 * loudly rather than dropped.
 */
import { describe, expect, it, vi } from "vitest";
import type { Queue } from "bullmq";
import type { DispatchEnvelope, StreamBridge } from "@flow-state-dev/engine";
import { createWorkerDispatcher } from "../src/dispatcher";
import { leaseJobId } from "../src/lease-backend";

function makeBridge() {
  const subscriber = {
    completed: new Promise(() => {}),
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

describe("createWorkerDispatcher", () => {
  it("enqueues a place-bearing job under the id its place names", async () => {
    const { bridge } = makeBridge();
    const add = vi.fn(async (_name: string, data: unknown) => ({ data }));
    const dispatcher = createWorkerDispatcher({ queue: { add } as unknown as Queue, bridge });

    await dispatcher.dispatch(envelope);

    expect(add).toHaveBeenCalledWith(
      "flow-run",
      expect.objectContaining({ requestId: "req_new", leasePlace: place }),
      expect.objectContaining({ jobId: leaseJobId(place) })
    );
  });

  it("refuses a dispatch whose job id BullMQ already had, rather than losing the request", async () => {
    // BullMQ answers an `add` under an existing id with the existing job and
    // writes nothing. A backend that reused a ticket would otherwise drop the
    // new request without a word.
    const { bridge, subscriber } = makeBridge();
    const add = vi.fn(async () => ({ data: { requestId: "req_old" } }));
    const dispatcher = createWorkerDispatcher({ queue: { add } as unknown as Queue, bridge });

    await expect(dispatcher.dispatch(envelope)).rejects.toThrow(/req_old/);
    expect(subscriber.close).toHaveBeenCalled();
  });
});
