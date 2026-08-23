/**
 * What the board REPORTS when it stops, with a row parked for review
 * (FIX-1234 §9).
 *
 * The exclusion itself is a few lines. This is where the complexity is: what a
 * board says when the rows it has left are a mixture — some parked, some handed
 * off, some genuinely failed — and the fact that a parked row usually has
 * downstream tasks waiting on it, so the naive answer is "blocked by failures"
 * on a board where nothing failed.
 *
 * Three things are pinned here, and they fail in different ways:
 *
 * 1. **The ladder's order is the contract.** First match wins. A denied retry
 *    still reports the budget stopped the board even with a row parked, and a
 *    parked row never demotes an errored one.
 * 2. **Equivalence.** With no parked row anywhere, the reason is *identical* to
 *    the one the pre-FIX-1234 classifier produced. That is asserted against a
 *    local transcription of the old ladder rather than against remembered
 *    strings, so a reordering that changes an existing answer fails here.
 * 3. **The verdict is carried, not derived.** The reason comes from the exit
 *    decision this drain's own worker pool made, so the same collection, read
 *    at the same instant, reports two different things for two different
 *    pools. Nothing else in the suite can distinguish a carried verdict from a
 *    re-derived one.
 */
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import {
  createSequencerBackedTaskCollection,
  leaseLapsed,
  type Task,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createBoardMetaCompleted } from "../../src/task-board/blocks/board-meta";
import type { CheckBoardOutput } from "../../src/task-board";
import type { RunsElsewhere } from "../../src/task-board/shared";
import { createFakeSequencerState } from "../helpers";

let seq = 0;
function freshCollection(caps?: { maxTotalRetries?: number | null }): TaskCollectionRef {
  seq += 1;
  return createSequencerBackedTaskCollection({
    collectionId: `park-report-${seq}`,
    sequencer: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
    ...caps,
  });
}

/** The exit output a worker pool produces when it excused parked rows. */
const parkedExit: CheckBoardOutput[] = [
  { shouldContinue: false, reason: "drained", excusedParked: true },
];
/** The exit output of a pool that stopped for any other reason. */
const plainExit: CheckBoardOutput[] = [{ shouldContinue: false, reason: "drained" }];

/**
 * Run the board's completion block over `collection` through the real block
 * runner and return the `terminationReason` it emitted.
 *
 * `poolExits` stands in for the `forEach` result the composed drain hands this
 * block — one final `checkBoard` output per worker loop.
 */
async function reasonFor(
  collection: TaskCollectionRef,
  poolExits: unknown,
  runsElsewhere?: RunsElsewhere
): Promise<string> {
  const block = createBoardMetaCompleted({
    name: `park-report-meta-${seq}`,
    collection: async () => collection,
    collectionId: collection.collectionId,
    ...(runsElsewhere !== undefined ? { runsElsewhere } : {}),
  });
  const result = await testBlock(block, { input: poolExits });
  expect(result.error).toBeNull();
  type MetaItem = { type?: string; component?: string; data?: unknown };
  const meta = (result.items as MetaItem[]).find(
    (i) => i.type === "component" && i.component === "task-board-meta"
  );
  return (meta?.data as { terminationReason: string }).terminationReason;
}

/** Add a task and park it for review, the way an external reviewer does. */
async function park(collection: TaskCollectionRef, id: string): Promise<void> {
  await collection.addTask({ id, goal: id });
  await collection.claim("reviewer", { eligibility: (t) => t.id === id });
  await collection.awaitReview(id, "needs a human");
}

async function settle(
  collection: TaskCollectionRef,
  id: string,
  how: "completed" | "errored" | "cancelled" | "blocked"
): Promise<void> {
  await collection.addTask({ id, goal: id });
  if (how === "blocked") {
    await collection.block(id, "held");
    return;
  }
  if (how === "cancelled") {
    await collection.cancel(id, "not needed");
    return;
  }
  await collection.claim(`w-${id}`, { eligibility: (t) => t.id === id });
  if (how === "completed") await collection.complete(id, null);
  else await collection.fail(id, "boom");
}

