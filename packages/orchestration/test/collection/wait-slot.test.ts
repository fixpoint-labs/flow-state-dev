/**
 * A row's wait slot (FIX-2082): taken when a wait starts, in one conditional
 * write; lapsed at its deadline, losing to an ending already written; and
 * released for the request it was lapsed for, which either read the ending it
 * held (delivered) or ended without reading it (owed to the filer's notice).
 * The same rules on both backings.
 */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  type Task,
  type TaskChangeEvent,
  type TaskCollectionRef,
} from "../../src/tasks";
import { recordEnding } from "../../src/tasks/notice/task-notice";
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

const slot = (gateId: string, requestId: string) => ({ gateId, deadline: 9_000, requestId });

describe.each(BACKINGS)("a row's wait slot (%s)", (_name, makeBacking) => {
  it("is taken by the first request, and refused to a second while the first waits", async () => {
    const { tasks, events } = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", assignee: "ops" });
    expect(await tasks.markWait!("t", slot("g1", "r1"))).toEqual({ outcome: "recorded" });
    expect((tasks.get("t") as Task).wait).toEqual({ gateId: "g1", deadline: 9_000, requestId: "r1" });
    expect(events.at(-1)).toMatchObject({ kind: "wait_changed" });

    expect(await tasks.markWait!("t", slot("g2", "r2"))).toEqual({ outcome: "declined", reason: "disallowed", status: "pending" });
    expect((tasks.get("t") as Task).wait?.gateId).toBe("g1");
    // The same gate again is a replay of the call that took it.
    expect(await tasks.markWait!("t", slot("g1", "r1"))).toEqual({ outcome: "unchanged" });
  });

  it("is refused terminal on a row that has ended: the waiting call reads its ending instead", async () => {
    const { tasks } = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", assignee: "ops" });
    await tasks.cancel("t", "done with it");
    expect(await tasks.markWait!("t", slot("g1", "r1"))).toEqual({ outcome: "declined", reason: "terminal", status: "cancelled" });
  });

  it("is taken over by the same request waiting again, and by any request once lapsed", async () => {
    const { tasks } = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", assignee: "ops" });
    await tasks.markWait!("t", slot("g1", "r1"));
    // A drain waiting again at its deadline: the same request, a new gate.
    expect(await tasks.markWait!("t", slot("g2", "r1"))).toEqual({ outcome: "recorded" });
    expect(await tasks.lapseWait!("t", "g2", "r1")).toEqual({ outcome: "recorded" });
    expect((tasks.get("t") as Task).wait).toMatchObject({ gateId: "g2", lapsed: true });
    expect(await tasks.markWait!("t", slot("g3", "r2"))).toEqual({ outcome: "recorded" });
    expect((tasks.get("t") as Task).wait).toEqual({ gateId: "g3", deadline: 9_000, requestId: "r2" });
  });

  it("keeps a drain's mark while lapsed, so a filer's wait can tell the plan still waits; a plain wait writes none", async () => {
    const { tasks } = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", assignee: "ops" });
    await tasks.markWait!("t", { ...slot("g1", "r1"), drain: true });
    expect(await tasks.lapseWait!("t", "g1", "r1")).toEqual({ outcome: "recorded" });
    expect((tasks.get("t") as Task).wait).toEqual({ gateId: "g1", deadline: 9_000, requestId: "r1", lapsed: true, drain: true });
    // The drain waiting again marks it again; a plain wait's slot carries no mark.
    await tasks.markWait!("t", { ...slot("g2", "r1"), drain: true });
    expect((tasks.get("t") as Task).wait).toEqual({ gateId: "g2", deadline: 9_000, requestId: "r1", drain: true });
    await tasks.addTask({ id: "u", goal: "g", assignee: "ops" });
    await tasks.markWait!("u", slot("g3", "r2"));
    expect((tasks.get("u") as Task).wait).toEqual({ gateId: "g3", deadline: 9_000, requestId: "r2" });
  });

  it("lapses only its own gate's slot, and loses to an ending already written", async () => {
    const { tasks } = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", assignee: "ops" });
    await tasks.markWait!("t", slot("g1", "r1"));
    expect(await tasks.lapseWait!("t", "other", "r1")).toEqual({ outcome: "unchanged" });
    const claimed = await tasks.claim("w", { leaseDurationMs: 10_000 });
    await tasks.complete(claimed!.id, "done");
    // The ending won: it owes the parked request its resume, and nothing lapses.
    expect(tasks.get("t")).toMatchObject({ status: "completed", resumeOwed: true });
    expect(await tasks.lapseWait!("t", "g1", "r1")).toEqual({ outcome: "declined", reason: "terminal", status: "completed" });
    expect((tasks.get("t") as Task).wait?.lapsed).toBeUndefined();
  });

  it("an ending onto a lapsed slot owes no resume: nobody is parked on it", async () => {
    const { tasks } = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", assignee: "ops" });
    await tasks.markWait!("t", slot("g1", "r1"));
    await tasks.lapseWait!("t", "g1", "r1");
    const claimed = await tasks.claim("w", { leaseDurationMs: 10_000 });
    await tasks.complete(claimed!.id, "done");
    expect((tasks.get("t") as Task).resumeOwed).toBeUndefined();
  });

  it("a release for the request that read the row clears the slot; one for another request changes nothing", async () => {
    const { tasks } = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", assignee: "ops" });
    await tasks.markWait!("t", slot("g1", "r1"));
    await tasks.lapseWait!("t", "g1", "r1");
    expect(await tasks.releaseWait!("t", { requestId: "r2", read: false })).toEqual({ outcome: "unchanged" });
    expect(await tasks.releaseWait!("t", { requestId: "r1", read: true })).toEqual({ outcome: "recorded" });
    expect((tasks.get("t") as Task).wait).toBeUndefined();
  });

  it("a live slot is never released: only a lapsed one is", async () => {
    const { tasks } = await makeBacking();
    await tasks.addTask({ id: "t", goal: "g", assignee: "ops" });
    await tasks.markWait!("t", slot("g1", "r1"));
    expect(await tasks.releaseWait!("t", { requestId: "r1", read: false })).toEqual({ outcome: "unchanged" });
    expect((tasks.get("t") as Task).wait?.gateId).toBe("g1");
  });
});

