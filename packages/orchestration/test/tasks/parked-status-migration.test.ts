/**
 * FIX-1245 — the shipped task status is `parked`, and the legacy
 * `awaiting_review` still reads.
 *
 * The rename is not cosmetic on the read path. Persisted resource state is
 * parsed on every read, and `normalizeResourceState` never surfaces a value
 * that fails its schema — it substitutes the resource's default. A task row
 * written before this change carries `awaiting_review`, so an enum that no
 * longer accepts it would not mislabel that row: it would silently reset the
 * whole collection instance to empty. Hence BP-030's dual read, and hence a
 * test that pins the legacy value rather than only the new one.
 *
 * The shim also has to be a **fixed point**. `assertStableResourceState`
 * re-parses any value a schema rewrote and rejects the write when the second
 * parse moves it again, so mapping legacy → `parked` is only safe because
 * parsing `parked` yields `parked`.
 */

import { describe, it, expect } from "vitest";
import { taskSchema } from "../../src/tasks/schema/task";
import { taskStatusSchema, type TaskStatus } from "../../src/tasks/schema/task-status";

/** A persisted task row at the given status, with every required field present. */
function rowAt(status: string): Record<string, unknown> {
  return {
    id: "ask",
    goal: "wait for a person",
    status,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000
  };
}

describe("FIX-1245 parked status", () => {
  it("is the status the enum ships", () => {
    expect(taskStatusSchema.safeParse("parked").success).toBe(true);
  });

  it("no longer accepts the old name as a value callers may write", () => {
    expect(taskStatusSchema.safeParse("awaiting_review").success).toBe(false);
  });

  it("reads a persisted row still carrying awaiting_review, as parked", () => {
    const parsed = taskSchema.safeParse(rowAt("awaiting_review"));
    expect(parsed.success).toBe(true);
    expect((parsed.data as { status: TaskStatus }).status).toBe("parked");
  });

  it("is a fixed point: re-parsing the migrated row does not move it again", () => {
    const once = taskSchema.parse(rowAt("awaiting_review"));
    const twice = taskSchema.parse(once);
    expect(twice).toEqual(once);
  });

  it("leaves a row already written at parked alone", () => {
    const parsed = taskSchema.parse(rowAt("parked"));
    expect((parsed as { status: TaskStatus }).status).toBe("parked");
  });
});
