/**
 * Tests for FIX-658 task attribution — `attributeItemsToTasks`,
 * `itemsForTask`, `collectAttributedItemIds`.
 *
 * Attribution is by the emit-time `taskId` stamped on each item (set by the
 * worker body via `ctx._markTaskScope`), not by timestamp windows. These
 * tests pin the behaviours that timestamp windowing got wrong: concurrent
 * sibling workers whose lifecycles overlap, and sequential turns of one
 * worker. Collection membership is resolved from `task-change` events so a
 * pass scoped to one collection ignores another collection's tasks.
 */
import { describe, expect, it } from "vitest";
import type { ComponentItem, MessageItem, OutputItem, SourceItem } from "../../src/items";
import {
  attributeItemsToTasks,
  itemsForTask,
  collectAttributedItemIds,
} from "../../src/items";

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

function taskChange(args: {
  collectionId: string;
  taskId: string;
  kind: "added" | "claimed" | "completed" | "errored" | "cancelled" | "retried";
  ts: number;
}): ComponentItem {
  return {
    id: nextId("item_component"),
    type: "component",
    status: "completed",
    requestId: "req_1",
    itemIndex: 0,
    provenance: { blockName: "task-board", blockInstanceId: "task-board#1", phase: "main" },
    ts: args.ts,
    component: "task-change",
    data: { collectionId: args.collectionId, taskId: args.taskId, kind: args.kind },
  };
}

function message(args: { ts: number; text: string; taskId?: string }): MessageItem {
  return {
    id: nextId("item_msg"),
    type: "message",
    role: "assistant",
    status: "completed",
    requestId: "req_1",
    itemIndex: 0,
    provenance: { blockName: "worker", blockInstanceId: "worker#1", phase: "main" },
    ts: args.ts,
    taskId: args.taskId,
    content: [{ type: "output_text", text: args.text }],
  };
}

function source(args: { ts: number; url: string; taskId?: string }): SourceItem {
  return {
    id: nextId("item_source"),
    type: "source",
    status: "completed",
    requestId: "req_1",
    itemIndex: 0,
    provenance: { blockName: "worker", blockInstanceId: "worker#1", phase: "main" },
    ts: args.ts,
    taskId: args.taskId,
    sourceType: "url",
    sourceId: nextId("src"),
    url: args.url,
  };
}

function text(item: OutputItem): string {
  return (item as MessageItem).content[0]!.type === "output_text"
    ? ((item as MessageItem).content[0] as { text: string }).text
    : "";
}

