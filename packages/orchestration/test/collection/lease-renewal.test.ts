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
  classifierDispatcher,
  createSequencerBackedTaskCollection,
  startLeaseRenewal,
  ticketForClaim,
  withLeaseRenewal,
  DEFAULT_MAX_ABANDONMENTS,
  MIN_RENEWAL_DELAY_MS,
  RENEWAL_DIVISOR,
  type RenewalTimer,
  type Task,
  type TaskCollectionRef,
} from "../../src/tasks";
import {
  withLeaseRenewalScope,
  stampLeaseRenewal,
  currentLeaseRenewal,
} from "../../src/tasks/lease-renewal-scope";
import { hasClaimableTask } from "../../src/task-board/shared";
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

describe("one clock — the collection's", () => {
  // A lease is a comparison, and a comparison needs one clock. `leaseUntil` is
  // stamped by the claim write against the collection's clock, so anything
  // asking "has this run out" has to ask the same one. Every collection in
  // this file is frozen at t=1000, which is roughly 1.7e12 ms away from the
  // wall clock — so a reader that reaches for `Date.now()` instead is not
  // subtly wrong, it is wrong by fifty-six years, and these assertions catch
  // it. In production both clocks are the wall clock and nothing misbehaves,
  // which is exactly what makes it a trap: the divergence is reachable only
  // from a test, and a lease test on two timelines is the last test you want
  // to be silently vacuous.

  it("writes a renewal deadline on the COLLECTION's timeline, not the wall clock", async () => {
    const h = harness();
    const task = await claimed(h, 30_000);
    const timer = fakeTimer();
    const driver = startLeaseRenewal({
      collection: h.collection,
      ticket: ticketForClaim("tasks", task),
      claimedTask: task,
      // Deliberately NO `now` — the driver has to pick the collection's up.
      timer: timer.timer,
    });

    h.setNow(11_000);
    await timer.fireNext();

    // 11_000 + the committed 30s span. Reading the wall clock here would
    // install a deadline around 1.7e12 and this assertion would be off by
    // decades.
    expect(h.collection.get("t")!.leaseUntil).toBe(41_000);
    driver.stop();
  });

  it("does not read a healthy claim as abandoned through the board's wake probe", async () => {
    // The read side of the same divergence. Under `Date.now()` this freshly
    // claimed row — leased to t=31_000 on the collection's clock — reads as
    // lapsed decades ago, so the probe reports claimable work and a board
    // would try to recover a task a worker is actively holding.
    const h = harness();
    await claimed(h, 30_000);

    expect(hasClaimableTask(h.collection)).toBe(false);

    h.setNow(31_001);
    expect(hasClaimableTask(h.collection)).toBe(true);
  });

  it("does not read a healthy claim as abandoned through a narrowing dispatcher", async () => {
    // Same again at the classifier's candidate scan, which is the third place
    // a hardcoded clock was reachable from.
    const h = harness();
    await claimed(h, 30_000);
    const seen: string[][] = [];
    const dispatcher = classifierDispatcher({
      classify: async (candidates) => {
        seen.push(candidates.map((c) => c.id));
        return null;
      },
    });

    // Nothing is claimable, so the classifier is never even consulted.
    expect(await dispatcher.claim(h.collection, "w2", {} as never)).toBeNull();
    expect(seen).toEqual([]);

    h.setNow(31_001);
    await dispatcher.claim(h.collection, "w2", {} as never);
    expect(seen).toEqual([["t"]]); // now it really is abandoned
  });
});

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

  it("hands the work a signal that is ALREADY composed", async () => {
    // The callback gets `options.signal` OR lease loss, whichever fires first,
    // so the caller has nothing left to combine. Handing over the bare lease
    // signal would be the trap: `options.signal` stops the driver and not the
    // work, so a worker given only the lease signal keeps running and keeps
    // spending after its request is cancelled — against a claim it is no
    // longer renewing.
    const h = harness();
    const task = await claimed(h, 30_000);
    const timer = fakeTimer();
    const request = new AbortController();
    let seen: AbortSignal | undefined;

    await withLeaseRenewal({
      collection: h.collection,
      ticket: ticketForClaim("tasks", task),
      claimedTask: task,
      signal: request.signal,
      now: h.now,
      timer: timer.timer,
      run: async (signal) => {
        seen = signal;
      },
    });

    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen!.aborted).toBe(false);
    // Cancelling the REQUEST reaches the work, not just the driver.
    request.abort();
    expect(seen!.aborted).toBe(true);
  });

  it("hands over the lease signal alone when no ambient signal was given", async () => {
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
      run: async (signal) => {
        seen = signal;
      },
    });

    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen!.aborted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The hand-off — the window between claiming and working
