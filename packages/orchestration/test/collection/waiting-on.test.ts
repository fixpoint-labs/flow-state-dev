/**
 * `waitingOn` (FIX-2077 D1): a running task that waits keeps its claim with no
 * lease.
 *
 * A lease means "a live worker holds this". A task waiting on a person, or
 * on work it filed, has no live worker, so the row records
 * what it waits on and drops its lease, and the reclaim (which takes only rows
 * whose lease ran out) leaves it alone: a waiting task is never run twice.
 * Admission clears the field and gives the row a lease again.
 */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  isClaimable,
  ticketForClaim,
  type TaskClaimTicket,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

interface Backing {
  collection: TaskCollectionRef;
  setNow: (n: number) => void;
}

async function sequencerBacking(): Promise<Backing> {
  let clock = 1000;
  return {
    collection: createStateBackedTaskCollection({
      collectionId: "tasks",
      state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
      now: () => clock,
    }),
    setNow: (n) => {
      clock = n;
    },
  };
}

async function resourceBacking(): Promise<Backing> {
  let clock = 1000;
  return {
    collection: await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: createFakeResourceCollection(),
      now: () => clock,
    }),
    setNow: (n) => {
      clock = n;
    },
  };
}

describe.each([
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking],
])("waitingOn (%s)", (_name, makeBacking) => {
  /** Claim `t` at t=1000 under a 10-second lease. */
  async function claimed(): Promise<Backing & { claim: TaskClaimTicket }> {
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t" });
    const task = (await backing.collection.claim("w", { leaseDurationMs: 10_000 }))!;
    return { ...backing, claim: ticketForClaim(backing.collection.collectionId, task) };
  }

  it("a waiting row drops its lease, so a reclaim past the old deadline leaves it running", async () => {
    const { collection, claim, setNow } = await claimed();

    expect(await collection.setWaitingOn!("t", "wait", { claim })).toEqual({ outcome: "recorded" });
    const held = collection.get("t")!;
    expect(held.waitingOn).toBe("wait");
    expect(held.leaseUntil).toBeUndefined();
    expect(held.status).toBe("in_progress");

    setNow(1000 + 60_000);
    expect(isClaimable(held, () => undefined, collection.now())).toBe(false);
    expect(await collection.claim("w2", { leaseDurationMs: 10_000 })).toBeNull();
    expect(await collection.reclaim()).toBe(0);
    expect(collection.get("t")).toMatchObject({ status: "in_progress", attempts: 1, waitingOn: "wait" });
  });

  it("admission clears it and starts a lease of the span the claim committed to", async () => {
    const { collection, claim, setNow } = await claimed();
    await collection.setWaitingOn!("t", "filed", { claim });

    setNow(50_000);
    expect(await collection.setWaitingOn!("t", null, { claim, leaseUntil: 60_000 })).toEqual({ outcome: "recorded" });
    const admitted = collection.get("t")!;
    expect(admitted.waitingOn).toBeUndefined();
    expect(admitted.leaseUntil).toBe(60_000);
    expect(admitted.leaseDurationMs).toBe(10_000);
  });

  it("keeps the request's answer as the output while it waits, unless a checkpoint was reported", async () => {
    const { collection, claim } = await claimed();
    await collection.setWaitingOn!("t", "filed", { claim, answer: { output: "the answer" } });
    expect(collection.get("t")?.output).toBe("the answer");

    const other = await claimed();
    await other.collection.reportProgress!("t", { output: "checkpoint" }, { claim: other.claim });
    await other.collection.setWaitingOn!("t", "filed", { claim: other.claim, answer: { output: "the answer" } });
    expect(other.collection.get("t")).toMatchObject({ output: "checkpoint", checkpointed: true });
  });

  it("refuses a request that does not hold the claim", async () => {
    const { collection, claim } = await claimed();
    const stale = { ...claim, attempt: claim.attempt + 1 };
    expect(await collection.setWaitingOn!("t", "wait", { claim: stale })).toMatchObject({
      outcome: "declined",
      reason: "lost-claim",
    });
    expect(collection.get("t")?.waitingOn).toBeUndefined();
  });

  it("an ending clears it: a finished row waits on nothing", async () => {
    const { collection, claim } = await claimed();
    await collection.setWaitingOn!("t", "filed", { claim });
    await collection.complete("t", "done", { claim });
    expect(collection.get("t")).toMatchObject({ status: "completed" });
    expect(collection.get("t")?.waitingOn).toBeUndefined();
  });
});
