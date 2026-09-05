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
  committedLeaseSpan,
  createResourceBackedTaskCollection,
  createSequencerBackedTaskCollection,
  ticketForClaim,
  type Task,
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

  it("lets a claimant that has not started yet take a lapsed row BACK, on the same attempt", async () => {
    // FIX-1305. The arm above is right about a worker reporting a result and
    // too strong for one that has not begun — a task handed to a child session
    // has nobody renewing its lease until the child's gate runs, so an ordinary
    // queue delay presents exactly this row: lapsed, and untouched by anyone.
    //
    // The takeover keeps the attempt. That is the half worth pinning: a
    // re-claim would recover the row too, and would spend an attempt and a
    // second dispatch to do it.
    const { collection, setNow, claim } = await claimed();
    setNow(1000 + 10_000);

    const outcome = await collection.renewLease("t", 1000 + 20_000, {
      claim,
      adoptLapsedLease: true,
    });

    expect(outcome).toEqual({ outcome: "recorded" });
    expect(collection.get("t")?.leaseUntil).toBe(1000 + 20_000);
    expect(collection.get("t")?.attempts).toBe(1);
    expect(collection.get("t")?.status).toBe("in_progress");
    // And the row is genuinely held again, not merely stamped: the settlement
    // the taker owes is now accepted, which is the whole point of taking it.
    expect(await collection.complete("t", "done", { ifAllowed: true, claim })).toEqual({
      outcome: "recorded",
    });
  });

  it("still takes back a row a coordinator patched while it was running", async () => {
    // The lease a claim committed to has to survive every other write to the
    // row, and `leaseUntil - updatedAt` does not: `setPriority`, the label
    // verbs and `patchMetadata` are all supported on an `in_progress` task and
    // all move `updatedAt` while leaving the deadline alone. A patch after the
    // deadline drives that subtraction negative, so a takeover reading it would
    // refuse a claim nothing had touched — the failure this whole change exists
    // to remove, reintroduced through the patch surface. Hence the duration is
    // stored at claim time and read back through `committedLeaseSpan`.
    const { collection, setNow, claim } = await claimed();
    setNow(1000 + 12_000);
    // A coordinator re-prioritizing a running task, past its deadline.
    expect(await collection.setPriority("t", 3)).toEqual({ outcome: "recorded" });
    const patched = collection.get("t") as Task;
    expect(patched.updatedAt).toBeGreaterThan(patched.leaseUntil!);

    // The claim's own duration, not what the two stamps now subtract to.
    expect(committedLeaseSpan(patched)).toBe(10_000);

    expect(
      await collection.renewLease("t", collection.now() + 10_000, {
        claim,
        adoptLapsedLease: true,
      })
    ).toEqual({ outcome: "recorded" });
    expect(collection.get("t")?.leaseUntil).toBe(1000 + 22_000);
  });

  it("reads a row claimed before the duration was stored from its two stamps", async () => {
    // BP-030. A task persisted before the field existed carries no
    // `leaseDurationMs`, and the subtraction is exactly what it committed as
    // long as nothing has written to the row since — so the fallback is the
    // old answer, not a refusal.
    const { collection } = await claimed();
    const legacy = { ...(collection.get("t") as Task), leaseDurationMs: undefined };

    expect(committedLeaseSpan(legacy)).toBe(10_000);
    expect(committedLeaseSpan({ ...legacy, leaseUntil: undefined })).toBeUndefined();
  });

  it("refuses the takeover when a reclaim actually won the row", async () => {
    // The other side of the same write, and the one that makes the option safe
    // to hand out: the race is decided by the substrate, not by the caller's
    // read. Here the row lapsed and a second worker took it, so the first
    // claimant's takeover has to lose — with nothing installed on the row the
    // successor now holds.
    const { collection, setNow, claim } = await claimed();
    setNow(1000 + 10_000);
    const successor = await collection.claim("w2", { leaseDurationMs: 10_000 });
    expect(successor?.attempts).toBe(2);
    const successorLease = collection.get("t")!.leaseUntil;

    const outcome = await collection.renewLease("t", 1000 + 60_000, {
      claim,
      adoptLapsedLease: true,
    });

    expect(outcome).toEqual({
      outcome: "declined",
      reason: "lost-claim",
      status: "in_progress",
    });
    expect(collection.get("t")?.leaseUntil).toBe(successorLease);
  });

  it("still refuses a SETTLEMENT that carries the takeover flag", async () => {
    // The flag is scoped to the renewal — the one write that targets
    // `in_progress` — so a worker that ran past its lease cannot reach for it
    // to force its result in. Without the scope this option would quietly undo
    // the arm at the top of this file.
    const { collection, setNow, claim } = await claimed();
    setNow(1000 + 10_000);

    expect(
      await collection.complete("t", "done", {
        ifAllowed: true,
        claim,
        adoptLapsedLease: true,
      })
    ).toEqual({ outcome: "declined", reason: "lost-claim", status: "in_progress" });
    expect(collection.get("t")?.status).toBe("in_progress");
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
