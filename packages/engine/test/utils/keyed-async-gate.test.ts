/**
 * Unit tests for the keyed async gate (FIX-837) — the per-string-key
 * serializer backing the concurrency arbiter. Verifies FIFO ordering under
 * `runExclusive`, parallelism across distinct keys, atomic `tryAcquire`
 * admission, idle-key pruning, and the `waitTimeoutMs` budget.
 */
import { describe, expect, it } from "vitest";
import { createKeyedAsyncGate } from "../../src/utils/keyed-async-gate";
import { ConcurrencyQueueTimeoutError } from "../../src/transports/errors";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

describe("createKeyedAsyncGate", () => {
  it("runExclusive serializes concurrent callers on one key in submission order", async () => {
    const gate = createKeyedAsyncGate();
    const order: number[] = [];
    const running: number[] = [];
    let maxConcurrent = 0;

    const work = (n: number) =>
      gate.runExclusive("k", async () => {
        running.push(n);
        maxConcurrent = Math.max(maxConcurrent, running.length);
        order.push(n);
        await tick();
        running.splice(running.indexOf(n), 1);
      });

    await Promise.all([work(1), work(2), work(3)]);

    expect(order).toEqual([1, 2, 3]);
    expect(maxConcurrent).toBe(1);
  });

  it("runExclusive runs distinct keys in parallel", async () => {
    const gate = createKeyedAsyncGate();
    let concurrent = 0;
    let maxConcurrent = 0;

    const work = (key: string) =>
      gate.runExclusive(key, async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await tick();
        concurrent -= 1;
      });

    await Promise.all([work("a"), work("b"), work("c")]);
    expect(maxConcurrent).toBe(3);
  });

  it("tryAcquire is atomic — only one of two synchronous callers wins", () => {
    const gate = createKeyedAsyncGate();
    const first = gate.tryAcquire("k");
    const second = gate.tryAcquire("k");
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    first?.();
    // After release the key is free again.
    const third = gate.tryAcquire("k");
    expect(third).not.toBeNull();
    third?.();
  });

  it("tryAcquire release lease is idempotent", () => {
    const gate = createKeyedAsyncGate();
    const lease = gate.tryAcquire("k");
    lease?.();
    lease?.(); // second call is a no-op
    // A fresh acquire must still succeed (the double release didn't free a re-acquired slot).
    const again = gate.tryAcquire("k");
    expect(again).not.toBeNull();
    again?.();
  });

  it("tryAcquire fails while a runExclusive holder owns the key, succeeds once released", async () => {
    const gate = createKeyedAsyncGate();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const run = gate.runExclusive("k", () => held);
    await tick();
    expect(gate.tryAcquire("k")).toBeNull();
    release();
    await run;
    const lease = gate.tryAcquire("k");
    expect(lease).not.toBeNull();
    lease?.();
  });

  it("prunes idle keys — the map shrinks back to zero after work settles", async () => {
    const gate = createKeyedAsyncGate();
    await Promise.all([
      gate.runExclusive("a", async () => tick()),
      gate.runExclusive("a", async () => tick()),
      gate.runExclusive("b", async () => tick())
    ]);
    const lease = gate.tryAcquire("c");
    lease?.();
    expect(gate.size()).toBe(0);
  });

  it("runExclusive rejects with ConcurrencyQueueTimeoutError when the wait budget elapses", async () => {
    const gate = createKeyedAsyncGate();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const holder = gate.runExclusive("k", () => held);
    await tick();

    let fnRan = false;
    const waiter = gate.runExclusive(
      "k",
      async () => {
        fnRan = true;
      },
      { waitTimeoutMs: 10 }
    );

    await expect(waiter).rejects.toBeInstanceOf(ConcurrencyQueueTimeoutError);
    expect(fnRan).toBe(false);

    release();
    await holder;
    expect(gate.size()).toBe(0);
  });
});
