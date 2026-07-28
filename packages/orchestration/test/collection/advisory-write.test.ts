/**
 * Advisory write-back guards on `complete` / `fail` (FIX-951).
 *
 * The substrate's own write-backs opt into `{ ifAllowed, expectAttempt }` so
 * a result that arrives after its task was settled by someone else is
 * dropped instead of throwing. The throw is what used to escape the task
 * board's per-worker rescue and abandon every sibling task on the board.
 *
 * Parameterized over both backings, because they carry separately maintained
 * copies of the transition wrapper — a fix applied to one and not the other
 * is the failure mode this suite exists to catch.
 *
 * The guards answer different questions and are tested separately.
 * `ifAllowed` asks whether the state machine will take the move.
 * `expectAttempt` asks whether the caller still owns the task, which is
 * often a *legal* transition and so invisible to the first guard.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  createSequencerBackedTaskCollection,
  createResourceBackedTaskCollection,
  type TaskCollectionRef,
  type TaskChangeEvent,
} from "../../src/tasks";
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

      await expect(
        collection.fail("t", "worker blew up", ADVISORY)
      ).resolves.toBeUndefined();

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
      ).resolves.toBeUndefined();

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

  describe("expectAttempt — ownership, not a matching counter", () => {
    it("declines a stale write after the task was reclaimed and re-claimed", async () => {
      // Worker A holds attempt 1. The lease expires, the task returns to
      // pending, worker B claims it (attempts → 2). A's late write-back is a
      // perfectly *legal* `in_progress → completed`, so `ifAllowed` waves it
      // through and only `expectAttempt` can stop it settling B's live work.
      const a = await claimed({ id: "t" });
      expect(a.attempts).toBe(1);
      await collection.reclaim(Number.MAX_SAFE_INTEGER);
      const b = await collection.claim("worker-2", { eligibility: (t) => t.id === "t" });
      expect(b?.attempts).toBe(2);
      events.length = 0;

      await collection.complete("t", "stale output", {
        ...ADVISORY,
        expectAttempt: a.attempts,
      });

      const task = collection.get("t");
      expect(task?.status).toBe("in_progress");
      expect(task?.output).toBeUndefined();
      expect(events).toHaveLength(0);

      // ...and the same for the failure write-back.
      await collection.fail("t", "stale error", {
        ...ADVISORY,
        expectAttempt: a.attempts,
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
      // counter-only `expectAttempt` passes, and the stale worker silently
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
        expectAttempt: a.attempts,
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

      await collection.complete("t", "ok", { ...ADVISORY, expectAttempt: a.attempts });

      expect(collection.get("t")?.status).toBe("completed");
      expect(events.at(-1)?.kind).toBe("completed");
    });

    it("permits the write from awaiting_review, which an attempt also holds", async () => {
      const a = await claimed({ id: "t" });
      await collection.awaitReview("t");
      events.length = 0;

      await collection.fail("t", "rejected", { ...ADVISORY, expectAttempt: a.attempts });

      expect(collection.get("t")?.status).toBe("errored");
    });

    it("is skipped entirely when no attempt is supplied", async () => {
      // Back-compat path: a worker body checkpointed before the attempt was
      // stamped carries no value, and must still record its result rather
      // than declining every write.
      await claimed({ id: "t" });
      await collection.complete("t", "ok", { ...ADVISORY, expectAttempt: undefined });
      expect(collection.get("t")?.status).toBe("completed");
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
});
