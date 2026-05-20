import { describe, expect, it, vi } from "vitest";
import type { OutputItem } from "../src/items/types";
import type { BlockContext } from "../src/types/block";
import { sequencer } from "../src";
import { createMockContext, runForTest } from "./helpers";

/**
 * In-memory fake of `ResponseEmitterHandle` for waitForCondition tests.
 * Holds an items array and a listener set so each test can push synthetic
 * items and re-trigger the runtime exactly like the server-side emitter
 * would.
 */
function createFakeResponse(initial: OutputItem[] = []) {
  const items: OutputItem[] = [...initial];
  const listeners = new Set<(item: OutputItem, kind: "added" | "updated" | "done") => void>();

  return {
    handle: {
      emit: () => undefined,
      getItems: () => items,
      subscribeToItems: (listener: (item: OutputItem, kind: "added" | "updated" | "done") => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }
    },
    pushItem(item: OutputItem, kind: "added" | "updated" | "done" = "added"): void {
      items.push(item);
      for (const listener of listeners) listener(item, kind);
    },
    triggerUpdate(item: OutputItem): void {
      for (const listener of listeners) listener(item, "updated");
    },
    get listenerCount(): number {
      return listeners.size;
    }
  };
}

function makeItem(over: Partial<OutputItem> & { type: OutputItem["type"] }): OutputItem {
  return {
    id: `i_${Math.random().toString(36).slice(2)}`,
    ts: Date.now(),
    itemIndex: 0,
    status: "done",
    ...over
  } as OutputItem;
}

function makeCtx(fakeResponse: ReturnType<typeof createFakeResponse>, overrides?: Partial<BlockContext>): BlockContext {
  return createMockContext({
    response: fakeResponse.handle,
    ...overrides
  });
}

