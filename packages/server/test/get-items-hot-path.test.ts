import { describe, expect, it } from "vitest";
import { createResponseEmitter } from "../src";
import type { OutputItem } from "@flow-state-dev/core/items";

/**
 * Regression coverage for FIX-406 6G: `getItems()` no longer sorts on every
 * read, and the emitter exposes an O(1) `getItemCount()` for the per-emit
 * `itemIndex` assignment that previously triggered a full sort.
 */
function makeItem(index: number, ts: number): OutputItem {
  return {
    id: `item_${index}`,
    type: "message",
    role: "assistant",
    status: "completed",
    itemIndex: index,
    ts,
    provenance: { blockName: "b", blockInstanceId: "b#0" },
    content: []
  } as unknown as OutputItem;
}

describe("response emitter item hot path", () => {
  it("getItemCount matches the number of tracked items in O(1)", async () => {
    const emitter = createResponseEmitter({ requestId: "req_count" });
    expect(emitter.getItemCount()).toBe(0);

    for (let i = 0; i < 5; i++) {
      await emitter.emitItemAdded(makeItem(i, 1000 + i));
    }

    expect(emitter.getItemCount()).toBe(5);
    expect(emitter.getItemCount()).toBe(emitter.getItems().length);
  });

  it("getItems returns items in stream (insertion) order", async () => {
    const emitter = createResponseEmitter({ requestId: "req_order" });
    for (let i = 0; i < 4; i++) {
      await emitter.emitItemAdded(makeItem(i, 2000 + i));
    }

    const ids = emitter.getItems().map((item) => item.id);
    expect(ids).toEqual(["item_0", "item_1", "item_2", "item_3"]);
  });

  it("item.done / item.updated preserve an item's original stream position", async () => {
    const emitter = createResponseEmitter({ requestId: "req_update" });
    await emitter.emitItemAdded(makeItem(0, 3000));
    await emitter.emitItemAdded(makeItem(1, 3001));
    await emitter.emitItemAdded(makeItem(2, 3002));

    // Re-touch the first item after later ones were added.
    await emitter.emitItemUpdated("item_0", { status: "in_progress" });
    await emitter.emitItemDone(makeItem(0, 3000));

    const ids = emitter.getItems().map((item) => item.id);
    expect(ids).toEqual(["item_0", "item_1", "item_2"]);
    expect(emitter.getItemCount()).toBe(3);
  });

  it("stays well under a quadratic blowup for a large item stream", async () => {
    const emitter = createResponseEmitter({ requestId: "req_perf" });
    const N = 5000;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      // Mirror the runtime hot path: read the count (itemIndex) then emit.
      const index = emitter.getItemCount();
      await emitter.emitItemAdded(makeItem(index, 1_000_000 + i));
    }
    const elapsed = performance.now() - start;

    expect(emitter.getItemCount()).toBe(N);
    // The old per-emit sort made this path super-linear; with an O(1) count
    // and no read-time sort it is comfortably linear. Generous bound to stay
    // CI-stable while still catching a reintroduced sort.
    expect(elapsed).toBeLessThan(1500);
  });
});
