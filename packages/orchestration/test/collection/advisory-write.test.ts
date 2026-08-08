/**
 * Advisory write-back guards on `complete` / `fail` (FIX-951), and the write
 * verdict every guarded path now reports (FIX-976).
 *
 * The substrate's own write-backs opt into `{ ifAllowed, claim }` so
 * a result that arrives after its task was settled by someone else is
 * dropped instead of throwing. The throw is what used to escape the task
 * board's per-worker rescue and abandon every sibling task on the board.
 *
 * FIX-976 keeps every one of those behaviours and adds a return value saying
 * what happened, so a caller that *wants* to know no longer has to re-read the
 * task and infer. The write-backs still discard it, which is what preserves the
 * containment property: **reporting a decline and acting on one are separate.**
 *
 * Parameterized over both backings, because they carry separately maintained
 * copies of the transition wrapper AND of the patch helper — a fix applied to
 * one and not the other is the failure mode this suite exists to catch.
 *
 * The guards answer different questions and are tested separately.
 * `ifAllowed` asks whether the state machine will take the move.
 * `claim` asks whether this is the caller's task at all, and then whether the
 * caller still owns it — both often *legal* transitions and so invisible to the
 * first guard.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  createSequencerBackedTaskCollection,
  createResourceBackedTaskCollection,
  ticketForClaim,
  type TaskClaimTicket,
  type TaskCollectionRef,
  type TaskChangeEvent,
  type TaskStatus,
} from "../../src/tasks";
import { transitionDeclineReason } from "../../src/tasks/collection/internal";
import type { Task } from "../../src/tasks";
import {
  createCapturedChanges,
  createFakeResourceCollection,
  createFakeSequencerState,
} from "../helpers";

type BackingFactory = () => Promise<{
  collection: TaskCollectionRef;
  events: TaskChangeEvent[];
  setNow: (n: number) => void;
}>;

function sequencerBacking(): BackingFactory {
  return async () => {
    let clock = 1000;
    const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({
      tasks: {},
    });
    const captured = createCapturedChanges();
    return {
      collection: createSequencerBackedTaskCollection({
        collectionId: "tasks",
        sequencer,
        onChange: captured.onChange,
        now: () => clock,
      }),
      events: captured.events,
      setNow: (n) => {
        clock = n;
      },
    };
  };
}

function resourceBacking(): BackingFactory {
  return async () => {
    let clock = 1000;
    const collection = createFakeResourceCollection();
    const captured = createCapturedChanges();
    return {
      collection: await createResourceBackedTaskCollection({
        collectionId: "tasks",
        collection,
        onChange: captured.onChange,
        now: () => clock,
      }),
      events: captured.events,
      setNow: (n) => {
        clock = n;
      },
    };
  };
}

const ADVISORY = { ifAllowed: true } as const;

// ---------------------------------------------------------------------------
// The decline predicate's reason encoding (FIX-976, step 1)
// ---------------------------------------------------------------------------

/**
 * Tested directly, not only through the backings, because the *precedence* is
 * the contract and not every reason is reachable through a verdict-returning
 * method on every path: `cancel`'s target is legal from every non-terminal
 * status, so `disallowed` and `lost-claim` come from `complete`/`fail`. Pinning
 * the predicate here keeps all four reasons and their order asserted
 * regardless of which methods are widened.
 */