/** A row claimed by a detached worker and still holding a live lease. */
async function handOff(
  collection: TaskCollectionRef,
  id: string
): Promise<RunsElsewhere> {
  await collection.addTask({ id, goal: id, assignee: "background" });
  await collection.claim("workstream", { eligibility: (t) => t.id === id });
  return (task: Task) => task.assignee === "background";
}

/**
 * The termination ladder as it stood *before* FIX-1234, transcribed.
 *
 * The equivalence property below is asserted against this rather than against
 * remembered strings, so "the new ladder reports what the old one did" is a
 * check the test performs rather than a claim the author makes.
 */
function legacyReason(collection: TaskCollectionRef, runsElsewhere?: RunsElsewhere): string {
  const all = collection.list();
  const now = collection.now();
  const anyDenied = all.some(
    (t) => (t as Task & { retryDeniedByBudget?: boolean }).retryDeniedByBudget === true
  );
  if (anyDenied) return "retry-budget-exhausted";
  const remaining = all.filter((t) => t.status !== "completed");
  if (remaining.length === 0) return "all-completed";
  const allHandedOff =
    remaining.length > 0 &&
    remaining.every(
      (t) =>
        runsElsewhere !== undefined &&
        t.status === "in_progress" &&
        runsElsewhere(t) &&
        !leaseLapsed(t, now)
    );
  return allHandedOff ? "handed-off" : "blocked-by-failures";
}

describe("termination ladder — the order is the contract (§9)", () => {
  it("rung 4: a parked row on an otherwise settled board reports the review exit", async () => {
    const collection = freshCollection();
    await settle(collection, "done", "completed");
    await park(collection, "ask");

    expect(await reasonFor(collection, parkedExit)).toBe("parked-for-review");
  });

  it("rung 3: an errored row is not demoted by a parked one", async () => {
    const collection = freshCollection();
    await park(collection, "ask");
    await settle(collection, "broke", "errored");

    expect(await reasonFor(collection, parkedExit)).toBe("blocked-by-failures");
  });

  it("rung 3: a cancelled row is not demoted by a parked one", async () => {
    const collection = freshCollection();
    await park(collection, "ask");
    await settle(collection, "dropped", "cancelled");

    expect(await reasonFor(collection, parkedExit)).toBe("blocked-by-failures");
  });

  it("rung 3: a row moved to `blocked` is an independent reason, and the review gate must not mask it", async () => {
    // WHY THIS TEST EXISTS, next to the equivalence test below — it looks
    // redundant and it is not. The equivalence test asserts identity *when no
    // parked row exists anywhere*, so a board that has one is outside its scope
    // by construction. The whole defect class here — a park masking another
    // reason the board stopped — lives in exactly the region the equivalence
    // test excludes, and no strengthening of it will reach in.
    const collection = freshCollection();
    await park(collection, "ask");
    await settle(collection, "held", "blocked");

    expect(await reasonFor(collection, parkedExit)).toBe("blocked-by-failures");
  });

  it("rung 1: a denied retry still reports the budget, even with a row parked", async () => {
    const collection = freshCollection({ maxTotalRetries: 0 });
    await park(collection, "ask");
    // A task that ASKED for retries (`maxAttempts`) and met a budget with none
    // left is what writes the persisted denial marker. A plain hard failure
    // does not, which is the distinction rung 1 rests on.
    await collection.addTask({ id: "flaky", goal: "flaky", maxAttempts: 5 });
    await collection.claim("w-flaky", { eligibility: (t) => t.id === "flaky" });
    await collection.fail("flaky", "boom");
    expect(collection.get("flaky")?.status).toBe("errored");

    expect(await reasonFor(collection, parkedExit)).toBe("retry-budget-exhausted");
  });

  it("rung 2: a board that finished everything says so, whatever its pool carried", async () => {
    // The sibling-worker case, and the reason it needs no exit latch: one
    // worker can decide the board is parked-only and exit while a resume wakes
    // a sibling that then finishes the task. The ladder is what keeps that
    // honest — rung 2 outranks the park rung, so a board that actually drained
    // reports `all-completed` and not a stale park claim.
    const collection = freshCollection();
    await settle(collection, "resumed-and-done", "completed");

    expect(await reasonFor(collection, parkedExit)).toBe("all-completed");
  });

  it("the park outranks the hand-off: a parked row alongside a handed-off one reports the park", async () => {
    // Both are released from this drain. The one a human owes an answer to is
    // what the operator needs to see.
    //
    // KEEP THIS PAIRING. It is the reason the "going nowhere" rung below asks
    // what will never run rather than what contributed to the exit. Under a
    // "the park was the sole cause" rule the hand-off also contributed, so the
    // reason would fall through to `handed-off` and the operator would lose the
    // fact that somebody is owed an answer. Any future attempt to simplify that
    // rung into a sole-cause guard fails here, which is the point.
    const collection = freshCollection();
    const runsElsewhere = await handOff(collection, "background-work");
    await park(collection, "ask");

    expect(await reasonFor(collection, parkedExit, runsElsewhere)).toBe(
      "parked-for-review"
    );
  });
});

