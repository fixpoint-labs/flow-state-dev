/**
 * Tests for `task-plan-state.ts` — the pure data-extraction helpers behind
 * `<TaskPlan />`. The component itself wraps these helpers in a `useMemo` and
 * adds DOM rendering; covering the helpers directly avoids running a
 * happy-dom render for cases that are entirely about data shape.
 */
import { describe, it, expect } from "vitest";
import type { ComponentItem, OutputItem } from "@flow-state-dev/core/items";
import {
  TASK_BOARD_META_COMPONENT,
  TASK_CHANGE_COMPONENT,
  collectTaskOwnedItemIds,
  discoverCollections,
  extractTaskItemWindows,
  extractTaskPlanState,
  groupTasksByAssignee,
  groupTasksByStatus,
  humanizeStatus,
  type Task,
  type TaskStatus,
} from "../registry/components/task-plan-state";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let nextItemIndex = 0;
let nextTs = 1_000;
function resetItemCounters() {
  nextItemIndex = 0;
  nextTs = 1_000;
}

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  const { id, goal, status, createdAt, updatedAt, ...rest } = overrides;
  return {
    id,
    goal: goal ?? id,
    status: status ?? "pending",
    createdAt: createdAt ?? 0,
    updatedAt: updatedAt ?? 0,
    ...rest,
  };
}

function makeTaskChange(
  collectionId: string,
  task: Task,
  options?: { kind?: string; prevStatus?: TaskStatus }
): ComponentItem {
  const item: ComponentItem = {
    id: `item_change_${task.id}_${nextItemIndex}`,
    type: "component",
    component: TASK_CHANGE_COMPONENT,
    data: {
      collectionId,
      taskId: task.id,
      kind: options?.kind ?? "added",
      task,
      ...(options?.prevStatus !== undefined ? { prevStatus: options.prevStatus } : {}),
    },
    key: `${collectionId}/${task.id}`,
    status: "completed",
    requestId: "req_test",
    itemIndex: nextItemIndex++,
    provenance: { blockName: "test", blockInstanceId: "test", phase: "main" },
    ts: nextTs++,
  } as ComponentItem;
  return item;
}

function makeBoardMeta(
  collectionId: string,
  status: string,
  counts?: Record<string, number>
): ComponentItem {
  return {
    id: `item_meta_${collectionId}_${nextItemIndex}`,
    type: "component",
    component: TASK_BOARD_META_COMPONENT,
    data: {
      collectionId,
      status,
      ...(counts !== undefined ? { counts } : {}),
    },
    key: collectionId,
    status: "completed",
    requestId: "req_test",
    itemIndex: nextItemIndex++,
    provenance: { blockName: "test", blockInstanceId: "test", phase: "main" },
    ts: nextTs++,
  } as ComponentItem;
}

// ---------------------------------------------------------------------------
// extractTaskPlanState
// ---------------------------------------------------------------------------

