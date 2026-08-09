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
import { createFakeSequencerState } from "../helpers";

type OnIdle = "wait" | "complete" | "complete-or-blocked";

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
    now: () => 1000,
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
