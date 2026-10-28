/**
 * The field table inside the collection's one guarded edit (FIX-2081): every
 * field `updateTask` changes is decided against the committed row, inside the
 * write, on both backings. A task that starts between a caller's read and the
 * write is refused, not edited; a retry's return to `pending` doesn't reopen
 * it; a follow-up keeps its worker; a cancel records how it was made; a
 * progress report and a completion keep the checkpoint.
 */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  lockedFields,
  TASK_FIELD_RULES,
  ticketForClaim,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

const BACKINGS: Array<[string, () => Promise<TaskCollectionRef>]> = [
  [
    "state-backed",
    async () =>
      createStateBackedTaskCollection({
        collectionId: "tasks",
        state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
      }),
  ],
  [
    "resource-backed",
    async () => createResourceBackedTaskCollection({ collectionId: "tasks", collection: createFakeResourceCollection() }),
  ],
];

describe("the field table", () => {
  it("gives every field one rule: until the task starts, but a cancel and a message until it finishes", () => {
    for (const [field, rule] of Object.entries(TASK_FIELD_RULES)) {
      expect(rule, field).toBe(field === "cancel" || field === "message" ? "until-finish" : "until-start");
    }
    expect(TASK_FIELD_RULES.message).toBe("until-finish");
  });

  it("takes a message on a started task, and none on a finished one (FIX-2086)", () => {
    const base = { id: "t", goal: "g", createdAt: 1, updatedAt: 1 } as const;
    expect(lockedFields({ ...base, status: "in_progress", attempts: 1 }, ["message"])).toEqual([]);
    expect(lockedFields({ ...base, status: "completed", attempts: 1 }, ["message"])).toEqual(["message"]);
  });

  it("locks every field on a finished task, and the until-start ones on a started task", () => {
    const base = { id: "t", goal: "g", attempts: 0, createdAt: 1, updatedAt: 1 } as const;
    expect(lockedFields({ ...base, status: "pending" }, ["goal", "cancel"])).toEqual([]);
    expect(lockedFields({ ...base, status: "pending", attempts: 1 }, ["goal", "cancel"])).toEqual(["goal"]);
    expect(lockedFields({ ...base, status: "completed", attempts: 1 }, ["goal", "cancel"])).toEqual(["goal", "cancel"]);
  });
});

describe.each(BACKINGS)("the guarded edit, %s", (_name, make) => {
  it("edits every field of a task that hasn't started, in one write", async () => {
    const tasks = await make();
    await tasks.addTask({ id: "dep", goal: "first" });
    await tasks.addTask({ id: "t", goal: "g", assignee: "a", labels: ["x"], metadata: { keep: 1 } });
    const outcome = await tasks.patchSettings("t", {
      goal: "g2",
      title: "T",
      context: "c",
      input: { k: 1 },
      deps: ["dep"],
      priority: 3,
      labels: ["y"],
      metadata: { added: 2 },
      assignee: "b",
      maxAttempts: 2,
    });
    expect(outcome).toEqual({ outcome: "recorded" });
    expect(tasks.get("t")).toMatchObject({
      goal: "g2",
      title: "T",
      context: "c",
      input: { k: 1 },
      deps: ["dep"],
      priority: 3,
      labels: ["y"],
      metadata: { keep: 1, added: 2 },
      assignee: "b",
      maxAttempts: 2,
    });
  });

  it("refuses an edit once the task has started, and writes nothing", async () => {
    const tasks = await make();
    await tasks.addTask({ id: "t", goal: "g", assignee: "a" });
    await tasks.claim("w");
    const before = JSON.stringify(tasks.get("t"));
    expect(await tasks.patchSettings("t", { assignee: "b" })).toMatchObject({ outcome: "declined", reason: "started" });
    expect(await tasks.patchSettings("t", { goal: "g2" })).toMatchObject({ outcome: "declined", reason: "started" });
    expect(JSON.stringify(tasks.get("t"))).toBe(before);
  });

  it("refuses an edit on a task pending again after a retry: it started once", async () => {
    const tasks = await make();
    await tasks.addTask({ id: "t", goal: "g", maxAttempts: 2 });
    const claimed = (await tasks.claim("w"))!;
    await tasks.fail("t", "boom", { claim: ticketForClaim("tasks", claimed) });
    expect(tasks.get("t")?.status).toBe("pending");
    expect(await tasks.patchSettings("t", { priority: 5 })).toMatchObject({ outcome: "declined", reason: "started" });
  });

  it("refuses an edit on a finished task", async () => {
    const tasks = await make();
    await tasks.addTask({ id: "t", goal: "g" });
    await tasks.cancel("t");
    expect(await tasks.patchSettings("t", { labels: ["late"] })).toMatchObject({ outcome: "declined", reason: "terminal" });
  });

  it("keeps a follow-up's worker", async () => {
    const tasks = await make();
    await tasks.addTask({ id: "t-f1", goal: "g", assignee: "a", followUpOf: "t" });
    expect(await tasks.patchSettings("t-f1", { assignee: "b" })).toMatchObject({ outcome: "declined", reason: "follow-up" });
    expect(tasks.get("t-f1")?.assignee).toBe("a");
  });

  it("records how a cancel was made, when its caller says", async () => {
    const tasks = await make();
    await tasks.addTask({ id: "t", goal: "g" });
    await tasks.addTask({ id: "u", goal: "g" });
    await tasks.cancel("t", undefined, { via: "action" });
    await tasks.cancel("u");
    expect(tasks.get("t")).toMatchObject({ status: "cancelled", cancelledVia: "action" });
    expect(tasks.get("u")).not.toHaveProperty("cancelledVia");
  });

  it("keeps a checkpoint through completion, and writes a result only when none was made", async () => {
    const tasks = await make();
    await tasks.addTask({ id: "cp", goal: "g" });
    await tasks.addTask({ id: "plain", goal: "g" });
    const first = (await tasks.claim("w", { eligibility: (t) => t.id === "cp" }))!;
    const firstClaim = ticketForClaim("tasks", first);
    expect(await tasks.reportProgress!("cp", { output: "checkpoint", statusNote: "note" }, { claim: firstClaim })).toEqual({
      outcome: "recorded",
    });
    await tasks.complete("cp", "final", { claim: firstClaim });
    const second = (await tasks.claim("w", { eligibility: (t) => t.id === "plain" }))!;
    await tasks.complete("plain", "final", { claim: ticketForClaim("tasks", second) });
    expect(tasks.get("cp")).toMatchObject({ status: "completed", output: "checkpoint", statusNote: "note" });
    expect(tasks.get("plain")).toMatchObject({ status: "completed", output: "final" });
  });

  it("refuses a progress report from a claim the row no longer honours", async () => {
    const tasks = await make();
    await tasks.addTask({ id: "t", goal: "g" });
    const claimed = (await tasks.claim("w"))!;
    const claim = ticketForClaim("tasks", claimed);
    await tasks.cancel("t");
    expect(await tasks.reportProgress!("t", { statusNote: "late" }, { claim })).toMatchObject({ outcome: "declined" });
    expect(tasks.get("t")).not.toHaveProperty("statusNote");
  });
});