describe("termination ladder — a review gate must not mask an unrelated stall", () => {
  it("reports the stall when a pending row's deps can never be satisfied", async () => {
    // The defect this rung exists for. The parked row and the stranded row are
    // unrelated: answering the review releases nothing, and the board is still
    // stuck afterwards. Reporting `parked-for-review` here tells an operator a
    // human is the reason the drain stopped, sends them to answer it, and
    // leaves them exactly where they started.
    //
    // Note that rung 3 cannot catch this. That rung reads *status*, and this
    // row's status is an ordinary `pending`; what is wrong with it is which
    // task it is waiting for.
    const collection = freshCollection();
    await park(collection, "ask");
    await collection.addTask({ id: "stranded", goal: "stranded", deps: ["ghost"] });

    expect(await reasonFor(collection, parkedExit)).toBe("blocked-by-failures");
  });

  it("reports the review when the stuck row is stuck ON the review", async () => {
    // The normative counterpart, and the case a careless fix breaks. This
    // pending row is also unclaimable right now — but it is unclaimable
    // *because* of the parked row, so the review is genuinely why the board
    // stopped and answering it releases the work.
    const collection = freshCollection();
    await park(collection, "ask");
    await collection.addTask({ id: "after", goal: "after", deps: ["ask"] });

    expect(await reasonFor(collection, parkedExit)).toBe("parked-for-review");
  });

  it("follows the chain: a row two hops behind the review is still the review's", async () => {
    // Why the rung is a reachability closure rather than a one-level check. A
    // one-level test sees `second`'s dependency unsatisfied and calls the board
    // stalled, on a board that needs nothing but an answer.
    const collection = freshCollection();
    await park(collection, "ask");
    await collection.addTask({ id: "first", goal: "first", deps: ["ask"] });
    await collection.addTask({ id: "second", goal: "second", deps: ["first"] });

    expect(await reasonFor(collection, parkedExit)).toBe("parked-for-review");
  });

  it("reports the stall when one row waits on the review and another waits on nothing reachable", async () => {
    // A board where both are true. The row that will never run outranks the one
    // an answer would release: the operator can act on a review, but they
    // cannot act on a stall they were never told about.
    const collection = freshCollection();
    await park(collection, "ask");
    await collection.addTask({ id: "after", goal: "after", deps: ["ask"] });
    await collection.addTask({ id: "stranded", goal: "stranded", deps: ["ghost"] });

    expect(await reasonFor(collection, parkedExit)).toBe("blocked-by-failures");
  });

  it("reports the stall on a dependency cycle, which no status makes visible", async () => {
    const collection = freshCollection();
    await park(collection, "ask");
    await collection.addTask({ id: "a", goal: "a", deps: ["b"] });
    await collection.addTask({ id: "b", goal: "b", deps: ["a"] });

    expect(await reasonFor(collection, parkedExit)).toBe("blocked-by-failures");
  });

  it("keeps the review reason for a row added after the pool classified", async () => {
    // A PIN, not a new behaviour — it passes before and after the rung existed,
    // and it is here so a future reader does not "fix" it.
    //
    // This is the one window where the pool's verdict and the rows genuinely
    // disagree: `excusedParked` was decided when nothing else was waitable, and
    // a ready row arrived before this block's fresh read. Reporting a stall here
    // would announce a failure on a board where nothing failed and the new row
    // is perfectly runnable.
    //
    // Reachable only through this seam, which is why the test uses it. With the
    // ready row present *at classification time* the classifier answers
    // `continue` and never issues a park verdict at all — see the reachability
    // note on `hasRowGoingNowhere`. Constructing the two halves separately is
    // what the window is, not a fake of it.
    const collection = freshCollection();
    await park(collection, "ask");
    await collection.addTask({ id: "late", goal: "arrived after the drain stopped" });

    expect(await reasonFor(collection, parkedExit)).toBe("parked-for-review");
  });

  it("does not fire on a handed-off row, which is going somewhere", async () => {
    // The separation the rung rests on: handed-off work is progressing
    // elsewhere, so a row waiting on it is waiting on something that moves.
    const collection = freshCollection();
    const runsElsewhere = await handOff(collection, "background-work");
    await park(collection, "ask");
    await collection.addTask({
      id: "after",
      goal: "after",
      deps: ["background-work"],
    });

    expect(await reasonFor(collection, parkedExit, runsElsewhere)).toBe(
      "parked-for-review"
    );
  });
});