describe("sequencer .waitForCondition", () => {
  it("resolves { timedOut: false } immediately when the predicate is already true on entry", async () => {
    const fake = createFakeResponse([
      makeItem({ type: "message" } as Partial<OutputItem> & { type: OutputItem["type"] })
    ]);
    const ctx = makeCtx(fake);

    const subscribeSpy = vi.spyOn(fake.handle, "subscribeToItems");

    const seq = sequencer({ name: "wfc-entry" }).waitForCondition(
      (items) => items.some((i) => i.type === "message"),
      { timeoutMs: 1000 }
    );

    const out = await runForTest(seq, undefined, ctx);
    expect(out).toEqual({ timedOut: false });
    expect(subscribeSpy).not.toHaveBeenCalled();
    expect(fake.listenerCount).toBe(0);
  });

  it("resolves { timedOut: false } when an item event makes the predicate true", async () => {
    const fake = createFakeResponse();
    const ctx = makeCtx(fake);

    const seq = sequencer({ name: "wfc-event" }).waitForCondition(
      (items) => items.some((i) => i.type === "message"),
      { timeoutMs: 1000 }
    );

    const pending = runForTest(seq, undefined, ctx);
    // Let the sequencer subscribe.
    await Promise.resolve();
    expect(fake.listenerCount).toBe(1);

    fake.pushItem(makeItem({ type: "message" } as Partial<OutputItem> & { type: OutputItem["type"] }));

    const out = await pending;
    expect(out).toEqual({ timedOut: false });
    expect(fake.listenerCount).toBe(0);
  });

  it("resolves on an item.updated event when the predicate inspects updates", async () => {
    const fake = createFakeResponse();
    const ctx = makeCtx(fake);

    const seq = sequencer({ name: "wfc-update" }).waitForCondition(
      (items) => items.some((i) => i.status === "done" && i.type === "message"),
      { timeoutMs: 1000 }
    );

    const pending = runForTest(seq, undefined, ctx);
    await Promise.resolve();

    // Push an in-progress item — predicate stays false (status !== "done").
    const live = makeItem({ type: "message", status: "in_progress" } as Partial<OutputItem> & { type: OutputItem["type"] });
    fake.pushItem(live);
    // Mutate in place and fire an "updated" event.
    (live as { status: string }).status = "done";
    fake.triggerUpdate(live);

    const out = await pending;
    expect(out).toEqual({ timedOut: false });
    expect(fake.listenerCount).toBe(0);
  });

  it("resolves { timedOut: true } after timeoutMs when the predicate never becomes true", async () => {
    const fake = createFakeResponse();
    const ctx = makeCtx(fake);

    const seq = sequencer({ name: "wfc-timeout" }).waitForCondition(() => false, { timeoutMs: 25 });

    const out = await runForTest(seq, undefined, ctx);
    expect(out).toEqual({ timedOut: true });
    expect(fake.listenerCount).toBe(0);
  });

  it("resolves without throwing when the parent signal aborts mid-wait", async () => {
    const fake = createFakeResponse();
    const controller = new AbortController();
    const ctx = makeCtx(fake, { signal: controller.signal });

    const seq = sequencer({ name: "wfc-abort" }).waitForCondition(() => false, { timeoutMs: 5000 });

    const pending = runForTest(seq, undefined, ctx);
    await Promise.resolve();
    expect(fake.listenerCount).toBe(1);

    controller.abort();

    const out = await pending;
    expect(out).toEqual({ timedOut: false });
    expect(fake.listenerCount).toBe(0);
  });

  it("resolves promptly when the parent signal is already aborted on entry", async () => {
    const fake = createFakeResponse();
    const controller = new AbortController();
    controller.abort();
    const ctx = makeCtx(fake, { signal: controller.signal });

    const seq = sequencer({ name: "wfc-pre-aborted" }).waitForCondition(
      () => false,
      // Large timeout — if we accidentally wait for it the test will hang
      // long past its 5s vitest budget. Resolution must come from the
      // already-aborted signal, not the timer.
      { timeoutMs: 60_000 }
    );

    const start = Date.now();
    const out = await runForTest(seq, undefined, ctx);
    expect(Date.now() - start).toBeLessThan(100);
    expect(out).toEqual({ timedOut: false });
    expect(fake.listenerCount).toBe(0);
  });

  it("propagates a predicate throw at entry without subscribing", async () => {
    const fake = createFakeResponse();
    const ctx = makeCtx(fake);

    const subscribeSpy = vi.spyOn(fake.handle, "subscribeToItems");

    const seq = sequencer({ name: "wfc-throw-entry" }).waitForCondition(
      () => { throw new Error("entry boom"); },
      { timeoutMs: 1000 }
    );

    await expect(runForTest(seq, undefined, ctx)).rejects.toThrow("entry boom");
    expect(subscribeSpy).not.toHaveBeenCalled();
    expect(fake.listenerCount).toBe(0);
  });

  it("propagates a predicate throw on an event after teardown", async () => {
    const fake = createFakeResponse();
    const ctx = makeCtx(fake);

    let calls = 0;
    const seq = sequencer({ name: "wfc-throw-event" }).waitForCondition(
      () => {
        calls += 1;
        if (calls === 1) return false; // entry: fine
        throw new Error("event boom");
      },
      { timeoutMs: 1000 }
    );

    const pending = runForTest(seq, undefined, ctx);
    await Promise.resolve();
    expect(fake.listenerCount).toBe(1);

    fake.pushItem(makeItem({ type: "message" } as Partial<OutputItem> & { type: OutputItem["type"] }));

    await expect(pending).rejects.toThrow("event boom");
    expect(fake.listenerCount).toBe(0);
  });

  it("calls the predicate exactly once per event when many arrive in rapid succession", async () => {
    const fake = createFakeResponse();
    const ctx = makeCtx(fake);

    const evaluations: number[] = [];
    const seq = sequencer({ name: "wfc-rapid" }).waitForCondition(
      (items) => {
        evaluations.push(items.length);
        return items.length >= 5;
      },
      { timeoutMs: 1000 }
    );

    const pending = runForTest(seq, undefined, ctx);
    await Promise.resolve();

    // Initial eval (length 0) already happened before subscribe.
    expect(evaluations).toEqual([0]);

    for (let i = 0; i < 5; i += 1) {
      fake.pushItem(makeItem({ type: "message" } as Partial<OutputItem> & { type: OutputItem["type"] }));
    }

    const out = await pending;
    expect(out).toEqual({ timedOut: false });
    // Initial 0 + one eval per pushed item = 6 calls, then short-circuits.
    expect(evaluations).toEqual([0, 1, 2, 3, 4, 5]);
    expect(fake.listenerCount).toBe(0);
  });
});
