/**
 * A failure no retry can change settles the task for good.
 *
 * `fail` re-pends a task that still has attempts left, which is right for a
 * run that might go better next time and wrong for one refused before it
 * started (the run names no workspace it may use, say): the next attempt is
 * refused the same way, and the person who filed it hears nothing until the
 * budget is spent. `noRetry` makes that one failure terminal, through the
 * same guarded write, and changes nothing else.
 */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  ticketForClaim,
  type Task,
  type TaskCollectionRef,
} from "../../src/tasks";
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

describe.each(BACKINGS)("fail with noRetry (%s)", (_name, makeBacking) => {
  it("ends a task with attempts left errored, on its first failure", async () => {
    const tasks = await makeBacking();
    await tasks.createTask({ id: "t", goal: "t", maxAttempts: 3 });
    const claimed = (await tasks.claim("w", { leaseDurationMs: 10_000 }))!;

    const outcome = await tasks.fail("t", "refused: no project", {
      claim: ticketForClaim("tasks", claimed),
      noRetry: true,
    });

    expect(outcome.outcome).toBe("recorded");
    expect(tasks.get("t") as Task).toMatchObject({ status: "errored", error: "refused: no project", attempts: 1 });
  });

  it("is still refused for an attempt that no longer holds the task", async () => {
    const tasks = await makeBacking();
    await tasks.createTask({ id: "t", goal: "t", maxAttempts: 3 });
    const first = (await tasks.claim("w", { leaseDurationMs: 10_000 }))!;
    await tasks.fail("t", "first try failed", { claim: ticketForClaim("tasks", first) });
    await tasks.claim("w", { leaseDurationMs: 10_000 });

    const stale = await tasks.fail("t", "refused", { claim: ticketForClaim("tasks", first), noRetry: true });

    expect(stale.outcome).toBe("declined");
    expect((tasks.get("t") as Task).status).toBe("in_progress");
  });

  it("without it, the same failure still re-pends", async () => {
    const tasks = await makeBacking();
    await tasks.createTask({ id: "t", goal: "t", maxAttempts: 3 });
    const claimed = (await tasks.claim("w", { leaseDurationMs: 10_000 }))!;
    await tasks.fail("t", "try again", { claim: ticketForClaim("tasks", claimed) });
    expect((tasks.get("t") as Task).status).toBe("pending");
  });
});
