/**
 * Folding a session's item stream into boards (FIX-1071).
 *
 * The fold's whole contract is that each task ends up at its LATEST state, and
 * everything downstream trusts that: the Tasks panel renders the row from it,
 * and the Children panel matches links against its `topic` and `assignee`.
 * A fold that lands on a stale snapshot is silent — every row still renders,
 * with the wrong values in it.
 */
import { describe, expect, it } from "vitest";
import {
  flattenTaskItems,
  groupCollections,
} from "../src/react/lib/task-collection-state";
import type { TaskStreamItem } from "../src/react/lib/task-collection-state";

/**
 * One `task-change` item as the substrate emits it.
 *
 * `ts` is required on every item by the contract in `contracts/items/types.ts`,
 * which is what makes an order-independent fold possible.
 */
function change(options: {
  requestId: string;
  ts: number;
  taskId: string;
  assignee?: string;
  topic?: string;
  status?: string;
}): TaskStreamItem {
  return {
    id: `item_${options.requestId}_${options.taskId}_${options.ts}`,
    type: "component",
    status: "completed",
    requestId: options.requestId,
    itemIndex: 0,
    provenance: { blockName: "board", blockInstanceId: "b:0", phase: "main" },
    ts: options.ts,
    component: "task-change",
    data: {
      collectionId: "issues",
      taskId: options.taskId,
      kind: "metadata_changed",
      task: {
        id: options.taskId,
        goal: "do the thing",
        status: options.status ?? "in_progress",
        ...(options.assignee !== undefined ? { assignee: options.assignee } : {}),
        ...(options.topic !== undefined ? { metadata: { topic: options.topic } } : {}),
      },
    },
  } as never;
}

/** One `task-board-meta` item, as a board emits at start and at end. */
function meta(options: {
  requestId: string;
  ts: number;
  status: string;
  total: number;
}): TaskStreamItem {
  return {
    id: `meta_${options.requestId}_${options.ts}`,
    type: "component",
    status: "completed",
    requestId: options.requestId,
    itemIndex: 0,
    provenance: { blockName: "board", blockInstanceId: "b:0", phase: "main" },
    ts: options.ts,
    component: "task-board-meta",
    key: "issues",
    data: {
      collectionId: "issues",
      status: options.status,
      counts: {
        total: options.total,
        pending: 0,
        in_progress: 0,
        blocked: 0,
        awaiting_review: 0,
        completed: options.total,
        errored: 0,
        cancelled: 0,
      },
    },
  } as never;
}

describe("groupCollections — which board meta wins", () => {
  it("keeps the newest meta when an older-started request finishes last", () => {
    // Two overlapping drains on one collection. `req_older` STARTED first but
    // ran longer, so its final meta is emitted AFTER `req_newer`'s — genuinely
    // later, on the real clock. Request ordering walks it first, so a fold that
    // replaces unconditionally then overwrites it with the newer-started
    // request's older snapshot, and the board reports a superseded run.
    //
    // Not a tie: the timestamps differ and the inversion is across requests,
    // which is the case `ts`-wins-outright exists for.
    const [collection] = groupCollections(
      flattenTaskItems([
        {
          startedAt: 2_000,
          items: [meta({ requestId: "req_newer", ts: 3_000, status: "completed", total: 1 })],
        },
        {
          startedAt: 1_000,
          items: [meta({ requestId: "req_older", ts: 4_000, status: "completed", total: 9 })],
        },
      ])
    );

    expect(collection?.boardMeta.counts?.total).toBe(9);
  });

  it("still lets a later meta in the same request supersede an earlier one", () => {
    // The ordinary case the exception was written for: one board emits `active`
    // at start and `completed` at end, inside one request.
    const [collection] = groupCollections(
      flattenTaskItems([
        {
          startedAt: 1_000,
          items: [
            meta({ requestId: "req_1", ts: 1_000, status: "active", total: 0 }),
            meta({ requestId: "req_1", ts: 2_000, status: "completed", total: 3 }),
          ],
        },
      ])
    );

    expect(collection?.boardMeta.status).toBe("completed");
    expect(collection?.boardMeta.counts?.total).toBe(3);
  });
});

