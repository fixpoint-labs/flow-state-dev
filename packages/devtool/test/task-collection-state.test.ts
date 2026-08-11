/**
 * Folding a session's item stream into boards (FIX-1071).
 *
 * The fold's whole contract is that each task ends up at its LATEST state, and
 * everything downstream trusts that: the Tasks panel renders the row from it,
 * and the Workstreams panel matches links against its `topic` and `assignee`.
 * A fold that lands on a stale snapshot is silent — every row still renders,
 * with the wrong values in it.
 */
import { describe, expect, it } from "vitest";
import { groupCollections } from "../src/react/lib/task-collection-state";
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
