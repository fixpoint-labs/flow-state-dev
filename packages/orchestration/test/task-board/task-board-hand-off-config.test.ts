/**
 * The hand-off declaration surface and its construction-time refusals
 * (FIX-982 P1).
 *
 * P1 ships **no execution** — nothing here dispatches out of the request. What
 * is asserted is the contract a board must satisfy *before* the hand-off
 * exists, because the refusals are what stop the first handed-off board being
 * built on a backing that could never settle it.
 *
 * Two properties carry most of the weight:
 *
 * - **The off state.** A bare worker value and a board that hands nothing off
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
import { defineCapability, defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import {
  defineTaskCollection,
  type TaskCollectionRef,
  type TaskWorker,
} from "../../src/tasks";
import {
  isTaskDispatcher,
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

let seatCount = 0;
/** A seat that hands off: the dispatcher a board reads its address from. */
function seat(target = "implement"): TaskWorker {
  seatCount += 1;
  return dispatcher({
    name: `seat-${target}-${seatCount}`,
    type: "task",
    target,
    session: "per-task",
  }) as unknown as TaskWorker;
}

const durable = defineTaskCollection({ id: "hand-off-config-tasks", scope: "user" });

describe("hand-off dispatch — the off state (BP-030 / BP-035)", () => {
  it("leaves a bare-worker board untouched: no boardId, nothing handed off", () => {
    const board = taskBoard({
      name: "inline-board",
      workers: { summarize: worker("summarize") },
    });

    expect(board.handedOff).toEqual([]);
    expect(board.boardId).toBeUndefined();
    expect(board.backing).toBe("request");
  });

  it("reads a `{ worker, dispatch }` entry as before — the detached shape is untouched", () => {
    // The dispatcher seat sits BESIDE the detached entry shape; neither reads
    // the other's declaration. A detached entry stays detached and hands
    // nothing off.
    const board = taskBoard({
      name: "detached-beside",
      boardId: "detached-beside",
      collection: durable,
      workers: {
        summarize: { worker: worker("summarize-2b"), dispatch: { mode: "detached" } },
      },
    });
    expect(board.detachedWorkers.map((slot) => slot.label)).toEqual(["assignee:summarize"]);
    expect(board.handedOff).toEqual([]);
  });

  it("reads a dispatcher seat as handed off, with the address it carries", () => {
    // The drain must see blocks in every seat. A dispatcher is one, so the
    // routing table is built from the same shape it always was; what the
    // board adds is knowing which seats hand off, and where to.
    const board = taskBoard({
      name: "unwrap-board",
      boardId: "unwrap-board",
      collection: durable,
      workers: {
        summarize: worker("summarize-3"),
        implement: seat("implement"),
      },
    });

    expect(board.handedOff.map((slot) => slot.label)).toEqual(["assignee:implement"]);
    expect(board.handedOff[0]?.dispatch).toEqual({
      type: "task",
      target: "implement",
      session: "per-task",
    });
  });
});

describe("isTaskDispatcher", () => {
  it("tells a task dispatcher from an inline block and from a registry", () => {
    const block = worker("discriminate");

    expect(isTaskDispatcher(seat("implement"))).toBe(true);
    expect(isTaskDispatcher(block)).toBe(false);
    expect(isTaskDispatcher({ summarize: block })).toBe(false);
    expect(isTaskDispatcher(undefined)).toBe(false);
    expect(
      isTaskDispatcher(
        dispatcher({ name: "internal", type: "internal", target: "x", session: { key: () => "k" } })
      )
    ).toBe(false);
  });
});