describe("termination ladder — equivalence with the pre-FIX-1234 classifier", () => {
  /**
   * Every park-free board shape the ladder can reach. With no parked row
   * anywhere, rung 4 is inert and the ladder must be exactly what it was.
   */
  const shapes: Array<{
    name: string;
    build: (c: TaskCollectionRef) => Promise<RunsElsewhere | undefined>;
  }> = [
    {
      name: "empty board",
      build: async () => undefined,
    },
    {
      name: "everything completed",
      build: async (c) => {
        await settle(c, "a", "completed");
        await settle(c, "b", "completed");
        return undefined;
      },
    },
    {
      name: "one errored row",
      build: async (c) => {
        await settle(c, "a", "completed");
        await settle(c, "b", "errored");
        return undefined;
      },
    },
    {
      name: "one cancelled row",
      build: async (c) => {
        await settle(c, "b", "cancelled");
        return undefined;
      },
    },
    {
      name: "one row moved to blocked",
      build: async (c) => {
        await settle(c, "b", "blocked");
        return undefined;
      },
    },
    {
      name: "a stranded pending row",
      build: async (c) => {
        await c.addTask({ id: "waiting", goal: "waiting", deps: ["ghost"] });
        return undefined;
      },
    },
    {
      name: "a dependency cycle",
      build: async (c) => {
        await c.addTask({ id: "a", goal: "a", deps: ["b"] });
        await c.addTask({ id: "b", goal: "b", deps: ["a"] });
        return undefined;
      },
    },
    {
      name: "a claimable pending row the drain never got to",
      build: async (c) => {
        await c.addTask({ id: "ready", goal: "ready" });
        return undefined;
      },
    },
    {
      name: "every remaining row handed off",
      build: async (c) => handOff(c, "background-work"),
    },
    {
      name: "a handed-off row alongside an errored one",
      build: async (c) => {
        const runsElsewhere = await handOff(c, "background-work");
        await settle(c, "broke", "errored");
        return runsElsewhere;
      },
    },
    {
      name: "a handed-off row alongside a blocked one",
      build: async (c) => {
        const runsElsewhere = await handOff(c, "background-work");
        await settle(c, "held", "blocked");
        return runsElsewhere;
      },
    },
  ];

  for (const shape of shapes) {
    it(`reports what the old ladder reported: ${shape.name}`, async () => {
      const collection = freshCollection();
      const runsElsewhere = await shape.build(collection);
      // Nothing parked — the precondition this property is scoped to.
      expect(collection.count({ status: "awaiting_review" })).toBe(0);

      const expected = legacyReason(collection, runsElsewhere);
      // `plainExit` is the only pool output these boards can produce, and that
      // is the point rather than a convenience: a board on the default
      // `onReview` never sets the flag, and a board in `exit` mode with no
      // parked row never excuses one, so "no parked row anywhere" and "a pool
      // that carried a park verdict" cannot both be true. Feeding a park
      // verdict in here would assert on a state the system cannot reach — and
      // would assert the wrong thing, since rung 4 deliberately outranks the
      // hand-off and default rungs (§9's parked-plus-handed-off row, and its
      // resume-lands-in-the-window row).
      expect(await reasonFor(collection, plainExit, runsElsewhere)).toBe(expected);
    });
  }
});

