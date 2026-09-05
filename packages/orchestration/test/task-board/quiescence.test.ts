/**
 * The board's shared exit rule, and the wake test's fast path (FIX-990).
 *
 * `boardQuiescence` is the single definition of "does this board still have
 * work to wait on". Two consumers read it: the exit check
 * (`blocks/check-board.ts`), which maps a terminal verdict onto its exit
 * `reason`, and the worker's idle-wait predicate (`predicates.ts`), which adds
 * one disjunct of its own.
 *
 * The table below asserts what the consolidation actually guarantees — that
 * both consumers act on the *same verdict*. It deliberately does not assert
 * that wake and exit agree: they must not. A board with claimable pending work
 * is `continue` (the drain keeps going) *and* has to wake a sleeping worker, so
 * the claimable row's expectation is divergence. A test written the other way
 * would either fail on that row or pressure someone into deleting the fast
 * path, which would silently reintroduce the promptness defect and make the
 * test the cause of it.
 *
 * These are a DRY guard, not a bug guard: they pass before and after the
 * classifier was extracted. What they fail on is a second spelling of the exit
 * rule reappearing, or the wake test being reduced to the verdict alone.
 */
import { describe, expect, it } from "vitest";
import {
  createSequencerBackedTaskCollection,
  DEFAULT_LEASE_DURATION_MS,
  type TaskCollectionRef,
} from "../../src/tasks";
import { boardQuiescence, type BoardQuiescence } from "../../src/task-board/quiescence";
import { whenBoardClaimable } from "../../src/task-board/predicates";
import {
  handedOffTaskPredicate,
  type HandOffSeat,
} from "../../src/task-board/hand-off";
import { createFakeSequencerState } from "../helpers";

type OnIdle = "wait" | "complete" | "complete-or-blocked";

/**
 * The frozen clock every collection in this file is built on. The wake probe
 * reads it back off the collection (FIX-1005), which is what keeps `working`
 * reading as "a worker holds this" rather than as an expired lease.
 */
const BOARD_NOW = 1000;

/** A collection in one of the board states the classifier discriminates. */
async function collectionInState(
  state: "empty" | "claimable" | "working" | "parked" | "dep-blocked" | "settled"
): Promise<TaskCollectionRef> {
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({
    tasks: {},
  });
  const collection = createSequencerBackedTaskCollection({
    collectionId: "tasks",
    sequencer,
    now: () => BOARD_NOW,
  });

  switch (state) {
    case "empty":
      break;
    case "claimable":
      await collection.addTask({ id: "a", goal: "a" });
      break;
    case "working":
      await collection.addTask({ id: "a", goal: "a" });
      await collection.claim("w1");
      break;
    case "parked":
      await collection.addTask({ id: "a", goal: "a" });
      await collection.claim("w1");
      await collection.awaitReview("a");
      break;
    case "dep-blocked":
      // `pending` forever: its dep is errored, so it can never be claimed and
      // no worker is in flight. The state the `blocked` verdict exists for.
      await collection.addTask({ id: "dep", goal: "dep" });
      await collection.addTask({ id: "a", goal: "a", deps: ["dep"] });
      await collection.claim("w1");
      await collection.fail("dep", "boom");
      break;
    case "settled":
      await collection.addTask({ id: "a", goal: "a" });
      await collection.claim("w1");
      await collection.complete("a", null);
      break;
  }
  return collection;
}

interface Row {
  state: Parameters<typeof collectionInState>[0];
  onIdle: OnIdle;
  verdict: BoardQuiescence;
  /** What the worker's idle-wait predicate does with that verdict. */
  wakes: boolean;
  shouldExit?: (collection: TaskCollectionRef) => boolean;
}