describe("hand-off dispatch — construction-time refusals (decision 11)", () => {
  it("refuses a handed-off board with no boardId, naming the worker", () => {
    expect(() =>
      taskBoard({
        name: "no-id",
        collection: durable,
        workers: { implement: seat("implement") },
      })
    ).toThrow(/no boardId.*assignee:implement|assignee:implement.*no boardId/s);
  });

  it("refuses a handed-off board on the default request backing", () => {
    // The default backing's lifetime IS the request, so handed-off work on it
    // would run with nothing able to settle or observe it — and the failure
    // would appear only after the first restart.
    expect(() =>
      taskBoard({
        name: "request-backed",
        boardId: "request-backed",
        workers: { implement: seat("implement") },
      })
    ).toThrow(/request-backed collection|must be durable/);
  });

  it("refuses a handed-off board on a sequencer backing", () => {
    expect(() =>
      taskBoard({
        name: "seq-backed",
        boardId: "seq-backed",
        collection: { backing: "sequencer", collectionId: "seq-backed" },
        workers: { implement: seat("implement") },
      })
    ).toThrow(/sequencer-backed collection|must be durable/);
  });

  it("refuses a handed-off board on a caller-supplied factory backing", () => {
    // A factory is caller-opaque: the board cannot establish that what comes
    // back is durable, so it cannot honestly accept the declaration.
    expect(() =>
      taskBoard({
        name: "factory-backed",
        boardId: "factory-backed",
        collection: () => ({}) as unknown as TaskCollectionRef,
        workers: { implement: seat("implement") },
      })
    ).toThrow(/factory-backed collection|must be durable/);
  });

  it("refuses a handed-off entry block that declares sessionStateSchema, at defineFlow", () => {
    // Every handed-off block in a flow may share its child session with other
    // rows, so two blocks picking the same key with different shapes corrupt
    // each other with no error anywhere. The refusal is the whole fix. It
    // fires when the flow is defined — the block lives on the flow, so the
    // board cannot see it any earlier.
    const board = taskBoard({
      name: "session-state",
      boardId: "session-state",
      collection: durable,
      workers: { implement: seat("implement") },
    });
    expect(() =>
      defineFlow({
        kind: "session-state",
        actions: { run: { block: board.drain } },
        task: { actions: {
          implement: {
            block: worker("impl-session", { sessionStateSchema: z.object({ topic: z.string() }) }),
          },
        } },
      })
    ).toThrow(/sessionStateSchema/);
  });

  it("refuses a handed-off entry block whose capability declares sessionStateSchema", () => {
    // The schema arrives through `uses`, not the block's own config, and lands
    // in the same shared child session; the refusal reads the block's resolved
    // capabilities so the channel does not matter.
    const memo = defineCapability({
      name: "memo",
      sessionStateSchema: z.object({ topic: z.string() }),
    });
    const board = taskBoard({
      name: "cap-session",
      boardId: "cap-session",
      collection: durable,
      workers: { implement: seat("implement") },
    });
    expect(() =>
      defineFlow({
        kind: "cap-session",
        actions: { run: { block: board.drain } },
        task: { actions: { implement: { block: worker("impl-cap", { uses: [memo] }) } } },
      })
    ).toThrow(/via capability "memo"/);
  });

  it("does NOT refuse sessionStateSchema on an INLINE worker of a hand-off board", () => {
    // The collision is a property of running in the child session a handed-off
    // seat may share with other rows, which an inline worker never joins.
    // Refusing it would be a guard firing on a condition it does not actually
    // test.
    const board = taskBoard({
      name: "mixed-board",
      boardId: "mixed-board",
      collection: durable,
      workers: {
        summarize: worker("sum-session", { sessionStateSchema: z.object({ topic: z.string() }) }),
        implement: seat("implement"),
      },
    });
    expect(() =>
      defineFlow({
        kind: "mixed-board",
        actions: { run: { block: board.drain } },
        task: { actions: { implement: { block: worker("impl-mixed") } } },
      })
    ).not.toThrow();
  });

  it("accepts a durable handed-off board with a boardId", () => {
    const board = taskBoard({
      name: "good-board",
      boardId: "good-board",
      collection: durable,
      workers: {
        summarize: worker("sum-good"),
        implement: seat("implement"),
      },
    });

    expect(board.boardId).toBe("good-board");
    expect(board.backing).toBe("resource");
    expect(board.handedOff).toHaveLength(1);
  });
});

