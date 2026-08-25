/**
 * FIX-990 — a resource-backed task board wakes promptly when a task is added
 * through a separately resolved ref while a worker is mid-wait.
 *
 * The board's `.waitForCondition` wake predicate reads a ref resolved ONCE per
 * drain invocation (`makeWorker`'s leading `.tap`, cached in `cell.collection`
 * — `packages/orchestration/src/task-board/index.ts`) and reused for every
 * subsequent evaluation, on the stated assumption that resolving the
 * collection twice yields the same view of which tasks exist.
 *
 * That assumption did not hold for a resource-backed (durable)
 * `TaskCollectionRef`: `createResourceBackedTaskCollection` hydrated a
 * brand-new private sync mirror per call, so a task added through any other
 * resolution stayed invisible to a parked worker. The wake's `wakeOn` filter
 * still fired (the task-change item was real), but the predicate it
 * re-evaluated read the stale mirror and stayed false, so
 * `.waitForCondition` only ever resolved via its TIMEOUT — the event-driven
 * wake the pattern advertises was a no-op for this case and the board fell
 * back to its full poll interval every time. `claimStep` and `checkBoard`
 * re-resolve fresh on every call and were never affected.
 *
 * A durable collection's task set is now shared across every resolution taken
 * inside one request, so the cached ref sees a sibling's add synchronously.
 *
 * Lives here rather than only in `packages/orchestration` because it exercises
 * genuine concurrent `.stepAll` interleaving between the drain and a sibling's
 * separate resolution. The CONTROL case pins that the two boards behave the
 * same way: the identical race on a request-backed board has always woken in
 * single-digit milliseconds, and the durable board now matches it.
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

describe("task-board: resource-backed wait predicate reads a shared task set", () => {
  it("a task added via a separately-resolved ref is claimed promptly, not at the poll timeout", async () => {
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
    //     threshold below.
    //   - false pass (the more serious one): some OTHER unrelated latency
    //     could keep the wake fast enough to stay green even if the shared
    //     task set regressed.
    //
    // CORROBORATING EVIDENCE ONLY (FIX-990). Because of that second mode
    // this assertion is never the proof that the fix works. The primary,
    // mechanism-level guards carry no timing at all and live in
    // `packages/orchestration/test/collection/shared-task-set.test.ts`
    // (two resolutions agree) and
    // `packages/orchestration/test/task-board/durable-board-freshness.test.ts`
    // (the drain stays alive with work outstanding, and the worker's claim
    // attempts stay far below its iteration budget). If this file goes red,
    // read those first: they discriminate a real regression from a slow
    // runner, which this one cannot.
    //
    // Held at the CONTROL's own threshold below, so the durable board is
    // measured against the request-backed board rather than against a
    // number picked for it.
    expect(addToCompletionMs).toBeLessThan(TIMEOUT_MS * 0.5);
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
