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
  type TaskCollectionRef,
} from "../../src/tasks";
import { boardQuiescence, type BoardQuiescence } from "../../src/task-board/quiescence";
import { whenBoardClaimable } from "../../src/task-board/predicates";
import { detachedTaskPredicate } from "../../src/task-board/detached";
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
  }[]
): Promise<TaskCollectionRef> {
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({
    tasks: {},
  });
  const collection = createSequencerBackedTaskCollection({
    collectionId: "tasks",
    sequencer,
    now: () => BOARD_NOW,
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
  return collection;
}

/**
 * A row handed to a Workstream must not hold its launching request open
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
 * for every board that declares nothing detached, and an inline `in_progress`
 * row must still hold the drain open — get that wrong and every existing board
 * exits mid-flight.
 */
describe("boardQuiescence - work handed to a Workstream", () => {
  const onIdles: OnIdle[] = ["complete", "complete-or-blocked"];
  /** Stands in for a board whose only worker is detached. */
  const allDetached = () => true;

  it.each(onIdles)(
    "onIdle %s: an inline in-progress row still holds the drain open",
    async (onIdle) => {
      // The control. Same board, same row, no detached declaration — this is
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
      const options = { onIdle, runsElsewhere: allDetached };

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
      // A registry board where one coordinate detached and one did not. The
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
    "onIdle %s: a pending detached row is still this drain's work to dispatch",
    async (onIdle) => {
      // The exclusion reaches `in_progress` only. A drain that dropped pending
      // detached rows would exit before spawning them — the feature inverted
      // into a board that silently runs nothing.
      const collection = await boardWithRows([{ id: "a" }]);
      const options = { onIdle, runsElsewhere: allDetached };

      expect(boardQuiescence(collection, options)).toBe("continue");
      // ...and it is claimable, so a sleeping worker must be stirred to spawn it.
      expect(whenBoardClaimable(collection, options)([])).toBe(true);
    }
  );

  it("keeps a parked detached row holding the drain, and says so on purpose", async () => {
    // A documented bound, not an oversight: `awaiting_review` waits on an
    // external actor whichever way the row was dispatched, so it is left alone.
    // Pinned here so removing the limit is a deliberate edit to this line
    // rather than a silent widening of the exclusion.
    const collection = await boardWithRows([{ id: "a", drive: "park" }]);
    const options = { onIdle: "complete-or-blocked" as OnIdle, runsElsewhere: allDetached };

    expect(boardQuiescence(collection, options)).toBe("continue");
  });

  it("does not report a handed-off board as blocked", async () => {
    // `blocked` means "nothing is producing state changes and nothing can be
    // claimed". A board whose only remaining row is running in a Workstream is
    // drained from this drain's side, and `drained` dominates — reporting
    // `blocked` would send `blocked-by-failures` for healthy background work.
    const collection = await boardWithRows([{ id: "a", drive: "claim" }]);

    expect(
      boardQuiescence(collection, {
        onIdle: "complete-or-blocked",
        runsElsewhere: allDetached,
      })
    ).toBe("drained");
  });
});

/**
 * How a board decides which of its rows a Workstream is running (FIX-982).
 *
 * Resolution has to mirror the detached runner's own `coordinateForTask` —
 * uniform, then a declared assignee, then the floor — or the drain and the
 * Workstream disagree about which worker a row belongs to.
 */
describe("detachedTaskPredicate", () => {
  const slot = (
    coordinate: { kind: "uniform" } | { kind: "floor" } | { kind: "assignee"; name: string },
    detached: boolean
  ) =>
    ({ coordinate, detached, label: "", worker: {} }) as unknown as Parameters<
      typeof detachedTaskPredicate
    >[0][number];

  it("is absent for a board that declares nothing detached", () => {
    // Absence is what keeps every existing board on the `count()` path — the
    // classifier's answer for them is bit-for-bit unchanged.
    expect(detachedTaskPredicate([slot({ kind: "uniform" }, false)])).toBeUndefined();
  });

  it("covers every row on a detached uniform board", () => {
    const predicate = detachedTaskPredicate([slot({ kind: "uniform" }, true)])!;
    expect(predicate({ assignee: "anything" } as never)).toBe(true);
    expect(predicate({} as never)).toBe(true);
  });

  it("separates a detached assignee from an inline one", () => {
    const predicate = detachedTaskPredicate([
      slot({ kind: "assignee", name: "background" }, true),
      slot({ kind: "assignee", name: "inline" }, false),
    ])!;
    expect(predicate({ assignee: "background" } as never)).toBe(true);
    expect(predicate({ assignee: "inline" } as never)).toBe(false);
  });

  it("sends an undeclared assignee to the floor, and reads the floor's own mode", () => {
    const detachedFloor = detachedTaskPredicate([
      slot({ kind: "assignee", name: "inline" }, false),
      slot({ kind: "floor" }, true),
    ])!;
    expect(detachedFloor({ assignee: "unknown" } as never)).toBe(true);
    expect(detachedFloor({ assignee: "inline" } as never)).toBe(false);

    // The floor is defined by the assignees it is NOT, so the predicate has to
    // see the inline registry entries too. Built from the detached slots alone,
    // "inline" would read as unrouted and fall to a detached floor.
    const inlineFloor = detachedTaskPredicate([
      slot({ kind: "assignee", name: "background" }, true),
      slot({ kind: "floor" }, false),
    ])!;
    expect(inlineFloor({ assignee: "unknown" } as never)).toBe(false);
    expect(inlineFloor({ assignee: "background" } as never)).toBe(true);
  });

  it("does not resolve an inherited Object.prototype member as a worker", () => {
    // `assignee` reaches the board from a model-facing tool, so a bare index
    // would route `"constructor"` at a declared worker that does not exist.
    const predicate = detachedTaskPredicate([
      slot({ kind: "assignee", name: "background" }, true),
      slot({ kind: "floor" }, false),
    ])!;
    expect(predicate({ assignee: "constructor" } as never)).toBe(false);
  });
});
