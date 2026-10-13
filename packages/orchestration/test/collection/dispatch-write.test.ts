/**
 * A recorded row and the write that dispatches it (FIX-1875 S3).
 *
 * A row recorded but not dispatched carries `undispatched: true`. Absent
 * means ready, so every row stored before the mark existed keeps starting
 * (BR-5). `dispatch` is the one write that readies a recorded row: it refuses
 * a row that is claimed, running, ended or already ready (BR-10), and it
 * records the call that made it, so the same call replayed finds its own write
 * instead of that refusal (BR-15). No caller-patchable surface reaches the mark.
 */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  taskSchema,
  type Task,
  type TaskCollectionRef,
} from "../../src/tasks";
import { dispatchWrite } from "../../src/tasks/collection/internal";
import { createCapturedChanges, createFakeResourceCollection, createFakeSequencerState } from "../helpers";

async function sequencerBacking(): Promise<TaskCollectionRef> {
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  return createStateBackedTaskCollection({
    collectionId: "tasks",
    state: sequencer,
    onChange: createCapturedChanges().onChange,
    now: () => 1000,
  });
}

async function resourceBacking(): Promise<TaskCollectionRef> {
  return createResourceBackedTaskCollection({
    collectionId: "tasks",
    collection: createFakeResourceCollection(),
    onChange: createCapturedChanges().onChange,
    now: () => 1000,
  });
}

const BACKINGS = [
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking],
] as const;

describe("the not-dispatched mark on the stored shape", () => {
  it("round-trips through the task schema, and a row without it parses as ready", () => {
    const base = { id: "t", goal: "g", status: "pending", attempts: 0, createdAt: 1, updatedAt: 1 };
    expect(taskSchema.parse({ ...base, undispatched: true, dispatchCall: "c1" })).toMatchObject({
      undispatched: true,
      dispatchCall: "c1",
    });
    expect(taskSchema.parse(base).undispatched).toBeUndefined();
  });
});

describe("the dispatch rule on a row no public write produces", () => {
  it("refuses a running row that still carries the mark, rather than readying it", () => {
    // Claim never admits a marked row; a row stored this way by another writer
    // must still not be readied mid-run.
    const row = taskSchema.parse({
      id: "t", goal: "g", status: "in_progress", attempts: 1, createdAt: 1, updatedAt: 1, undispatched: true,
    }) as Task;
    expect(dispatchWrite(row, { call: "c" })).toEqual({ decline: "disallowed" });
  });
});