// ---------------------------------------------------------------------------

describe("withLeaseRenewalScope — the claim → work hand-off", () => {
  // Every way of leaving the WORK is already covered: the dispatch step's
  // `onSettled` runs whether the worker returned, threw or suspended, and a
  // cancelled request stops the driver through the ambient signal. What none of
  // them cover is the window before that step is ever reached. A block that
  // claims a task still has to write its state and emit its status afterwards,
  // and if either fails the work step never runs — so no recorder fires, no
  // `onSettled` fires, and a failed request does not abort its own signal.
  // Nothing would stop the timer, and because a live lease is exactly what
  // tells `claim()` a row is NOT abandoned, no other worker could recover the
  // task for as long as the host lived.

  it("stops a driver the setup stamped before it threw", async () => {
    const h = harness();
    const task = await claimed(h, 30_000);
    const timer = fakeTimer();

    await expect(
      withLeaseRenewalScope(async () => {
        stampLeaseRenewal(
          startLeaseRenewal({
            collection: h.collection,
            ticket: ticketForClaim("tasks", task),
            claimedTask: task,
            now: h.now,
            timer: timer.timer,
          })
        );
        // Stands in for the state write and the status emission that every
        // claiming block still performs after the claim commits.
        throw new Error("state write failed");
      })
    ).rejects.toThrow("state write failed");

    expect(timer.pending()).toBe(0);
  });

  it("leaves the lease untouched after that failure, so the row can lapse", async () => {
    // The point of stopping is that the row goes quiet. A driver that survived
    // would keep pushing `leaseUntil` forward and the task would never look
    // abandoned to the next worker.
    const h = harness();
    const task = await claimed(h, 30_000);
    const timer = fakeTimer();
    const leaseAtClaim = h.collection.get("t")!.leaseUntil;

    await expect(
      withLeaseRenewalScope(async () => {
        stampLeaseRenewal(
          startLeaseRenewal({
            collection: h.collection,
            ticket: ticketForClaim("tasks", task),
            claimedTask: task,
            now: h.now,
            timer: timer.timer,
          })
        );
        throw new Error("setup failed");
      })
    ).rejects.toThrow("setup failed");

    // Even if a tick were somehow still queued, it writes nothing.
    h.setNow(h.now() + 10_000);
    await timer.fireNext();

    expect(h.collection.get("t")!.leaseUntil).toBe(leaseAtClaim);
  });

  it("leaves the driver RUNNING when the setup succeeds", async () => {
    // The control. Stopping on the way out of a *successful* setup would kill
    // renewal for the work that is about to start — the opposite bug.
    const h = harness();
    const task = await claimed(h, 30_000);
    const timer = fakeTimer();

    await withLeaseRenewalScope(async () => {
      stampLeaseRenewal(
        startLeaseRenewal({
          collection: h.collection,
          ticket: ticketForClaim("tasks", task),
          claimedTask: task,
          now: h.now,
          timer: timer.timer,
        })
      );
    });

    expect(timer.pending()).toBe(1);
    h.setNow(h.now() + 10_000);
    await timer.fireNext();
    expect(h.collection.get("t")!.leaseUntil).toBe(11_000 + 30_000);
  });

  it("publishes the same scope `currentLeaseRenewal` reads", async () => {
    // It replaces `openLeaseRenewalScope` at the call sites, so the driver has
    // to stay reachable by the readers that stop it and run work under it.
    const h = harness();
    const task = await claimed(h, 30_000);
    const timer = fakeTimer();
    let reachable: boolean | undefined;

    await withLeaseRenewalScope(async () => {
      const driver = startLeaseRenewal({
        collection: h.collection,
        ticket: ticketForClaim("tasks", task),
        claimedTask: task,
        now: h.now,
        timer: timer.timer,
      });
      stampLeaseRenewal(driver);
      reachable = currentLeaseRenewal() === driver;
    });

    expect(reachable).toBe(true);
  });

  it("survives a setup that fails BEFORE it stamps anything", async () => {
    // The claim itself can fail. There is no driver to stop, and the guard must
    // not turn that into a second error on top of the real one.
    await expect(
      withLeaseRenewalScope(async () => {
        throw new Error("claim failed");
      })
    ).rejects.toThrow("claim failed");
  });
});


