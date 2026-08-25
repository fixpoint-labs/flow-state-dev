/**
 * FIX-951 — a worker outcome that lands on a settled task must not abandon
 * the board.
 *
 * Wrapped around every task-board worker is a rescue whose one job is to
 * make sure a worker going wrong affects only *its* task. That containment
 * broke whenever the task was settled while its worker was still running:
 * the board's own write-back became an illegal status transition, threw
 * from inside the rescue where nothing catches it, and the `forEach`
 * rejected on the first failure — abandoning every sibling task and
 * surfacing an error about a bookkeeping write rather than about whatever
 * actually went wrong.
 *
 * Lives here rather than only in `packages/orchestration` because the
 * escape emerges from full `runAction` composition — worker sequencer →
 * `.rescue()` → `.forEach` fan-out — which the block-level tier does not
 * exercise. The discriminating per-status cases stay in
 * `packages/orchestration/test/collection/advisory-write.test.ts`; this
 * scenario proves the composition.
 *
 * Both trigger shapes are covered, because the filed issue only described
 * the first and the second is the more common one:
 *   1. the worker settles its own task and then throws
 *   2. the worker settles its own task and then RETURNS NORMALLY —
 *      cancelling a task does not stop the worker already running it, so a
 *      healthy worker finishing its work is the ordinary case
 *
 * FIX-964 extends the same scenario to the case the guards do not reach: a
 * board running on a CUSTOM store that ignores them. See the second describe
 * block for why that is a different failure with the same symptom.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import {
  taskBoard,
  taskBoardStateSchema,
  taskWorkerInputSchema,
} from "@flow-state-dev/orchestration/task-board";
import {
  getOrCreateTaskCollection,
  type TaskCollectionRef,
} from "@flow-state-dev/orchestration";
import { testFlow } from "@flow-state-dev/testing";
import { z } from "zod";
import { itemsByType } from "../helpers/assertions";

const COLLECTION_ID = "containment-board";
/** Held-out value the siblings must carry, so a hollow pass can't sneak through. */
const SALT = "salt-9f31";

/**
 * Build the board flow. `poisonBehaviour` picks which of the two triggers
 * the first worker exercises after cancelling its own task.
 */
function buildFlow(poisonBehaviour: "throw" | "return", onError: "skip" | "fail") {
  const worker = handler({
    name: "containment-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ ok: z.string() }),
    execute: async (input, ctx) => {
      if (input.goal !== "poison") {
        return { ok: `${input.goal}:${SALT}` };
      }
      // Settle the task out from under the worker that holds it — exactly
      // what a coordinator cancelling mid-flight does, and reachable from
      // the worker itself through its task tools.
      const collection = await getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId: COLLECTION_ID,
      });
      await collection.cancel(input.taskId, "settled mid-flight");
      if (poisonBehaviour === "throw") {
        throw new Error("worker blew up");
      }
      return { ok: `poison:${SALT}` };
    },
  }) as Parameters<typeof taskBoard>[0]["workers"];

  const board = taskBoard({
    name: COLLECTION_ID,
    collection: { backing: "request", collectionId: COLLECTION_ID },
    concurrency: 2,
    workers: worker,
    initialTasks: [
      { id: "poison", goal: "poison" },
      { id: "sibling-a", goal: "sibling-a" },
      { id: "sibling-b", goal: "sibling-b" },
    ],
    onError,
    onIdle: "complete",
    maxIterations: 50,
  });

  return defineFlow({
    kind: "fix951-drain-containment",
    actions: {
      run: {
        block: sequencer({
          name: "containment-root",
          inputSchema: z.unknown(),
          stateSchema: taskBoardStateSchema,
        }).step(board.drain),
      },
    },
  })({ id: "default" });
}

/**
 * Final status per task id, read off the emitted `task-change` stream
 * rather than off the drain's return value — a board that never ran its
 * siblings would still return something.
 */
function finalStatuses(
  items: readonly unknown[],
  collectionId: string = COLLECTION_ID
): Record<string, string> {
  const statuses: Record<string, string> = {};
  for (const item of itemsByType(items as never, "component")) {
    const data = (item as { data?: Record<string, unknown> }).data;
    if (data?.collectionId !== collectionId) continue;
    const task = data.task as { id?: string; status?: string } | undefined;
    if (task?.id === undefined || task.status === undefined) continue;
    statuses[task.id] = task.status;
  }
  return statuses;
}

