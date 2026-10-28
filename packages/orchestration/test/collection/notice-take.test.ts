/**
 * Taking a notice (FIX-2123): the filer's `onTaskSettled` takes a notice in
 * one conditional write before it runs its block, and the filer's wait drops
 * a notice it read in another. The two are decided on the row as stored, so
 * exactly one goes through, whichever comes first. The same rules on both
 * backings.
 */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  type Task,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

async function sequencerBacking(): Promise<TaskCollectionRef> {
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  return createStateBackedTaskCollection({ collectionId: "tasks", state: sequencer, now: () => 1000 });
}

async function resourceBacking(): Promise<TaskCollectionRef> {
  return createResourceBackedTaskCollection({ collectionId: "tasks", collection: createFakeResourceCollection(), now: () => 1000 });
}

const BACKINGS = [
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking],
] as const;

const KEY = "noticeOwed:1:completed";
const NOTICE = { attempt: 1, ending: "completed" } as const;

/** A row that completed and owes its filer the notice, written as the ledger's recorder would. */
async function endedOwing(tasks: TaskCollectionRef): Promise<void> {
  await tasks.createTask({ id: "t", goal: "g", assignee: "ops" });
  const claimed = await tasks.claim("w", { leaseDurationMs: 10_000 });
  await tasks.complete(claimed!.id, "done");
  await tasks.patchMetadata("t", { [KEY]: { attempt: 1, ending: "completed", due: 1000 } });
}

const marker = (tasks: TaskCollectionRef) => (tasks.get("t") as Task).metadata?.[KEY];
const take = (tasks: TaskCollectionRef) => (tasks.get("t") as Task).metadata?.["noticeTaken:1:completed"];

describe.each(BACKINGS)("taking a notice (%s)", (_name, makeBacking) => {
  it("a take first leaves the wait's drop nothing to drop: the notice is the delivery", async () => {
    const tasks = await makeBacking();
    await endedOwing(tasks);
    expect(await tasks.takeNotice!("t", NOTICE, { by: "r-notice" })).toEqual({ outcome: "recorded" });
    expect(take(tasks)).toEqual({ by: "r-notice", at: 1000 });
    expect(marker(tasks)).toEqual({ attempt: 1, ending: "completed", due: 1000 });

    expect(await tasks.dropNoticeReadByWait!("t")).toEqual({ outcome: "unchanged" });
    expect(marker(tasks)).toEqual({ attempt: 1, ending: "completed", due: 1000 });
    expect(take(tasks)).toMatchObject({ by: "r-notice" });
  });

  it("a drop first leaves no notice to take: the wait was the delivery", async () => {
    const tasks = await makeBacking();
    await endedOwing(tasks);
    expect(await tasks.dropNoticeReadByWait!("t")).toEqual({ outcome: "recorded" });
    expect(await tasks.takeNotice!("t", NOTICE, { by: "r-notice" })).toEqual({ outcome: "unchanged" });
    expect(marker(tasks)).toBeNull();
  });

  it("a notice taken by one request is refused to another, unless that one names it as the taker that ended", async () => {
    const tasks = await makeBacking();
    await endedOwing(tasks);
    await tasks.takeNotice!("t", NOTICE, { by: "r1" });
    expect(await tasks.takeNotice!("t", NOTICE, { by: "r2" })).toEqual({ outcome: "unchanged" });
    expect(take(tasks)).toMatchObject({ by: "r1" });
    // r1's block failed and its request ended: the pass's copy takes it over.
    expect(await tasks.takeNotice!("t", NOTICE, { by: "r2", replacing: "r1" })).toEqual({ outcome: "recorded" });
    expect(take(tasks)).toMatchObject({ by: "r2" });
    // The same request taking it again (its replay) keeps it.
    expect(await tasks.takeNotice!("t", NOTICE, { by: "r2" })).toEqual({ outcome: "recorded" });
  });

  it("takes a marker stored before takes existed, and never one held for a request whose wait lapsed", async () => {
    const tasks = await makeBacking();
    await endedOwing(tasks);
    // Stored before FIX-2078: no due time, and no take.
    await tasks.patchMetadata("t", { [KEY]: { attempt: 1, ending: "completed" } });
    expect(await tasks.takeNotice!("t", NOTICE, { by: "r1" })).toEqual({ outcome: "recorded" });

    await tasks.patchMetadata("t", { [KEY]: { attempt: 1, ending: "completed", due: 1000, held: true } });
    expect(await tasks.takeNotice!("t", NOTICE, { by: "r2" })).toEqual({ outcome: "unchanged" });
  });

  it("files no notice record a filing's metadata names: a planted take can't keep a wait from dropping the notice", async () => {
    const tasks = await makeBacking();
    await tasks.createTask({
      id: "t",
      goal: "g",
      assignee: "ops",
      metadata: { note: "kept", "noticeTaken:1:completed": { by: "planted", at: 1 }, [KEY]: { attempt: 1, ending: "completed" } }
    });
    expect((tasks.get("t") as Task).metadata).toEqual({ note: "kept" });
  });
});
