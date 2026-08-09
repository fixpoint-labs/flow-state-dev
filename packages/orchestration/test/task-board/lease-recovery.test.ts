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
import { handler, SuspensionError } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createSequencerBackedTaskCollection,
  leaseLapsed,
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

describe("the board's worker really runs under the lease-loss signal", () => {
  it("aborts the worker when the claim is taken from under it (FIX-1005)", async () => {
    // The reachability guard. Every other lease test here passes whether or not
    // the driver is reachable from the steps that read it, because a settled
    // task makes renewal stop itself — the write is declined `terminal`. So the
    // wiring can be inert and the suite stays green.
    //
    // Move `openLeaseRenewalScope()` in the board's setup tap below its first
    // `await` and this fails with `ended: "timeout"`: `enterWith` then
    // publishes to a scope that dies with the tap, `currentLeaseRenewal()`
    // returns undefined in the step's `abortSignal` resolver, and the worker
    // runs on the request's signal alone.
    const collection = liveCollection("lease-loss-signal");
    let ended = "never-ran";

    const watcher = handler({
      name: "signal-watcher",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ ended: z.string() }),
      execute: async (_input, ctx) =>
        new Promise<{ ended: string }>((resolve) => {
          const finish = (how: string) => {
            ended = how;
            resolve({ ended: how });
          };
          if (ctx.signal?.aborted === true) return finish("already");
          ctx.signal?.addEventListener("abort", () => finish("aborted"), { once: true });
          setTimeout(() => finish("timeout"), 4_000);
        }),
    }) as TaskWorker;

    const board = taskBoard({
      name: "lease-loss-board",
      collection: () => collection,
      concurrency: 1,
      dispatcher: leasingDispatcher(MIN_LEASE_DURATION_MS),
      initialTasks: [{ id: "t", goal: "watch the signal" }],
      workers: watcher,
    });

    // Settle the row out from under the running worker. The next renewal tick
    // is refused, and that refusal is what aborts the lease-loss signal.
    setTimeout(() => void collection.fail("t", "reclaimed by someone else"), 200);

    await testBlock(board.drain, { input: undefined });

    expect(ended).toBe("aborted");
  }, 30_000);
});

describe("a worker that parks on a suspension stops holding its task", () => {
  it("lets the lease lapse so another worker recovers it, instead of renewing forever", async () => {
    // The third exit, and the only one no composed handler can see.
    // `ctx.suspend()` throws a `SuspensionError`, which bypasses `.rescue()` by
    // design (suspension is control flow, not a failure), and a suspended
    // request does not abort its signal either. So neither recorder runs and
    // the renewal driver has nothing telling it to stop.
    //
    // Left alone it renews an `in_progress` row for as long as the host lives.
    // The task is then held by a worker that is parked and never coming back on
    // its own, and NO other worker can recover it — the exact deadlock this
    // issue exists to remove, rebuilt out of a park.
    //
    // Neuter the `onSettled` option on the board's worker step and this fails
    // at the `leaseLapsed` assertion: the driver is still ticking every ~333ms
    // and the deadline it writes is always in the future.
    const collection = liveCollection("suspend-parks");

    const parkingWorker = handler({
      name: "parking-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ done: z.boolean() }),
      execute: async () => {
        throw new SuspensionError({
          suspensionId: "needs-a-human",
          reason: "human_approval",
        });
      },
    }) as TaskWorker;

    const parked = taskBoard({
      name: "parked-board",
      collection: () => collection,
      concurrency: 1,
      dispatcher: leasingDispatcher(MIN_LEASE_DURATION_MS),
      initialTasks: [{ id: "t", goal: "needs a human" }],
      workers: parkingWorker,
    });

    // The suspension really does escape the whole board rather than being
    // recorded as a failure — otherwise `recordError` would have stopped the
    // driver and this test would be proving nothing.
    const parked_escape = await testBlock(parked.drain, { input: undefined }).then(
      () => undefined,
      (err: unknown) => err
    );
    expect(parked_escape).toBeInstanceOf(SuspensionError);
    expect(collection.get("t")!.status).toBe("in_progress");

    // Two full leases' worth of renewal opportunities. A live driver ticks six
    // times in this window; a stopped one lets the deadline pass.
    await sleep(MIN_LEASE_DURATION_MS * 2);

    expect(leaseLapsed(collection.get("t")!, Date.now())).toBe(true);

    // Not merely "the deadline passed": a second worker actually picks the row
    // up and carries it to completion, which is what "recoverable" has to mean.
    const ran: string[] = [];
    const liveWorker = handler({
      name: "live-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ done: z.boolean() }),
      execute: async (input) => {
        ran.push(input.taskId);
        return { done: true };
      },
    }) as TaskWorker;

    const rescuer = taskBoard({
      name: "rescuer-board",
      collection: () => collection,
      concurrency: 1,
      workers: liveWorker,
    });

    const rescueRun = await testBlock(rescuer.drain, { input: undefined });

    expect(rescueRun.error).toBeNull();
    expect(ran).toEqual(["t"]);
    const settled = collection.get("t")!;
    expect(settled.status).toBe("completed");
    expect(settled.abandonments).toBe(1);
  }, 30_000);
});
