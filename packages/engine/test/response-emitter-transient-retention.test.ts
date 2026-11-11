/**
 * Tests for the response emitter's bound on done transient items.
 *
 * A long-running request (a task-board worker polling for hours) emits a
 * steady stream of transient items: `resource_change`, transient
 * `block_trace`, `state_snapshot`, status rows. They never reach the request
 * record, so keeping every one in the emitter's item map is unbounded growth.
 * The emitter keeps only the most recent `maxBufferSize` done transient items
 * (enough for `.waitForCondition`'s entry check to see a change that landed
 * just before the wait), while the wire and the events log still get every
 * event, and item indices never repeat.
 */
import type { ComponentItem, MessageItem, OutputItem } from "@flow-state-dev/core/items";
import { whenResourceChanged } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { createResponseEmitter, type RequestStreamEventWithId } from "../src/streaming/response-emitter";

const provenance = { blockName: "test", blockInstanceId: "test_1", phase: "main" as const };

function transientItem(itemIndex: number, id = `item_t_${itemIndex}`): ComponentItem {
  return {
    id,
    type: "component",
    status: "completed",
    transient: true,
    requestId: "req_test",
    itemIndex,
    provenance,
    ts: 100,
    component: "status",
    data: { n: itemIndex }
  };
}

function message(itemIndex: number): MessageItem {
  return {
    id: `item_m_${itemIndex}`,
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: `m ${itemIndex}` }],
    status: "completed",
    requestId: "req_test",
    itemIndex,
    provenance,
    ts: 100
  };
}

