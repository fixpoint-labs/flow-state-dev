/**
 * Tests for `extractTaskItems` / `extractTaskItemWindows` (FIX-480, reworked
 * for FIX-658).
 *
 * Since FIX-658 these delegate to the shared `@flow-state-dev/core/items`
 * attribution algorithm, which keys off the emit-time `taskId` stamped on each
 * item (not timestamp windows). The fixtures stamp `taskId` the way the
 * runtime does. Cases cover the boundary conditions the substrate cares about:
 * single-task happy path, the concurrent-overlap bug, retries, abandoned
 * tasks, cross-collection isolation, and bookend exclusion.
 */
import { describe, expect, it } from "vitest";
import type { ComponentItem, MessageItem, OutputItem, SourceItem } from "@flow-state-dev/core/items";
import {
  extractTaskItems,
  extractTaskItemWindows,
} from "../../src";

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
    provenance: {
      blockName: "task-board",
      blockInstanceId: "task-board#1",
      phase: "main",
    },
    ts: args.ts,
    component: "task-change",
    data: {
      collectionId: args.collectionId,
      taskId: args.taskId,
      kind: args.kind,
    },
  };
}

function taskBoardMeta(args: { collectionId: string; ts: number }): ComponentItem {
  return {
    id: nextId("item_component"),
    type: "component",
    status: "completed",
    requestId: "req_1",
    itemIndex: 0,
    provenance: {
      blockName: "task-board",
      blockInstanceId: "task-board#1",
      phase: "main",
    },
    ts: args.ts,
    component: "task-board-meta",
    data: { collectionId: args.collectionId, status: "active" },
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
    provenance: {
      blockName: "worker",
      blockInstanceId: "worker#1",
      phase: "main",
    },
    ts: args.ts,
    taskId: args.taskId,
    content: [{ type: "output_text", text: args.text }],
  };
}

function sourceItem(args: { ts: number; url: string; title?: string; taskId?: string }): SourceItem {
  return {
    id: nextId("item_source"),
    type: "source",
    status: "completed",
    requestId: "req_1",
    itemIndex: 0,
    provenance: {
      blockName: "worker",
      blockInstanceId: "worker#1",
      phase: "main",
    },
    ts: args.ts,
    taskId: args.taskId,
    sourceType: "url",
    sourceId: nextId("src"),
    url: args.url,
    title: args.title,
  };
}

