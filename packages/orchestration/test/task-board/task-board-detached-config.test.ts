/**
 * The detached-dispatch declaration surface and its construction-time refusals
 * (FIX-982 P1).
 *
 * P1 ships **no execution** — nothing here dispatches out of the request. What
 * is asserted is the contract a board must satisfy *before* the spawn exists,
 * because the refusals are what stop the first detached board being built on a
 * backing that could never settle it.
 *
 * Two properties carry most of the weight:
 *
 * - **The off state.** A bare worker value and a board with no `dispatch`
 *   behave exactly as they do today. This is the flag's second state (BP-035)
 *   and the BP-030 promise that no existing board needs editing — asserted,
 *   not assumed, because every refusal below is one bad predicate away from
 *   firing on an ordinary board.
 * - **Refusals are loud and by name.** A silent degrade fails the criterion
 *   this issue inherited from the epic. Each assertion pins the *reason* in the
 *   message, so a refusal that starts firing for a different cause is a test
 *   failure rather than a passing test about the wrong thing.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  defineTaskCollection,
  type TaskCollectionRef,
  type TaskWorker,
} from "../../src/tasks";
import {
  isTaskWorkerEntry,
  taskBoard,
  taskWorkerInputSchema,
} from "../../src/task-board";

function worker(name: string, extra?: Record<string, unknown>): TaskWorker {
  return handler({
    name,
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.null(),
    execute: () => null,
    ...extra,
  }) as TaskWorker;
}

const durable = defineTaskCollection({ id: "detached-tasks", scope: "user" });

describe("detached dispatch — the off state (BP-030 / BP-035)", () => {
  it("leaves a bare-worker board untouched: no boardId, nothing detached", () => {
    const board = taskBoard({
      name: "inline-board",
      workers: { summarize: worker("summarize") },
    });

    expect(board.detachedWorkers).toEqual([]);
    expect(board.boardId).toBeUndefined();
    expect(board.backing).toBe("request");
  });

  it("accepts an entry that declares itself inline, on the default backing", () => {
    // An entry is a spelling, not an opt-in. Only `mode: "detached"` engages
    // the refusals — otherwise wrapping a worker to be explicit would silently
    // demand a durable backing.
    const board = taskBoard({
      name: "explicit-inline",
      workers: { summarize: { worker: worker("summarize-2"), dispatch: { mode: "inline" } } },
    });

    expect(board.detachedWorkers).toEqual([]);
  });

  it("unwraps entries into the worker blocks the drain composes", () => {
    // The drain must see the same shape it always did. If an entry leaked
    // through as a router route, the router would try to run `{worker,
    // dispatch}` as a block.
    const board = taskBoard({
      name: "unwrap-board",
      boardId: "unwrap-board",
      collection: durable,
      workers: {
        summarize: worker("summarize-3"),
        implement: { worker: worker("implement-3"), dispatch: { mode: "detached" } },
      },
    });

    expect(board.detachedWorkers.map((slot) => slot.label)).toEqual(["assignee:implement"]);
    expect(board.detachedWorkers[0]?.worker.name).toBe("implement-3");
  });
});

describe("isTaskWorkerEntry", () => {
  it("tells an entry from a bare block and from a registry", () => {
    const block = worker("discriminate");

    expect(isTaskWorkerEntry({ worker: block })).toBe(true);
    expect(isTaskWorkerEntry({ worker: block, dispatch: { mode: "detached" } })).toBe(true);
    expect(isTaskWorkerEntry(block)).toBe(false);
    expect(isTaskWorkerEntry({ summarize: block })).toBe(false);
    expect(isTaskWorkerEntry(undefined)).toBe(false);
    // `worker` present but not a block — a registry whose assignee is literally
    // "worker". Falls through to the registry reading, which is what keeps an
    // existing board routing the way it always did.
    expect(isTaskWorkerEntry({ worker: { name: "not-a-block" } })).toBe(false);
  });
});

describe("detached dispatch — construction-time refusals (decision 11)", () => {
  it("refuses a detached board with no boardId, naming the worker", () => {
    expect(() =>
      taskBoard({
        name: "no-id",
        collection: durable,
        workers: { implement: { worker: worker("impl-no-id"), dispatch: { mode: "detached" } } },
      })
    ).toThrow(/no boardId.*assignee:implement|assignee:implement.*no boardId/s);
  });

  it("refuses a detached board on the default request backing", () => {
    // The default backing's lifetime IS the request, so detached work on it
    // would run with nothing able to settle or observe it — and the failure
    // would appear only after the first restart.
    expect(() =>
      taskBoard({
        name: "request-backed",
        boardId: "request-backed",
        workers: { implement: { worker: worker("impl-req"), dispatch: { mode: "detached" } } },
      })
    ).toThrow(/request-backed collection|must be durable/);
  });

  it("refuses a detached board on a sequencer backing", () => {
    expect(() =>
      taskBoard({
        name: "seq-backed",
        boardId: "seq-backed",
        collection: { backing: "sequencer", collectionId: "seq-backed" },
        workers: { implement: { worker: worker("impl-seq"), dispatch: { mode: "detached" } } },
      })
    ).toThrow(/sequencer-backed collection|must be durable/);
  });

  it("refuses a detached board on a caller-supplied factory backing", () => {
    // A factory is caller-opaque: the board cannot establish that what comes
    // back is durable, so it cannot honestly accept the declaration.
    expect(() =>
      taskBoard({
        name: "factory-backed",
        boardId: "factory-backed",
        collection: () => ({}) as unknown as TaskCollectionRef,
        workers: { implement: { worker: worker("impl-fac"), dispatch: { mode: "detached" } } },
      })
    ).toThrow(/factory-backed collection|must be durable/);
  });

  it("refuses a detached worker that declares sessionStateSchema, by name", () => {
    // Every detached worker in a flow becomes a route on ONE WorkstreamFlow, so
    // two routes picking the same key with different shapes corrupt each other
    // with no error anywhere. The refusal is the whole fix.
    expect(() =>
      taskBoard({
        name: "session-state",
        boardId: "session-state",
        collection: durable,
        workers: {
          implement: {
            worker: worker("impl-session", { sessionStateSchema: z.object({ topic: z.string() }) }),
            dispatch: { mode: "detached" },
          },
        },
      })
    ).toThrow(/sessionStateSchema/);
  });

  it("does NOT refuse sessionStateSchema on an INLINE worker of a detached board", () => {
    // The collision is a property of sharing the WorkstreamFlow router, which
    // an inline worker never joins. Refusing it would be a guard firing on a
    // condition it does not actually test.
    expect(() =>
      taskBoard({
        name: "mixed-board",
        boardId: "mixed-board",
        collection: durable,
        workers: {
          summarize: worker("sum-session", { sessionStateSchema: z.object({ topic: z.string() }) }),
          implement: { worker: worker("impl-mixed"), dispatch: { mode: "detached" } },
        },
      })
    ).not.toThrow();
  });

  it("accepts a durable detached board with a boardId", () => {
    const board = taskBoard({
      name: "good-board",
      boardId: "good-board",
      collection: durable,
      workers: {
        summarize: worker("sum-good"),
        implement: { worker: worker("impl-good"), dispatch: { mode: "detached" } },
      },
    });

    expect(board.boardId).toBe("good-board");
    expect(board.backing).toBe("resource");
    expect(board.detachedWorkers).toHaveLength(1);
  });
});

describe("detached dispatch — the uniform and floor coordinates", () => {
  it("detaches a uniform worker through the board-level dispatch field", () => {
    const board = taskBoard({
      name: "uniform-detached",
      boardId: "uniform-detached",
      collection: durable,
      workers: worker("uniform-impl"),
      dispatch: { mode: "detached" },
    });

    expect(board.detachedWorkers.map((slot) => slot.label)).toEqual(["uniform"]);
  });

  it("refuses a board-level dispatch alongside a registry", () => {
    // `workers: { worker: block }` is genuinely ambiguous — a one-key registry
    // routing assignee "worker" and a uniform entry are the same object — so
    // uniform detachment is spelled at the board level. Applying that field to
    // a registry would not say which worker it meant.
    expect(() =>
      taskBoard({
        name: "ambiguous",
        boardId: "ambiguous",
        collection: durable,
        workers: { implement: worker("impl-amb") },
        dispatch: { mode: "detached" },
      })
    ).toThrow(/would not say which worker/);
  });

  it("detaches the delegation floor through an entry", () => {
    const board = taskBoard({
      name: "floor-detached",
      boardId: "floor-detached",
      collection: durable,
      workers: { summarize: worker("sum-floor") },
      defaultWorker: { worker: worker("floor-impl"), dispatch: { mode: "detached" } },
    });

    expect(board.detachedWorkers.map((slot) => slot.label)).toEqual(["floor"]);
  });
});
