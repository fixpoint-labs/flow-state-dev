/**
 * `updateTask` when a task starts between the tool's read and its write
 * (FIX-2081): the tool's pre-check passes on the row it read, still pending,
 * and the collection's guarded write refuses on the row it commits against,
 * now started. The refusal reaches the model as `field_locked_after_start`,
 * and the row keeps its worker and its status. Both backings, for a
 * reassignment and for a hold.
 */
import { describe, expect, it } from "vitest";
import type { GeneratorTool } from "@flow-state-dev/core";
import { runForTest } from "@flow-state-dev/testing";
import { buildTaskToolsList } from "../../src/skills/task-tools-capability";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  type Task,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";
import { buildDelegationCtx } from "./delegation-ctx";

const BACKINGS: Array<[string, () => Promise<TaskCollectionRef>]> = [
  [
    "state-backed",
    async () =>
      createStateBackedTaskCollection({
        collectionId: "tasks",
        state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
      }),
  ],
  ["resource-backed", async () => createResourceBackedTaskCollection({ collectionId: "tasks", collection: createFakeResourceCollection() })],
];

/**
 * `ref` as the tool sees it when the task starts in between: the first read
 * of `id` answers the row as it stood before, and the claim lands before the
 * write. Later reads are fresh.
 */
function startsInBetween(ref: TaskCollectionRef, id: string, before: Task): TaskCollectionRef {
  let stale = true;
  return {
    ...ref,
    get: (taskId: string) => {
      if (taskId === id && stale) {
        stale = false;
        return before;
      }
      return ref.get(taskId);
    },
    patchSettings: async (taskId, patch) => {
      await ref.claim("w", { eligibility: (t) => t.id === id });
      return ref.patchSettings(taskId, patch);
    },
  } as TaskCollectionRef;
}

const updateTaskOver = (ref: TaskCollectionRef): GeneratorTool => {
  const tool = buildTaskToolsList(async () => ref).find((t) => (t as { config?: { name?: string } }).config?.name === "updateTask");
  return tool as GeneratorTool;
};

describe.each(BACKINGS)("updateTask across a claim (%s)", (_name, make) => {
  it.each([
    ["a reassignment", { assignee: "writer" }, "assignee"],
    ["a hold", { status: "held" }, "a hold or a release"],
  ] as const)("refuses %s once the task has started under it, and writes nothing", async (_what, edit, named) => {
    const ref = await make();
    await ref.addTask({ id: "a", goal: "g", assignee: "researcher" });
    const before = ref.get("a")!;
    expect(before.status).toBe("pending");
    const { ctx } = buildDelegationCtx({ self: false });

    const result = (await runForTest(updateTaskOver(startsInBetween(ref, "a", before)), { id: "a", ...edit }, ctx)) as {
      ok: boolean;
      error: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^field_locked_after_start: /);
    expect(result.error).toContain(named);
    expect(result.error).toContain("it is in_progress");
    expect(ref.get("a")).toMatchObject({ status: "in_progress", assignee: "researcher" });
  });
});

