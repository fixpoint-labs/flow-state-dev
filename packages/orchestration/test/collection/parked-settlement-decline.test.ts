/**
 * A worker's own write-back must not land on a row parked for review
 * (FIX-1234).
 *
 * ## Why this is tested at the write and not at the recorder
 *
 * The board's recorders read the row's status before settling it, and that read
 * cannot carry the guarantee. It is a check racing the thing it checks: a
 * concurrent park landing *after* the read and *before* the write arrives in a
 * status the attempt still owns (`awaiting_review` is in
 * `ATTEMPT_OWNED_STATUSES`) and one that `awaiting_review → completed` and
 * `→ errored` can legally leave. Every existing worker-self-park test passes
 * with the read alone, because none of them interleaves anything.
 *
 * So the refusal moved inside the atomic transition, behind the opt-in
 * `refuseWhenParked`, and that is what these assert. Each one calls the settling
 * verb with the row already `awaiting_review` — exactly the state a concurrent
 * park produces at the moment the write evaluates — rather than staging a fake
 * interleaving around a read that no longer decides anything. The property under
 * test is "the write refuses", whatever the caller believed beforehand.
 *
 * The second describe is the other half of the contract. Settling a parked task
 * is legitimate in general — a holder recording a review's rejection as a
 * failure, a coordinator ending one with `complete` or `cancel` — so the
 * substrate keeps permitting it and only a caller that asks gets the refusal.
 */
import { describe, expect, it } from "vitest";
import {
  createSequencerBackedTaskCollection,
  ticketForClaim,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createFakeSequencerState } from "../helpers";

let seq = 0;
function collection(): TaskCollectionRef {
  seq += 1;
  return createSequencerBackedTaskCollection({
    collectionId: `parked-decline-${seq}`,
    sequencer: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
  });
}

/** Claim a task and park it, returning the ticket the claim minted. */
async function claimThenPark(
  tasks: TaskCollectionRef,
  id: string,
  init: { maxAttempts?: number } = {}
) {
  await tasks.addTask({ id, goal: id, ...init });
  const claimed = await tasks.claim("w1", { eligibility: (t) => t.id === id });
  expect(claimed).not.toBeNull();
  const ticket = ticketForClaim(tasks.collectionId, claimed!);
  await tasks.awaitReview(id, "needs a human");
  expect(tasks.get(id)?.status).toBe("awaiting_review");
  return ticket;
}

describe("a parked row declines the attempt's settlement", () => {
  it("refuses `complete`, leaving the park intact", async () => {
    const tasks = collection();
    const claim = await claimThenPark(tasks, "ask");

    const outcome = await tasks.complete("ask", { done: true }, { ifAllowed: true, claim, refuseWhenParked: true });

    expect(outcome.outcome).toBe("declined");
    expect(outcome.outcome === "declined" && outcome.reason).toBe("parked");
    // The human still has something to look at, and no result was recorded.
    expect(tasks.get("ask")?.status).toBe("awaiting_review");
    expect(tasks.get("ask")?.output).toBeUndefined();
  });

  it("refuses `fail`, so a throw after parking cannot error the row", async () => {
    const tasks = collection();
    const claim = await claimThenPark(tasks, "ask");

    const outcome = await tasks.fail("ask", "fell over after parking", {
      ifAllowed: true,
      claim,
      refuseWhenParked: true,
    });

    expect(outcome.outcome).toBe("declined");
    expect(outcome.outcome === "declined" && outcome.reason).toBe("parked");
    expect(tasks.get("ask")?.status).toBe("awaiting_review");
  });

  it("refuses a RETRYING `fail`, which would otherwise hand the row to a sibling", async () => {
    // The sharpest case. A failure with retries left targets `pending`, not
    // `errored`, so a guard keyed on the target status would let it through —
    // and re-queueing a parked row puts it in front of another worker while a
    // person is still being asked. The refusal is keyed on the change kind for
    // exactly this reason.
    const tasks = collection();
    const claim = await claimThenPark(tasks, "ask", { maxAttempts: 5 });

    const outcome = await tasks.fail("ask", "transient", { ifAllowed: true, claim, refuseWhenParked: true });

    expect(outcome.outcome).toBe("declined");
    expect(outcome.outcome === "declined" && outcome.reason).toBe("parked");
    expect(tasks.get("ask")?.status).toBe("awaiting_review");
  });

  it("says `parked` rather than `lost-claim`, because nobody took the row", async () => {
    // The two facts call for opposite recoveries: `lost-claim` means re-claim and
    // redo the work, `parked` means do neither — the work is done and a person is
    // deciding. Reporting the first for the second sends a caller into a redo.
    const tasks = collection();
    const claim = await claimThenPark(tasks, "ask");

    const outcome = await tasks.complete("ask", null, { ifAllowed: true, claim, refuseWhenParked: true });

    expect(outcome.outcome === "declined" && outcome.reason).not.toBe("lost-claim");
    expect(outcome.outcome === "declined" && outcome.reason).toBe("parked");
  });
});

describe("what the refusal deliberately does not touch", () => {
  it("lets the review end by resume, on the same claim", async () => {
    // `resumeFromReview` also targets `pending` and may carry the worker's own
    // ticket. It must keep working, which is why the refusal is scoped to
    // settlement kinds rather than to the target status.
    const tasks = collection();
    const claim = await claimThenPark(tasks, "ask");

    const outcome = await tasks.resumeFromReview("ask", "approved", { claim });

    expect(outcome.outcome).not.toBe("declined");
    expect(tasks.get("ask")?.status).toBe("pending");
    expect(tasks.get("ask")?.feedback).toBe("approved");
  });

  it("lets a coordinator cancel a parked task", async () => {
    const tasks = collection();
    await claimThenPark(tasks, "ask");

    const outcome = await tasks.cancel("ask", "no longer needed");

    expect(outcome.outcome).not.toBe("declined");
    expect(tasks.get("ask")?.status).toBe("cancelled");
  });

  it("lets a caller that did not ask complete a parked task", async () => {
    // A review can legitimately end in completion, decided by something other
    // than the worker that parked it. The refusal is opt-in, so that route is
    // untouched — as is the documented one where a holder records a rejection as
    // a failure, which `advisory-write.test.ts` pins.
    const tasks = collection();
    await claimThenPark(tasks, "ask");

    const outcome = await tasks.complete("ask", { approved: true });

    expect(outcome.outcome).not.toBe("declined");
    expect(tasks.get("ask")?.status).toBe("completed");
  });

  it("still settles an in-progress row on the same claim", async () => {
    // The off state: nothing about an ordinary settlement changed.
    const tasks = collection();
    await tasks.addTask({ id: "work", goal: "work" });
    const claimed = await tasks.claim("w1", { eligibility: (t) => t.id === "work" });
    const claim = ticketForClaim(tasks.collectionId, claimed!);

    const outcome = await tasks.complete("work", { done: true }, { ifAllowed: true, claim, refuseWhenParked: true });

    expect(outcome.outcome).not.toBe("declined");
    expect(tasks.get("work")?.status).toBe("completed");
  });
});