describe("extractTaskPlanState", () => {
  it("returns empty state when no items match the collection", () => {
    resetItemCounters();
    const state = extractTaskPlanState([], "board-1");
    expect(state.tasks).toEqual([]);
    expect(state.boardMeta).toEqual({});
    expect(state.collectionId).toBe("board-1");
  });

  it("ignores task-change items belonging to other collections", () => {
    resetItemCounters();
    const items: OutputItem[] = [
      makeTaskChange("other-board", makeTask({ id: "t1" })),
      makeTaskChange("board-1", makeTask({ id: "t2" })),
    ];
    const state = extractTaskPlanState(items, "board-1");
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]!.task.id).toBe("t2");
  });

  it("collapses multiple task-change items per task to the latest", () => {
    resetItemCounters();
    const items: OutputItem[] = [
      makeTaskChange("board-1", makeTask({ id: "t1", status: "pending" }), { kind: "added" }),
      makeTaskChange("board-1", makeTask({ id: "t1", status: "in_progress" }), {
        kind: "claimed",
        prevStatus: "pending",
      }),
      makeTaskChange("board-1", makeTask({ id: "t1", status: "completed" }), {
        kind: "completed",
        prevStatus: "in_progress",
      }),
    ];
    const state = extractTaskPlanState(items, "board-1");
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]!.task.status).toBe("completed");
    expect(state.tasks[0]!.kind).toBe("completed");
    expect(state.tasks[0]!.prevStatus).toBe("in_progress");
  });

  it("captures the latest task-board-meta for the collection", () => {
    resetItemCounters();
    const items: OutputItem[] = [
      makeBoardMeta("board-1", "active"),
      makeTaskChange("board-1", makeTask({ id: "t1", status: "completed" }), {
        kind: "completed",
      }),
      makeBoardMeta("board-1", "completed", {
        total: 1,
        completed: 1,
        errored: 0,
        cancelled: 0,
        blocked: 0,
        awaiting_review: 0,
        in_progress: 0,
        pending: 0,
      }),
    ];
    const state = extractTaskPlanState(items, "board-1");
    expect(state.boardMeta.status).toBe("completed");
    expect(state.boardMeta.counts?.total).toBe(1);
  });

  it("returns tasks in createdAt ascending order regardless of emission order", () => {
    resetItemCounters();
    const items: OutputItem[] = [
      makeTaskChange("board-1", makeTask({ id: "z", createdAt: 30 })),
      makeTaskChange("board-1", makeTask({ id: "a", createdAt: 10 })),
      makeTaskChange("board-1", makeTask({ id: "m", createdAt: 20 })),
    ];
    const state = extractTaskPlanState(items, "board-1");
    expect(state.tasks.map((e) => e.task.id)).toEqual(["a", "m", "z"]);
  });

  it("ignores non-component items", () => {
    resetItemCounters();
    const messageItem = {
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [],
      status: "completed",
      requestId: "req_test",
      itemIndex: 0,
      provenance: { blockName: "test", blockInstanceId: "test", phase: "main" },
      ts: 0,
    } as OutputItem;

    const items: OutputItem[] = [
      messageItem,
      makeTaskChange("board-1", makeTask({ id: "t1" })),
    ];
    const state = extractTaskPlanState(items, "board-1");
    expect(state.tasks).toHaveLength(1);
  });

  it("ignores task-change items with missing data fields", () => {
    resetItemCounters();
    const malformed = {
      id: "item_bad",
      type: "component",
      component: TASK_CHANGE_COMPONENT,
      data: { collectionId: "board-1" }, // missing taskId + task
      status: "completed",
      requestId: "req_test",
      itemIndex: 0,
      provenance: { blockName: "test", blockInstanceId: "test", phase: "main" },
      ts: 0,
    } as ComponentItem;

    const items: OutputItem[] = [
      malformed,
      makeTaskChange("board-1", makeTask({ id: "t1" })),
    ];
    const state = extractTaskPlanState(items, "board-1");
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]!.task.id).toBe("t1");
  });
});

// ---------------------------------------------------------------------------
// groupTasksByStatus
// ---------------------------------------------------------------------------

describe("groupTasksByStatus", () => {
  it("emits sections in canonical order, dropping empty ones", () => {
    const entries = [
      { task: makeTask({ id: "a", status: "completed" }) },
      { task: makeTask({ id: "b", status: "pending" }) },
      { task: makeTask({ id: "c", status: "in_progress" }) },
    ];
    const groups = groupTasksByStatus(entries);
    expect(groups.map((g) => g.status)).toEqual([
      "pending",
      "in_progress",
      "completed",
    ]);
  });

  it("hides cancelled tasks by default", () => {
    const entries = [
      { task: makeTask({ id: "a", status: "cancelled" }) },
      { task: makeTask({ id: "b", status: "completed" }) },
    ];
    const groups = groupTasksByStatus(entries);
    expect(groups.map((g) => g.status)).toEqual(["completed"]);
  });

  it("respects explicit hiddenStatuses (overrides default)", () => {
    const entries = [
      { task: makeTask({ id: "a", status: "cancelled" }) },
      { task: makeTask({ id: "b", status: "completed" }) },
    ];
    const groups = groupTasksByStatus(entries, { hiddenStatuses: [] });
    expect(groups.map((g) => g.status)).toEqual(["completed", "cancelled"]);
  });

  it("trails unknown / extended statuses at the end with humanized labels", () => {
    const entries = [
      { task: makeTask({ id: "a", status: "completed" }) },
      { task: makeTask({ id: "b", status: "needs-revision" }) },
      { task: makeTask({ id: "c", status: "planning" }) },
    ];
    const groups = groupTasksByStatus(entries);
    expect(groups[0]!.status).toBe("completed");
    expect(groups.slice(1).map((g) => g.status).sort()).toEqual([
      "needs-revision",
      "planning",
    ]);
    const needsRevision = groups.find((g) => g.status === "needs-revision");
    expect(needsRevision!.label).toBe("Needs revision");
  });
});

// ---------------------------------------------------------------------------
// groupTasksByAssignee
// ---------------------------------------------------------------------------