describe("transitionDeclineReason — which condition fired", () => {
  const BOARD = "tasks";
  const task = (status: TaskStatus, attempts = 1, createdAt = 0): Task =>
    ({
      id: "t",
      goal: "t",
      status,
      attempts,
      createdAt,
      updatedAt: 0,
    }) as Task;

  /** A ticket for `t` on this board, at attempt 1, created at 0. */
  const mine: TaskClaimTicket = {
    collectionId: BOARD,
    taskId: "t",
    attempt: 1,
    createdAt: 0,
  };

  it("returns undefined with no options, so an unguarded caller still throws downstream", () => {
    expect(
      transitionDeclineReason(task("pending"), "errored", undefined, BOARD),
    ).toBeUndefined();
  });

  it("reports terminal for a settled task", () => {
    for (const status of ["completed", "errored", "cancelled"] as const) {
      expect(transitionDeclineReason(task(status), "cancelled", ADVISORY, BOARD)).toBe(
        "terminal",
      );
    }
  });

  it("reports disallowed for a NONTERMINAL illegal move", () => {
    // The reason a two-reason contract could not describe this surface: these
    // declines are live today and are not about terminality at all.
    expect(transitionDeclineReason(task("pending"), "errored", ADVISORY, BOARD)).toBe(
      "disallowed",
    );
    expect(transitionDeclineReason(task("blocked"), "errored", ADVISORY, BOARD)).toBe(
      "disallowed",
    );
  });

  it("reports lost-claim when the attempt no longer owns the task", () => {
    // Legal transition, matching counter, but the task is back to `pending` —
    // ownership is the counter AND the status.
    expect(
      transitionDeclineReason(task("pending"), "completed", { claim: mine }, BOARD),
    ).toBe("lost-claim");
  });

  it("reports not-my-task for a ticket naming another task", () => {
    // The defect this guard exists for, at the predicate: the ticket's attempt
    // MATCHES the target's, exactly as two freshly claimed tasks do.
    expect(
      transitionDeclineReason(
        task("in_progress"),
        "completed",
        { claim: { ...mine, taskId: "somebody-elses" } },
        BOARD,
      ),
    ).toBe("not-my-task");
  });

  it("reports not-my-task for a ticket naming another board", () => {
    // Two boards may both hold a task id; a coordinator may legitimately file
    // the same id on both.
    expect(
      transitionDeclineReason(
        task("in_progress"),
        "completed",
        { claim: { ...mine, collectionId: "some-other-board" } },
        BOARD,
      ),
    ).toBe("not-my-task");
  });

  it("reports not-my-task when the id was recycled by a delete and recreate", () => {
    // The ABA case. Same id, same board, and `attempts` reset to 0 by the
    // recreate — so `attempt` alone would have to match a fresh claim's 1 and
    // the ONLY field that distinguishes the two tasks is `createdAt`. Drop it
    // from the ticket and this test is the one that goes red.
    const recreated = task("in_progress", 1, 5_000);
    expect(
      transitionDeclineReason(recreated, "completed", { claim: mine }, BOARD),
    ).toBe("not-my-task");
  });

  it("reports terminal when terminal AND disallowed both hold — fixed precedence", () => {
    // `completed → errored` is both. Leaving the order undefined is what lets
    // two implementers emit two different messages for one refusal.
    expect(transitionDeclineReason(task("completed"), "errored", ADVISORY, BOARD)).toBe(
      "terminal",
    );
  });

  it("reports terminal ahead of lost-claim when both guards would fire", () => {
    // attempts 2 vs the ticket's 1, on a settled task.
    expect(
      transitionDeclineReason(
        task("completed", 2),
        "completed",
        { ...ADVISORY, claim: mine },
        BOARD,
      ),
    ).toBe("terminal");
  });

  it("reports not-my-task AHEAD of disallowed — the ordering, not just the outcome", () => {
    // The load-bearing ordering assertion, and the one a test phrased as
    // "the write was refused" cannot make.
    //
    // A caller whose basis for the target is stale sees `pending`, and
    // `pending → completed` is illegal, so the disallowed arm WOULD fire here.
    // Left last, the ownership arm would report `disallowed` on this
    // interleaving and `not-my-task` on the other — the same cross-task write
    // refused for two different reasons depending on when the caller happened
    // to resolve the collection. Neither the model-facing message nor a
    // programmatic caller can be built on that.
    expect(
      transitionDeclineReason(
        task("pending"),
        "completed",
        { ...ADVISORY, claim: { ...mine, taskId: "somebody-elses" } },
        BOARD,
      ),
    ).toBe("not-my-task");

    // ...and the same write against a FRESH basis, where the target is
    // `in_progress` and `disallowed` could not have fired. Both interleavings,
    // one answer.
    expect(
      transitionDeclineReason(
        task("in_progress"),
        "completed",
        { ...ADVISORY, claim: { ...mine, taskId: "somebody-elses" } },
        BOARD,
      ),
    ).toBe("not-my-task");
  });

  it("permits the write when no guard fires", () => {
    expect(
      transitionDeclineReason(
        task("in_progress"),
        "completed",
        { ...ADVISORY, claim: mine },
        BOARD,
      ),
    ).toBeUndefined();
  });

  it("throws on the removed expectAttempt key rather than dropping the guard", () => {
    // BP-030. TypeScript catches this for a typed caller; an untyped one would
    // otherwise have its ownership check silently discarded and its write
    // proceed — the exact silence the ticket exists to remove.
    expect(() =>
      transitionDeclineReason(
        task("in_progress"),
        "completed",
        { ifAllowed: true, expectAttempt: 1 } as never,
        BOARD,
      ),
    ).toThrow(/"expectAttempt" was removed/);

    // Present-but-undefined is still a caller that thinks it is passing a guard.
    expect(() =>
      transitionDeclineReason(
        task("in_progress"),
        "completed",
        { expectAttempt: undefined } as never,
        BOARD,
      ),
    ).toThrow(/"expectAttempt" was removed/);
  });
});