const rows: Row[] = [
  // --- The row that pins the fast path. Verdict says keep draining; the wake
  // --- test still has to stir a sleeping worker, in every mode.
  { state: "claimable", onIdle: "complete", verdict: "continue", wakes: true },
  { state: "claimable", onIdle: "complete-or-blocked", verdict: "continue", wakes: true },
  { state: "claimable", onIdle: "wait", verdict: "continue", wakes: true },

  // --- Drained: every task terminal.
  { state: "settled", onIdle: "complete", verdict: "drained", wakes: true },
  { state: "settled", onIdle: "complete-or-blocked", verdict: "drained", wakes: true },
  { state: "empty", onIdle: "complete", verdict: "drained", wakes: true },
  { state: "empty", onIdle: "complete-or-blocked", verdict: "drained", wakes: true },

  // --- A sibling is working, or a task is parked for review: keep waiting,
  // --- and stay asleep. This is the abandonment-fix path for `parked`.
  { state: "working", onIdle: "complete", verdict: "continue", wakes: false },
  { state: "working", onIdle: "complete-or-blocked", verdict: "continue", wakes: false },
  { state: "parked", onIdle: "complete", verdict: "continue", wakes: false },
  { state: "parked", onIdle: "complete-or-blocked", verdict: "continue", wakes: false },

  // --- Dep-blocked: `complete-or-blocked` calls it, `complete` waits on an
  // --- external pump (its documented legacy behaviour).
  { state: "dep-blocked", onIdle: "complete-or-blocked", verdict: "blocked", wakes: true },
  { state: "dep-blocked", onIdle: "complete", verdict: "continue", wakes: false },

  // --- `wait` defers to the caller and never exits on drained-ness alone: a
  // --- fully drained wait-mode board that woke on drained-ness would spin.
  { state: "settled", onIdle: "wait", verdict: "continue", wakes: false },
  { state: "empty", onIdle: "wait", verdict: "continue", wakes: false },
  { state: "working", onIdle: "wait", verdict: "continue", wakes: false },
  {
    state: "working",
    onIdle: "wait",
    verdict: "exit",
    wakes: true,
    shouldExit: () => true,
  },
];

describe("boardQuiescence - both consumers read one verdict", () => {
  it.each(rows)(
    "$state / onIdle $onIdle -> $verdict (wake: $wakes)",
    async ({ state, onIdle, verdict, wakes, shouldExit }) => {
      const collection = await collectionInState(state);
      const options = {
        onIdle,
        ...(shouldExit !== undefined ? { shouldExit } : {}),
      };

      // The exit check acts on this verdict directly, using it as its `reason`.
      expect(boardQuiescence(collection, options)).toBe(verdict);
      // The wake test acts on the same verdict plus its claimable disjunct.
      expect(whenBoardClaimable(collection, options)([])).toBe(wakes);
    }
  );
});

describe("whenBoardClaimable - the promptness fast path", () => {
  it.each<OnIdle>(["complete", "complete-or-blocked", "wait"])(
    "wakes on newly claimable work in onIdle %s, where the verdict alone would not",
    async (onIdle) => {
      const collection = await collectionInState("claimable");
      const options = { onIdle, shouldExit: () => false };

      // The regression guard, stated as the two halves of the disjunction:
      // the classifier says keep draining, and the wake test still fires. Drop
      // the `hasClaimableTask` disjunct and this fails in all three modes.
      expect(boardQuiescence(collection, options)).toBe("continue");
      expect(whenBoardClaimable(collection, options)([])).toBe(true);
    }
  );

  it("does not wake for a pending task whose deps are unsatisfied", async () => {
    // The disjunct is `hasClaimableTask`, not `has any pending task` — a
    // dep-blocked pending task must not read as claimable and busy-wake a
    // worker that could do nothing with it.
    const collection = await collectionInState("dep-blocked");
    const options = { onIdle: "complete" as OnIdle };
    expect(boardQuiescence(collection, options)).toBe("continue");
    expect(whenBoardClaimable(collection, options)([])).toBe(false);
  });
});

/**
 * Build a board and drive each named row to a status (FIX-982).
 *
 * Claims are taken one row at a time through `eligibility` so a row's status is
 * a property of the spec rather than of dispatch order.
 */
async function boardWithRows(
  specs: {
    id: string;
    assignee?: string;
    /** Omitted leaves the row `pending`. */
    drive?: "claim" | "park";
  }[],
  /**
   * Where the collection's clock sits when the classifier reads it. Defaults to
   * the instant the rows were built, so every lease taken above is still live;
   * push it past a lease to model a worker that stopped renewing.
   */
  readAt: () => number = () => BOARD_NOW
): Promise<TaskCollectionRef> {
  let now = BOARD_NOW;
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({
    tasks: {},
  });
  const collection = createSequencerBackedTaskCollection({
    collectionId: "tasks",
    sequencer,
    now: () => now,
  });
  for (const spec of specs) {
    await collection.addTask({
      id: spec.id,
      goal: spec.id,
      ...(spec.assignee !== undefined ? { assignee: spec.assignee } : {}),
    });
  }
  for (const spec of specs) {
    if (spec.drive === undefined) continue;
    await collection.claim("w1", { eligibility: (task) => task.id === spec.id });
    if (spec.drive === "park") await collection.awaitReview(spec.id);
  }
  now = readAt();
  return collection;
}

