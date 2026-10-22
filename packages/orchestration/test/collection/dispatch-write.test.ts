/**
 * A held row and the dispatch that releases it (FIX-1875 S3; a release of a
 * held row since FIX-2080 D1).
 *
 * A row filed held doesn't start until something releases it. `dispatch` is
 * the release a dispatching board's `dispatchTask { taskId }` writes: it
 * refuses a row that isn't held (started, released, or ready from the start)
 * and an ended one, and it records the call that made it, so the same call
 * replayed finds its own write instead of that refusal (BR-15). Every release
 * of a held row publishes `released`. No caller-patchable surface reaches the
 * status.
 */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  type Task,
  type TaskChangeEvent,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

type Backing = { tasks: TaskCollectionRef; events: TaskChangeEvent[] };

async function sequencerBacking(): Promise<Backing> {
  const events: TaskChangeEvent[] = [];
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  const tasks = createStateBackedTaskCollection({
    collectionId: "tasks",
    state: sequencer,
    onChange: (event) => events.push(event),
    now: () => 1000,
  });
  return { tasks, events };
}

async function resourceBacking(): Promise<Backing> {
  const events: TaskChangeEvent[] = [];
  const tasks = await createResourceBackedTaskCollection({
    collectionId: "tasks",
    collection: createFakeResourceCollection(),
    onChange: (event) => events.push(event),
    now: () => 1000,
  });
  return { tasks, events };
}

const BACKINGS = [
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking],
] as const;

describe.each(BACKINGS)("dispatching a held row (%s)", (_name, makeBacking) => {
  it("files held only when asked, so a plain add is ready as before", async () => {
    const { tasks } = await makeBacking();
    await tasks.addTask({ id: "ready", goal: "g", assignee: "ops" });
    await tasks.addTask({ id: "held", goal: "g", assignee: "ops", held: true });
    expect(tasks.get("ready")!.status).toBe("pending");
    expect(tasks.get("held")!.status).toBe("held");
  });

  it("releases the row and records the call, setting the assignee in the same write", async () => {
    const { tasks, events } = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", held: true });
    const outcome = await tasks.dispatch!("t", { call: "call-1", assignee: "ops" });
    expect(outcome).toEqual({ outcome: "recorded" });
    expect(tasks.get("t") as Task).toMatchObject({ status: "pending", assignee: "ops", dispatchCall: "call-1" });
    expect(events.at(-1)).toMatchObject({ kind: "released", prevStatus: "held" });
  });

  it("answers a replay of the same call unchanged, not with the already-dispatched refusal", async () => {
    const { tasks } = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", assignee: "ops", held: true });
    await tasks.dispatch!("t", { call: "call-1" });
    expect(await tasks.dispatch!("t", { call: "call-1" })).toEqual({ outcome: "unchanged" });
    expect(await tasks.dispatch!("t", { call: "call-2" })).toEqual({
      outcome: "declined",
      reason: "already-dispatched",
      status: "pending",
    });
  });

  it("refuses a row that was never held: an ordinary filed row is already dispatched", async () => {
    const { tasks } = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", assignee: "ops" });
    expect(await tasks.dispatch!("t", { call: "call-1" })).toEqual({
      outcome: "declined",
      reason: "already-dispatched",
      status: "pending",
    });
  });

  it("refuses a claimed or running row, and an ended one, writing nothing", async () => {
    const { tasks } = await makeBacking();
    // Claim never admits a held row, so a running row is one filed ready and
    // claimed by its worker: there is nothing left to release.
    await tasks.addTask({ id: "run", goal: "g", assignee: "ops" });
    await tasks.addTask({ id: "end", goal: "g", assignee: "ops", held: true });
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

  it("refuses an assignee a follow-up can't take, as updateTask does", async () => {
    const { tasks } = await makeBacking();
    await tasks.addTask({ id: "t-f1", goal: "g", assignee: "ops", followUpOf: "t", held: true });
    expect(await tasks.dispatch!("t-f1", { call: "c", assignee: "writer" })).toMatchObject({
      outcome: "declined",
      reason: "follow-up",
    });
    expect(tasks.get("t-f1")!.status).toBe("held");
  });

  it("keeps the status out of reach of every caller-patchable write", async () => {
    const { tasks } = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", assignee: "ops", held: true });
    await tasks.patchMetadata("t", { status: "pending" });
    await tasks.setAssignee("t", "writer");
    const row = tasks.get("t") as Task;
    expect(row.status).toBe("held");
    expect(row.assignee).toBe("writer");
    expect(row.metadata).toEqual({ status: "pending" });
  });

  it("lets an assign and a dispatch land in either order: the later owner stands and the row is released once", async () => {
    const assignFirst = (await makeBacking()).tasks;
    await assignFirst.addTask({ id: "t", goal: "g", assignee: "ops", held: true });
    await assignFirst.setAssignee("t", "writer");
    await assignFirst.dispatch!("t", { call: "c", assignee: "editor" });
    expect(assignFirst.get("t")).toMatchObject({ assignee: "editor", status: "pending" });

    const dispatchFirst = (await makeBacking()).tasks;
    await dispatchFirst.addTask({ id: "t", goal: "g", assignee: "ops", held: true });
    await dispatchFirst.dispatch!("t", { call: "c", assignee: "editor" });
    await dispatchFirst.setAssignee("t", "writer");
    expect(dispatchFirst.get("t")).toMatchObject({ assignee: "writer", status: "pending" });
  });
});

// A held row gates every claimer of the collection, not only the board that
// files it: a plain drain, a dispatch or a row action claims through the
// substrate's admission, and one that took a held row would start work
// nobody released.
describe.each(BACKINGS)("a claimer with no start test of its own (%s)", (_name, makeBacking) => {
  it("never claims a held row, and claims it once it is released by a dispatch", async () => {
    const { tasks } = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", assignee: "ops", held: true });
    expect(await tasks.claim("w", { leaseDurationMs: 10_000 })).toBeNull();
    expect(tasks.get("t")!.status).toBe("held");

    await tasks.dispatch!("t", { call: "call-1" });
    expect((await tasks.claim("w", { leaseDurationMs: 10_000 }))?.id).toBe("t");
  });

  it("claims a row filed ready, as every row was before holds (BP-030)", async () => {
    const { tasks } = await makeBacking();
    await tasks.addTask({ id: "legacy", goal: "g", assignee: "ops" });
    expect((await tasks.claim("w", { leaseDurationMs: 10_000 }))?.id).toBe("legacy");
  });
});