describe("an ending held for the request whose wait lapsed", () => {
  const ended = (wait?: Task["wait"]): Task =>
    ({
      id: "t",
      goal: "g",
      status: "completed",
      attempts: 1,
      createdAt: 1,
      updatedAt: 1000,
      ...(wait !== undefined ? { wait } : {}),
    }) as Task;

  it("is held, not sent, while its slot is lapsed; a live slot owes the resume instead, and no slot a plain notice", () => {
    const completion = { kind: "completed", output: "done" } as const;
    const held = recordEnding(ended({ gateId: "g1", deadline: 1, requestId: "r1", lapsed: true }), completion);
    expect(held.metadata).toEqual({ "noticeOwed:1:completed": { attempt: 1, ending: "completed", due: 3000, held: true } });
    expect(recordEnding(ended({ gateId: "g1", deadline: 1, requestId: "r1" }), completion).metadata).toBeUndefined();
    expect(recordEnding(ended(), completion).metadata).toEqual({
      "noticeOwed:1:completed": { attempt: 1, ending: "completed", due: 3000 },
    });
  });

  it.each(BACKINGS)("is dropped by a read, or released to the filer due then, on its release (%s)", async (_name, makeBacking) => {
    for (const read of [true, false]) {
      const { tasks } = await makeBacking();
      await tasks.addTask({ id: "t", goal: "g", assignee: "ops" });
      await tasks.markWait!("t", slot("g1", "r1"));
      await tasks.lapseWait!("t", "g1", "r1");
      // The ending lands on the lapsed slot, held; written here as the ledger's recorder would.
      const claimed = await tasks.claim("w", { leaseDurationMs: 10_000 });
      await tasks.complete(claimed!.id, "done");
      await tasks.patchMetadata("t", { "noticeOwed:1:completed": { attempt: 1, ending: "completed", due: 1000, held: true } });

      await tasks.releaseWait!("t", { requestId: "r1", read });
      const marker = (tasks.get("t") as Task).metadata?.["noticeOwed:1:completed"];
      if (read) expect(marker).toBeNull();
      else expect(marker).toEqual({ attempt: 1, ending: "completed", due: 3000 });
    }
  });
});