describe.each([
  ["sequencer-backed", sequencerBacking()],
  ["resource-backed", resourceBacking()],
])("advisory write-backs (%s)", (_label, factory) => {
  let collection: TaskCollectionRef;
  let events: TaskChangeEvent[];
  let setNow: (n: number) => void;

  beforeEach(async () => {
    const setup = await factory();
    collection = setup.collection;
    events = setup.events;
    setNow = setup.setNow;
  });

  /** Add + claim, returning the claimed task (attempts === 1). */
  async function claimed(init: { id: string; maxAttempts?: number }) {
    await collection.addTask({ goal: init.id, ...init });
    const task = await collection.claim("worker-1", {
      eligibility: (t) => t.id === init.id,
    });
    if (task === null) throw new Error("fixture failed to claim");
    return task;
  }

  /**
   * The ticket the substrate mints for a claim — built the same way the board
   * builds it, from the task `claim()` returned. Tests that want a *wrong*
   * ticket derive one from this rather than hand-assembling a literal, so a
   * change to what a ticket contains cannot leave them silently asserting less.
   */
  const ticket = (task: Task): TaskClaimTicket =>
    ticketForClaim(collection.collectionId, task);

  describe("the guard is off by default — direct callers still throw", () => {
    // BP-035: the off state of a new flag is a path, and it is the one that
    // keeps the model-facing `failTask` tool honest about a bad call.
    it("fail on a cancelled task throws when no options are passed", async () => {
      await claimed({ id: "t" });
      await collection.cancel("t", "coordinator changed its mind");
      await expect(collection.fail("t", "worker blew up")).rejects.toThrow(
        /illegal status transition/
      );
    });

    it("complete on a cancelled task throws when no options are passed", async () => {
      await claimed({ id: "t" });
      await collection.cancel("t", "coordinator changed its mind");
      await expect(collection.complete("t", "done")).rejects.toThrow(
        /illegal status transition/
      );
    });
  });

  describe("ifAllowed — the state machine's answer", () => {
    it("declines a fail onto a cancelled task, preserving the cancel", async () => {
      await claimed({ id: "t" });
      await collection.cancel("t", "coordinator changed its mind");
      events.length = 0;

      // Resolves rather than throwing — that is the FIX-951 contract. What it
      // resolves TO is the FIX-976 verdict; either way nothing is thrown.
      await expect(
        collection.fail("t", "worker blew up", ADVISORY)
      ).resolves.toMatchObject({ outcome: "declined" });

      const task = collection.get("t");
      expect(task?.status).toBe("cancelled");
      // Assert the payload, not just the status: the cancel's own reason is
      // what a late failure would overwrite.
      expect(task?.error).toBe("coordinator changed its mind");
      expect(events).toHaveLength(0);
    });

    it("declines a complete onto a cancelled task — the succeeding-worker trigger", async () => {
      // A worker that finishes normally on a cancelled task is the ordinary
      // case, not the exotic one: cancelling does not stop the worker already
      // running. Its success write-back is the illegal transition.
      await claimed({ id: "t" });
      await collection.cancel("t", "coordinator changed its mind");
      events.length = 0;

      await collection.complete("t", "worker finished anyway", ADVISORY);

      const task = collection.get("t");
      expect(task?.status).toBe("cancelled");
      expect(task?.output).toBeUndefined();
      expect(events).toHaveLength(0);
    });

    it("declines a fail onto a cancelled task WITH retry budget left", async () => {
      // The branch-coverage case. `shouldRetryOnFail` is status-blind, so a
      // task with budget takes the *retry* branch and attempts
      // `cancelled → pending`, which is disallowed. An implementation that
      // threads the guard into only the hard-fail branch throws here and
      // passes every case above.
      await claimed({ id: "t", maxAttempts: 3 });
      await collection.cancel("t", "coordinator changed its mind");
      events.length = 0;

      await expect(
        collection.fail("t", "worker blew up", ADVISORY)
      ).resolves.toMatchObject({ outcome: "declined" });

      const task = collection.get("t");
      expect(task?.status).toBe("cancelled");
      expect(task?.error).toBe("coordinator changed its mind");
      expect(task?.feedback).toBeUndefined();
      expect(events).toHaveLength(0);
    });

    it("declines a fail onto a task the worker already completed itself", async () => {
      await claimed({ id: "t" });
      await collection.complete("t", "self-recorded output");
      events.length = 0;

      await collection.fail("t", "and then it threw", ADVISORY);

      const task = collection.get("t");
      expect(task?.status).toBe("completed");
      expect(task?.output).toBe("self-recorded output");
      expect(events).toHaveLength(0);
    });

    it("declines a second complete, keeping the output the worker recorded", async () => {
      // The same-status row. `completed → completed` is *legal* (the state
      // machine treats same-status as allowed) and terminal, so only the
      // terminal arm of the condition stops the incidental return value from
      // overwriting the output the worker explicitly recorded. A
      // disallowed-only condition passes every other case in this file and
      // fails here.
      await claimed({ id: "t" });
      await collection.complete("t", "self-recorded output");
      events.length = 0;

      await collection.complete("t", "incidental return value", ADVISORY);

      expect(collection.get("t")?.output).toBe("self-recorded output");
      expect(events).toHaveLength(0);
    });

    it("still writes on the normal path — an in_progress task settles as usual", async () => {
      // The control. The guard must not touch the case it is not for.
      await claimed({ id: "t" });
      events.length = 0;

      await collection.complete("t", "ok", ADVISORY);

      expect(collection.get("t")?.status).toBe("completed");
      expect(collection.get("t")?.output).toBe("ok");
      expect(events.at(-1)?.kind).toBe("completed");
    });

    it("still writes from awaiting_review — legal today, must stay legal", async () => {
      await claimed({ id: "t" });
      await collection.awaitReview("t", "needs a look");
      events.length = 0;

      await collection.fail("t", "reviewer rejected it", ADVISORY);

      expect(collection.get("t")?.status).toBe("errored");
      expect(events.at(-1)?.kind).toBe("errored");
    });

    it("declines rather than throws from pending and blocked", async () => {
      // Correction 3 on the filed issue: terminal statuses are the majority
      // of the exposure, not all of it. Both of these reach `errored`
      // illegally on the no-retry-budget branch.
      await claimed({ id: "p" });
      await collection.reclaim(Number.MAX_SAFE_INTEGER); // lease expiry → pending
      expect(collection.get("p")?.status).toBe("pending");
      await collection.fail("p", "stale worker", ADVISORY);
      expect(collection.get("p")?.status).toBe("pending");

      await collection.addTask({ id: "b", goal: "b" });
      await collection.block("b", "waiting on a human");
      await collection.fail("b", "stale worker", ADVISORY);
      expect(collection.get("b")?.status).toBe("blocked");
      expect(collection.get("b")?.error).toBe("waiting on a human");
    });

    it("does not suppress unrelated failures — a missing task still throws", async () => {
      // Advisory means enumerated, never blanket. Exactly one failure mode
      // becomes a no-op; a missing task is not it.
      await expect(collection.fail("nope", "boom", ADVISORY)).rejects.toThrow(
        /not found/
      );
      await expect(collection.complete("nope", "ok", ADVISORY)).rejects.toThrow(
        /not found/
      );
    });
  });

  describe("claim — ownership, not a matching counter", () => {
    it("declines a stale write after the task was reclaimed and re-claimed", async () => {
      // Worker A holds attempt 1. The lease expires, the task returns to
      // pending, worker B claims it (attempts → 2). A's late write-back is a
      // perfectly *legal* `in_progress → completed`, so `ifAllowed` waves it
      // through and only the ticket can stop it settling B's live work.
      const a = await claimed({ id: "t" });
      expect(a.attempts).toBe(1);
      await collection.reclaim(Number.MAX_SAFE_INTEGER);
      const b = await collection.claim("worker-2", { eligibility: (t) => t.id === "t" });
      expect(b?.attempts).toBe(2);
      events.length = 0;

      await collection.complete("t", "stale output", {
        ...ADVISORY,
        claim: ticket(a),
      });

      const task = collection.get("t");
      expect(task?.status).toBe("in_progress");
      expect(task?.output).toBeUndefined();
      expect(events).toHaveLength(0);

      // ...and the same for the failure write-back.
      await collection.fail("t", "stale error", {
        ...ADVISORY,
        claim: ticket(a),
      });
      expect(collection.get("t")?.status).toBe("in_progress");
      expect(events).toHaveLength(0);
    });

    it("declines a stale fail onto a reclaimed-and-parked task, never re-claimed", async () => {
      // The case that discriminates the two forms of the guard, and the
      // reason it binds to ownership rather than to `Task.attempts`.
      //
      // `reclaim()` does not advance `attempts`, so with no second claim the
      // displaced worker matches the counter by construction. With retry
      // budget the fail takes the *retry* branch to `pending`, and
      // `blocked → pending` is legal — so `ifAllowed` passes AND a
      // counter-only ticket passes, and the stale worker silently
      // unblocks work a coordinator deliberately parked.
      //
      // Both `maxAttempts` and the absence of a second claim are
      // load-bearing. Drop either and the case stops discriminating.
      const a = await claimed({ id: "t", maxAttempts: 3 });
      await collection.reclaim(Number.MAX_SAFE_INTEGER);
      await collection.block("t", "parked pending a decision");
      expect(collection.get("t")?.attempts).toBe(a.attempts); // counter unchanged
      events.length = 0;

      await collection.fail("t", "stale worker finally failed", {
        ...ADVISORY,
        claim: ticket(a),
      });

      const task = collection.get("t");
      expect(task?.status).toBe("blocked");
      expect(task?.error).toBe("parked pending a decision");
      expect(task?.feedback).toBeUndefined();
      expect(events).toHaveLength(0);
    });

    it("permits the write when the attempt still owns the task", async () => {
      const a = await claimed({ id: "t" });
      events.length = 0;

      await collection.complete("t", "ok", { ...ADVISORY, claim: ticket(a) });

      expect(collection.get("t")?.status).toBe("completed");
      expect(events.at(-1)?.kind).toBe("completed");
    });

    it("permits the write from awaiting_review, which an attempt also holds", async () => {
      const a = await claimed({ id: "t" });
      await collection.awaitReview("t");
      events.length = 0;

      await collection.fail("t", "rejected", { ...ADVISORY, claim: ticket(a) });

      expect(collection.get("t")?.status).toBe("errored");
    });

    it("is skipped entirely when no ticket is supplied", async () => {
      // The unguarded posture, asserted rather than assumed (BP-035, and the
      // coordinator contract). A caller with no claim — a coordinator, a
      // directly-wired consumer, a worker body checkpointed before the ticket
      // was stamped — must still record its result rather than declining every
      // write.
      await claimed({ id: "t" });
      await collection.complete("t", "ok", { ...ADVISORY, claim: undefined });
      expect(collection.get("t")?.status).toBe("completed");
    });

    it("declines a write to a task the caller does not hold, leaving it untouched", async () => {
      // THE defect. Two tasks, both freshly claimed, so both sit on attempt 1 —
      // which is the ordinary state of a board, not a contrivance. Before the
      // ticket, `a`'s token satisfied a write to `b` and settled a stranger's
      // live work.
      const a = await claimed({ id: "a" });
      const b = await claimed({ id: "b" });
      expect(a.attempts).toBe(b.attempts); // the collision is real
      events.length = 0;

      const outcome = await collection.complete("b", "written by a's holder", {
        ...ADVISORY,
        claim: ticket(a),
      });

      expect(outcome).toEqual({
        outcome: "declined",
        reason: "not-my-task",
        status: "in_progress",
      });
      // Asserting the payload, not just the status: a write that landed on the
      // wrong task still produces a plausible-looking `completed`, and only the
      // output says who wrote it.
      expect(collection.get("b")?.status).toBe("in_progress");
      expect(collection.get("b")?.output).toBeUndefined();
      expect(events).toHaveLength(0);

      // ...and `a` — the task the caller actually holds — still settles.
      expect(await collection.complete("a", "ok", { ...ADVISORY, claim: ticket(a) })).toEqual(
        { outcome: "recorded" },
      );
    });

    it("declines a ticket minted for a different board", async () => {
      const a = await claimed({ id: "a" });
      const foreign = { ...ticket(a), collectionId: "some-other-board" };

      expect(
        await collection.complete("a", "cross-board write", { ...ADVISORY, claim: foreign }),
      ).toMatchObject({ outcome: "declined", reason: "not-my-task" });
      expect(collection.get("a")?.status).toBe("in_progress");
    });

    // The ABA case — a stale ticket matching a task recreated under a recycled
    // id — is asserted at the predicate above, not here. `TaskCollectionRef`
    // exposes no `delete`, so it cannot be staged through this interface at
    // all; it is reachable only through the underlying resource collection and
    // capacity eviction. Staging it by reaching around the ref would test the
    // fixture rather than the contract.
  });

  /**
   * The four parking/review transitions had no options parameter at all before
   * FIX-981, so nothing a worker did through them could be guarded. `cancel`
   * had one but hard-coded it and dropped the caller's.
   *
   * Tested as a group because the failure mode is partial coverage: "claim and
   * settlement" is the phrasing this substrate has already been burned by, and
   * a fix applied to `complete`/`fail` alone passes every test above.
   */
  describe("every worker-callable transition honours the ticket", () => {
    it("refuses a cross-task write on each of the five, writing nothing", async () => {
      const a = await claimed({ id: "a" });
      const stranger = { ...ADVISORY, claim: ticket(a) };

      // Three targets, each parked in a status the write in question is legal
      // from, so no refusal below can be produced by `ifAllowed` standing in
      // for the ownership arm.
      await claimed({ id: "b" }); // in_progress
      await collection.addTask({ id: "c", goal: "c" });
      await collection.block("c", "parked by a coordinator"); // pending → blocked
      await claimed({ id: "d" });
      await collection.awaitReview("d", "queued for review"); // → awaiting_review

      expect(await collection.awaitReview("b", "not yours", stranger)).toMatchObject({
        outcome: "declined",
        reason: "not-my-task",
      });
      expect(await collection.cancel("b", "not yours", stranger)).toMatchObject({
        outcome: "declined",
        reason: "not-my-task",
      });
      // `block` from `in_progress` is ALSO illegal, so this one pins the
      // ordering as well as the coverage: it must report `not-my-task`, not
      // `disallowed`.
      expect(await collection.block("b", "not yours", stranger)).toMatchObject({
        outcome: "declined",
        reason: "not-my-task",
      });
      expect(collection.get("b")?.status).toBe("in_progress");
      expect(collection.get("b")?.error).toBeUndefined();

      expect(await collection.unblock("c", stranger)).toMatchObject({
        outcome: "declined",
        reason: "not-my-task",
      });
      expect(collection.get("c")?.status).toBe("blocked");
      expect(collection.get("c")?.error).toBe("parked by a coordinator");

      expect(await collection.resumeFromReview("d", "not yours", stranger)).toMatchObject({
        outcome: "declined",
        reason: "not-my-task",
      });
      expect(collection.get("d")?.status).toBe("awaiting_review");
    });

    it("permits the five for the task's own holder", async () => {
      // The control. A guard that refused everything would pass the case above.
      const t = await claimed({ id: "t" });
      const own = { ...ADVISORY, claim: ticket(t) };

      expect(await collection.awaitReview("t", "look at this", own)).toEqual({
        outcome: "recorded",
      });
      expect(collection.get("t")?.status).toBe("awaiting_review");
      expect(await collection.resumeFromReview("t", "looks fine", own)).toEqual({
        outcome: "recorded",
      });
      expect(collection.get("t")?.status).toBe("pending");

      const u = await claimed({ id: "u" });
      expect(await collection.cancel("u", "no longer needed", { claim: ticket(u) })).toEqual({
        outcome: "recorded",
      });
      expect(collection.get("u")?.status).toBe("cancelled");
    });

    it("keeps cancel advisory by construction even when a caller passes options", async () => {
      // `ifAllowed` is forced on AFTER the caller's options are spread. A
      // caller cannot switch off the terminal arm and clobber a settlement.
      await claimed({ id: "t" });
      await collection.complete("t", "worker output");
      const before = JSON.stringify(collection.get("t"));

      expect(
        await collection.cancel("t", "too late", { ifAllowed: false } as never),
      ).toMatchObject({ outcome: "declined", reason: "terminal" });
      expect(JSON.stringify(collection.get("t"))).toBe(before);
    });
  });

  describe("the widened flag's own regressions", () => {
    it("cancel on an already-cancelled task keeps the first cancel's reason", async () => {
      // `cancelled → cancelled` is legal *and* terminal. The existing suite
      // reaches terminal via `complete()`, so this path is untested there and
      // a green run proves nothing about it. Without the terminal arm the
      // fix would regress the one method that was already correct.
      await collection.addTask({ id: "t", goal: "t" });
      await collection.cancel("t", "first reason");
      setNow(9999);
      events.length = 0;

      await collection.cancel("t", "second reason");

      const task = collection.get("t");
      expect(task?.error).toBe("first reason");
      expect(task?.updatedAt).toBe(1000);
      expect(events).toHaveLength(0);
    });

    it("cancel still works on a non-terminal task", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      await collection.cancel("t", "user cancelled");
      expect(collection.get("t")?.status).toBe("cancelled");
      expect(events.at(-1)?.kind).toBe("cancelled");
    });
  });

  // -------------------------------------------------------------------------
  // The write verdict (FIX-976)
  // -------------------------------------------------------------------------

  /** Settle `t` into each terminal status, from a fresh task each time. */
  async function settledInto(status: "completed" | "errored" | "cancelled") {
    if (status === "cancelled") {
      await collection.addTask({ id: "t", goal: "t" });
      await collection.cancel("t", "no longer needed");
      return;
    }
    await claimed({ id: "t" });
    if (status === "completed") await collection.complete("t", "done");
    else await collection.fail("t", "blew up");
  }

  describe("cancel reports what it did", () => {
    it("declines with reason terminal on a settled task, writing nothing", async () => {
      // The lie this issue is about: today this call answers `{ ok: true }` at
      // the tool boundary having written nothing at all.
      await claimed({ id: "t" });
      await collection.complete("t", "worker output");
      const before = JSON.stringify(collection.get("t"));
      events.length = 0;

      const outcome = await collection.cancel("t", "coordinator changed its mind");

      expect(outcome).toEqual({
        outcome: "declined",
        reason: "terminal",
        status: "completed",
      });
      // Byte-identical, not just same-status: the decline must not touch
      // `updatedAt`, `error`, or `completedAt` either.
      expect(JSON.stringify(collection.get("t"))).toBe(before);
      expect(events).toHaveLength(0);
    });

    it("reports terminal, not disallowed, when both conditions hold", async () => {
      // `completed → cancelled` is terminal AND disallowed. Precedence is fixed
      // so two callers cannot render two messages for one refusal.
      await settledInto("completed");
      const outcome = await collection.cancel("t", "too late");
      expect(outcome).toMatchObject({ outcome: "declined", reason: "terminal" });
    });

    it("reports recorded on a live task", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      const outcome = await collection.cancel("t", "user cancelled");
      expect(outcome).toEqual({ outcome: "recorded" });
      expect(events.at(-1)?.kind).toBe("cancelled");
    });
  });

  describe("setAssignee — the one guarded patch operation", () => {
    it.each(["completed", "errored", "cancelled"] as const)(
      "declines on a %s task and leaves the assignee unwritten",
      async (status) => {
        await settledInto(status);
        expect(collection.get("t")?.assignee).toBeUndefined();
        events.length = 0;

        const outcome = await collection.setAssignee("t", "backup-researcher");

        expect(outcome).toEqual({ outcome: "declined", reason: "terminal", status });
        expect(collection.get("t")?.assignee).toBeUndefined();
        expect(events).toHaveLength(0);
      },
    );

    it("records the write on a live task and emits a change item", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      events.length = 0;

      const outcome = await collection.setAssignee("t", "researcher");

      expect(outcome).toEqual({ outcome: "recorded" });
      expect(collection.get("t")?.assignee).toBe("researcher");
      expect(events.at(-1)?.kind).toBe("assignee_changed");
    });

    it("reports unchanged when the assignee already matches, emitting no task-change", async () => {
      // The variant that cannot be dropped: reporting this as `recorded` would
      // claim a write that did not happen, which is this issue's own defect.
      //
      // Deliberately asserts on `task-change` items ONLY. The resource backing
      // still runs `updateState` for the no-op and still emits a
      // `resource_change`; that is documented, preserved behaviour, and a test
      // asserting its absence would pin a wish rather than the contract.
      await collection.addTask({ id: "t", goal: "t", assignee: "researcher" });
      const before = JSON.stringify(collection.get("t"));
      events.length = 0;

      const outcome = await collection.setAssignee("t", "researcher");

      expect(outcome).toEqual({ outcome: "unchanged" });
      expect(JSON.stringify(collection.get("t"))).toBe(before);
      expect(events).toHaveLength(0);
    });
  });

  /**
   * The A1 regression bar. The guard is per-operation, never on the shared patch
   * helper — a helper-wide guard would pass every `setAssignee` case above and
   * silently break the supervisor's failure-category audit and
   * `cascadeSkipDependents`' `skipped` label, both of which write to tasks that
   * are unambiguously terminal.
   */
  describe("the four sibling patch methods stay writable on a terminal task", () => {
    it.each(["completed", "errored", "cancelled"] as const)(
      "addLabel records on a %s task and writes the label",
      async (status) => {
        await settledInto(status);
        events.length = 0;

        const outcome = await collection.addLabel("t", "worker-error");

        expect(outcome).toEqual({ outcome: "recorded" });
        expect(collection.get("t")?.labels).toEqual(["worker-error"]);
        expect(events.at(-1)?.kind).toBe("label_changed");
      },
    );

    it("removeLabel records on a terminal task", async () => {
      await collection.addTask({ id: "t", goal: "t", labels: ["stale"] });
      await collection.cancel("t", "dropped");

      const outcome = await collection.removeLabel("t", "stale");

      expect(outcome).toEqual({ outcome: "recorded" });
      expect(collection.get("t")?.labels).toEqual([]);
    });

    it("setPriority records on a terminal task", async () => {
      await settledInto("errored");

      const outcome = await collection.setPriority("t", 9);

      expect(outcome).toEqual({ outcome: "recorded" });
      expect(collection.get("t")?.priority).toBe(9);
    });

    it("patchMetadata records on a terminal task", async () => {
      await settledInto("completed");

      const outcome = await collection.patchMetadata("t", { audited: true });

      expect(outcome).toEqual({ outcome: "recorded" });
      expect(collection.get("t")?.metadata).toEqual({ audited: true });
    });

    it("reports unchanged for an idempotent sibling write", async () => {
      await collection.addTask({ id: "t", goal: "t", labels: ["dup"], priority: 3 });
      expect(await collection.addLabel("t", "dup")).toEqual({ outcome: "unchanged" });
      expect(await collection.removeLabel("t", "absent")).toEqual({ outcome: "unchanged" });
      expect(await collection.setPriority("t", 3)).toEqual({ outcome: "unchanged" });
    });

    it("still throws on a missing task — a decline is not a blanket suppressor", async () => {
      await expect(collection.setAssignee("nope", "w")).rejects.toThrow(/not found/);
      await expect(collection.addLabel("nope", "l")).rejects.toThrow(/not found/);
    });
  });

  /**
   * `complete` / `fail` report their advisory decline too. FIX-976 never calls
   * these — its tools reach `setAssignee` and `cancel` — so this is the
   * epic-coherence half. It is also the only place `disallowed` and `lost-claim`
   * become observable through a public method, since `cancelled` is a legal
   * target from every non-terminal status.
   *
   * The decline itself stays SILENT: nothing written, no change item. Only the
   * return value is new.
   */
  describe("complete / fail report their advisory decline", () => {
    it("declines a complete onto a settled task with reason terminal, still silently", async () => {
      await claimed({ id: "t" });
      await collection.cancel("t", "coordinator changed its mind");
      events.length = 0;

      const outcome = await collection.complete("t", "worker finished anyway", ADVISORY);

      expect(outcome).toEqual({
        outcome: "declined",
        reason: "terminal",
        status: "cancelled",
      });
      expect(collection.get("t")?.output).toBeUndefined();
      expect(events).toHaveLength(0);
    });

    it("declines a fail from pending with reason disallowed, not terminal", async () => {
      // The nonterminal illegal move. Reported as `disallowed` because it is not
      // about terminality at all — mis-attributing it would have a tool tell a
      // coordinator its live task is finished.
      await claimed({ id: "p" });
      await collection.reclaim(Number.MAX_SAFE_INTEGER); // lease expiry → pending
      expect(collection.get("p")?.status).toBe("pending");

      const outcome = await collection.fail("p", "stale worker", ADVISORY);

      expect(outcome).toEqual({ outcome: "declined", reason: "disallowed", status: "pending" });
      expect(collection.get("p")?.status).toBe("pending");
    });

    it("declines a fail from blocked with reason disallowed", async () => {
      await collection.addTask({ id: "b", goal: "b" });
      await collection.block("b", "waiting on a human");

      const outcome = await collection.fail("b", "stale worker", ADVISORY);

      expect(outcome).toEqual({ outcome: "declined", reason: "disallowed", status: "blocked" });
    });

    it("declines a stale write with reason lost-claim on a legal transition", async () => {
      // `in_progress → completed` is perfectly legal, so `ifAllowed` waves it
      // through and only the ticket stops it. The reason has to say so, or a
      // caller reads "terminal" about a task that is actively running.
      const a = await claimed({ id: "t" });
      await collection.reclaim(Number.MAX_SAFE_INTEGER);
      await collection.claim("worker-2", { eligibility: (t) => t.id === "t" });
      events.length = 0;

      const outcome = await collection.complete("t", "stale output", {
        ...ADVISORY,
        claim: ticket(a),
      });

      expect(outcome).toEqual({
        outcome: "declined",
        reason: "lost-claim",
        status: "in_progress",
      });
      expect(events).toHaveLength(0);
    });

    it("reports recorded on the normal path, from both fail branches", async () => {
      await claimed({ id: "hard" });
      expect(await collection.fail("hard", "no budget", ADVISORY)).toEqual({
        outcome: "recorded",
      });
      expect(collection.get("hard")?.status).toBe("errored");

      // The retry branch reports too — it is a different `transitionTo` call, and
      // threading the verdict into only the hard-fail branch would pass every
      // case that never sets `maxAttempts`.
      await claimed({ id: "soft", maxAttempts: 3 });
      expect(await collection.fail("soft", "flaky", ADVISORY)).toEqual({
        outcome: "recorded",
      });
      expect(collection.get("soft")?.status).toBe("pending");
      expect(collection.get("soft")?.feedback).toBe("flaky");
    });

    it("reports recorded from complete on a live task", async () => {
      await claimed({ id: "t" });
      expect(await collection.complete("t", "ok", ADVISORY)).toEqual({ outcome: "recorded" });
    });
  });
});