describe("FIX-951: task-board drain containment on a settled task", () => {
  it.each([
    ["worker throws after settling its own task", "throw" as const],
    ["worker returns normally after settling its own task", "return" as const],
  ])("drains the siblings when the %s", async (_label, behaviour) => {
    const result = await testFlow({
      flow: buildFlow(behaviour, "skip"),
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });

    // Before the fix this is the illegal-transition error, and the run dies
    // partway with two tasks still `pending`.
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const statuses = finalStatuses(result.items);
    expect(statuses["sibling-a"]).toBe("completed");
    expect(statuses["sibling-b"]).toBe("completed");
    // The settler's decision wins over the late worker result.
    expect(statuses["poison"]).toBe("cancelled");

    // Anti-hollow-pass: a board that abandoned its siblings could still
    // report them as some status. Assert their OUTPUT carries the salt, so
    // the workers demonstrably ran.
    const outputs = itemsByType(result.items, "component")
      .map((i) => (i as { data?: Record<string, unknown> }).data)
      .filter((d) => d?.collectionId === COLLECTION_ID)
      .map((d) => (d?.task as { output?: { ok?: string } } | undefined)?.output?.ok)
      .filter((v): v is string => typeof v === "string");
    expect(outputs).toContain(`sibling-a:${SALT}`);
    expect(outputs).toContain(`sibling-b:${SALT}`);
  });

  it("bounds the re-queue spin the fix trades the crash for", async () => {
    // Honest accounting for the cost of this change. A drain that used to
    // die loudly on this race now keeps going, and in one narrow shape —
    // something returns the task to `pending` under a worker that keeps
    // failing — that means a quiet re-dispatch loop. It has to actually
    // terminate at the cap, not merely be assumed to.
    //
    // The shape is seeded artificially: the worker re-queues its own task
    // (what a lease expiry does) and then throws, so the failure write-back
    // lands on a `pending` task every time and declines instead of settling.
    //
    // The bound is per WORKER, not per board: `maxIterations` caps each
    // worker sequencer's own `loopBack`, and the drain fans out
    // `concurrency` of them. It also counts re-executions, so each worker
    // runs its body up to `maxIterations + 1` times. This asserts the
    // AGGREGATE ceiling, `concurrency * (maxIterations + 1)` — writing
    // `<= maxIterations` or `<= concurrency * maxIterations` instead would
    // fail against a correct implementation.
    const CONCURRENCY = 2;
    const MAX_ITERATIONS = 3;
    let dispatches = 0;

    const worker = handler({
      name: "spin-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ ok: z.string() }),
      execute: async (input, ctx) => {
        dispatches++;
        const collection = await getOrCreateTaskCollection({
          ctx,
          backing: "request",
          collectionId: "spin-board",
        });
        // Re-queue every in-progress task, including this worker's own.
        await collection.reclaim(Number.MAX_SAFE_INTEGER);
        throw new Error(`spin on ${input.goal}`);
      },
    }) as Parameters<typeof taskBoard>[0]["workers"];

    const board = taskBoard({
      name: "spin-board",
      collection: { backing: "request", collectionId: "spin-board" },
      concurrency: CONCURRENCY,
      workers: worker,
      initialTasks: [{ id: "spinner", goal: "spinner" }],
      onError: "skip",
      onIdle: "complete",
      maxIterations: MAX_ITERATIONS,
    });

    const flow = defineFlow({
      kind: "fix951-spin-bound",
      actions: {
        run: {
          block: sequencer({
            name: "spin-root",
            inputSchema: z.unknown(),
            stateSchema: taskBoardStateSchema,
          }).step(board.drain),
        },
      },
    })({ id: "default" });

    await testFlow({
      flow,
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });

    // Terminated at all (the run returned), and within the real ceiling.
    expect(dispatches).toBeGreaterThan(0);
    expect(dispatches).toBeLessThanOrEqual(CONCURRENCY * (MAX_ITERATIONS + 1));
  });

  it("onError:'fail' still fails the board, and with the worker's own error", async () => {
    // The fix must not turn a configured failure into a success. What
    // changes is WHICH error surfaces: the worker's real one, instead of
    // the transition error that used to replace it.
    const result = await testFlow({
      flow: buildFlow("throw", "fail"),
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });

    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain("worker blew up");
    expect(String(result.error)).not.toContain("illegal status transition");
  });
});

const LEGACY_COLLECTION_ID = "legacy-store-board";

