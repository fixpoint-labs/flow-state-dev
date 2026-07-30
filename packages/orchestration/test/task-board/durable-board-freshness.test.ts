/**
 * Durable task board: same-request freshness, at board level (FIX-990).
 *
 * A worker that finds nothing to claim parks in `.waitForCondition`, and the
 * predicate it re-evaluates on every wake reads a collection ref resolved
 * once, on entering that wait. When that ref held a private view of which
 * tasks exist, a task added afterwards through another resolution stayed
 * invisible to it, and the consequence was worse than a late read:
 *
 *   - the stale view reports "nothing in flight", so the wait returns
 *     immediately instead of sleeping;
 *   - the exit check re-resolves fresh, correctly says "keep going", so the
 *     worker loops straight back into the wait;
 *   - the loop burns its whole `maxIterations` budget in milliseconds and then
 *     stops iterating **silently** — budget exhaustion emits nothing;
 *   - with no worker left, the drain ends while a task is still outstanding.
 *
 * The two regressions here share one scenario and assert behaviour, not
 * latency: a task reaching the worker, a drain still alive at a known point,
 * and a claim-attempt count. The end-to-end latency guard in
 * `packages/integration-tests/src/scenarios/task-board-resource-wake-stale-ref.test.ts`
 * documents its own false-pass mode and corroborates these; it does not stand
 * in for them.
 */
import { describe, expect, it } from "vitest";
import { defineResourceCollection, handler, sequencer } from "@flow-state-dev/core";
import type { JsonObject } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  defineTaskCollection,
  fifoDispatcher,
  getOrCreateTaskCollection,
  type Task,
  type TaskCollectionRef,
  type TaskDispatcher,
  type TaskWorker,
} from "../../src/tasks";
import {
  taskBoard,
  taskBoardStateSchema,
  taskWorkerInputSchema,
} from "../../src/task-board";

const IDLE_POLL_MS = 2;
const MAX_ITERATIONS = 20;

/** Resolve after `ms` — spaces the actor's handshake steps below. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `fifo`, wrapped to count claim attempts. The spin this file guards against
 * emits nothing on the item stream (an exhausted iteration budget is silent),
 * so the attempt count is the direct measurement of it.
 *
 * Counted in total rather than per worker: the `workerId` the dispatcher
 * receives is the claim block's `blockInstanceId`, which is fresh on every
 * loop iteration (it exists for trace attribution, not identity). The board
 * below runs `concurrency: 1`, so the total *is* that one worker's count.
 */
function countingDispatcher(attempts: { total: number }): TaskDispatcher {
  return {
    async claim(collection, workerId, ctx): Promise<Task | null> {
      attempts.total += 1;
      return fifoDispatcher.claim(collection, workerId, ctx);
    },
  };
}

/**
 * Build the scenario.
 *
 * The board starts with one task whose dep will never exist, so it is
 * `pending` but never claimable: the single worker's first claim comes back
 * empty and it parks in the wait, taking its view of the task set right then.
 * `onIdle: "complete"` is the mode that keeps such a board alive — the
 * default `complete-or-blocked` would (correctly) exit `blocked` on a board
 * whose only task is dep-blocked, before any of this could play out.
 *
 * The external actor then, in order:
 *
 *   1. adds a task, claims it, and parks it in `awaiting_review`. Neither
 *      world races the board's worker for it: in `complete` mode the wake
 *      predicate needs `inFlightCount === 0`, and both the stale view (which
 *      still holds `unreachable` as pending) and the shared view keep that
 *      false, so the worker does not stir.
 *   2. cancels the dep-blocked task. That task *is* in the worker's own view
 *      and its state is read live, so the view now reads all-terminal. This is
 *      the moment a private view says "drained" while the board really holds
 *      an outstanding, unclaimable task.
 *   3. records whether the drain has already finished, then resumes the parked
 *      task so a live board can finish it.
 *
 * Only step 1 is ordered by a delay (the worker's first claim has to come
 * first, and `claimedByActor` below fails loudly if it didn't). Everything
 * after is ordered by the actor's own awaits, and the "still alive" reading
 * comes from the drain's own completion tap rather than a clock.
 */
