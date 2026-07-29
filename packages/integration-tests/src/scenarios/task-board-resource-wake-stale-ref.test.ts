/**
 * A resource-backed task board's `.waitForCondition` wake predicate reads a
 * ref that is resolved ONCE per drain invocation (`makeWorker`'s leading
 * `.tap`, cached in `cell.collection` — `packages/orchestration/src/task-
 * board/index.ts:692-753`) and reused for every subsequent predicate
 * evaluation, on the stated assumption that "the collection factory is
 * idempotent (same collectionId -> same ref)".
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
 * The CONTROL test proves the delay is specific to the resource-backed
 * mirror: the identical sibling-add pattern on a request-backed board wakes
 * in single-digit milliseconds.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { defineTaskCollection } from "@flow-state-dev/orchestration";
import {
  taskBoard,
  taskBoardStateSchema,
  taskWorkerInputSchema,
} from "@flow-state-dev/orchestration/task-board";
import { testFlow } from "@flow-state-dev/testing";
import { z } from "zod";

describe("task-board: resource-backed wait predicate reads a stale ref mirror", () => {
  it("a task added via a separately-resolved ref is claimed only after the full poll timeout, not promptly", async () => {
    const todos = defineTaskCollection({
      id: "wake-stale-todos",
      scope: "session",
      stateSchema: z.object({ topic: z.string() }),
    });

    const IDLE_POLL_MS = 5;
    const TIMEOUT_MS = Math.max(IDLE_POLL_MS * 100, 50); // mirrors production's own formula

    const processed: string[] = [];
    const worker = handler({
      name: "wake-stale-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ ok: z.string() }),
      execute: async (input) => {
        processed.push(input.goal);
        return { ok: input.goal };
      },
    }) as Parameters<typeof taskBoard>[0]["workers"];

    const board = taskBoard({
      name: "wake-stale-board",
      collection: todos,
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

    let addedAt: number | undefined;
    // Sibling handler: does NOT run under `board.drain`. It installs the
    // durable collection via `board.capability` and adds a task through a
    // SEPARATELY resolved ref — exactly the pattern
    // `task-board.test.ts`'s "sibling using board.capability resolves the
    // collection" case already proves is a supported, independent
    // resolution. Raced against the drain via `.stepAll` so the add lands
    // WHILE the (already-started) worker is mid-wait, not before it.
    const seedAfterStart = handler({
      name: "wake-stale-seed-after-start",
      inputSchema: z.unknown(),
      uses: [board.capability],
      execute: async (_input, ctx) => {
        // Give the worker time to run its first empty claim attempt and
        // install its `.waitForCondition` subscription before we add.
        await new Promise((r) => setTimeout(r, IDLE_POLL_MS * 4));
        addedAt = Date.now();
        await ctx.cap["wake-stale-board"].addTask({
          id: "late",
          goal: "late-task",
          input: { topic: "late" },
        });
      },
    });

    const flow = defineFlow({
      kind: "wake-stale-resource",
      actions: {
        run: {
          block: sequencer({
            name: "wake-stale-root",
            inputSchema: z.unknown(),
            stateSchema: taskBoardStateSchema,
          }).stepAll([board.drain, sequencer({ name: "wake-stale-seed-wrapper" }).step(seedAfterStart)]),
        },
      },
    })({ id: "default" });

    const start = Date.now();
    const result = await testFlow({
      flow,
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });
    const totalElapsedMs = Date.now() - start;

    expect(result.error).toBeUndefined();
    expect(processed).toEqual(["late-task"]);
    expect(addedAt).toBeDefined();
    const claimedAfterAddMs = totalElapsedMs - (addedAt! - start);

    // The claim (once it happens) obviously postdates the add — the
    // question is HOW LONG after. A working event-driven wake would claim
    // within a few ms of the add (see the CONTROL test below). If the wait
    // predicate's cached ref is blind to the new task, the worker can only
    // proceed once `.waitForCondition` resolves via ITS TIMEOUT, so the gap
    // should sit close to a full `TIMEOUT_MS`.
    expect(claimedAfterAddMs).toBeGreaterThan(TIMEOUT_MS * 0.6);
  });

  it("CONTROL: the identical sibling-add pattern on a request-backed board wakes promptly", async () => {
    // Same shape, same sibling pattern, only the backing differs — isolates
    // that the delay above is the resource ref's stale mirror, not
    // something inherent to a sibling adding a task mid-wait.
    const IDLE_POLL_MS = 5;
    const TIMEOUT_MS = Math.max(IDLE_POLL_MS * 100, 50);

    const processed: string[] = [];
    const worker = handler({
      name: "wake-control-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ ok: z.string() }),
      execute: async (input) => {
        processed.push(input.goal);
        return { ok: input.goal };
      },
    }) as Parameters<typeof taskBoard>[0]["workers"];

    const board = taskBoard({
      name: "wake-control-board",
      collection: { backing: "request", collectionId: "wake-control" },
      concurrency: 1,
      dispatcher: "fifo",
      workers: worker,
      onIdle: "wait",
      shouldExit: (c) => c.count({ status: ["completed"] }) > 0,
      idlePollMs: IDLE_POLL_MS,
      maxIterations: 20,
    });

    let addedAt: number | undefined;
    const seedAfterStart = handler({
      name: "wake-control-seed-after-start",
      inputSchema: z.unknown(),
      uses: [board.capability],
      execute: async (_input, ctx) => {
        await new Promise((r) => setTimeout(r, IDLE_POLL_MS * 4));
        addedAt = Date.now();
        await ctx.cap["wake-control-board"].addTask({ id: "late", goal: "late-task" });
      },
    });

    const flow = defineFlow({
      kind: "wake-control-request",
      actions: {
        run: {
          block: sequencer({
            name: "wake-control-root",
            inputSchema: z.unknown(),
            stateSchema: taskBoardStateSchema,
          }).stepAll([board.drain, sequencer({ name: "wake-control-seed-wrapper" }).step(seedAfterStart)]),
        },
      },
    })({ id: "default" });

    const start = Date.now();
    const result = await testFlow({
      flow,
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });
    const totalElapsedMs = Date.now() - start;

    expect(result.error).toBeUndefined();
    expect(processed).toEqual(["late-task"]);
    const claimedAfterAddMs = totalElapsedMs - (addedAt! - start);
    // Request-backed: no separate mirror, `cell.collection` reads live state
    // directly — the wake should be prompt, well under the poll timeout.
    expect(claimedAfterAddMs).toBeLessThan(TIMEOUT_MS * 0.5);
  });
});
