/**
 * FIX-990 — a resource-backed task board's `.waitForCondition` wake predicate
 * reads a ref that is resolved ONCE per drain invocation (`makeWorker`'s
 * leading `.tap`, cached in `cell.collection` —
 * `packages/orchestration/src/task-board/index.ts:692-753`) and reused for
 * every subsequent predicate evaluation, on the stated assumption that "the
 * collection factory is idempotent (same collectionId -> same ref)".
 *
 * That assumption does not hold for a resource-backed (durable)
 * `TaskCollectionRef`: `createResourceBackedTaskCollection` hydrates a
 * brand-new sync mirror via one `await collection.list()` PER CALL, and its
 * own file header documents the tradeoff — "tasks created in the underlying
 * collection by *other* blocks after construction will not appear in this
 * ref's sync view." `claimStep` and `checkBoard` each re-resolve the
 * collection fresh on every call and are unaffected (proven already by
 * `packages/orchestration/test/task-board/task-board.test.ts`'s "re-resolves
 * per call" case) — only the wait predicate's cached `cell.collection` is
 * stale.
 *
 * Net effect: on a resource-backed board, a task added through a genuinely
 * separate resolution (the documented `board.capability` sibling pattern)
 * while a worker is mid-wait is NOT claimed promptly. The wake's `wakeOn`
 * filter still fires (the task-change item is real), but the predicate it
 * re-evaluates reads the stale mirror and stays false, so `.waitForCondition`
 * only ever resolves via its TIMEOUT. The "event-driven wake" the pattern is
 * documented to provide is defeated for exactly the case the file's own
 * caveat describes — it doesn't just make the read *late*, it makes the
 * event-driven path a no-op and the board falls back to its full poll
 * interval every time.
 *
 * Lives here rather than only in `packages/orchestration` because the
 * escape depends on genuine concurrent `.stepAll` interleaving between the
 * drain and a sibling's separate resolution — composition
 * `packages/orchestration/test/task-board/` does not exercise. That file's
 * "re-resolves per call" case proves `claimStep`/`checkBoard` are fine in
 * isolation; this scenario proves the wait predicate isn't, under real
 * concurrency.
 *
 * The CONTROL case proves the delay is specific to the resource-backed
 * mirror, not the sibling-add pattern itself: the identical race on a
 * request-backed board wakes in single-digit milliseconds.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { defineTaskCollection, type TaskWorker } from "@flow-state-dev/orchestration";
import {
  taskBoard,
  taskBoardStateSchema,
  taskWorkerInputSchema,
} from "@flow-state-dev/orchestration/task-board";
import { testFlow } from "@flow-state-dev/testing";
import { z } from "zod";

const IDLE_POLL_MS = 2;
const TIMEOUT_MS = Math.max(IDLE_POLL_MS * 100, 50); // mirrors production's own formula

function buildFlow(backing: "resource" | "request") {
  const boardName = `${backing}-wake-stale-ref-board`;
  const collectionId = `${backing}-wake-stale-ref`;

  const processed: string[] = [];
  const worker = handler({
    name: `${backing}-wake-stale-ref-worker`,
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ ok: z.string() }),
    execute: async (input) => {
      processed.push(input.goal);
      return { ok: input.goal };
    },
  }) as TaskWorker;

  const board = taskBoard({
    name: boardName,
    collection:
      backing === "resource"
        ? defineTaskCollection({ id: collectionId, scope: "session", stateSchema: z.object({ topic: z.string() }) })
        : { backing: "request", collectionId },
    concurrency: 1,
    dispatcher: "fifo",
    workers: worker,
    // No initial tasks — the worker finds nothing claimable on its very
    // first iteration and goes straight into `.waitForCondition`, caching
    // `cell.collection` at that moment, before the sibling add below.
    // `onIdle: "wait"` rather than the default: with zero initial tasks,
    // `complete-or-blocked` would see `inFlightCount === 0` and exit
    // `drained` immediately, before the sibling ever adds anything.
    onIdle: "wait",
    shouldExit: (c) => c.count({ status: ["completed"] }) > 0,
    idlePollMs: IDLE_POLL_MS,
    maxIterations: 20,
  });

  const addedAt: { value: number | undefined } = { value: undefined };
  // Sibling block: does NOT run under `board.drain`. It installs the
  // durable collection via `board.capability` and adds a task through a
  // SEPARATELY resolved ref — exactly the pattern
  // `task-board.test.ts`'s "sibling using board.capability resolves the
  // collection" case already proves is a supported, independent
  // resolution. Raced against the drain via `.stepAll` so the add lands
  // WHILE the (already-started) worker is mid-wait, not before it.
  const seedAfterStart = handler({
    name: `${backing}-wake-stale-ref-seed-after-start`,
    inputSchema: z.unknown(),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      // Give the worker time to run its first empty claim attempt and
      // install its `.waitForCondition` subscription before we add.
      await new Promise((r) => setTimeout(r, IDLE_POLL_MS * 4));
      addedAt.value = Date.now();
      await ctx.cap[boardName].addTask({
        id: "late",
        goal: "late-task",
        ...(backing === "resource" ? { input: { topic: "late" } } : {}),
      });
    },
  });

  const flow = defineFlow({
    kind: `${backing}-wake-stale-ref`,
    actions: {
      run: {
        block: sequencer({
          name: `${backing}-wake-stale-ref-root`,
          inputSchema: z.unknown(),
          stateSchema: taskBoardStateSchema,
        }).stepAll([board.drain, seedAfterStart]),
      },
    },
  })({ id: "default" });

  return { flow, processed, addedAt };
}

describe("task-board: resource-backed wait predicate reads a stale ref mirror", () => {
  it("a task added via a separately-resolved ref is claimed only after the full poll timeout, not promptly", async () => {
    const { flow, processed, addedAt } = buildFlow("resource");

    const result = await testFlow({
      flow,
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });

    expect(result.error).toBeUndefined();
    expect(processed).toEqual(["late-task"]);
    expect(addedAt.value).toBeDefined();
    // Measures add -> flow completion (not add -> claim specifically; the
    // claim is the last thing that happens before the drain's `shouldExit`
    // is satisfied and the whole `.stepAll` settles, so this is a tight
    // proxy for it, not an exact one).
    const addToCompletionMs = Date.now() - addedAt.value!;

    // Timing is a proxy here, not the mechanism itself, and that's a real
    // weakness — checked for a stronger alternative and didn't find one
    // reachable without touching production code:
    //   - `.waitForCondition` DOES resolve with a `{ timedOut: boolean }`
    //     that would settle this directly, but `makeWorker`'s idle-wait
    //     composition (`.tap(...).waitForCondition(...).map(() => ({
    //     claimed: false, ... }))`) erases it before the sequencer's own
    //     trace is recorded, and inline sequencer steps (`.tap` /
    //     `.waitForCondition` / `.map`) don't emit their own `block_trace`
    //     items independently of the named block that composes them
    //     (confirmed against `engine/src/execution/executeBlock.ts` and the
    //     actual item stream) — so `timedOut` never reaches the outside.
    //   - Counting claim attempts / checkBoard iterations doesn't
    //     discriminate this scenario either: a correct wake and a fallback
    //     to timeout both produce the exact same 2 claims / 2 checkBoard
    //     calls here (claim-fails, wait, claim-succeeds) — only the WAIT's
    //     internal resolution path differs, not anything externally
    //     visible on the item stream. (That technique does work for a
    //     genuine spin, where the iteration count itself is the tell — see
    //     the FIX-978 settlement's C2/C4 — it just doesn't apply to a
    //     single-event "did it wake or time out" question like this one.)
    //
    // So this stays a timing assertion, with both of its known failure
    // modes named rather than left implicit:
    //   - false failure: a contended CI runner could pause the process
    //     after `addedAt` long enough to push even a CORRECT wake over the
    //     control's threshold below.
    //   - false pass (the more serious one): once FIX-990 is fixed, some
    //     OTHER unrelated latency could keep this above its own threshold,
    //     so this test stays green when it should start failing. There is
    //     no mechanism-level backstop against that here.
    //
    // KNOWN DEFECT (FIX-990): this assertion characterizes the bug, not the
    // desired behavior — it will FAIL once FIX-990's fix lands and needs
    // inverting (to `toBeLessThan`) at that point. Don't "fix" this test by
    // itself if it starts failing; that's the signal the defect is closed.
    // If the direction changes, keep this comment's description of what
    // will change in sync with it.
    expect(addToCompletionMs).toBeGreaterThan(TIMEOUT_MS * 0.6);
  });

  it("CONTROL: the identical sibling-add pattern on a request-backed board wakes promptly", async () => {
    // Same shape, same sibling pattern, only the backing differs — isolates
    // that the delay above is the resource ref's stale mirror, not
    // something inherent to a sibling adding a task mid-wait.
    const { flow, processed, addedAt } = buildFlow("request");

    const result = await testFlow({
      flow,
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });

    expect(result.error).toBeUndefined();
    expect(processed).toEqual(["late-task"]);
    const addToCompletionMs = Date.now() - addedAt.value!;
    // Request-backed: no separate mirror, `cell.collection` reads live state
    // directly — the wake should be prompt, well under the poll timeout.
    // Same timing-as-proxy caveat as above applies (a contended CI runner
    // could in principle push this over the bound on a correct wake).
    expect(addToCompletionMs).toBeLessThan(TIMEOUT_MS * 0.5);
  });
});