/**
 * A clock far enough past every lease this file takes that no row can still be
 * held. `DEFAULT_LEASE_DURATION_MS` is the span the claim write stamps.
 */
const AFTER_EVERY_LEASE = () => BOARD_NOW + DEFAULT_LEASE_DURATION_MS + 1;

/**
 * A row handed to a child session must not hold its launching request open
 * (FIX-982).
 *
 * The bug these pin is a *non-event*: the drain claims the task, spawns the
 * child, and then keeps waiting on the row it just gave away, so the launching
 * request returns only once the background work finishes — the feature's whole
 * point, silently undone by the exit question.
 *
 * Every case asserts BOTH consumers, for the reason this file exists: the exit
 * check and the wake test drifted apart once already, and a hand-off honoured
 * by only one of them puts a worker to sleep on a board the other calls
 * drained.
 *
 * The inline control is the load-bearing half. `runsElsewhere` is `undefined`
 * for every board with no dispatcher seat, and an inline `in_progress`
 * row must still hold the drain open — get that wrong and every existing board
 * exits mid-flight.
 */
describe("boardQuiescence - work handed to a child session", () => {
  const onIdles: OnIdle[] = ["complete", "complete-or-blocked"];
  /** Stands in for a board whose only seat hands off. */
  const allHandedOff = () => true;

  it.each(onIdles)(
    "onIdle %s: an inline in-progress row still holds the drain open",
    async (onIdle) => {
      // The control. Same board, same row, no dispatcher seat — this is
      // the behaviour every board on the repo depends on.
      const collection = await boardWithRows([{ id: "a", drive: "claim" }]);
      const options = { onIdle };

      expect(boardQuiescence(collection, options)).toBe("continue");
      expect(whenBoardClaimable(collection, options)([])).toBe(false);
    }
  );

  it.each(onIdles)(
    "onIdle %s: the same row drains once it is running elsewhere",
    async (onIdle) => {
      const collection = await boardWithRows([{ id: "a", drive: "claim" }]);
      const options = { onIdle, runsElsewhere: allHandedOff };

      // The fix, stated against the control above: one declaration flips the
      // identical board state from "keep waiting" to "nothing left for me".
      expect(boardQuiescence(collection, options)).toBe("drained");
      // A drained board wakes the sleeper so it observes the drain and exits.
      expect(whenBoardClaimable(collection, options)([])).toBe(true);
    }
  );

  it.each(onIdles)(
    "onIdle %s: an inline sibling still holds a mixed board open",
    async (onIdle) => {
      // A registry board where one seat hands off and one does not. The
      // exclusion has to be per-row, not per-board.
      const collection = await boardWithRows([
        { id: "bg", assignee: "background", drive: "claim" },
        { id: "here", assignee: "inline", drive: "claim" },
      ]);
      const options = {
        onIdle,
        runsElsewhere: (task: { assignee?: string }) => task.assignee === "background",
      };

      expect(boardQuiescence(collection, options)).toBe("continue");
      expect(whenBoardClaimable(collection, options)([])).toBe(false);
    }
  );

  it.each(onIdles)(
    "onIdle %s: a pending handed-off row is still this drain's work to dispatch",
    async (onIdle) => {
      // The exclusion reaches `in_progress` only. A drain that dropped pending
      // handed-off rows would exit before dispatching them — the feature inverted
      // into a board that silently runs nothing.
      const collection = await boardWithRows([{ id: "a" }]);
      const options = { onIdle, runsElsewhere: allHandedOff };

      expect(boardQuiescence(collection, options)).toBe("continue");
      // ...and it is claimable, so a sleeping worker must be stirred to spawn it.
      expect(whenBoardClaimable(collection, options)([])).toBe(true);
    }
  );

  it("keeps a parked handed-off row holding the drain, and says so on purpose", async () => {
    // A documented bound, not an oversight: `parked` waits on an
    // external actor whichever way the row was dispatched, so it is left alone.
    // Pinned here so removing the limit is a deliberate edit to this line
    // rather than a silent widening of the exclusion.
    const collection = await boardWithRows([{ id: "a", drive: "park" }]);
    const options = { onIdle: "complete-or-blocked" as OnIdle, runsElsewhere: allHandedOff };

    expect(boardQuiescence(collection, options)).toBe("continue");
  });

  it.each(onIdles)(
    "onIdle %s: a handed-off row nobody is holding any more is this drain's work again",
    async (onIdle) => {
      // The exclusion is "running elsewhere", and `runsElsewhere` alone cannot
      // say that: it reads the board's declarations and the row's assignee, and
      // both are just as true of a row NOBODY is running. A claimant that died
      // between `claim()` and the child's first breath leaves exactly this row
      // — `in_progress`, handed-off assignee, no worker anywhere — and so does a
      // child that was accepted and then died.
      //
      // What it costs is the worker loop's exit: `claimTask` runs before
      // `checkBoard`, so a worker parked in `idleWait` when the deadline passes
      // wakes on the now-claimable row and hits `checkBoard` NEXT — which,
      // reading the row as still running elsewhere, ends the loop before it can
      // circle back and reclaim it. The board reports `drained` holding a
      // claimed row nothing will settle.
      //
      // No persisted "the hand-off was accepted" mark distinguishes those
      // states, whichever side of the spawn it is written on: before, and it is
      // present for a hand-off that never happened; after, and a crash between
      // acceptance and the write leaves it absent for one that did — and it
      // says nothing at all about a child that started and then died. The lease
      // is the fact that EXPIRES, so it is the one that can answer.
      const collection = await boardWithRows(
        [{ id: "a", drive: "claim" }],
        AFTER_EVERY_LEASE
      );
      const options = { onIdle, runsElsewhere: allHandedOff };

      expect(boardQuiescence(collection, options)).toBe("continue");
      // ...and it is reclaimable, so the sleeper must be stirred to take it —
      // which is also the drift guard. `hasClaimableTask` reads this same
      // lapsed lease, so a classifier that ignored it would wake a worker and
      // then tell it the board was drained.
      expect(whenBoardClaimable(collection, options)([])).toBe(true);
    }
  );

  it("does not report a handed-off board as blocked", async () => {
    // `blocked` means "nothing is producing state changes and nothing can be
    // claimed". A board whose only remaining row is running in a child session is
    // drained from this drain's side, and `drained` dominates — reporting
    // `blocked` would send `blocked-by-failures` for healthy background work.
    const collection = await boardWithRows([{ id: "a", drive: "claim" }]);

    expect(
      boardQuiescence(collection, {
        onIdle: "complete-or-blocked",
        runsElsewhere: allHandedOff,
      })
    ).toBe("drained");
  });
});

