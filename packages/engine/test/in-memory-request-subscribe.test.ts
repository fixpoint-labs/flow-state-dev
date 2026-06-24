import { describe, expect, it } from "vitest";
import { createInMemoryRequestStore } from "../src/stores";
import {
  createRequestStoreConformanceTests,
  makeRequestStreamEvent
} from "../src/testing";
import { StoreSubscriptionError } from "../src/errors/store-subscription-error";

createRequestStoreConformanceTests({
  name: "InMemoryRequestStore",
  createStore: () => createInMemoryRequestStore(),
  // Memory bus has no polling — set to 0 so the conformance live-tolerance
  // window collapses to its 200ms floor.
  pollIntervalMs: 0,
  // Memory deliberately ignores `livenessTimeoutMs` — there is no
  // cross-process death scenario.
  skipLivenessTimeout: true
});

describe("InMemoryRequestStore (backend-specific)", () => {
  it("throws backpressure_overflow when the bounded queue fills", async () => {
    const store = createInMemoryRequestStore();
    const controller = new AbortController();
    const iter = store.subscribeToEvents("r1", {
      fromSequence: 0,
      signal: controller.signal,
      maxPendingEvents: 2,
      livenessTimeoutMs: 60_000
    });

    // Drain the catch-up phase (empty) so the iterator is parked on the
    // live queue.
    const stalled = (async () => {
      const errors: unknown[] = [];
      try {
        for await (const _event of iter) {
          // Stall: never consume, so the live queue fills.
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      } catch (err) {
        errors.push(err);
      }
      return errors;
    })();

    // Yield so the iterator registers its subscriber callback.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Push more events than the queue can hold.
    for (let i = 1; i <= 10; i += 1) {
      store.persistEvents("r1", [makeRequestStreamEvent("r1", i)]);
    }

    // Eventually the iterator notices the overflow and throws.
    const errors = await Promise.race([
      stalled,
      new Promise<unknown[]>((resolve) =>
        setTimeout(() => resolve([]), 2_000)
      )
    ]);
    controller.abort();

    expect(errors.length).toBe(1);
    expect(errors[0]).toBeInstanceOf(StoreSubscriptionError);
    expect((errors[0] as StoreSubscriptionError).subCode).toBe(
      "backpressure_overflow"
    );
  }, 5_000);
});