describe("groupCollections — which snapshot of a task wins", () => {
  it("keeps the newest change when the items arrive newest-request-first", () => {
    // The order the panel actually receives. `listSessionRequests` returns
    // requests `updated_at DESC` — newest first — and the panel flattens them in
    // that order, so a fold that simply takes the last item it walks past ends
    // up holding the OLDEST request's snapshot of every task that changed twice.
    const older = change({
      requestId: "req_1",
      ts: 1_000,
      taskId: "task-a",
      assignee: "implement",
      topic: "FIX-1",
      status: "in_progress",
    });
    const newer = change({
      requestId: "req_2",
      ts: 2_000,
      taskId: "task-a",
      assignee: "review",
      topic: "FIX-2",
      status: "completed",
    });

    const [collection] = groupCollections([newer, older]);

    expect(collection?.tasks).toHaveLength(1);
    expect(collection?.tasks[0]?.task.status).toBe("completed");
    expect(collection?.tasks[0]?.task.assignee).toBe("review");
    expect(collection?.tasks[0]?.task.metadata?.["topic"]).toBe("FIX-2");
  });

  it("still counts every change it saw, whichever one won", () => {
    // The `×N` ribbon counts activity, not survivors — reordering the winner
    // must not quietly turn two changes into one.
    const [collection] = groupCollections([
      change({ requestId: "req_2", ts: 2_000, taskId: "task-a", status: "completed" }),
      change({ requestId: "req_1", ts: 1_000, taskId: "task-a", status: "in_progress" }),
    ]);

    expect(collection?.tasks[0]?.changeCount).toBe(2);
  });

  it("falls back to walk order when two changes share a timestamp", () => {
    // Within one request the items are already in sequence order, so equal
    // timestamps must not reorder them — the later one walked past still wins.
    const [collection] = groupCollections([
      change({ requestId: "req_1", ts: 5_000, taskId: "task-a", status: "in_progress" }),
      change({ requestId: "req_1", ts: 5_000, taskId: "task-a", status: "completed" }),
    ]);

    expect(collection?.tasks[0]?.task.status).toBe("completed");
  });
});

describe("flattenTaskItems — the two axes a tie can fall on", () => {
  // A `ts` tie has to be broken on the right axis, and the two are opposite in
  // the panel's own ordering: within a request, later-walked is genuinely later;
  // across requests, later-walked is the OLDER request, because the panel holds
  // them newest-first. Walk order alone therefore settles one correctly and
  // inverts the other, which is why the requests are ordered before flattening.

  it("puts an older request's items before a newer one's", () => {
    const items = flattenTaskItems([
      // Newest first, as the panel holds them.
      { startedAt: 2_000, items: [change({ requestId: "req_2", ts: 5_000, taskId: "task-a" })] },
      { startedAt: 1_000, items: [change({ requestId: "req_1", ts: 5_000, taskId: "task-a" })] },
    ]);

    expect(items.map((i) => (i as { requestId: string }).requestId)).toEqual([
      "req_1",
      "req_2",
    ]);
  });

  it("keeps a request's own items in sequence order", () => {
    // The reason requests are reordered rather than the flat item list: within
    // one request the sequence IS the order, and sorting items would lose it.
    const items = flattenTaskItems([
      {
        startedAt: 1_000,
        items: [
          change({ requestId: "req_1", ts: 5_000, taskId: "task-a", status: "in_progress" }),
          change({ requestId: "req_1", ts: 5_000, taskId: "task-a", status: "completed" }),
        ],
      },
    ]);

    expect(items.map((i) => (i as { data: { task: { status: string } } }).data.task.status)).toEqual(
      ["in_progress", "completed"]
    );
  });

  it("orders two requests that started in the same millisecond by recency", () => {
    // A stable sort on equal keys preserves input order, and input order is
    // newest-first — so an equal `startedAt` would re-invert the axis unless the
    // tie is broken deliberately.
    const items = flattenTaskItems([
      { startedAt: 1_000, items: [change({ requestId: "req_newer", ts: 5_000, taskId: "task-a" })] },
      { startedAt: 1_000, items: [change({ requestId: "req_older", ts: 5_000, taskId: "task-a" })] },
    ]);

    expect(items.map((i) => (i as { requestId: string }).requestId)).toEqual([
      "req_older",
      "req_newer",
    ]);
  });
});

describe("the two folds composed — a tie across requests", () => {
  it("lets the newer request win a same-millisecond tie", () => {
    // The defect the `ts` comparison alone cannot catch: equal timestamps fall
    // through to walk order, and walk order across requests was inverted.
    const [collection] = groupCollections(
      flattenTaskItems([
        {
          startedAt: 2_000,
          items: [
            change({
              requestId: "req_newer",
              ts: 5_000,
              taskId: "task-a",
              assignee: "review",
              status: "completed",
            }),
          ],
        },
        {
          startedAt: 1_000,
          items: [
            change({
              requestId: "req_older",
              ts: 5_000,
              taskId: "task-a",
              assignee: "implement",
              status: "in_progress",
            }),
          ],
        },
      ])
    );

    expect(collection?.tasks[0]?.task.status).toBe("completed");
    expect(collection?.tasks[0]?.task.assignee).toBe("review");
  });
});