function buildScenario() {
  const boardName = "durable-freshness-board";
  const processed: string[] = [];
  const attempts = { total: 0 };
  const observed = {
    claimedByActor: undefined as string | null | undefined,
    drainDoneBeforeResume: undefined as boolean | undefined,
  };
  const drain = { done: false };

  const worker = handler({
    name: `${boardName}-worker`,
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ ok: z.string() }),
    execute: (input) => {
      processed.push(input.goal);
      return { ok: input.goal };
    },
  }) as TaskWorker;

  const board = taskBoard({
    name: boardName,
    collection: defineTaskCollection({
      id: "durable-freshness",
      scope: "session",
      stateSchema: z.object({ topic: z.string() }),
    }),
    concurrency: 1,
    dispatcher: countingDispatcher(attempts),
    workers: worker,
    initialTasks: [
      { id: "unreachable", goal: "unreachable", deps: ["ghost"], input: { topic: "u" } },
    ],
    onIdle: "complete",
    idlePollMs: IDLE_POLL_MS,
    maxIterations: MAX_ITERATIONS,
  });

  const actor = handler({
    name: `${boardName}-actor`,
    inputSchema: z.unknown(),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      // Let the worker run its first (empty) claim and park in the wait, so
      // what follows lands after it took its view of the task set.
      await delay(IDLE_POLL_MS * 20);
      const tasks: TaskCollectionRef = await ctx.cap[boardName].tasks();

      await tasks.addTask({ id: "parked", goal: "parked", input: { topic: "p" } });
      const claimed = await tasks.claim("external-actor", {
        eligibility: (task) => task.id === "parked",
      });
      observed.claimedByActor = claimed === null ? null : claimed.id;
      await tasks.awaitReview("parked", "needs a human");

      await tasks.cancel("unreachable", "dep will never exist");

      // Long enough for a spinning worker to exhaust its budget and retire.
      // A correctly sleeping worker is still parked when this elapses.
      await delay(150);
      observed.drainDoneBeforeResume = drain.done;
      await tasks.resumeFromReview("parked");
    },
  });

  const markDrainDone = handler({
    name: `${boardName}-mark-done`,
    inputSchema: z.unknown(),
    outputSchema: z.null(),
    execute: () => {
      drain.done = true;
      return null;
    },
  });

  const root = sequencer({
    name: `${boardName}-root`,
    inputSchema: z.unknown(),
    stateSchema: taskBoardStateSchema,
  }).stepAll([
    sequencer({ name: `${boardName}-drain-branch`, inputSchema: z.unknown() })
      .tap(board.drain)
      .tap(markDrainDone),
    actor,
  ]);

  return { root, processed, attempts, observed };
}

describe("taskBoard - durable board same-request freshness", () => {
  it("does not retire while a task is outstanding, and works it once resumed", async () => {
    const { root, processed, observed } = buildScenario();

    const result = await testBlock(root, { input: undefined });

    expect(result.error).toBeNull();
    // Precondition: the actor, not the board, took the task it parked.
    expect(observed.claimedByActor).toBe("parked");
    // The drain was still running when the parked task was resumed. Read from
    // the drain's own completion tap, so this is behaviour rather than a bound.
    expect(observed.drainDoneBeforeResume).toBe(false);
    // And the outstanding work reached a worker instead of being abandoned.
    expect(processed).toEqual(["parked"]);
  });

  it("keeps worker claim attempts far below the iteration budget", async () => {
    const { root, attempts, observed } = buildScenario();

    const result = await testBlock(root, { input: undefined });

    expect(result.error).toBeNull();
    expect(observed.claimedByActor).toBe("parked");
    // A spinning worker pins its budget (21 attempts against a 20-iteration
    // budget) at near-zero wall-clock cost. A sleeping one needs a handful:
    // the empty first attempt, one per wait timeout, and the claim after the
    // resume. The bound sits between the two so neither reading is a squeeze.
    expect(attempts.total).toBeGreaterThan(0);
    expect(attempts.total).toBeLessThan(MAX_ITERATIONS / 2);
  });
});

