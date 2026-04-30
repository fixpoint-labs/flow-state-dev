/**
 * Tests for FIX-480 §3.1 — `extractTaskItems` / `computeTaskItemWindows`.
 *
 * The substrate utility is the lifted-from-renderer `extractTaskItemWindows`
 * algorithm. Tests cover the boundary cases the spec calls out (single-task
 * happy path, parallel claims, retries without terminal close, abandoned
 * tasks, cross-collection isolation, bookend exclusion).
 */
import { describe, expect, it } from "vitest";
import type { ComponentItem, MessageItem, OutputItem, SourceItem } from "@flow-state-dev/core/items";
import {
  computeTaskItemWindows,
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

function message(args: { ts: number; text: string }): MessageItem {
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
    content: [{ type: "output_text", text: args.text }],
  };
}

function sourceItem(args: { ts: number; url: string; title?: string }): SourceItem {
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
    sourceType: "url",
    sourceId: nextId("src"),
    url: args.url,
    title: args.title,
  };
}

describe("extractTaskItems / computeTaskItemWindows", () => {
  it("single-task happy path: returns items between claim and terminal", () => {
    const items: OutputItem[] = [
      taskChange({ collectionId: "c1", taskId: "t1", kind: "added", ts: 100 }),
      taskChange({ collectionId: "c1", taskId: "t1", kind: "claimed", ts: 200 }),
      message({ ts: 250, text: "working" }),
      sourceItem({ ts: 260, url: "https://example.com", title: "Example" }),
      taskChange({ collectionId: "c1", taskId: "t1", kind: "completed", ts: 300 }),
      message({ ts: 400, text: "after-window" }),
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
      message({ ts: 200, text: "real work" }),
      taskChange({ collectionId: "c1", taskId: "t1", kind: "completed", ts: 300 }),
    ];

    const out = extractTaskItems(items, "c1", "t1");
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("message");
  });

  it("excludes task-change for nested collections inside the window", () => {
    // A worker spawns a nested taskBoard. Its `task-change` events should
    // be skipped — they're substrate scaffolding, not worker emissions.
    const items: OutputItem[] = [
      taskChange({ collectionId: "outer", taskId: "t1", kind: "claimed", ts: 100 }),
      message({ ts: 150, text: "outer work" }),
      taskChange({ collectionId: "inner", taskId: "n1", kind: "added", ts: 160 }),
      taskChange({ collectionId: "inner", taskId: "n1", kind: "claimed", ts: 170 }),
      taskChange({ collectionId: "inner", taskId: "n1", kind: "completed", ts: 180 }),
      message({ ts: 200, text: "more outer work" }),
      taskChange({ collectionId: "outer", taskId: "t1", kind: "completed", ts: 300 }),
    ];

    const out = extractTaskItems(items, "outer", "t1");
    expect(out).toHaveLength(2);
    expect(out.every((i) => i.type === "message")).toBe(true);
  });

  it("retries do not reset the window — first-claim-wins, all attempts included", () => {
    const items: OutputItem[] = [
      taskChange({ collectionId: "c1", taskId: "t1", kind: "claimed", ts: 100 }),
      message({ ts: 110, text: "attempt 1" }),
      taskChange({ collectionId: "c1", taskId: "t1", kind: "retried", ts: 120 }),
      taskChange({ collectionId: "c1", taskId: "t1", kind: "claimed", ts: 200 }),
      message({ ts: 210, text: "attempt 2" }),
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

  it("abandoned/in-flight (no terminal): returns all items after claim", () => {
    const items: OutputItem[] = [
      taskChange({ collectionId: "c1", taskId: "t1", kind: "claimed", ts: 100 }),
      message({ ts: 150, text: "still running" }),
      message({ ts: 999, text: "still running later" }),
    ];

    const out = extractTaskItems(items, "c1", "t1");
    expect(out).toHaveLength(2);
  });

  it("cross-collection isolation — different collectionIds do not bleed", () => {
    const items: OutputItem[] = [
      taskChange({ collectionId: "a", taskId: "t1", kind: "claimed", ts: 100 }),
      message({ ts: 150, text: "a-work" }),
      taskChange({ collectionId: "b", taskId: "t1", kind: "claimed", ts: 200 }),
      message({ ts: 250, text: "b-work" }),
      taskChange({ collectionId: "a", taskId: "t1", kind: "completed", ts: 300 }),
      taskChange({ collectionId: "b", taskId: "t1", kind: "completed", ts: 350 }),
    ];

    const aOut = extractTaskItems(items, "a", "t1");
    const bOut = extractTaskItems(items, "b", "t1");

    // `a` window is 100..300 — picks up both messages chronologically.
    // `b` window is 200..350 — picks up the b-work message only.
    expect(aOut.map((i) => (i as MessageItem).content[0])).toEqual([
      { type: "output_text", text: "a-work" },
      { type: "output_text", text: "b-work" },
    ]);
    expect(bOut.map((i) => (i as MessageItem).content[0])).toEqual([
      { type: "output_text", text: "b-work" },
    ]);
  });

  it("computeTaskItemWindows reports start/end per task", () => {
    const items: OutputItem[] = [
      taskChange({ collectionId: "c1", taskId: "t1", kind: "claimed", ts: 100 }),
      taskChange({ collectionId: "c1", taskId: "t2", kind: "claimed", ts: 150 }),
      taskChange({ collectionId: "c1", taskId: "t1", kind: "completed", ts: 200 }),
      // t2 never terminates
    ];
    const w = computeTaskItemWindows(items, "c1");
    expect(w.size).toBe(2);
    expect(w.get("t1")).toEqual({ start: 100, end: 200 });
    expect(w.get("t2")).toEqual({ start: 150, end: undefined });
  });

  it("extractTaskItemWindows assigns each item to first matching task only (no duplication)", () => {
    const items: OutputItem[] = [
      taskChange({ collectionId: "c1", taskId: "t1", kind: "claimed", ts: 100 }),
      taskChange({ collectionId: "c1", taskId: "t2", kind: "claimed", ts: 150 }),
      // This message falls in BOTH windows; the per-stream function should
      // assign it to the FIRST matching task only.
      message({ ts: 175, text: "shared-time-window" }),
      taskChange({ collectionId: "c1", taskId: "t1", kind: "completed", ts: 300 }),
      taskChange({ collectionId: "c1", taskId: "t2", kind: "completed", ts: 400 }),
    ];

    const map = extractTaskItemWindows(items, "c1");
    const total = [...map.values()].reduce((acc, b) => acc + b.length, 0);
    expect(total).toBe(1); // exactly one assignment, never duplicated
  });
});
