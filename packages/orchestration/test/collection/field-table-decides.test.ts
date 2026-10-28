/**
 * The field table is the guard (FIX-2081): the collection's settings write
 * decides each field by `TASK_FIELD_RULES`, with no rule of its own beside
 * it. Here the table is swapped for one where `priority` stays editable
 * until the task finishes. A started task then takes a priority edit and
 * still refuses a goal edit, on both backings. A write that kept its own
 * "started" rule would refuse both, and this file goes red.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/tasks/collection/field-rules", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/tasks/collection/field-rules")>();
  const TASK_FIELD_RULES = { ...real.TASK_FIELD_RULES, priority: "until-finish" } as const;
  const finished = new Set(["completed", "errored", "cancelled"]);
  // A copy of `lockedFields`, reading the swapped table.
  const lockedFields: typeof real.lockedFields = (task, fields) => {
    if (finished.has(task.status)) return [...fields];
    if (!real.hasStarted(task)) return [];
    return fields.filter((field) => TASK_FIELD_RULES[field] === "until-start");
  };
  return { ...real, TASK_FIELD_RULES, lockedFields };
});

const { createResourceBackedTaskCollection, createStateBackedTaskCollection, ticketForClaim } = await import("../../src/tasks");
const { createFakeResourceCollection, createFakeSequencerState } = await import("../helpers");

const BACKINGS = [
  [
    "state-backed",
    async () =>
      createStateBackedTaskCollection({
        collectionId: "tasks",
        state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
      }),
  ],
  ["resource-backed", async () => createResourceBackedTaskCollection({ collectionId: "tasks", collection: createFakeResourceCollection() })],
] as const;

describe.each(BACKINGS)("the settings write reads the field table (%s)", (_name, make) => {
  it("lets a started task take an edit its table rule still allows, and refuses the rest", async () => {
    const tasks = await make();
    await tasks.addTask({ id: "t", goal: "g", maxAttempts: 2, priority: 1 });
    const claimed = (await tasks.claim("w"))!;
    await tasks.fail("t", "boom", { claim: ticketForClaim("tasks", claimed) });
    // Pending again, and started once.
    expect(tasks.get("t")).toMatchObject({ status: "pending", attempts: 1 });

    expect(await tasks.patchSettings("t", { priority: 5 })).toEqual({ outcome: "recorded" });
    expect(tasks.get("t")?.priority).toBe(5);
    expect(await tasks.patchSettings("t", { goal: "g2" })).toMatchObject({ outcome: "declined", reason: "started" });
    expect(tasks.get("t")?.goal).toBe("g");
  });
});
