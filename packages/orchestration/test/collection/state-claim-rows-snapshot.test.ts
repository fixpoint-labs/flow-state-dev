/**
 * A narrowed claim on the state backing reads the board's rows once per
 * compare-and-set pass.
 *
 * A caller's `eligibility` is handed the board's rows for every candidate it
 * judges. On the state backing that board is one immutable map inside the
 * write, so listing it per candidate turns a claim over N rows into N list
 * builds of N rows each. Every candidate in one pass must see one snapshot.
 */
import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../src/tasks";
import { createStateBackedTaskCollection } from "../../src/tasks/collection/state-backed";
import { createFakeSequencerState } from "../helpers";

describe("a narrowed claim on the state backing", () => {
  it("hands every candidate in one pass the same snapshot of the rows", async () => {
    const tasks = createStateBackedTaskCollection({
      collectionId: "tasks",
      state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
      now: () => 1000,
    });
    const N = 50;
    await tasks.createTasks(Array.from({ length: N }, (_, i) => ({ id: `t${i}`, goal: "g" })));

    // Count every listing of the board's map (an object holding all N rows)
    // made while the claim runs: the scan's own, and any `eligibility` costs.
    const values = vi.spyOn(Object, "values");
    const snapshots = new Set<readonly Task[]>();
    let claimed: Task | null;
    let boardListings: number;
    try {
      claimed = await tasks.claim("w", {
        eligibility: (task, rows) => {
          snapshots.add(rows);
          return task.id === `t${N - 1}`;
        },
      });
      boardListings = values.mock.calls.filter(
        ([arg]) => arg !== null && typeof arg === "object" && Object.keys(arg).length === N && "t0" in arg
      ).length;
    } finally {
      // Restoring also clears the recorded calls, so they are counted first.
      values.mockRestore();
    }

    expect(claimed?.id).toBe(`t${N - 1}`);
    // One compare-and-set pass (no replay here), so one listing and one
    // snapshot, not one per candidate.
    expect(boardListings).toBe(1);
    expect(snapshots.size).toBe(1);
  });
});
