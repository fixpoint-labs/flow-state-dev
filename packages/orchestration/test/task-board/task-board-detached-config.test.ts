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
import { handler, sequencer } from "@flow-state-dev/core";
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

describe("detached dispatch — a session-scoped ledger is refused at construction", () => {
  /**
   * A Workstream runs in its own session, and a session-scoped collection
   * resolves against the running session — so the child addresses an empty
   * ledger and never finds the row it was dispatched for.
   *
   * Nothing about that announces itself at runtime. The start gate reads the
   * missing row as a stale claim and returns cleanly, the row stays
   * `in_progress`, the next drain reclaims and redispatches it, and the board
   * loops — burning dispatches, making no progress, and terminating only when
   * the abandonment cap finally errors the row out. A refusal at construction is
   * the only version of this a person can diagnose from the symptom, which is
   * why it is asserted here and not against a running board.
   */
  const sessionScoped = defineTaskCollection({ id: "session-tasks", scope: "session" });

  it("refuses, naming the board and pointing at the scopes that work", () => {
    expect(() =>
      taskBoard({
        name: "session-detached",
        boardId: "session-detached",
        collection: sessionScoped,
        workers: {
          implement: { worker: worker("impl-session"), dispatch: { mode: "detached" } },
        },
      })
    ).toThrow(/session-scoped collection/);
  });

  it("names the declared worker, so the message points at what would not run", () => {
    expect(() =>
      taskBoard({
        name: "session-detached-named",
        boardId: "session-detached-named",
        collection: sessionScoped,
        workers: {
          implement: { worker: worker("impl-session-2"), dispatch: { mode: "detached" } },
        },
      })
    ).toThrow(/assignee:implement/);
  });

  it("leaves a session-scoped board with nothing detached alone", () => {
    // The refusal is about the hand-off, not about the scope. An inline board
    // never leaves its request, so a session-scoped ledger is exactly right for
    // it — and refusing one would outlaw a shape that works today.
    expect(() =>
      taskBoard({
        name: "session-inline",
        collection: defineTaskCollection({ id: "session-inline-tasks", scope: "session" }),
        workers: { implement: worker("impl-session-inline") },
      })
    ).not.toThrow();
  });

  it("accepts a detached board on a user-scoped ledger", () => {
    // The control: same declaration, reachable scope. Without this the refusal
    // above would pass just as well against a guard that refused every detached
    // board.
    expect(() =>
      taskBoard({
        name: "user-detached",
        boardId: "user-detached",
        collection: defineTaskCollection({ id: "user-tasks", scope: "user" }),
        workers: {
          implement: { worker: worker("impl-user"), dispatch: { mode: "detached" } },
        },
      })
    ).not.toThrow();
  });
});

describe("the session-schema refusal sees composed children", () => {
  it("refuses a schema declared by a step inside the worker", () => {
    // A detached worker is routinely a sequencer, and the block declaring the
    // schema is usually a step inside it. It runs in the Workstream's session
    // exactly as the root would, and collides with a sibling route's key
    // exactly as the root would — so inspecting only the root accepted the
    // board and left the declaration to surface as a missing typed key inside
    // the child.
    const nested = sequencer({ name: "outer" }).tap(
      handler({
        name: "inner-with-state",
        sessionStateSchema: z.object({ needed: z.string() }),
        execute: () => null,
      })
    );

    expect(() =>
      taskBoard({
        name: "nested-session-state",
        boardId: "nested-session-state",
        collection: durable,
        workers: { implement: { worker: nested as never, dispatch: { mode: "detached" } } },
      })
    ).toThrow(/sessionStateSchema/);
  });

  it("names the composed block, not just the worker", () => {
    const nested = sequencer({ name: "outer-2" }).tap(
      handler({
        name: "inner-named",
        sessionStateSchema: z.object({ needed: z.string() }),
        execute: () => null,
      })
    );

    expect(() =>
      taskBoard({
        name: "nested-session-named",
        boardId: "nested-session-named",
        collection: durable,
        workers: { implement: { worker: nested as never, dispatch: { mode: "detached" } } },
      })
    ).toThrow(/inner-named/);
  });

  it("leaves a composed worker that declares none alone", () => {
    // The control. A walk that flagged any sequencer would refuse most detached
    // boards in the codebase.
    const plain = sequencer({ name: "outer-plain" }).tap(
      handler({ name: "inner-plain", execute: () => null })
    );

    expect(() =>
      taskBoard({
        name: "nested-session-clean",
        boardId: "nested-session-clean",
        collection: durable,
        workers: { implement: { worker: plain as never, dispatch: { mode: "detached" } } },
      })
    ).not.toThrow();
  });
});