// ---------------------------------------------------------------------------
// The retry budget rides the same ordering contract (FIX-948)
// ---------------------------------------------------------------------------

/**
 * A declined `fail()` must record NOTHING — including the retry facts.
 *
 * The board's failure write-back passes both guards
 * (`{ ifAllowed: true, claim }`) precisely so a worker's failure
 * arriving after its lease was reclaimed, or after a newer attempt claimed the
 * task, is discarded. FIX-948 added two writes to that same path: a retry grant
 * and a denial marker. If either lands before the decline, a stale failure
 * **spends another task's retry allowance**, or marks the board
 * `retry-budget-exhausted` when nothing was ever refused.
 *
 * The assertion SET is the point, not the scenario. A test checking only the
 * task's status passes while the budget silently drains — which is the whole
 * failure mode — so all four invariants are asserted in one test: status, grant
 * count, denial flag, and the emitted event.
 */
describe("retry budget — a declined stale failure records nothing (FIX-948)", () => {
  /**
   * A board whose budget is either available or spent, plus a subject task whose
   * attempt has been displaced by a newer claim. The subject is left
   * `in_progress` under attempt 2 while the caller still holds attempt 1.
   */
  async function displacedAttempt(budget: "available" | "spent") {
    const captured = createCapturedChanges();
    const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({
      tasks: {},
    });
    const collection = createSequencerBackedTaskCollection({
      collectionId: "tasks",
      sequencer,
      maxTotalRetries: budget === "spent" ? 1 : 10,
      onChange: captured.onChange,
    });

    if (budget === "spent") {
      // Burn the single grant on an unrelated task, so the subject's failure
      // would be DENIED if the declined path wrote anything.
      await collection.addTask({ id: "spender", goal: "spender", maxAttempts: 5 });
      await collection.claim("w0", { eligibility: (t) => t.id === "spender" });
      await collection.fail("spender", "spend it");
    }

    await collection.addTask({ id: "subject", goal: "subject", maxAttempts: 5 });
    const first = await collection.claim("w1", { eligibility: (t) => t.id === "subject" });
    if (first === null) throw new Error("fixture failed to claim");
    // Displace it: reclaim the lease, then let a second worker claim it.
    await collection.reclaim(Number.MAX_SAFE_INTEGER);
    await collection.claim("w2", { eligibility: (t) => t.id === "subject" });

    captured.events.length = 0;
    return {
      collection,
      events: captured.events,
      staleClaim: ticketForClaim(collection.collectionId, first),
    };
  }

  for (const budget of ["available", "spent"] as const) {
    it(`writes no status, no grant, no denial and no event with the budget ${budget}`, async () => {
      const { collection, events, staleClaim } = await displacedAttempt(budget);
      const before = collection.get("subject");

      const outcome = await collection.fail("subject", "late failure from a displaced worker", {
        ifAllowed: true,
        claim: staleClaim,
      });

      expect(outcome).toEqual({
        outcome: "declined",
        reason: "lost-claim",
        status: "in_progress",
      });
      const after = collection.get("subject");
      // 1. status unchanged
      expect(after?.status).toBe("in_progress");
      expect(after?.status).toBe(before?.status);
      // 2. grant count unchanged  3. denial flag unset
      expect(after?.retryLedger).toEqual(before?.retryLedger);
      expect(after?.retryLedger?.granted ?? 0).toBe(0);
      expect(after?.retryLedger?.deniedByBudget ?? false).toBe(false);
      // 4. no task-change event emitted
      expect(events).toHaveLength(0);
    });
  }

  it("leaves the board's budget intact, so a legitimate later failure still retries", async () => {
    // The consequence the four invariants above exist to protect: a budget of 1
    // that a declined write silently consumed would settle this failure instead.
    const { collection, staleClaim } = await displacedAttempt("available");
    await collection.fail("subject", "stale", { ifAllowed: true, claim: staleClaim });

    await collection.addTask({ id: "later", goal: "later", maxAttempts: 5 });
    await collection.claim("w3", { eligibility: (t) => t.id === "later" });
    await collection.fail("later", "genuine failure");

    expect(collection.get("later")?.status).toBe("pending");
    expect(collection.get("later")?.retryLedger).toEqual({
      granted: 1,
      deniedByBudget: false,
    });
  });
});
