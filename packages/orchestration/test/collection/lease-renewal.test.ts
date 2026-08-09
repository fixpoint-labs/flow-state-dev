/**
 * The renewal verb and the driver that drives it (FIX-1005).
 *
 * Renewal is what makes an expired lease mean something. Before it, nothing
 * ever extended a lease, so an expired one was the *normal* condition of a
 * perfectly healthy worker and acting on it would have reset live work. With
 * it, silence means the holder is gone.
 *
 * The driver's rules are all here because they are all load-bearing and each
 * one exists because a specific arithmetic mistake broke a healthy worker:
 *
 * - the **span** is the one the claim committed, not the one that is left
 * - the **phase** of the first tick is the lease that is left, not the span
 * - below a floor there is **no timer at all** — the renewal runs inline
 * - a tick whose predecessor is in flight is **skipped**, never stacked
 * - a **decline** is the only stop condition; a throw is the unknown case
 */
import { describe, expect, it, vi } from "vitest";
import {
  createSequencerBackedTaskCollection,
  startLeaseRenewal,
  ticketForClaim,
  withLeaseRenewal,
  MIN_RENEWAL_DELAY_MS,
  RENEWAL_DIVISOR,
  type RenewalTimer,
  type Task,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createFakeSequencerState } from "../helpers";

interface Harness {
  collection: TaskCollectionRef;
  setNow: (n: number) => void;
  now: () => number;
}

function harness(): Harness {
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
    now: () => clock,
  };
}