describe("taskBoard - durable collection resolutions inside one request", () => {
  it("drops a task the resource collection evicted for capacity", async () => {
    // The eviction half of reconciliation, on the real registry rather than a
    // fake. Reaching it needs a caller-supplied resource collection with an
    // `eviction` policy: `defineTaskCollection` exposes `maxInstances` but not
    // `eviction`, and the registry's default is to THROW at the cap, so a board
    // declared the usual way can never evict. Where it can happen, eviction
    // removes the instance through the same per-key delete an explicit
    // `delete()` uses, so one reconciliation covers both.
    const evicting = defineResourceCollection({
      scope: "session",
      pattern: "evicting/**",
      stateSchema: z.record(z.unknown()),
      maxInstances: 2,
      eviction: "oldest",
    });

    const probe = handler({
      name: "evicting-probe",
      inputSchema: z.unknown(),
      outputSchema: z.object({ ids: z.array(z.string()), firstGone: z.boolean() }),
      resources: { evicting },
      execute: async (_input, ctx) => {
        const resolve = (): Promise<TaskCollectionRef> =>
          getOrCreateTaskCollection({
            ctx,
            backing: "resource",
            collectionId: "evicting",
            collection: ctx.resources.evicting as ResourceCollectionRef<JsonObject>,
          });

        const refA = await resolve();
        await refA.addTask({ id: "t1", goal: "t1" });
        await refA.addTask({ id: "t2", goal: "t2" });
        // Third create trips the cap and evicts the oldest instance.
        await refA.addTask({ id: "t3", goal: "t3" });

        // A later resolution reconciles the shared record against the store.
        const refB = await resolve();
        return {
          ids: refB.list().map((t) => t.id).sort(),
          firstGone: refB.get("t1") === undefined,
        };
      },
    });

    const result = await testBlock(
      sequencer({ name: "evicting-wrapper" }).step(probe),
      { input: undefined }
    );

    expect(result.error).toBeNull();
    const output = result.output as { ids: string[]; firstGone: boolean };
    // The store enforces the cap, so the record must match it rather than
    // carrying a third, evicted entry.
    expect(output.firstGone).toBe(true);
    expect(output.ids).toEqual(["t2", "t3"]);
  });


  it("shares one task set across two independently resolved refs", async () => {
    // The real-path counterpart to the unit-level mechanism test in
    // `test/collection/shared-task-set.test.ts`. That one proves the record is
    // shared per collection instance; this one proves the resource registry
    // really does hand the *same* instance to two resolutions in one request,
    // which is the assumption the keying rests on.
    const board = taskBoard({
      name: "two-resolutions-board",
      collection: defineTaskCollection({
        id: "two-resolutions",
        scope: "session",
        stateSchema: z.object({ topic: z.string() }),
      }),
      concurrency: 1,
      dispatcher: "fifo",
      workers: handler({
        name: "two-resolutions-worker",
        inputSchema: taskWorkerInputSchema,
        outputSchema: z.null(),
        execute: () => null,
      }) as TaskWorker,
    });

    const probe = handler({
      name: "two-resolutions-probe",
      inputSchema: z.unknown(),
      outputSchema: z.object({ viaA: z.number(), viaB: z.number() }),
      uses: [board.capability],
      execute: async (_input, ctx) => {
        const acc = ctx.cap["two-resolutions-board"];
        // Both refs resolve before the add — the shape of a parked worker.
        const refA: TaskCollectionRef = await acc.tasks();
        const refB: TaskCollectionRef = await acc.tasks();
        await refA.addTask({ id: "t1", goal: "g1", input: { topic: "t" } });
        return { viaA: refA.count(), viaB: refB.count() };
      },
    });

    const result = await testBlock(
      sequencer({ name: "two-resolutions-wrapper" }).step(probe),
      { input: undefined }
    );

    expect(result.error).toBeNull();
    expect(result.output).toEqual({ viaA: 1, viaB: 1 });
  });
});