describe.each(BACKINGS)("dispatching a recorded row (%s)", (_name, makeBacking) => {
  it("files the mark only when asked, so a plain add is ready as before", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "ready", goal: "g", assignee: "ops" });
    await tasks.addTask({ id: "recorded", goal: "g", assignee: "ops", undispatched: true });
    expect(tasks.get("ready")!.undispatched).toBeUndefined();
    expect(tasks.get("recorded")!.undispatched).toBe(true);
  });

  it("clears the mark and records the call, setting the assignee in the same write", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", undispatched: true });
    const outcome = await tasks.dispatch!("t", { call: "call-1", assignee: "ops" });
    expect(outcome).toEqual({ outcome: "recorded" });
    const row = tasks.get("t") as Task;
    expect(row.undispatched).toBeUndefined();
    expect(row).toMatchObject({ status: "pending", assignee: "ops", dispatchCall: "call-1" });
  });

  it("marks the row waited-on in the same write when the dispatch waits", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", assignee: "ops", undispatched: true });
    await tasks.dispatch!("t", { call: "call-1", ask: { gateId: "ask:tasks:t#n", deadline: 5000 } });
    const row = tasks.get("t") as Task;
    expect(row.undispatched).toBeUndefined();
    expect(row.ask).toEqual({ gateId: "ask:tasks:t#n", deadline: 5000 });
  });

  it("answers a replay of the same call unchanged, not with the already-dispatched refusal", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", assignee: "ops", undispatched: true });
    await tasks.dispatch!("t", { call: "call-1" });
    expect(await tasks.dispatch!("t", { call: "call-1" })).toEqual({ outcome: "unchanged" });
    expect(await tasks.dispatch!("t", { call: "call-2" })).toEqual({
      outcome: "declined",
      reason: "already-dispatched",
      status: "pending",
    });
  });

  it("refuses a row that was never recorded: an ordinary filed row is already dispatched", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", assignee: "ops" });
    expect(await tasks.dispatch!("t", { call: "call-1" })).toEqual({
      outcome: "declined",
      reason: "already-dispatched",
      status: "pending",
    });
  });

  it("refuses a claimed or running row, and an ended one, writing nothing", async () => {
    const tasks = await makeBacking();
    // Claim never admits a recorded row, so a running row is one filed ready
    // and claimed by its worker: there is nothing left to dispatch.
    await tasks.addTask({ id: "run", goal: "g", assignee: "ops" });
    await tasks.addTask({ id: "end", goal: "g", assignee: "ops", undispatched: true });
    await tasks.cancel("end", "no longer needed");
    const claimed = await tasks.claim("w", { leaseDurationMs: 10_000, eligibility: (t) => t.id === "run" });
    expect(claimed?.id).toBe("run");
    const runBefore = tasks.get("run")!.revision;
    expect(await tasks.dispatch!("run", { call: "c" })).toEqual({
      outcome: "declined",
      reason: "already-dispatched",
      status: "in_progress",
    });
    expect(tasks.get("run")!.revision).toBe(runBefore);
    expect(await tasks.dispatch!("end", { call: "c" })).toEqual({
      outcome: "declined",
      reason: "terminal",
      status: "cancelled",
    });
  });

  it("refuses an assignee a follow-up can't take, as assignTask does", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "t-f1", goal: "g", assignee: "ops", followUpOf: "t", undispatched: true });
    expect(await tasks.dispatch!("t-f1", { call: "c", assignee: "writer" })).toMatchObject({
      outcome: "declined",
      reason: "follow-up",
    });
    expect(tasks.get("t-f1")!.undispatched).toBe(true);
  });

  it("keeps the mark out of reach of every caller-patchable write", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", assignee: "ops", undispatched: true });
    await tasks.patchMetadata("t", { undispatched: false });
    await tasks.setAssignee("t", "writer");
    const row = tasks.get("t") as Task;
    expect(row.undispatched).toBe(true);
    expect(row.assignee).toBe("writer");
    expect(row.metadata).toEqual({ undispatched: false });
  });

  it("lets an assign and a dispatch land in either order: the later owner stands and the row is ready once", async () => {
    const assignFirst = await makeBacking();
    await assignFirst.addTask({ id: "t", goal: "g", assignee: "ops", undispatched: true });
    await assignFirst.setAssignee("t", "writer");
    await assignFirst.dispatch!("t", { call: "c", assignee: "editor" });
    expect(assignFirst.get("t")).toMatchObject({ assignee: "editor", status: "pending" });
    expect(assignFirst.get("t")!.undispatched).toBeUndefined();

    const dispatchFirst = await makeBacking();
    await dispatchFirst.addTask({ id: "t", goal: "g", assignee: "ops", undispatched: true });
    await dispatchFirst.dispatch!("t", { call: "c", assignee: "editor" });
    await dispatchFirst.setAssignee("t", "writer");
    expect(dispatchFirst.get("t")).toMatchObject({ assignee: "writer", status: "pending" });
    expect(dispatchFirst.get("t")!.undispatched).toBeUndefined();
  });
});

// The mark gates every claimer of the collection, not only the board that
// writes it: a plain drain, a hand-off or a row action claims through the
// substrate's admission, and one that took a recorded row would start work
// nobody dispatched.
describe.each(BACKINGS)("a claimer with no start test of its own (%s)", (_name, makeBacking) => {
  it("never claims a recorded row, and claims it once it is dispatched", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", assignee: "ops", undispatched: true });
    expect(await tasks.claim("w", { leaseDurationMs: 10_000 })).toBeNull();
    expect(tasks.get("t")!.status).toBe("pending");

    await tasks.dispatch!("t", { call: "call-1" });
    expect((await tasks.claim("w", { leaseDurationMs: 10_000 }))?.id).toBe("t");
  });

  it("claims a row filed without the mark, as every row was before it (BP-030)", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "legacy", goal: "g", assignee: "ops" });
    expect((await tasks.claim("w", { leaseDurationMs: 10_000 }))?.id).toBe("legacy");
  });
});