describe("groupTasksByAssignee", () => {
  it("buckets entries by assignee with named groups before unassigned", () => {
    const entries = [
      { task: makeTask({ id: "a", assignee: "writer" }) },
      { task: makeTask({ id: "b" }) }, // unassigned
      { task: makeTask({ id: "c", assignee: "editor" }) },
      { task: makeTask({ id: "d", assignee: "writer" }) },
    ];
    const groups = groupTasksByAssignee(entries);
    expect(groups.map((g) => g.label)).toEqual([
      "editor",
      "writer",
      "Unassigned",
    ]);
    expect(groups.find((g) => g.label === "writer")!.entries).toHaveLength(2);
  });

  it("returns a single group when every entry shares one assignee", () => {
    const entries = [
      { task: makeTask({ id: "a", assignee: "writer" }) },
      { task: makeTask({ id: "b", assignee: "writer" }) },
    ];
    const groups = groupTasksByAssignee(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("writer");
  });
});

// ---------------------------------------------------------------------------
// discoverCollections
// ---------------------------------------------------------------------------

describe("discoverCollections", () => {
  it("returns the sorted set of collectionIds across both item types", () => {
    resetItemCounters();
    const items: OutputItem[] = [
      makeTaskChange("zeta", makeTask({ id: "t1" })),
      makeBoardMeta("alpha", "active"),
      makeTaskChange("alpha", makeTask({ id: "t2" })),
      makeTaskChange("zeta", makeTask({ id: "t3" })),
    ];
    expect(discoverCollections(items)).toEqual(["alpha", "zeta"]);
  });

  it("ignores items that aren't task-change or task-board-meta", () => {
    resetItemCounters();
    const otherComponent = {
      id: "item_other",
      type: "component",
      component: "some-other-thing",
      data: { collectionId: "ignored" },
      status: "completed",
      requestId: "req_test",
      itemIndex: 0,
      provenance: { blockName: "test", blockInstanceId: "test", phase: "main" },
      ts: 0,
    } as ComponentItem;
    expect(discoverCollections([otherComponent])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// humanizeStatus
// ---------------------------------------------------------------------------

describe("humanizeStatus", () => {
  it.each([
    ["in_progress", "In progress"],
    ["awaiting_review", "Awaiting review"],
    ["needs-revision", "Needs revision"],
    ["planning", "Planning"],
    ["", ""],
  ])("normalizes %s → %s", (input, expected) => {
    expect(humanizeStatus(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// extractTaskItemWindows / collectTaskOwnedItemIds (FIX-658)
// ---------------------------------------------------------------------------

function makeWorkMessage(text: string, taskId?: string): OutputItem {
  return {
    id: `item_msg_${nextItemIndex++}`,
    type: "message",
    role: "assistant",
    status: "completed",
    requestId: "req_test",
    itemIndex: nextItemIndex,
    provenance: { blockName: "worker", blockInstanceId: "worker", phase: "main" },
    ts: nextTs++,
    taskId,
    content: [{ type: "output_text", text }],
  } as OutputItem;
}

describe("extractTaskItemWindows / collectTaskOwnedItemIds", () => {
  it("attributes a concurrent sibling's items to itself, not the queueing task", () => {
    resetItemCounters();
    const disc = makeTask({ id: "discoverer" });
    const anl = makeTask({ id: "analyzer" });
    const items: OutputItem[] = [
      makeTaskChange("c", disc, { kind: "claimed" }),
      makeWorkMessage("discoverer work", "discoverer"),
      makeTaskChange("c", anl, { kind: "claimed" }),
      makeWorkMessage("analyzer work", "analyzer"),
      makeWorkMessage("discoverer more", "discoverer"),
      makeTaskChange("c", anl, { kind: "completed" }),
      makeTaskChange("c", disc, { kind: "completed" }),
    ];

    const windows = extractTaskItemWindows(items, "c");
    expect(windows.get("discoverer")).toHaveLength(2);
    expect(windows.get("analyzer")).toHaveLength(1);

    // Buckets are disjoint — no item appears under two tasks.
    const all = [...windows.values()].flat().map((i) => i.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it("collectTaskOwnedItemIds returns task-owned ids and excludes bookends + unattributed", () => {
    resetItemCounters();
    const t = makeTask({ id: "t1" });
    const owned = makeWorkMessage("owned", "t1");
    const orphan = makeWorkMessage("orphan"); // no taskId
    const items: OutputItem[] = [
      makeTaskChange("c", t, { kind: "claimed" }),
      owned,
      orphan,
      makeTaskChange("c", t, { kind: "completed" }),
    ];

    const ids = collectTaskOwnedItemIds(items);
    expect(ids.has(owned.id)).toBe(true);
    expect(ids.has(orphan.id)).toBe(false);
    // Bookend task-change items are never owned.
    expect([...ids].some((id) => id.startsWith("item_change"))).toBe(false);
  });
});