/**
 * How a board decides which of its rows a child session is running.
 *
 * Resolution has to mirror the child's own gate — a declared assignee, else
 * the floor — or the drain and the child disagree about which seat a row
 * belongs to.
 */
describe("handedOffTaskPredicate", () => {
  const seat = (name: string): HandOffSeat => ({
    name,
    label: `assignee:${name}`,
    dispatch: { type: "task", target: "t", session: "per-task" },
  });

  it("is absent for a board with no dispatcher seat", () => {
    // Absence is what keeps every existing board on the `count()` path — the
    // classifier's answer for them is bit-for-bit unchanged.
    expect(handedOffTaskPredicate([])).toBeUndefined();
  });

  it("separates a handed-off assignee from an inline one", () => {
    const predicate = handedOffTaskPredicate([seat("background")])!;
    expect(predicate({ assignee: "background" } as never)).toBe(true);
    expect(predicate({ assignee: "inline" } as never)).toBe(false);
  });

  it("never hands an undeclared assignee off — only a named seat can", () => {
    // The floor and the uniform seat cannot hand off (the board refuses a
    // dispatcher there), so an unrouted row is always this drain's.
    const predicate = handedOffTaskPredicate([seat("background")])!;
    expect(predicate({ assignee: "unknown" } as never)).toBe(false);
    expect(predicate({} as never)).toBe(false);
    expect(predicate({ assignee: "background" } as never)).toBe(true);
  });

  it("does not resolve an inherited Object.prototype member as a seat", () => {
    // `assignee` reaches the board from a model-facing tool, so a bare index
    // would route `"constructor"` at a declared seat that does not exist.
    const predicate = handedOffTaskPredicate([seat("background")])!;
    expect(predicate({ assignee: "constructor" } as never)).toBe(false);
  });
});