describe("ResponseEmitter done-transient retention", () => {
  it("keeps at most maxBufferSize done transient items, never dropping non-transient or in-progress ones", async () => {
    const cap = 5;
    const emitter = createResponseEmitter({ requestId: "req_test", maxBufferSize: cap });

    // An in-progress transient item that outlives all the churn below.
    const inProgress = { ...transientItem(0, "item_in_progress"), status: "in_progress" as const };
    await emitter.emitItemAdded(inProgress);
    await emitter.emitItemAdded(message(emitter.getItemCount()));
    await emitter.emitItemDone(message(emitter.getItemCount() - 1));

    for (let i = 0; i < 200; i += 1) {
      const item = transientItem(emitter.getItemCount());
      await emitter.emitItemAdded(item);
      await emitter.emitItemDone(item);
    }
    await emitter.emitItemAdded(message(emitter.getItemCount()));

    const items = emitter.getItems();
    const doneTransient = items.filter((i) => i.transient === true && i.id !== "item_in_progress");
    // Polling churn must not grow the map: only the newest `cap` survive.
    expect(doneTransient).toHaveLength(cap);
    expect(doneTransient.map((i) => (i as ComponentItem).data)).toEqual(
      [195, 196, 197, 198, 199].map((k) => ({ n: k + 2 }))
    );
    // What the request record and live views depend on is all still there.
    expect(items.some((i) => i.id === "item_in_progress")).toBe(true);
    expect(items.filter((i) => i.type === "message")).toHaveLength(2);
  });

  it("still sees a resource_change emitted before a wait begins (within the cap)", async () => {
    const emitter = createResponseEmitter({ requestId: "req_test" });
    const { item } = await emitter.emitResourceChange({
      scope: "request",
      resourcePath: "artifacts/doc",
      changeType: "updated"
    });
    expect(item.transient).toBe(true);
    expect(
      whenResourceChanged({ scope: "request", path: "artifacts/doc" })(emitter.getItems() as OutputItem[])
    ).toBe(true);
  });

  it("still delivers every transient added/done event to clients and the events log", async () => {
    const wire: RequestStreamEventWithId[] = [];
    const logged: RequestStreamEventWithId[] = [];
    const emitter = createResponseEmitter({
      requestId: "req_test",
      maxBufferSize: 3,
      onEvent: (event) => {
        wire.push(event);
      }
    });
    emitter.setEventHooks({ onEvent: (events) => logged.push(...events) });

    for (let i = 0; i < 20; i += 1) {
      const item = transientItem(emitter.getItemCount());
      await emitter.emitItemAdded(item);
      await emitter.emitItemDone(item);
    }

    const itemEvents = (events: RequestStreamEventWithId[]) =>
      events.filter((e) => e.type === "item.added" || e.type === "item.done");
    expect(itemEvents(wire)).toHaveLength(40);
    expect(itemEvents(logged)).toHaveLength(40);
  });

  it("never reissues an itemIndex across eviction, keyed re-emits, and a continuation base", async () => {
    const cap = 3;
    const emitter = createResponseEmitter({ requestId: "req_test", maxBufferSize: cap, startItemIndex: 100 });
    const issued: number[] = [];
    const take = (): number => {
      const index = emitter.getItemCount();
      issued.push(index);
      return index;
    };

    // A keyed (replace-on-emit) transient item: same id on every emission.
    const keyed = (index: number) => transientItem(index, "item_component_keyed:progress");
    let k = keyed(take());
    await emitter.emitItemAdded(k);
    await emitter.emitItemDone(k);

    for (let i = 0; i < 10; i += 1) {
      if (i % 3 === 0) {
        const m = message(take());
        await emitter.emitItemAdded(m);
        await emitter.emitItemDone(m);
      } else {
        await emitter.emitResourceChange({
          scope: "request",
          resourcePath: `r/${i}`,
          changeType: "updated",
          itemIndex: take()
        });
      }
    }
    // The keyed item has been pushed out of the map by now.
    expect(emitter.getItems().some((i) => i.id === "item_component_keyed:progress")).toBe(false);

    // Re-emitting the evicted keyed id must not move the cursor backwards.
    k = keyed(take());
    await emitter.emitItemAdded(k);
    await emitter.emitItemDone(k);
    for (let i = 0; i < 5; i += 1) {
      const t = transientItem(take());
      await emitter.emitItemAdded(t);
      await emitter.emitItemDone(t);
    }
    take();

    expect(issued[0]).toBe(100);
    for (let i = 1; i < issued.length; i += 1) {
      expect(issued[i]).toBeGreaterThan(issued[i - 1]!);
    }
  });
  it("does not evict a keyed item replaced while an earlier transient completion was still awaiting", async () => {
    // The first transient `item.done` awaits its event callback; meanwhile a
    // durable item takes the same keyed id. The stale completion must not put
    // the durable replacement in the eviction queue.
    let release!: () => void;
    let holdNext = true;
    const emitter = createResponseEmitter({
      requestId: "req_test",
      maxBufferSize: 1,
      onEvent: (event) => {
        if (holdNext && event.type === "item.done") {
          holdNext = false;
          return new Promise<void>((resolve) => (release = resolve));
        }
      }
    });

    const keyed = "item_component_keyed:status";
    await emitter.emitItemAdded(transientItem(0, keyed));
    const staleDone = emitter.emitItemDone(transientItem(0, keyed));

    const durable: ComponentItem = { ...transientItem(1, keyed), transient: false };
    await emitter.emitItemAdded(durable);
    await emitter.emitItemDone(durable);

    release();
    await staleDone;

    // Another transient completion fills the one-slot cap.
    await emitter.emitItemAdded(transientItem(2));
    await emitter.emitItemDone(transientItem(2));

    const kept = emitter.getItems().find((item) => item.id === keyed);
    expect(kept?.transient).toBe(false);
  });
  it("still evicts a done transient item that was updated while its completion was awaiting", async () => {
    // An `item.updated` is a patch, not a replacement: it must not take the
    // item out of eviction, or it would stay in memory for good.
    let release!: () => void;
    let holdNext = true;
    const emitter = createResponseEmitter({
      requestId: "req_test",
      maxBufferSize: 1,
      onEvent: (event) => {
        if (holdNext && event.type === "item.done") {
          holdNext = false;
          return new Promise<void>((resolve) => (release = resolve));
        }
      }
    });

    const patched = "item_t_patched";
    await emitter.emitItemAdded(transientItem(0, patched));
    const done = emitter.emitItemDone(transientItem(0, patched));
    await emitter.emitItemUpdated(patched, { data: { n: 99 } });
    release();
    await done;

    for (let i = 1; i <= 3; i += 1) {
      await emitter.emitItemAdded(transientItem(i));
      await emitter.emitItemDone(transientItem(i));
    }

    expect(emitter.getItems().some((item) => item.id === patched)).toBe(false);
    expect(emitter.getItems()).toHaveLength(1);
  });
});