describe("extractTaskItems / extractTaskItemWindows", () => {
  it("single-task happy path: returns items emitted under the task", () => {
    const items: OutputItem[] = [
      taskChange({ collectionId: "c1", taskId: "t1", kind: "added", ts: 100 }),
      taskChange({ collectionId: "c1", taskId: "t1", kind: "claimed", ts: 200 }),
      message({ ts: 250, text: "working", taskId: "t1" }),
      sourceItem({ ts: 260, url: "https://example.com", title: "Example", taskId: "t1" }),
      taskChange({ collectionId: "c1", taskId: "t1", kind: "completed", ts: 300 }),
      message({ ts: 400, text: "after, outside any task" }),
    ];

    const out = extractTaskItems(items, "c1", "t1");
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe("message");
    expect(out[1].type).toBe("source");
  });

  it("returns [] when the task has no claim event", () => {
    const items: OutputItem[] = [
      taskChange({ collectionId: "c1", taskId: "t1", kind: "added", ts: 100 }),
      message({ ts: 250, text: "noise" }),
    ];
    expect(extractTaskItems(items, "c1", "t1")).toEqual([]);
  });

  it("excludes task-change and task-board-meta bookends", () => {
    const items: OutputItem[] = [
      taskChange({ collectionId: "c1", taskId: "t1", kind: "claimed", ts: 100 }),
      taskBoardMeta({ collectionId: "c1", ts: 150 }),
      message({ ts: 200, text: "real work", taskId: "t1" }),
      taskChange({ collectionId: "c1", taskId: "t1", kind: "completed", ts: 300 }),
    ];

    const out = extractTaskItems(items, "c1", "t1");
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("message");
  });

  it("excludes nested-collection task-change items", () => {
    // A worker spawns a nested taskBoard. Its `task-change` events are
    // bookends — skipped — and its work items carry the inner task id, so
    // they don't attribute to the outer task.
    const items: OutputItem[] = [
      taskChange({ collectionId: "outer", taskId: "t1", kind: "claimed", ts: 100 }),
      message({ ts: 150, text: "outer work", taskId: "t1" }),
      taskChange({ collectionId: "inner", taskId: "n1", kind: "added", ts: 160 }),
      taskChange({ collectionId: "inner", taskId: "n1", kind: "claimed", ts: 170 }),
      taskChange({ collectionId: "inner", taskId: "n1", kind: "completed", ts: 180 }),
      message({ ts: 200, text: "more outer work", taskId: "t1" }),
      taskChange({ collectionId: "outer", taskId: "t1", kind: "completed", ts: 300 }),
    ];

    const out = extractTaskItems(items, "outer", "t1");
    expect(out).toHaveLength(2);
    expect(out.every((i) => i.type === "message")).toBe(true);
  });

  it("retries union all attempts under the same task", () => {
    const items: OutputItem[] = [
      taskChange({ collectionId: "c1", taskId: "t1", kind: "claimed", ts: 100 }),
      message({ ts: 110, text: "attempt 1", taskId: "t1" }),
      taskChange({ collectionId: "c1", taskId: "t1", kind: "retried", ts: 120 }),
      taskChange({ collectionId: "c1", taskId: "t1", kind: "claimed", ts: 200 }),
      message({ ts: 210, text: "attempt 2", taskId: "t1" }),
      taskChange({ collectionId: "c1", taskId: "t1", kind: "completed", ts: 300 }),
    ];

    const out = extractTaskItems(items, "c1", "t1");
    expect(out).toHaveLength(2);
    const texts = (out as MessageItem[]).map((m) => m.content[0]);
    expect(texts).toEqual([
      { type: "output_text", text: "attempt 1" },
      { type: "output_text", text: "attempt 2" },
    ]);
  });

  it("abandoned/in-flight (no terminal): returns all items stamped for the task", () => {
    const items: OutputItem[] = [
      taskChange({ collectionId: "c1", taskId: "t1", kind: "claimed", ts: 100 }),
      message({ ts: 150, text: "still running", taskId: "t1" }),
      message({ ts: 999, text: "still running later", taskId: "t1" }),
    ];

    const out = extractTaskItems(items, "c1", "t1");
    expect(out).toHaveLength(2);
  });

  it("concurrent overlap: a sibling's items do not bleed into the queueing task", () => {
    // The FIX-658 bug. `t1` is still running (window open) when `t2` runs to
    // completion inside it. Timestamp windowing put `t2`'s message in `t1`'s
    // bucket; emit-time `taskId` keeps them disjoint.
    const items: OutputItem[] = [
      taskChange({ collectionId: "c1", taskId: "t1", kind: "claimed", ts: 100 }),
      message({ ts: 110, text: "t1 work", taskId: "t1" }),
      taskChange({ collectionId: "c1", taskId: "t2", kind: "claimed", ts: 120 }),
      message({ ts: 130, text: "t2 work", taskId: "t2" }),
      taskChange({ collectionId: "c1", taskId: "t2", kind: "completed", ts: 140 }),
      message({ ts: 150, text: "t1 more work", taskId: "t1" }),
      taskChange({ collectionId: "c1", taskId: "t1", kind: "completed", ts: 160 }),
    ];

    expect((extractTaskItems(items, "c1", "t1") as MessageItem[]).map((m) => m.content[0])).toEqual([
      { type: "output_text", text: "t1 work" },
      { type: "output_text", text: "t1 more work" },
    ]);
    expect((extractTaskItems(items, "c1", "t2") as MessageItem[]).map((m) => m.content[0])).toEqual([
      { type: "output_text", text: "t2 work" },
    ]);
  });

  it("cross-collection isolation — different collectionIds do not bleed", () => {
    const items: OutputItem[] = [
      taskChange({ collectionId: "a", taskId: "t1", kind: "claimed", ts: 100 }),
      message({ ts: 150, text: "a-work", taskId: "t1" }),
      taskChange({ collectionId: "b", taskId: "t2", kind: "claimed", ts: 200 }),
      message({ ts: 250, text: "b-work", taskId: "t2" }),
      taskChange({ collectionId: "a", taskId: "t1", kind: "completed", ts: 300 }),
      taskChange({ collectionId: "b", taskId: "t2", kind: "completed", ts: 350 }),
    ];

    expect((extractTaskItems(items, "a", "t1") as MessageItem[]).map((m) => m.content[0])).toEqual([
      { type: "output_text", text: "a-work" },
    ]);
    expect((extractTaskItems(items, "b", "t2") as MessageItem[]).map((m) => m.content[0])).toEqual([
      { type: "output_text", text: "b-work" },
    ]);
  });

  it("extractTaskItemWindows: each item attributes to exactly one task (no duplication)", () => {
    const items: OutputItem[] = [
      taskChange({ collectionId: "c1", taskId: "t1", kind: "claimed", ts: 100 }),
      taskChange({ collectionId: "c1", taskId: "t2", kind: "claimed", ts: 150 }),
      message({ ts: 175, text: "t1-only", taskId: "t1" }),
      taskChange({ collectionId: "c1", taskId: "t1", kind: "completed", ts: 300 }),
      taskChange({ collectionId: "c1", taskId: "t2", kind: "completed", ts: 400 }),
    ];

    const map = extractTaskItemWindows(items, "c1");
    const total = [...map.values()].reduce((acc, b) => acc + b.length, 0);
    expect(total).toBe(1);
    expect(map.get("t1")).toHaveLength(1);
    expect(map.get("t2")).toBeUndefined();
  });
});