// ---------------------------------------------------------------------------
// The classifier's candidate set — admission vs disposition
// ---------------------------------------------------------------------------

describe("classifierDispatcher and abandonment-exhausted rows", () => {
  // The classifier narrows `claim()` to ONE id, which destroys the scan-past
  // behaviour the substrate relies on to settle exhausted rows in passing. So
  // this dispatcher has to keep admission and disposition apart itself: the
  // model chooses only among rows a worker could run, and exhausted rows are
  // settled directly rather than by spending a model call on them.

  /**
   * A row whose worker died `times` over, with its lease lapsed again now.
   *
   * Only a claim that takes back an ALREADY-lapsed row counts as a recovery, so
   * the first claim on a fresh `pending` task charges nothing — hence the extra
   * pass. Asserting the count rather than assuming it keeps these tests honest
   * if that rule ever moves.
   */
  async function abandoned(h: Harness, id: string, times: number): Promise<void> {
    await h.collection.addTask({ id, goal: id });
    for (let i = 0; i <= times; i += 1) {
      await h.collection.claim("w", { leaseDurationMs: 1_000 });
      h.setNow(h.now() + 5_000);
    }
    expect(h.collection.get(id)!.abandonments).toBe(times);
  }

  it("does not offer an exhausted row to the model", async () => {
    const h = harness();
    await abandoned(h, "dead", DEFAULT_MAX_ABANDONMENTS);
    await h.collection.addTask({ id: "live", goal: "live" });

    const seen: string[][] = [];
    const dispatcher = classifierDispatcher({
      classify: async (candidates) => {
        seen.push(candidates.map((t) => t.id));
        return candidates[0]?.id ?? null;
      },
    });

    const claimed = await dispatcher.claim(h.collection, "w", {} as never);

    // The model was shown only the row it could actually get.
    expect(seen).toEqual([["live"]]);
    expect(claimed?.id).toBe("live");
  });

  it("settles an exhausted row WITHOUT spending a model call", async () => {
    // The row still has to be settled — claiming is the only thing that does it
    // — but it is housekeeping, not a choice, so the model is not consulted.
    const h = harness();
    await abandoned(h, "dead", DEFAULT_MAX_ABANDONMENTS);

    let classifyCalls = 0;
    const dispatcher = classifierDispatcher({
      classify: async () => {
        classifyCalls += 1;
        return null;
      },
    });

    const claimed = await dispatcher.claim(h.collection, "w", {} as never);

    expect(classifyCalls).toBe(0);
    expect(claimed).toBeNull();
    expect(h.collection.get("dead")!.status).toBe("errored");
  });

  it("drains a board holding nothing but exhausted rows", async () => {
    // The anti-vacuity guard. Filtering exhausted rows out and stopping there
    // would leave rows `isClaimable` forever admits — the wake probe would keep
    // reporting work and this dispatcher would keep returning null, so the
    // board would never drain. Settling them is what terminates the loop.
    const h = harness();
    await abandoned(h, "dead-a", DEFAULT_MAX_ABANDONMENTS);
    await abandoned(h, "dead-b", DEFAULT_MAX_ABANDONMENTS);

    const dispatcher = classifierDispatcher({ classify: async () => null });

    expect(hasClaimableTask(h.collection)).toBe(true);
    // One pass per row, each settling one and consulting nobody.
    await dispatcher.claim(h.collection, "w", {} as never);
    await dispatcher.claim(h.collection, "w", {} as never);

    expect(hasClaimableTask(h.collection)).toBe(false);
    expect(h.collection.get("dead-a")!.status).toBe("errored");
    expect(h.collection.get("dead-b")!.status).toBe("errored");
  });

  it("still offers a row that has abandonment allowance LEFT", async () => {
    // Recovery is the feature. Only a row past its allowance is withheld.
    const h = harness();
    await abandoned(h, "recoverable", DEFAULT_MAX_ABANDONMENTS - 1);

    const seen: string[][] = [];
    const dispatcher = classifierDispatcher({
      classify: async (candidates) => {
        seen.push(candidates.map((t) => t.id));
        return candidates[0]?.id ?? null;
      },
    });

    const claimed = await dispatcher.claim(h.collection, "w", {} as never);

    expect(seen).toEqual([["recoverable"]]);
    expect(claimed?.id).toBe("recoverable");
  });
});