describe("attributeItemsToTasks / itemsForTask / collectAttributedItemIds", () => {
  it("concurrent overlap: sibling items never bleed into the queueing task", () => {
    // discoverer claimed, then while it is still running an analyzer is
    // spawned, claimed, runs to completion, and the discoverer finishes after.
    // Timestamp windowing put the analyzer message inside the discoverer's
    // open window; emit-time taskId keeps them disjoint.
    const items: OutputItem[] = [
      taskChange({ collectionId: "c", taskId: "discoverer", kind: "claimed", ts: 100 }),
      message({ ts: 110, text: "discoverer step 1", taskId: "discoverer" }),
      taskChange({ collectionId: "c", taskId: "analyzer", kind: "claimed", ts: 120 }),
      message({ ts: 130, text: "analyzer step 1", taskId: "analyzer" }),
      message({ ts: 140, text: "discoverer step 2", taskId: "discoverer" }),
      taskChange({ collectionId: "c", taskId: "analyzer", kind: "completed", ts: 150 }),
      taskChange({ collectionId: "c", taskId: "discoverer", kind: "completed", ts: 160 }),
    ];

    const map = attributeItemsToTasks(items, "c");
    expect(map.get("discoverer")!.map(text)).toEqual([
      "discoverer step 1",
      "discoverer step 2",
    ]);
    expect(map.get("analyzer")!.map(text)).toEqual(["analyzer step 1"]);
  });

  it("each item lands in at most one bucket (disjoint)", () => {
    const items: OutputItem[] = [
      taskChange({ collectionId: "c", taskId: "a", kind: "claimed", ts: 100 }),
      taskChange({ collectionId: "c", taskId: "b", kind: "claimed", ts: 110 }),
      message({ ts: 120, text: "a-work", taskId: "a" }),
      message({ ts: 130, text: "b-work", taskId: "b" }),
    ];
    const map = attributeItemsToTasks(items, "c");
    const total = [...map.values()].reduce((acc, b) => acc + b.length, 0);
    expect(total).toBe(2);
  });

  it("sequential turns of one worker attribute to their own task", () => {
    // Same worker runs t1 then t2; identical execution paths, distinguished
    // only by the emit-time taskId stamp.
    const items: OutputItem[] = [
      taskChange({ collectionId: "c", taskId: "t1", kind: "claimed", ts: 100 }),
      message({ ts: 110, text: "t1-work", taskId: "t1" }),
      taskChange({ collectionId: "c", taskId: "t1", kind: "completed", ts: 120 }),
      taskChange({ collectionId: "c", taskId: "t2", kind: "claimed", ts: 130 }),
      message({ ts: 140, text: "t2-work", taskId: "t2" }),
      taskChange({ collectionId: "c", taskId: "t2", kind: "completed", ts: 150 }),
    ];
    const map = attributeItemsToTasks(items, "c");
    expect(map.get("t1")!.map(text)).toEqual(["t1-work"]);
    expect(map.get("t2")!.map(text)).toEqual(["t2-work"]);
  });

  it("re-claim after review unions both attempts' items under the task", () => {
    const items: OutputItem[] = [
      taskChange({ collectionId: "c", taskId: "t", kind: "claimed", ts: 100 }),
      message({ ts: 110, text: "attempt 1", taskId: "t" }),
      taskChange({ collectionId: "c", taskId: "t", kind: "retried", ts: 120 }),
      taskChange({ collectionId: "c", taskId: "t", kind: "claimed", ts: 200 }),
      message({ ts: 210, text: "attempt 2", taskId: "t" }),
      taskChange({ collectionId: "c", taskId: "t", kind: "completed", ts: 300 }),
    ];
    expect(itemsForTask(items, "c", "t").map(text)).toEqual(["attempt 1", "attempt 2"]);
  });

  it("excludes bookend task-change items and unattributed (no taskId) items", () => {
    const items: OutputItem[] = [
      message({ ts: 50, text: "pre-claim noise" }), // no taskId
      taskChange({ collectionId: "c", taskId: "t", kind: "claimed", ts: 100 }),
      message({ ts: 110, text: "real work", taskId: "t" }),
      taskChange({ collectionId: "c", taskId: "t", kind: "completed", ts: 120 }),
    ];
    const out = itemsForTask(items, "c", "t");
    expect(out).toHaveLength(1);
    expect(text(out[0]!)).toBe("real work");
  });

  it("cross-collection isolation: a pass ignores another collection's tasks", () => {
    const items: OutputItem[] = [
      taskChange({ collectionId: "a", taskId: "t1", kind: "claimed", ts: 100 }),
      message({ ts: 110, text: "a-work", taskId: "t1" }),
      taskChange({ collectionId: "b", taskId: "t2", kind: "claimed", ts: 120 }),
      message({ ts: 130, text: "b-work", taskId: "t2" }),
    ];
    expect([...attributeItemsToTasks(items, "a").keys()]).toEqual(["t1"]);
    expect([...attributeItemsToTasks(items, "b").keys()]).toEqual(["t2"]);
    expect(itemsForTask(items, "a", "t2")).toEqual([]);
  });

  it("itemsForTask returns [] for a task with no task-change events", () => {
    const items: OutputItem[] = [
      message({ ts: 110, text: "orphan", taskId: "ghost" }),
    ];
    expect(itemsForTask(items, "c", "ghost")).toEqual([]);
  });

  it("collectAttributedItemIds returns every task-owned item id across collections, excluding bookends", () => {
    const m1 = message({ ts: 110, text: "a-work", taskId: "t1" });
    const s1 = source({ ts: 115, url: "https://x", taskId: "t1" });
    const m2 = message({ ts: 130, text: "b-work", taskId: "t2" });
    const noise = message({ ts: 50, text: "noise" }); // no taskId
    const items: OutputItem[] = [
      taskChange({ collectionId: "a", taskId: "t1", kind: "claimed", ts: 100 }),
      m1,
      s1,
      taskChange({ collectionId: "b", taskId: "t2", kind: "claimed", ts: 120 }),
      m2,
      noise,
    ];
    const owned = collectAttributedItemIds(items);
    expect(owned).toEqual(new Set([m1.id, s1.id, m2.id]));
  });
});
