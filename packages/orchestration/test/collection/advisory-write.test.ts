/**
 * Advisory write-back guards on `complete` / `fail` (FIX-951), and the write
 * verdict every guarded path now reports (FIX-976).
 *
 * The substrate's own write-backs opt into `{ ifAllowed, expectAttempt }` so
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
 * `expectAttempt` asks whether the caller still owns the task, which is
 * often a *legal* transition and so invisible to the first guard.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  createSequencerBackedTaskCollection,
  createResourceBackedTaskCollection,
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
 * the contract and only two of the three reasons are reachable through a
 * verdict-returning method: `cancel`'s target is legal from every non-terminal
 * status, so `disallowed` and `lost-claim` come from `complete`/`fail`. Pinning
 * the predicate here keeps all three reasons and their order asserted
 * regardless of which methods are widened.
 */
describe("transitionDeclineReason — which condition fired", () => {
  const task = (status: TaskStatus, attempts = 1): Task =>
    ({
      id: "t",
      goal: "t",
      status,
      attempts,
      createdAt: 0,
      updatedAt: 0,
    }) as Task;

  it("returns undefined with no options, so an unguarded caller still throws downstream", () => {
    expect(transitionDeclineReason(task("pending"), "errored", undefined)).toBeUndefined();
  });

  it("reports terminal for a settled task", () => {
    for (const status of ["completed", "errored", "cancelled"] as const) {
      expect(transitionDeclineReason(task(status), "cancelled", ADVISORY)).toBe("terminal");
    }
  });

  it("reports disallowed for a NONTERMINAL illegal move", () => {
    // The reason a two-reason contract could not describe this surface: these
    // declines are live today and are not about terminality at all.
    expect(transitionDeclineReason(task("pending"), "errored", ADVISORY)).toBe("disallowed");
    expect(transitionDeclineReason(task("blocked"), "errored", ADVISORY)).toBe("disallowed");
  });

  it("reports lost-claim when the attempt no longer owns the task", () => {
    // Legal transition, matching counter, but the task is back to `pending` —
    // ownership is the counter AND the status.
    expect(
      transitionDeclineReason(task("pending"), "completed", { expectAttempt: 1 }),
    ).toBe("lost-claim");
  });

  it("reports terminal when terminal AND disallowed both hold — fixed precedence", () => {
    // `completed → errored` is both. Leaving the order undefined is what lets
    // two implementers emit two different messages for one refusal.
    expect(transitionDeclineReason(task("completed"), "errored", ADVISORY)).toBe("terminal");
  });

  it("reports terminal ahead of lost-claim when both guards would fire", () => {
    // attempts 2 vs expectAttempt 1, on a settled task.
    expect(
      transitionDeclineReason(task("completed", 2), "completed", {
        ...ADVISORY,
        expectAttempt: 1,
      }),
    ).toBe("terminal");
  });

  it("permits the write when neither guard fires", () => {
    expect(
      transitionDeclineReason(task("in_progress"), "completed", {
        ...ADVISORY,
        expectAttempt: 1,
      }),
    ).toBeUndefined();
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
});
