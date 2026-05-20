/**
 * Tests for FIX-621 §3.4: ResponseEmitter.subscribeToItems implementation.
 *
 * The emitter must fan out item.added / item.updated / item.done transitions
 * to registered listeners, supporting unsubscribe, multi-listener fan-out,
 * exception isolation, re-entrant subscribe (listener registered during
 * fan-out skips the in-flight event), and snapshot semantics (a listener
 * unsubscribing itself mid-fan-out must not break the iteration).
 */
import type { MessageItem, OutputItem } from "@flow-state-dev/core/items";
import { describe, expect, it, vi } from "vitest";
import { createResponseEmitter } from "../src/streaming/response-emitter";

function makeItem(itemIndex: number, id?: string): MessageItem {
  return {
    id: id ?? `item_${itemIndex}`,
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: `hello ${itemIndex}` }],
    status: "completed",
    requestId: "req_test",
    itemIndex,
    provenance: {
      blockName: "test",
      blockInstanceId: "test_1",
      phase: "main"
    },
    ts: 100 + itemIndex
  };
}

describe("ResponseEmitter.subscribeToItems", () => {
  it("fires listener on item.added with kind 'added'", async () => {
    const emitter = createResponseEmitter({ requestId: "req_test", now: () => 100 });
    const events: Array<{ id: string; kind: string }> = [];
    emitter.subscribeToItems((item, kind) => {
      events.push({ id: item.id, kind });
    });
    await emitter.emitItemAdded(makeItem(0));
    expect(events).toEqual([{ id: "item_0", kind: "added" }]);
  });

  it("fires listener on item.updated and item.done", async () => {
    const emitter = createResponseEmitter({ requestId: "req_test", now: () => 100 });
    const events: Array<{ id: string; kind: string }> = [];
    emitter.subscribeToItems((item, kind) => {
      events.push({ id: item.id, kind });
    });
    await emitter.emitItemAdded(makeItem(0));
    await emitter.emitItemUpdated("item_0", { status: "in_progress" });
    await emitter.emitItemDone(makeItem(0));
    expect(events.map((e) => e.kind)).toEqual(["added", "updated", "done"]);
  });

  it("fans out to multiple listeners", async () => {
    const emitter = createResponseEmitter({ requestId: "req_test", now: () => 100 });
    const a: string[] = [];
    const b: string[] = [];
    emitter.subscribeToItems((_item, kind) => a.push(kind));
    emitter.subscribeToItems((_item, kind) => b.push(kind));
    await emitter.emitItemAdded(makeItem(0));
    expect(a).toEqual(["added"]);
    expect(b).toEqual(["added"]);
  });

  it("unsubscribe stops subsequent invocations", async () => {
    const emitter = createResponseEmitter({ requestId: "req_test", now: () => 100 });
    const events: string[] = [];
    const off = emitter.subscribeToItems((_item, kind) => events.push(kind));
    await emitter.emitItemAdded(makeItem(0));
    off();
    await emitter.emitItemAdded(makeItem(1, "item_1"));
    expect(events).toEqual(["added"]);
  });

  it("double unsubscribe is a no-op", async () => {
    const emitter = createResponseEmitter({ requestId: "req_test", now: () => 100 });
    const events: string[] = [];
    const off = emitter.subscribeToItems((_item, kind) => events.push(kind));
    off();
    off();
    await emitter.emitItemAdded(makeItem(0));
    expect(events).toEqual([]);
  });

  it("listener throw does not abort other listeners; debug event recorded", async () => {
    const emitter = createResponseEmitter({ requestId: "req_test", now: () => 100 });
    const survived: string[] = [];
    emitter.subscribeToItems(() => {
      throw new Error("listener boom");
    });
    emitter.subscribeToItems((_item, kind) => survived.push(kind));
    await emitter.emitItemAdded(makeItem(0));
    expect(survived).toEqual(["added"]);
    const debug = emitter
      .getEvents()
      .filter(
        (e) =>
          e.type === "debug" &&
          (e as { name?: string }).name === "response.subscribeToItems.listener_threw"
      );
    expect(debug.length).toBe(1);
  });

  it("listener registered during fan-out does not fire for the in-flight event", async () => {
    const emitter = createResponseEmitter({ requestId: "req_test", now: () => 100 });
    const late: string[] = [];
    emitter.subscribeToItems(() => {
      emitter.subscribeToItems((_item, kind) => late.push(kind));
    });
    await emitter.emitItemAdded(makeItem(0));
    expect(late).toEqual([]);
    // But fires on the next event.
    await emitter.emitItemAdded(makeItem(1, "item_1"));
    // Note: the re-entrant subscribe runs again on event 2, registering yet
    // another listener — but our "late" callback registered during event 1
    // sees event 2.
    expect(late.length).toBeGreaterThanOrEqual(1);
    expect(late[0]).toBe("added");
  });

  it("listener that unsubscribes itself during fan-out does not break iteration", async () => {
    const emitter = createResponseEmitter({ requestId: "req_test", now: () => 100 });
    const events: string[] = [];
    let off: (() => void) | undefined;
    off = emitter.subscribeToItems((_item, kind) => {
      events.push(`self:${kind}`);
      off?.();
    });
    emitter.subscribeToItems((_item, kind) => events.push(`other:${kind}`));
    await emitter.emitItemAdded(makeItem(0));
    // Both fire on first event (snapshot semantics).
    expect(events).toEqual(["self:added", "other:added"]);
    // Self-removing listener is gone on second event.
    await emitter.emitItemAdded(makeItem(1, "item_1"));
    expect(events).toEqual(["self:added", "other:added", "other:added"]);
  });
});

// Silence unused-import warnings in CI if vi happens unused.
void vi;