/** A controllable timer: nothing fires until `fireNext()` is called. */
function fakeTimer(): {
  timer: RenewalTimer;
  scheduled: number[];
  fireNext: () => Promise<void>;
  pending: () => number;
} {
  const queue: { delay: number; fn: () => void; cancelled: boolean }[] = [];
  return {
    timer: (fn, ms) => {
      const entry = { delay: ms, fn, cancelled: false };
      queue.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    scheduled: [] as unknown as number[],
    pending: () => queue.filter((e) => !e.cancelled).length,
    fireNext: async () => {
      const next = queue.find((e) => !e.cancelled);
      if (next === undefined) return;
      next.cancelled = true;
      next.fn();
      // Let the renewal write settle.
      await new Promise((r) => setImmediate(r));
    },
  };
}

/** Seed and claim `t` with `leaseDurationMs`, returning the committed row. */
async function claimed(h: Harness, leaseDurationMs: number): Promise<Task> {
  await h.collection.addTask({ id: "t", goal: "t" });
  return (await h.collection.claim("w", { leaseDurationMs }))!;
}

// ---------------------------------------------------------------------------
// The verb
// ---------------------------------------------------------------------------

describe("renewLease — the write", () => {
  it("writes exactly one field", async () => {
    const h = harness();
    const task = await claimed(h, 30_000);
    const before = h.collection.get("t")!;
    h.setNow(h.now() + 10_000);

    const outcome = await h.collection.renewLease("t", h.now() + 30_000, {
      claim: ticketForClaim("tasks", task),
    });

    expect(outcome).toEqual({ outcome: "recorded" });
    const after = h.collection.get("t")!;
    expect(after.leaseUntil).toBe(11_000 + 30_000);
    // Nothing a consumer reads as progress moved.
    expect(after.status).toBe(before.status);
    expect(after.attempts).toBe(before.attempts);
    expect(after.startedAt).toBe(before.startedAt);
    expect(after.abandonments).toBe(before.abandonments);
  });

  it("keeps `leaseUntil - updatedAt` equal to the committed span across a renewal", async () => {
    // The property the driver's span derivation rests on. If a renewal moved
    // one of the two without the other, a driver started after a renewal would
    // read a different span than the claim committed.
    const h = harness();
    const task = await claimed(h, 30_000);
    h.setNow(h.now() + 10_000);
    await h.collection.renewLease("t", h.now() + 30_000, {
      claim: ticketForClaim("tasks", task),
    });

    const after = h.collection.get("t")!;
    expect(after.leaseUntil! - after.updatedAt).toBe(30_000);
  });

  it("publishes no task-change item — a renewal is not a lifecycle change", async () => {
    // Announcing one every cadence tick per running job would spam every
    // subscribed client with a re-claim that did not happen, and wake every
    // idle worker on the board into a full collection scan.
    const events: unknown[] = [];
    let clock = 1000;
    const collection = createSequencerBackedTaskCollection({
      collectionId: "tasks",
      sequencer: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
      onChange: (e) => events.push(e),
      now: () => clock,
    });
    await collection.addTask({ id: "t", goal: "t" });
    const task = (await collection.claim("w", { leaseDurationMs: 30_000 }))!;
    events.length = 0;

    clock += 10_000;
    await collection.renewLease("t", clock + 30_000, { claim: ticketForClaim("tasks", task) });

    expect(events).toHaveLength(0);
  });

  it("declines terminal on a cancelled task", async () => {
    const h = harness();
    const task = await claimed(h, 30_000);
    await h.collection.cancel("t", "no longer needed");

    expect(
      await h.collection.renewLease("t", h.now() + 30_000, {
        claim: ticketForClaim("tasks", task),
      })
    ).toMatchObject({ outcome: "declined", reason: "terminal" });
  });

  it("declines not-my-task for a ticket naming another board", async () => {
    const h = harness();
    const task = await claimed(h, 30_000);

    expect(
      await h.collection.renewLease("t", h.now() + 30_000, {
        claim: { ...ticketForClaim("tasks", task), collectionId: "other-board" },
      })
    ).toMatchObject({ outcome: "declined", reason: "not-my-task" });
  });

  it("declines lost-claim for a displaced attempt", async () => {
    const h = harness();
    const task = await claimed(h, 30_000);
    await h.collection.reclaim(h.now() + 60_000);
    await h.collection.claim("w2", { leaseDurationMs: 30_000 });

    expect(
      await h.collection.renewLease("t", h.now() + 30_000, {
        claim: ticketForClaim("tasks", task),
      })
    ).toMatchObject({ outcome: "declined", reason: "lost-claim" });
  });

  it("throws — never declines — without a ticket", async () => {
    // Renewal is an ownership assertion, so an unfenced one would let anything
    // keep anyone's lease open. A programming error, not a lost race.
    const h = harness();
    await claimed(h, 30_000);

    await expect(
      // @ts-expect-error the type requires a ticket; this pins the runtime guard
      h.collection.renewLease("t", h.now() + 30_000, { ifAllowed: true })
    ).rejects.toThrow(/claim ticket/);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "throws on the non-finite deadline %p",
    async (leaseUntil) => {
      // Same numeric-domain posture the claim seam takes for a duration: a
      // number outside its permissible domain is a programming error, and it is
      // never folded into a write verdict or normalized into a surprise.
      const h = harness();
      const task = await claimed(h, 30_000);

      await expect(
        h.collection.renewLease("t", leaseUntil, { claim: ticketForClaim("tasks", task) })
      ).rejects.toThrow(/finite/);
    }
  );
});

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

describe("startLeaseRenewal — cadence, phase and the floor", () => {
  it("keeps a healthy worker's claim at any lease age, and never disturbs it", async () => {
    // If exactly one test in this suite survives a refactor, it is this one.
    // A task whose lease would have expired minutes ago under the old rules is
    // still the worker's, because its renewals are landing.
    const h = harness();
    const task = await claimed(h, 30_000);
    const timer = fakeTimer();
    const driver = startLeaseRenewal({
      collection: h.collection,
      ticket: ticketForClaim("tasks", task),
      claimedTask: task,
      now: h.now,
      timer: timer.timer,
    });

    for (let tick = 0; tick < 30; tick += 1) {
      h.setNow(h.now() + 10_000); // one cadence period
      await timer.fireNext();
    }

    // Four and a half minutes past the moment the original 30-second lease
    // would have expired — and the row is still this worker's.
    expect(h.now() - task.leaseUntil!).toBeGreaterThan(4 * 60_000);
    expect(driver.signal.aborted).toBe(false);
    expect(h.collection.get("t")?.status).toBe("in_progress");
    // And a fresh drain cannot take it.
    expect(await h.collection.claim("w2")).toBeNull();
    driver.stop();
  });

  it("derives the COMMITTED span, not the remainder, when it starts late", async () => {
    // A 1,000 ms claim reached 990 ms late. Under the remainder rule this reads
    // a 10 ms span and derives a ~3 ms cadence from it — the write storm the
    // lease minimum exists to prevent, rebuilt out of a valid claim.
    const h = harness();
    const task = await claimed(h, 1_000);
    h.setNow(h.now() + 990);
    const timer = fakeTimer();
    const delays: number[] = [];
    const driver = startLeaseRenewal({
      collection: h.collection,
      ticket: ticketForClaim("tasks", task),
      claimedTask: task,
      now: h.now,
      timer: (fn, ms) => {
        delays.push(ms);
        return timer.timer(fn, ms);
      },
    });

    // The first tick is phased against the lease that is LEFT (10 ms), which is
    // under the floor — so no timer at all, and the renewal runs inline.
    expect(delays).toHaveLength(0);
    await new Promise((r) => setImmediate(r));
    // The steady-state cadence that follows is derived from the committed
    // 1,000 ms span, not from the 10 ms remainder: 333 ms, not 3 ms.
    expect(delays).toEqual([Math.floor(1_000 / RENEWAL_DIVISOR)]);
    driver.stop();
  });

  it("commits its first renewal INSIDE the lease when it starts late", async () => {
    // Separate failure, same setup — and this is the one that matters. A driver
    // can derive the right 333 ms cadence and still fire it at t≈1,323 against
    // a lease dead at t=1,000, so the fence declines it and a HEALTHY worker is
    // reclaimed. Assert that the renewal succeeded, not merely the cadence.
    const h = harness();
    const task = await claimed(h, 1_000);
    const before = h.collection.get("t")!.leaseUntil;
    h.setNow(h.now() + 990);
    const timer = fakeTimer();
    const driver = startLeaseRenewal({
      collection: h.collection,
      ticket: ticketForClaim("tasks", task),
      claimedTask: task,
      now: h.now,
      timer: timer.timer,
    });

    await new Promise((r) => setImmediate(r));

    expect(driver.signal.aborted).toBe(false);
    expect(h.collection.get("t")!.leaseUntil).toBeGreaterThan(before!);
    driver.stop();
  });

  it("sets NO timer when the phased delay is under the floor, and renews inline", async () => {
    // Asserted as behaviour, not as a constant: a store spy plus a clock that
    // is never advanced and a timer that is never fired. This fails against a
    // driver that scheduled the write instead of issuing it.
    const h = harness();
    const task = await claimed(h, 1_000);
    h.setNow(h.now() + 900); // 100 ms left → phased delay 33 ms, under the floor
    const renew = vi.spyOn(h.collection, "renewLease");
    const timer = fakeTimer();
    const driver = startLeaseRenewal({
      collection: h.collection,
      ticket: ticketForClaim("tasks", task),
      claimedTask: task,
      now: h.now,
      timer: timer.timer,
    });

    await new Promise((r) => setImmediate(r));

    expect(renew).toHaveBeenCalledTimes(1);
    driver.stop();
  });

  it("takes the TIMER path when there is comfortably more lease than the floor", async () => {
    // The floor's own second path (BP-035): a driver that started on time pays
    // nothing for it, so an unconditional startup write would be a regression.
    const h = harness();
    const task = await claimed(h, 30_000);
    const renew = vi.spyOn(h.collection, "renewLease");
    const timer = fakeTimer();
    const driver = startLeaseRenewal({
      collection: h.collection,
      ticket: ticketForClaim("tasks", task),
      claimedTask: task,
      now: h.now,
      timer: timer.timer,
    });

    await new Promise((r) => setImmediate(r));

    expect(renew).not.toHaveBeenCalled();
    expect(timer.pending()).toBe(1);
    expect(MIN_RENEWAL_DELAY_MS).toBe(50);
    driver.stop();
  });

  it("aborts IMMEDIATELY when it starts past the window, not after a phased delay", async () => {
    const h = harness();
    const task = await claimed(h, 1_000);
    h.setNow(h.now() + 5_000); // the lease is long gone
    const timer = fakeTimer();
    const driver = startLeaseRenewal({
      collection: h.collection,
      ticket: ticketForClaim("tasks", task),
      claimedTask: task,
      now: h.now,
      timer: timer.timer,
    });

    await new Promise((r) => setImmediate(r));

    expect(driver.signal.aborted).toBe(true);
    driver.stop();
  });
});

describe("startLeaseRenewal — what stops it and what does not", () => {
  it("aborts the worker when the row moved to someone else", async () => {
    const h = harness();
    const task = await claimed(h, 30_000);
    const timer = fakeTimer();
    const driver = startLeaseRenewal({
      collection: h.collection,
      ticket: ticketForClaim("tasks", task),
      claimedTask: task,
      now: h.now,
      timer: timer.timer,
    });

    // Someone else takes the row.
    await h.collection.reclaim(h.now() + 60_000);
    await h.collection.claim("w2", { leaseDurationMs: 30_000 });
    await timer.fireNext();

    expect(driver.signal.aborted).toBe(true);
  });

  it("does NOT abort when the store throws inside the lease — the unknown case is not the dead case", async () => {
    // A store that threw tells us nothing about who holds the row, and the
    // fence refuses whatever this worker writes if it turns out to be gone.
    // Aborting here would kill a healthy worker over one flaky write.
    const h = harness();
    const task = await claimed(h, 30_000);
    vi.spyOn(h.collection, "renewLease").mockRejectedValue(new Error("store unreachable"));
    const timer = fakeTimer();
    const driver = startLeaseRenewal({
      collection: h.collection,
      ticket: ticketForClaim("tasks", task),
      claimedTask: task,
      now: h.now,
      timer: timer.timer,
    });

    await timer.fireNext();

    expect(driver.signal.aborted).toBe(false);
    // And it tries again next tick rather than giving up.
    expect(timer.pending()).toBe(1);
    driver.stop();
  });

  it("skips a tick whose predecessor is still in flight, never stacking two renewals", async () => {
    const h = harness();
    const task = await claimed(h, 30_000);
    let release!: () => void;
    const inFlight = new Promise<void>((r) => {
      release = r;
    });
    const renew = vi
      .spyOn(h.collection, "renewLease")
      .mockImplementation(async () => {
        await inFlight;
        return { outcome: "recorded" as const };
      });
    const timer = fakeTimer();
    const driver = startLeaseRenewal({
      collection: h.collection,
      ticket: ticketForClaim("tasks", task),
      claimedTask: task,
      now: h.now,
      timer: timer.timer,
    });

    await timer.fireNext(); // starts a renewal that never settles
    await timer.fireNext(); // would be the next tick
    await timer.fireNext();

    expect(renew).toHaveBeenCalledTimes(1);
    release();
    driver.stop();
  });

  it("stops WITHOUT aborting when the worker parks its own task for review", async () => {
    // A review park is an explicit park, not a lost claim — which is exactly
    // why the substrate's write fence is scoped to `in_progress`. Aborting the
    // worker here would contradict that rule one layer up. Stop renewing a row
    // the lease no longer speaks for, and leave the worker be.
    const h = harness();
    const task = await claimed(h, 30_000);
    const ticket = ticketForClaim("tasks", task);
    const timer = fakeTimer();
    const driver = startLeaseRenewal({
      collection: h.collection,
      ticket,
      claimedTask: task,
      now: h.now,
      timer: timer.timer,
    });

    await h.collection.awaitReview("t", "over to you", { ifAllowed: true, claim: ticket });
    await timer.fireNext();

    expect(driver.signal.aborted).toBe(false);
    expect(timer.pending()).toBe(0); // and it stopped renewing
  });

  it("stops renewing when the request's own signal aborts", async () => {
    // A cancelled request is not a live worker, so it should stop asserting it
    // is one rather than holding a lease open for work nobody is waiting on.
    const h = harness();
    const task = await claimed(h, 30_000);
    const request = new AbortController();
    const renew = vi.spyOn(h.collection, "renewLease");
    const timer = fakeTimer();
    startLeaseRenewal({
      collection: h.collection,
      ticket: ticketForClaim("tasks", task),
      claimedTask: task,
      signal: request.signal,
      now: h.now,
      timer: timer.timer,
    });

    request.abort();
    await timer.fireNext();

    expect(renew).not.toHaveBeenCalled();
  });

  it("stops on every path out of withLeaseRenewal, including a throw", async () => {
    const h = harness();
    const task = await claimed(h, 30_000);
    const renew = vi.spyOn(h.collection, "renewLease");
    const timer = fakeTimer();

    await expect(
      withLeaseRenewal({
        collection: h.collection,
        ticket: ticketForClaim("tasks", task),
        claimedTask: task,
        now: h.now,
        timer: timer.timer,
        run: async () => {
          throw new Error("worker blew up");
        },
      })
    ).rejects.toThrow("worker blew up");

    await timer.fireNext();
    expect(renew).not.toHaveBeenCalled();
  });

  it("hands the lease-loss signal to the work it wraps", async () => {
    const h = harness();
    const task = await claimed(h, 30_000);
    const timer = fakeTimer();
    let seen: AbortSignal | undefined;

    await withLeaseRenewal({
      collection: h.collection,
      ticket: ticketForClaim("tasks", task),
      claimedTask: task,
      now: h.now,
      timer: timer.timer,
      run: async (leaseLost) => {
        seen = leaseLost;
      },
    });

    expect(seen).toBeInstanceOf(AbortSignal);
  });
});
