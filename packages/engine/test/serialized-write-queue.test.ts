import { describe, expect, it, vi } from "vitest";
import { createSerializedWriteQueue } from "../src/utils/serialized-write-queue";

describe("SerializedWriteQueue", () => {
  it("executes operations in order", async () => {
    const queue = createSerializedWriteQueue();
    const order: number[] = [];

    queue.enqueue(async () => {
      await delay(10);
      order.push(1);
    });
    queue.enqueue(async () => {
      order.push(2);
    });
    queue.enqueue(async () => {
      order.push(3);
    });

    await queue.drain();
    expect(order).toEqual([1, 2, 3]);
  });

  it("drain() resolves when queue is empty", async () => {
    const queue = createSerializedWriteQueue();
    // Drain on empty queue resolves immediately
    await queue.drain();

    queue.enqueue(async () => {
      await delay(5);
    });

    await queue.drain();
    expect(queue.pending).toBe(0);
    expect(queue.active).toBe(false);
  });

  it("errors in operations do not abort the queue", async () => {
    const onError = vi.fn();
    const queue = createSerializedWriteQueue({ onError });
    const order: number[] = [];

    queue.enqueue(async () => {
      order.push(1);
    });
    queue.enqueue(async () => {
      throw new Error("boom");
    });
    queue.enqueue(async () => {
      order.push(3);
    });

    await queue.drain();
    expect(order).toEqual([1, 3]);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toBe("boom");
  });

  it("pending and active properties are accurate", async () => {
    const queue = createSerializedWriteQueue();

    expect(queue.pending).toBe(0);
    expect(queue.active).toBe(false);

    let resolve1: () => void;
    const p1 = new Promise<void>((r) => { resolve1 = r; });

    queue.enqueue(async () => {
      await p1;
    });
    queue.enqueue(async () => {});

    // First op is in-flight, second is queued
    await delay(1);
    expect(queue.active).toBe(true);
    expect(queue.pending).toBeGreaterThanOrEqual(1);

    resolve1!();
    await queue.drain();
    expect(queue.pending).toBe(0);
    expect(queue.active).toBe(false);
  });

  it("passes label as context to onError", async () => {
    const onError = vi.fn();
    const queue = createSerializedWriteQueue({ onError, label: "test-queue" });

    queue.enqueue(async () => {
      throw new Error("fail");
    });

    await queue.drain();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "test-queue");
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
