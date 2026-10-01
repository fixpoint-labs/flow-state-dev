/**
 * A person's turn is not a retry (FIX-1690, BR-9).
 *
 * A worker stopped so a person's message can reach it parks the row *for a
 * turn*. The existing `unpark` re-queues it and the next claim re-enters,
 * which advances `attempts` like every claim does. That re-entry is
 * discounted from the task's own retry budget, the way an abandonment is, so
 * talking to a run never makes it fail sooner. Failures after it, and
 * recoveries, charge exactly as before.
 */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createSequencerBackedTaskCollection,
  ticketForClaim,
  type Task,
  type TaskCollectionRef,
} from "../../src/tasks";
import {
  createCapturedChanges,
  createFakeResourceCollection,
  createFakeSequencerState,
} from "../helpers";
import { shouldRetryOnFail } from "../../src/tasks/collection/internal";

interface Backing {
  collection: TaskCollectionRef;
  setNow: (n: number) => void;
  now: () => number;
}

async function sequencerBacking(): Promise<Backing> {
  let clock = 1000;
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  return {
    collection: createSequencerBackedTaskCollection({
      collectionId: "tasks",
      sequencer,
      onChange: createCapturedChanges().onChange,
      now: () => clock,
    }),
    setNow: (n) => {
      clock = n;
    },
    now: () => clock,
  };
}

async function resourceBacking(): Promise<Backing> {
  let clock = 1000;
  return {
    collection: await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: createFakeResourceCollection(),
      onChange: createCapturedChanges().onChange,
      now: () => clock,
    }),
    setNow: (n) => {
      clock = n;
    },
    now: () => clock,
  };
}

const BACKINGS = [
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking],
] as const;

const LEASE = 10_000;

/** Claim `t` and park it for a person's turn, fenced by the claim. */
async function claimThenParkForTurn(backing: Backing): Promise<Task> {
  const claimed = (await backing.collection.claim("w", { leaseDurationMs: LEASE }))!;
  const parked = await backing.collection.awaitReview("t", "a person sent a message", {
    claim: ticketForClaim("tasks", claimed),
    forTurn: true,
  });
  expect(parked.outcome).toBe("recorded");
  return backing.collection.get("t") as Task;
}

/** The task's retry standing: attempts it spent out of its own budget. */
function standing(task: Task): number {
  return task.attempts - (task.abandonments ?? 0) - (task.turnReentries ?? 0);
}

describe.each(BACKINGS)("a person's turn is not a retry (%s)", (_name, makeBacking) => {
  it("re-enters a row parked for a turn without spending its retry standing", async () => {
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t", maxAttempts: 2 });

    const parked = await claimThenParkForTurn(backing);
    expect(parked.status).toBe("parked");
    expect(parked.parkedForTurn).toBe(true);
    const before = standing(parked);

    await backing.collection.unpark("t");
    const reclaimed = (await backing.collection.claim("w", { leaseDurationMs: LEASE }))!;

    expect(reclaimed.attempts).toBe(2);
    expect(reclaimed.parkedForTurn).toBeUndefined();
    expect(standing(reclaimed)).toBe(before);
    // No retry was granted against the board's cumulative budget either.
    expect(reclaimed.retryLedger).toBeUndefined();
  });

  it("still retries a failure on the row at maxAttempts - 1 after a turn", async () => {
    // maxAttempts 2: attempt 1 is stopped for a turn, attempt 2 fails. Without
    // the discount the claim count (2) has reached the budget and the failure
    // is terminal; with it, one real attempt was spent and a retry remains.
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t", maxAttempts: 2 });
    await claimThenParkForTurn(backing);
    await backing.collection.unpark("t");
    const second = (await backing.collection.claim("w", { leaseDurationMs: LEASE }))!;
    expect(shouldRetryOnFail(second)).toBe(true);

    await backing.collection.fail("t", "tests failed", { claim: ticketForClaim("tasks", second) });
    const afterFail = backing.collection.get("t") as Task;
    expect(afterFail.status).toBe("pending");
    // The failure after the turn charged one.
    expect(standing(afterFail)).toBe(standing(second));
    const third = (await backing.collection.claim("w", { leaseDurationMs: LEASE }))!;
    expect(standing(third)).toBe(2);
    expect(shouldRetryOnFail(third)).toBe(false);
  });

  it("does not discount a park that was not for a turn", async () => {
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t", maxAttempts: 2 });
    const claimed = (await backing.collection.claim("w", { leaseDurationMs: LEASE }))!;
    await backing.collection.awaitReview("t", "a question", { claim: ticketForClaim("tasks", claimed) });
    expect((backing.collection.get("t") as Task).parkedForTurn).toBeUndefined();
    await backing.collection.unpark("t");
    const second = (await backing.collection.claim("w", { leaseDurationMs: LEASE }))!;
    expect(second.turnReentries).toBeUndefined();
    expect(standing(second)).toBe(2);
  });

  it("parks for a turn only a running row: one that settled or re-pended first declines", async () => {
    // The door stops an attempt and then parks its row. If the attempt
    // settled or re-pended in that moment, the park must not move the row
    // behind it: the door answers from the status the decline names.
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t", maxAttempts: 3 });
    const claimed = (await backing.collection.claim("w", { leaseDurationMs: LEASE }))!;
    await backing.collection.fail("t", "tests failed", { claim: ticketForClaim("tasks", claimed) });
    expect((backing.collection.get("t") as Task).status).toBe("pending");

    const repended = await backing.collection.awaitReview("t", "a person sent a message", { forTurn: true });
    expect(repended).toMatchObject({ outcome: "declined", status: "pending" });
    expect((backing.collection.get("t") as Task).status).toBe("pending");

    const second = (await backing.collection.claim("w", { leaseDurationMs: LEASE }))!;
    await backing.collection.complete("t", { done: true }, { claim: ticketForClaim("tasks", second) });
    const settled = await backing.collection.awaitReview("t", "a person sent a message", { forTurn: true });
    expect(settled).toMatchObject({ outcome: "declined", status: "completed" });
    expect((backing.collection.get("t") as Task).parkedForTurn).toBeUndefined();
  });

  it("still counts a recovery as an abandonment after a turn", async () => {
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t", maxAttempts: 3 });
    await claimThenParkForTurn(backing);
    await backing.collection.unpark("t");
    await backing.collection.claim("w", { leaseDurationMs: LEASE });
    backing.setNow(backing.now() + LEASE + 1);
    const recovered = (await backing.collection.claim("w2", { leaseDurationMs: LEASE }))!;
    expect(recovered.attempts).toBe(3);
    expect(recovered.abandonments).toBe(1);
    expect(recovered.turnReentries).toBe(1);
    expect(standing(recovered)).toBe(1);
  });
});
