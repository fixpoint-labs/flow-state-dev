/**
 * Recovery and renewal, end to end on a real board (FIX-1005).
 *
 * The unit suites pin the fence, the predicate and the driver in isolation.
 * These two tests are the ones that would still catch a mechanism wired
 * together wrongly, and they are deliberately a matched pair — each is the
 * other's guard:
 *
 * 1. **A stranded job comes back.** A task claimed by a worker that is gone is
 *    picked up by a live one and completed, with no human and no manual call.
 *
 * 2. **A live worker is never disturbed.** A worker still running past its
 *    lease keeps its task, and the work runs exactly once.
 *
 * Test 2 is the **anti-vacuity guard** and it is not optional. Recovery alone
 * is trivially satisfiable by a build that recovers everything, all the time —
 * which is precisely the duplicate-execution trap this issue exists to
 * prevent. Delete renewal and test 1 still passes while test 2 fails, because
 * the live worker's lease lapses under it and a sibling runs its work a second
 * time. Neither test is worth much without the other.
 *
 * Both drive a real `taskBoard` over a caller-supplied collection on the wall
 * clock, so the leases really expire and the driver really schedules. Short
 * leases keep them fast; the board itself has no lease knob, so the second test
 * supplies one through a dispatcher, which is how a caller would.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createSequencerBackedTaskCollection,
  MIN_LEASE_DURATION_MS,
  type TaskCollectionRef,
  type TaskDispatcher,
  type TaskWorker,
} from "../../src/tasks";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import { createFakeSequencerState } from "../helpers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A board collection on the real clock, so leases genuinely expire. */
function liveCollection(collectionId: string): TaskCollectionRef {
  return createSequencerBackedTaskCollection({
    collectionId,
    sequencer: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
    now: () => Date.now(),
  });
}

/** A dispatcher that claims under `leaseDurationMs`; the board has no lease knob. */
function leasingDispatcher(leaseDurationMs: number): TaskDispatcher {
  return {
    async claim(collection, workerId) {
      return collection.claim(workerId, { leaseDurationMs });
    },
  };
}

describe("a stranded job returns to the queue and gets done", () => {
  it("picks up a task whose worker is gone, and completes it as attempt 2", async () => {
    // The abandoned row is created the way one really is: a claimant that then
    // stops renewing. Here that claimant simply never had a driver — which is
    // exactly the state a worker leaves behind when its process dies.
    const collection = liveCollection("recovery");
    await collection.addTask({ id: "t", goal: "finish the stranded job" });
    await collection.claim("worker-that-died", { leaseDurationMs: 1_000 });
    expect(collection.get("t")?.status).toBe("in_progress");

    await sleep(1_100); // nobody renewed it, so the lease lapses

    const ran: string[] = [];
    const worker = handler({
      name: "live-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ done: z.boolean() }),
      execute: async (input) => {
        ran.push(input.goal);
        return { done: true };
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "recovery-board",
      collection: () => collection,
      concurrency: 1,
      workers: worker,
    });

    const result = await testBlock(board.drain, { input: undefined });

    expect(result.error).toBeNull();
    // Not merely "the status flipped" — a worker actually started on it again
    // and carried it to completion.
    expect(ran).toEqual(["finish the stranded job"]);
    const settled = collection.get("t")!;
    expect(settled.status).toBe("completed");
    expect(settled.attempts).toBe(2);
    expect(settled.abandonments).toBe(1);
  }, 20_000);
});

describe("a live worker is never disturbed — the anti-vacuity guard", () => {
  it("keeps a worker's task while it runs well past its lease, and runs the work ONCE", async () => {
    // The shortest lease the substrate permits, and three leases' worth of
    // work under it. Renewal is the only thing standing between this and a
    // sibling worker taking the row.
    //
    // Neuter renewal and this fails with `ran.length === 2` and a task
    // completed twice — the exact duplicate execution FIX-1005 exists to
    // prevent, and the reason recovery-eligibility could not ship on its own.
    const collection = liveCollection("no-steal");
    const ran: string[] = [];

    const slowWorker = handler({
      name: "slow-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ done: z.boolean() }),
      execute: async (input) => {
        ran.push(input.taskId);
        await sleep(3_000);
        return { done: true };
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "no-steal-board",
      collection: () => collection,
      // Two workers, one task: the second is idle and looking for work the
      // whole time the first is running. That is what makes the theft possible
      // at all, so a single-worker board would not test anything.
      concurrency: 2,
      dispatcher: leasingDispatcher(MIN_LEASE_DURATION_MS),
      initialTasks: [{ id: "t", goal: "long job" }],
      workers: slowWorker,
    });

    const result = await testBlock(board.drain, { input: undefined });

    expect(result.error).toBeNull();
    expect(ran).toEqual(["t"]);
    const settled = collection.get("t")!;
    expect(settled.status).toBe("completed");
    // One claim, no takeover: the counter never advanced past the first
    // attempt and nothing was ever recorded as abandoned.
    expect(settled.attempts).toBe(1);
    expect(settled.abandonments ?? 0).toBe(0);
  }, 20_000);
});