// ---------------------------------------------------------------------------
// Retry phasing after a slow renewal
// ---------------------------------------------------------------------------

describe("a slow renewal does not push the retry past the deadline", () => {
  // The driver advertises that `RENEWAL_DIVISOR - 2` consecutive failures are
  // survived. That holds only if ticks keep landing on their grid. Scheduling
  // the next one a full cadence after the previous write SETTLED lets a slow
  // failure eat the interval that was supposed to carry the retry — and a slow
  // failure is the exact case the tolerance exists for.

  /** Records every scheduled tick as an absolute time on the harness clock. */
  function recordingTimer(h: Harness) {
    const ticks: { firesAt: number; delay: number }[] = [];
    let pending: (() => void) | undefined;
    const timer: RenewalTimer = (fn, ms) => {
      ticks.push({ firesAt: h.now() + ms, delay: ms });
      pending = fn;
      return () => {
        pending = undefined;
      };
    };
    return {
      timer,
      ticks,
      fire: async (index: number) => {
        h.setNow(ticks[index].firesAt);
        const fn = pending;
        pending = undefined;
        fn?.();
        await new Promise((r) => setTimeout(r, 20));
      },
    };
  }

  it("phases the retry from when the tick was DUE, not when the write settled", async () => {
    // 3s lease claimed at t=1000 → deadline 4000, cadence 1000, first tick due
    // at 2000. The write issued then takes 1.5s and fails, settling at 3500.
    //
    // Measured from settle time the retry would be scheduled for 4500 — half a
    // second after the lease it was meant to save. Phased from the due time it
    // goes out immediately instead, with 450ms of lease still in hand.
    const h = harness();
    await h.collection.addTask({ id: "t", goal: "t" });
    const task = (await h.collection.claim("w", { leaseDurationMs: 3_000 }))!;
    const deadline = task.leaseUntil!;
    const clock = recordingTimer(h);

    const slowFailing = {
      ...h.collection,
      renewLease: async () => {
        h.setNow(h.now() + 1_500);
        throw new Error("store hiccup");
      },
    } as unknown as TaskCollectionRef;

    startLeaseRenewal({
      collection: slowFailing,
      ticket: ticketForClaim("tasks", task),
      claimedTask: task,
      now: h.now,
      timer: clock.timer,
    });

    expect(clock.ticks[0].firesAt).toBe(2_000);
    await clock.fire(0);

    expect(clock.ticks).toHaveLength(2);
    expect(clock.ticks[1].firesAt).toBeLessThan(deadline);
  });

  it("does not spin when a store fails instantly and forever", async () => {
    // The floor that makes the above safe. Retrying "as soon as due" past a
    // deadline that has already gone would otherwise be a hot loop of failing
    // writes, so no retry is ever scheduled closer than MIN_RENEWAL_DELAY_MS.
    const h = harness();
    await h.collection.addTask({ id: "t", goal: "t" });
    const task = (await h.collection.claim("w", { leaseDurationMs: 3_000 }))!;
    const clock = recordingTimer(h);

    const instantlyFailing = {
      ...h.collection,
      renewLease: async () => {
        throw new Error("down");
      },
    } as unknown as TaskCollectionRef;

    startLeaseRenewal({
      collection: instantlyFailing,
      ticket: ticketForClaim("tasks", task),
      claimedTask: task,
      now: h.now,
      timer: clock.timer,
    });

    // Well past the deadline, so every subsequent tick is "overdue".
    h.setNow(10_000);
    await clock.fire(0);
    await clock.fire(1);

    expect(clock.ticks[2].delay).toBeGreaterThanOrEqual(MIN_RENEWAL_DELAY_MS);
  });

  it("leaves a healthy worker's cadence alone", async () => {
    // The control: when writes are fast, ticks stay one cadence apart.
    const h = harness();
    await h.collection.addTask({ id: "t", goal: "t" });
    const task = (await h.collection.claim("w", { leaseDurationMs: 3_000 }))!;
    const clock = recordingTimer(h);

    startLeaseRenewal({
      collection: h.collection,
      ticket: ticketForClaim("tasks", task),
      claimedTask: task,
      now: h.now,
      timer: clock.timer,
    });

    expect(clock.ticks[0].firesAt).toBe(2_000);
    await clock.fire(0);
    expect(clock.ticks[1].firesAt).toBe(3_000);
    await clock.fire(1);
    expect(clock.ticks[2].firesAt).toBe(4_000);
  });
});