/**
 * A custom store written against the interface without the advisory guards —
 * the documented `(ctx) => TaskCollectionRef` extension point, implemented the
 * way it reads.
 *
 * `complete` and `fail` take two parameters, so JavaScript discards the options
 * object in silence and the guards are never evaluated. Nothing about that is
 * detectable: it typechecks (fewer parameters are assignable), it runs, and on
 * every board where no result ever arrives late it is indistinguishable from a
 * correct store.
 *
 * `misbehaviour` picks which of the two failures the store exhibits:
 *
 * - `"ignores-guards"` — it delegates to a real backing, which throws on the
 *   illegal transition the guards existed to decline. The filed defect.
 * - `"unreachable"` — it throws on every write, on a task nobody else has
 *   touched. The store is simply down, and that must still reach the caller.
 */
function customStore(
  inner: TaskCollectionRef,
  misbehaviour: "ignores-guards" | "unreachable"
): TaskCollectionRef {
  if (misbehaviour === "unreachable") {
    return {
      ...inner,
      complete: () => Promise.reject(new Error("legacy store unreachable")),
      fail: () => Promise.reject(new Error("legacy store unreachable")),
    };
  }
  return {
    ...inner,
    complete: (id, output) => inner.complete(id, output),
    fail: (id, error) => inner.fail(id, error),
  };
}

function buildLegacyStoreFlow(misbehaviour: "ignores-guards" | "unreachable") {
  const worker = handler({
    name: "legacy-store-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ ok: z.string() }),
    execute: async (input, ctx) => {
      if (input.goal !== "poison") {
        return { ok: `${input.goal}:${SALT}` };
      }
      // The coordinator's handle on the same tasks — the real ref, not the
      // custom one. A cancel travelling a path the custom store never sees is
      // the ordinary case: the store is where the board writes results, not
      // where every decision is made.
      const collection = await getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId: LEGACY_COLLECTION_ID,
      });
      await collection.cancel(input.taskId, "settled mid-flight");
      return { ok: `poison:${SALT}` };
    },
  }) as Parameters<typeof taskBoard>[0]["workers"];

  const board = taskBoard({
    name: LEGACY_COLLECTION_ID,
    collection: async (ctx) =>
      customStore(
        await getOrCreateTaskCollection({
          ctx,
          backing: "request",
          collectionId: LEGACY_COLLECTION_ID,
        }),
        misbehaviour
      ),
    concurrency: 2,
    workers: worker,
    initialTasks: [
      { id: "poison", goal: "poison" },
      { id: "sibling-a", goal: "sibling-a" },
      { id: "sibling-b", goal: "sibling-b" },
    ],
    onError: "skip",
    onIdle: "complete",
    maxIterations: 50,
  });

  return defineFlow({
    kind: "fix964-custom-store-containment",
    actions: {
      run: {
        block: sequencer({
          name: "legacy-store-root",
          inputSchema: z.unknown(),
          stateSchema: taskBoardStateSchema,
        }).step(board.drain),
      },
    },
  })({ id: "default" });
}

describe("FIX-964: task-board drain containment on a custom store", () => {
  it("drains the siblings when the store ignores the advisory guards", async () => {
    const result = await testFlow({
      flow: buildLegacyStoreFlow("ignores-guards"),
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });

    // Before the fix: the store's throw escapes the per-worker rescue, the
    // `forEach` rejects on it, and `sibling-a` / `sibling-b` are left `pending`
    // forever. FIX-951's guards cannot help here — they were never evaluated.
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const statuses = finalStatuses(result.items, LEGACY_COLLECTION_ID);
    expect(statuses["sibling-a"]).toBe("completed");
    expect(statuses["sibling-b"]).toBe("completed");
    // Containment is not equivalence: the store still did the wrong thing, and
    // the cancel it failed to honour still stands.
    expect(statuses["poison"]).toBe("cancelled");

    // Anti-hollow-pass, as above: prove the siblings' workers actually ran
    // rather than trusting a status the board could report either way.
    const outputs = itemsByType(result.items, "component")
      .map((i) => (i as { data?: Record<string, unknown> }).data)
      .filter((d) => d?.collectionId === LEGACY_COLLECTION_ID)
      .map((d) => (d?.task as { output?: { ok?: string } } | undefined)?.output?.ok)
      .filter((v): v is string => typeof v === "string");
    expect(outputs).toContain(`sibling-a:${SALT}`);
    expect(outputs).toContain(`sibling-b:${SALT}`);
  });

  it("still fails the board when the store is down on a task the worker holds", async () => {
    // The load-bearing negative (BP-035). Containment is scoped to a throw a
    // conforming store would have turned into a decline; a store that is simply
    // unreachable has nothing to do with the guards, and turning that into a
    // quiet decline would lose every result the board ever produced.
    const result = await testFlow({
      flow: buildLegacyStoreFlow("unreachable"),
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });

    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain("legacy store unreachable");
  });
});