describe("hand-off dispatch — the uniform and floor coordinates", () => {
  it("refuses a task dispatcher as the uniform worker — only a named seat can hand off", () => {
    // A uniform worker has no seat name, so a row it takes has no assignee for
    // the child's gate to check the row against. (The board-level
    // `dispatch: { mode: "detached" }` option is a different mechanism and is
    // untouched here.)
    expect(() =>
      taskBoard({
        name: "uniform-detached",
        boardId: "uniform-detached",
        collection: durable,
        workers: seat("uniform-impl"),
      })
    ).toThrow(/only a named seat can hand off/);
  });

  it("refuses a hand-off through the delegation floor — only a named seat can hand off", () => {
    // The floor has no seat name — a row it takes has no assignee — so there
    // is nothing for the child's gate to check the row against.
    expect(() =>
      taskBoard({
        name: "floor-detached",
        boardId: "floor-detached",
        collection: durable,
        workers: { summarize: worker("sum-floor") },
        defaultWorker: seat("floor-impl"),
      })
    ).toThrow(/only a named seat can hand off/);
  });
});

describe("hand-off dispatch — a session-scoped ledger is refused at construction", () => {
  /**
   * A handed-off worker runs in its own child session, and a session-scoped
   * collection resolves against the running session — so the child addresses
   * an empty ledger and never finds the row it was dispatched for.
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
        workers: { implement: seat("implement") },
      })
    ).toThrow(/session-scoped collection/);
  });

  it("names the declared worker, so the message points at what would not run", () => {
    expect(() =>
      taskBoard({
        name: "session-detached-named",
        boardId: "session-detached-named",
        collection: sessionScoped,
        workers: { implement: seat("implement") },
      })
    ).toThrow(/assignee:implement/);
  });

  it("points at sharedToWorkstream as the fix", () => {
    expect(() =>
      taskBoard({
        name: "session-detached-fix",
        boardId: "session-detached-fix",
        collection: sessionScoped,
        workers: { implement: seat("implement") },
      })
    ).toThrow(/sharedToWorkstream/);
  });

  it("leaves a session-scoped board with nothing handed off alone", () => {
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

  it("accepts a handed-off board on a user-scoped ledger", () => {
    // The control: same declaration, reachable scope. Without this the refusal
    // above would pass just as well against a guard that refused every
    // handed-off board.
    expect(() =>
      taskBoard({
        name: "user-detached",
        boardId: "user-detached",
        collection: defineTaskCollection({ id: "user-tasks", scope: "user" }),
        workers: { implement: seat("implement") },
      })
    ).not.toThrow();
  });
});

describe("the session-schema refusal sees composed children", () => {
  /** A flow whose one board hands `implement` off to `block`. */
  function flowHandingOffTo(kind: string, block: TaskWorker) {
    const board = taskBoard({
      name: kind,
      boardId: kind,
      collection: durable,
      workers: { implement: seat("implement") },
    });
    return defineFlow({
      kind,
      actions: { run: { block: board.drain } },
      task: { actions: { implement: { block } } },
    });
  }

  it("refuses a schema declared by a step inside the entry block", () => {
    // A handed-off block is routinely a sequencer, and the block declaring the
    // schema is usually a step inside it. It runs in the child session exactly
    // as the root would, and collides with a sibling route's key exactly as
    // the root would — so inspecting only the root accepted the flow and left
    // the declaration to surface as a missing typed key inside the child.
    const nested = sequencer({ name: "outer" }).tap(
      handler({
        name: "inner-with-state",
        sessionStateSchema: z.object({ needed: z.string() }),
        execute: () => null,
      })
    );

    expect(() => flowHandingOffTo("nested-session-state", nested as never)).toThrow(
      /sessionStateSchema/
    );
  });

  it("names the composed block, not just the entry block", () => {
    const nested = sequencer({ name: "outer-2" }).tap(
      handler({
        name: "inner-named",
        sessionStateSchema: z.object({ needed: z.string() }),
        execute: () => null,
      })
    );

    expect(() => flowHandingOffTo("nested-session-named", nested as never)).toThrow(/inner-named/);
  });

  it("leaves a composed block that declares none alone", () => {
    // The control. A walk that flagged any sequencer would refuse most
    // handed-off boards in the codebase.
    const plain = sequencer({ name: "outer-plain" }).tap(
      handler({ name: "inner-plain", execute: () => null })
    );

    expect(() => flowHandingOffTo("nested-session-clean", plain as never)).not.toThrow();
  });
});
