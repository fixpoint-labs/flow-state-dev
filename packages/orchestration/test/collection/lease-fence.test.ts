/**
 * The lease fence — the holder's half of the one subtraction (FIX-1005).
 *
 * A worker renews the lease on the row it holds; a ticket-fenced write on an
 * `in_progress` row whose lease has already gone is refused. `isClaimable`'s
 * recovery arm and this decline arm are two readings of the same committed
 * fact, evaluated inside the same atomic write, so a row is either still the
 * claimant's or already the queue's and the two sides cannot drift.
 *
 * **These are state tests, not timing tests, and that is the point.** Every
 * behaviour below is asserted by putting a row in a committed state and issuing
 * a write — no clock racing, no stalled promise, no "eventually". The three
 * client-side mechanisms this arm replaced (an independent abort clock, a
 * deadline computed before the request went out, a marker re-asserted on a
 * timer) could each only be tested by orchestrating a timing window, which is
 * why their tests kept passing against broken shapes.
 *
 * Parameterized over both backings, which carry separately maintained copies of
 * the transition wrapper — a fix applied to one and not the other is the
 * failure mode this suite exists to catch.
 */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createSequencerBackedTaskCollection,
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
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({
    tasks: {},
  });
  return {
    collection: createSequencerBackedTaskCollection({
      collectionId: "tasks",
      sequencer,
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
])("the lease fence (%s)", (_name, makeBacking) => {
  /** Claim `t` at t=1000 under a 10-second lease, and mint its ticket. */
  async function claimed(): Promise<Backing & { claim: TaskClaimTicket }> {
    const backing = await makeBacking();
    backing.setNow(1000);
    await backing.collection.addTask({ id: "t", goal: "t" });
    const task = await backing.collection.claim("w", { leaseDurationMs: 10_000 });
    return {
      ...backing,
      claim: ticketForClaim(backing.collection.collectionId, task!),
    };
  }

  it("refuses a settle from a worker that ran past its lease", async () => {
    const { collection, setNow, claim } = await claimed();
    setNow(1000 + 10_000); // exactly the deadline — the comparison is `<=`

    const outcome = await collection.complete("t", "done", { ifAllowed: true, claim });

    expect(outcome).toEqual({
      outcome: "declined",
      reason: "lost-claim",
      status: "in_progress",
    });
    // The promise enforced rather than approximated: the row carries no result
    // the queue is about to re-derive.
    expect(collection.get("t")?.output).toBeUndefined();
    expect(collection.get("t")?.status).toBe("in_progress");
  });

  it("lets a settle INSIDE the lease succeed — the fence's own second path", async () => {
    // BP-035. Without this the arm could be far too broad and every other
    // assertion in this file would still pass.
    const { collection, setNow, claim } = await claimed();
    setNow(1000 + 9_999);

    expect(await collection.complete("t", "done", { ifAllowed: true, claim })).toEqual({
      outcome: "recorded",
    });
    expect(collection.get("t")?.status).toBe("completed");
  });

  it("refuses a renewal that COMMITS after the lease it held, and installs nothing", async () => {
    // The case that motivated the arm. Asserting only the decline would pass
    // against a write that declines and installs the new deadline anyway —
    // which is exactly what computing the deadline early used to do.
    const { collection, setNow, claim } = await claimed();
    const before = collection.get("t")!.leaseUntil;
    setNow(1000 + 12_000);

    const outcome = await collection.renewLease("t", 1000 + 40_000, { claim });

    expect(outcome).toEqual({
      outcome: "declined",
      reason: "lost-claim",
      status: "in_progress",
    });
    expect(collection.get("t")?.leaseUntil).toBe(before);
  });

  it("refuses a rescue fail() after a lost lease, and the row is then RECOVERED", async () => {
    // Two assertions, and the second is the one that matters. Before the arm,
    // an abort at lease expiry flowed into all three rescue paths, which call
    // `fail()` — so our own liveness mechanism terminalized a default task
    // `errored` instead of leaving it recoverable. A suite that stops at the
    // decline passes against a shape that leaves the row unclaimable forever.
    const { collection, setNow, claim } = await claimed();
    setNow(1000 + 11_000);

    expect(await collection.fail("t", "worker died", { ifAllowed: true, claim })).toEqual({
      outcome: "declined",
      reason: "lost-claim",
      status: "in_progress",
    });
    expect(collection.get("t")?.status).not.toBe("errored");

    const recovered = await collection.claim("w2");
    expect(recovered?.id).toBe("t");
    expect(recovered?.attempts).toBe(2);
  });

  it("leaves a write presenting NO ticket completely alone", async () => {
    // The arm is scoped to a presented ticket, so `reclaim()` and every other
    // unfenced write behave exactly as they did.
    const { collection, setNow } = await claimed();
    setNow(1000 + 50_000);

    expect(await collection.reclaim()).toBe(1);
    expect(collection.get("t")?.status).toBe("pending");
  });

  it("still lets resumeFromReview through after a review longer than the lease", async () => {
    // This is what pins the arm to `in_progress`. `awaitReview` deliberately
    // does not clear `leaseUntil`, so an unscoped arm would decline
    // `resumeFromReview` on any task a human took more than a lease to look at.
    // A review park is an explicit park; the lease governs `in_progress` only.
    const { collection, setNow, claim } = await claimed();
    await collection.awaitReview("t", "please look", { ifAllowed: true, claim });
    setNow(1000 + 10_000_000);

    expect(
      await collection.resumeFromReview("t", "looks good", { ifAllowed: true, claim })
    ).toEqual({ outcome: "recorded" });
    expect(collection.get("t")?.status).toBe("pending");
  });
});
