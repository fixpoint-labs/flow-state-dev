/**
 * A person's message reopens a finished task (FIX-1764).
 *
 * `reopen` owns the one edge out of a finished status: `completed`, `errored`
 * or `cancelled` back to `pending`. The status table still has no such edge,
 * so no other write reopens a row: a stale worker's late failure on a
 * completed row must still be refused, or a run that already ended could be
 * re-queued by accident. The reopened attempt is marked, so its worker knows
 * it is picking the task up again, and is not charged against `maxAttempts`:
 * a person talking to a task never spends its retries.
 */
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  defineTaskCollection,
  getOrCreateTaskCollection,
  IllegalTaskTransitionError,
  ticketForClaim,
  type Task,
  type TaskChangeEvent,
  type TaskCollectionRef,
  type TaskEnding,
} from "../../src/tasks";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

type Backing = { tasks: TaskCollectionRef; events: TaskChangeEvent[] };

async function sequencerBacking(): Promise<Backing> {
  const events: TaskChangeEvent[] = [];
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  const tasks = await createStateBackedTaskCollection({
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

/** Add `t`, claim it and settle it with `settle`. */
async function finished(
  tasks: TaskCollectionRef,
  settle: (tasks: TaskCollectionRef, claimed: Task) => Promise<unknown>,
  maxAttempts = 1
): Promise<Task> {
  await tasks.addTask({ id: "t", goal: "t", maxAttempts });
  const claimed = (await tasks.claim("w"))!;
  await settle(tasks, claimed);
  return tasks.get("t") as Task;
}

const complete = (tasks: TaskCollectionRef, claimed: Task) =>
  tasks.complete("t", { done: 1 }, { claim: ticketForClaim("tasks", claimed) });
const fail = (tasks: TaskCollectionRef, claimed: Task) =>
  tasks.fail("t", "boom", { claim: ticketForClaim("tasks", claimed) });
const cancel = (tasks: TaskCollectionRef) => tasks.cancel("t", "not needed");

describe.each(BACKINGS)("reopen (%s)", (_name, makeBacking) => {
  it.each([
    ["completed", complete],
    ["errored", fail],
    ["cancelled", cancel],
  ] as const)("puts a %s task back in the queue, marked reopened", async (status, settle) => {
    const { tasks, events } = await makeBacking();
    expect((await finished(tasks, settle)).status).toBe(status);

    const reopened = await tasks.reopen("t");
    expect(reopened.outcome).toBe("recorded");
    const row = tasks.get("t") as Task;
    expect(row).toMatchObject({ status: "pending", reopened: true, turnReentries: 1, attempts: 1 });
    // The ending's error and time go; a person picked the task up again.
    expect(row.error).toBeUndefined();
    expect(row.completedAt).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ kind: "reopened", prevStatus: status });
  });

  it("keeps the result until the reopened attempt writes its own", async () => {
    const { tasks } = await makeBacking();
    await finished(tasks, complete);
    await tasks.reopen("t");
    expect((tasks.get("t") as Task).output).toEqual({ done: 1 });
  });

  it("hands the next claim the mark, and does not charge that claim", async () => {
    const { tasks } = await makeBacking();
    await finished(tasks, complete);
    await tasks.reopen("t");
    const next = (await tasks.claim("w"))!;
    expect(next).toMatchObject({ status: "in_progress", attempts: 2, reopened: true });
    // One claim charged, as before the reopen.
    expect(next.attempts - (next.turnReentries ?? 0)).toBe(1);
    await tasks.complete("t", { done: 2 }, { claim: ticketForClaim("tasks", next) });
    expect(tasks.get("t")).toMatchObject({ status: "completed", output: { done: 2 } });
  });

  it("refuses a task that is not finished, as a value, and writes nothing", async () => {
    const { tasks, events } = await makeBacking();
    await tasks.addTask({ id: "t", goal: "t" });
    expect(await tasks.reopen("t")).toEqual({ outcome: "declined", reason: "disallowed", status: "pending" });
    const claimed = (await tasks.claim("w"))!;
    expect(await tasks.reopen("t")).toMatchObject({ outcome: "declined", status: "in_progress" });
    await tasks.awaitReview("t", "which?", { claim: ticketForClaim("tasks", claimed) });
    expect(await tasks.reopen("t")).toMatchObject({ outcome: "declined", status: "parked" });
    expect(events.some((event) => event.kind === "reopened")).toBe(false);
  });

  it("is the only write that leaves a finished row: a late failure is still refused", async () => {
    const { tasks } = await makeBacking();
    await tasks.addTask({ id: "t", goal: "t", maxAttempts: 3 });
    await tasks.claim("w");
    await tasks.complete("t", { done: 1 });
    // With attempts left a failure targets `pending`, the edge reopen owns.
    await expect(tasks.fail("t", "late")).rejects.toBeInstanceOf(IllegalTaskTransitionError);
    expect(await tasks.unpark("t", "x")).toMatchObject({ outcome: "declined", reason: "terminal" });
    expect((tasks.get("t") as Task).status).toBe("completed");
  });

  it("a later failure clears the mark, so a retry is not told it was reopened", async () => {
    const { tasks } = await makeBacking();
    await finished(tasks, complete, 3);
    await tasks.reopen("t");
    const next = (await tasks.claim("w"))!;
    await tasks.fail("t", "tests failed", { claim: ticketForClaim("tasks", next) });
    const retried = tasks.get("t") as Task;
    expect(retried).toMatchObject({ status: "pending", feedback: "tests failed" });
    expect(retried.reopened).toBeUndefined();
  });
});

describe("reopen and the ledger's ending recorder", () => {
  it("records no ending for the reopen, and a new one for the reopened attempt", async () => {
    const seen: TaskEnding[] = [];
    const declared = defineTaskCollection({
      id: "reopen-ledger",
      scope: "user",
      recordEnding: (row, ending) => {
        seen.push(ending);
        return row;
      },
    });
    const store = Object.assign(createFakeResourceCollection<JsonObject>("reopen-ledger/**"), {
      config: declared,
    }) as ResourceCollectionRef<JsonObject>;
    const ctx = {
      emit: { component: () => undefined },
      session: { identity: { type: "session", id: "s_1", userId: "alice" } },
      request: { identity: { type: "request", id: "r_1" } },
    } as unknown as BlockContext;
    const ref = await getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: "reopen-ledger", collection: store });

    await ref.addTask({ id: "t", goal: "g" });
    await ref.claim("w");
    await ref.complete("t", "first");
    expect(seen.map((ending) => ending.kind)).toEqual(["completed"]);

    await ref.reopen("t");
    expect(seen).toHaveLength(1);

    await ref.claim("w");
    await ref.complete("t", "second");
    expect(seen.map((ending) => ending.kind)).toEqual(["completed", "completed"]);
  });
});