describe("the exit verdict is carried from the drain that decided it", () => {
  it("reports two different reasons for one collection read at one instant", async () => {
    // The invocation-scope property, isolated. Same collection, same rows, same
    // moment: the only thing that differs is which pool's exit outputs this
    // invocation was handed. A verdict read from state shared between drains —
    // or re-derived from the rows — cannot produce two answers here, so this is
    // the assertion that distinguishes a carried verdict from every cheaper
    // implementation of the same feature.
    const collection = freshCollection();
    await park(collection, "ask");

    expect(await reasonFor(collection, parkedExit)).toBe("parked-for-review");
    expect(await reasonFor(collection, plainExit)).toBe("blocked-by-failures");
  });

  it("survives a resume landing between the pool finishing and the completion item", async () => {
    // Written as a flip. The naive implementation — infer the reason from the
    // rows as they stand now — passes the first assertion and fails the second,
    // because by then the parked row is `pending` again and reads as a stall.
    const collection = freshCollection();
    await park(collection, "ask");
    expect(await reasonFor(collection, parkedExit)).toBe("parked-for-review");

    await collection.resumeFromReview("ask", "approved");
    expect(collection.get("ask")?.status).toBe("pending");

    expect(await reasonFor(collection, parkedExit)).toBe("parked-for-review");
  });

  it("ignores a pool output that carries no park verdict, on a board with a parked row", async () => {
    // The other direction of the same property: the rows say "parked", the
    // drain says it stopped for another reason, and the drain wins. This is
    // what stops a board on the DEFAULT `onReview` — whose parked row was never
    // excused — from being relabelled by a reason derived from status alone.
    const collection = freshCollection();
    await park(collection, "ask");

    expect(await reasonFor(collection, plainExit)).toBe("blocked-by-failures");
  });

  it("takes the verdict from any worker in the pool, not only the first", async () => {
    const collection = freshCollection();
    await park(collection, "ask");

    const mixedPool: CheckBoardOutput[] = [
      { shouldContinue: false, reason: "drained" },
      { shouldContinue: false, reason: "drained" },
      { shouldContinue: false, reason: "drained", excusedParked: true },
    ];
    expect(await reasonFor(collection, mixedPool)).toBe("parked-for-review");
  });

  it("treats a non-pool input as carrying no verdict rather than failing", async () => {
    // `createBoardMetaCompleted` is exported and constructed directly by
    // callers outside the composed drain. Those hand it whatever their own
    // pipeline produced, and that has to mean "no park verdict" rather than a
    // validation error.
    const collection = freshCollection();
    await park(collection, "ask");

    expect(await reasonFor(collection, undefined)).toBe("blocked-by-failures");
    expect(await reasonFor(collection, { shouldContinue: false })).toBe(
      "blocked-by-failures"
    );
  });
});
